import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { BulkImportService } from './bulk-import.service';
import { buildTemplateWorkbook } from './bulk-import.template';
import { BULK_IMPORT_SHEETS, BulkImportSheet } from './bulk-import.types';

const MAX_WORKBOOK_SIZE_BYTES = 10 * 1024 * 1024;

function workbookFileFilter(
  _req: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
): void {
  const okType =
    file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    file.originalname.toLowerCase().endsWith('.xlsx');
  callback(okType ? null : new BadRequestException('Only .xlsx workbooks are accepted'), okType);
}

const TEMPLATE_FILE_NAME: Record<BulkImportSheet, string> = {
  vehicles: 'bongofleet-vehicles-template.xlsx',
  drivers: 'bongofleet-drivers-template.xlsx',
  assignments: 'bongofleet-assignments-template.xlsx',
  ownershipPlans: 'bongofleet-ownership-plans-template.xlsx',
};

/**
 * Stage BI1 - bulk import from Excel. OWNER-only on every route (tighter
 * than the OWNER+MANAGER document-upload precedent - this changes dozens of
 * records in one shot, a bigger blast radius). No session/draft state
 * between preview and commit - the dashboard just re-sends the same file it
 * already has (see bulk-import.service.ts).
 */
@ApiTags('bulk-import')
@ApiBearerAuth()
@Controller('bulk-import')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER)
export class BulkImportController {
  constructor(private readonly bulkImportService: BulkImportService) {}

  @Post('preview')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_WORKBOOK_SIZE_BYTES },
      fileFilter: workbookFileFilter,
    }),
  )
  preview(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('A file is required');
    }
    return this.bulkImportService.preview(file);
  }

  @Post('commit')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_WORKBOOK_SIZE_BYTES },
      fileFilter: workbookFileFilter,
    }),
  )
  commit(@UploadedFile() file: Express.Multer.File, @CurrentUser() actor: AuthenticatedUser) {
    if (!file) {
      throw new BadRequestException('A file is required');
    }
    return this.bulkImportService.commit(file, actor);
  }

  @Get('templates/:sheet')
  async downloadTemplate(@Param('sheet') sheet: string, @Res() res: Response): Promise<void> {
    if (!BULK_IMPORT_SHEETS.includes(sheet as BulkImportSheet)) {
      throw new BadRequestException('Unknown template');
    }
    const typedSheet = sheet as BulkImportSheet;
    const workbook = buildTemplateWorkbook(typedSheet);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${TEMPLATE_FILE_NAME[typedSheet]}"`,
    });
    await workbook.xlsx.write(res);
    res.end();
  }
}
