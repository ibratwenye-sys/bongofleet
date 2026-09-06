import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TransportReconciliationService } from './transport-reconciliation.service';
import { parseRowSelections } from './row-selections';

const MAX_STATEMENT_SIZE_BYTES = 10 * 1024 * 1024;

const CSV_MIME_TYPES = new Set(['text/csv', 'application/csv', 'application/vnd.ms-excel']);
const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Extends bulk-import's own workbookFileFilter shape to also accept .csv -
 *  a bank/mobile-money statement export is at least as likely to be a CSV
 *  as an .xlsx, unlike bulk-import's own fixed-template workbooks. */
function statementFileFilter(
  _req: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
): void {
  const name = file.originalname.toLowerCase();
  const okType =
    file.mimetype === XLSX_MIME_TYPE ||
    CSV_MIME_TYPES.has(file.mimetype) ||
    name.endsWith('.xlsx') ||
    name.endsWith('.csv');
  callback(
    okType ? null : new BadRequestException('Only .xlsx or .csv statement files are accepted'),
    okType,
  );
}

/**
 * TRANSPORT_DESIGN.md §6 - manual statement-upload matching for TransportJob
 * payments. OWNER or MANAGER (the existing rental payment-recording role
 * gate), not bulk-import's OWNER-only - this touches at most a handful of
 * jobs per upload, not dozens of records fleet-wide. No session/draft state
 * between preview and commit - the dashboard re-sends the same file it
 * already has, exactly like bulk-import's own convention.
 */
@ApiTags('transport-reconciliation')
@ApiBearerAuth()
@Controller('transport-reconciliation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.MANAGER)
export class TransportReconciliationController {
  constructor(private readonly service: TransportReconciliationService) {}

  @Post('preview')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_STATEMENT_SIZE_BYTES },
      fileFilter: statementFileFilter,
    }),
  )
  preview(@UploadedFile() file: Express.Multer.File, @CurrentUser() actor: AuthenticatedUser) {
    if (!file) {
      throw new BadRequestException('A file is required');
    }
    return this.service.preview(file, actor);
  }

  @Post('commit')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_STATEMENT_SIZE_BYTES },
      fileFilter: statementFileFilter,
    }),
  )
  commit(
    @UploadedFile() file: Express.Multer.File,
    @Body('selections') rawSelections: unknown,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!file) {
      throw new BadRequestException('A file is required');
    }
    const selections = parseRowSelections(rawSelections);
    return this.service.commit(file, selections, actor);
  }
}
