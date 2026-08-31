import { createReadStream } from 'node:fs';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
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
import { DocumentService, MAX_DOCUMENT_SIZE_BYTES, documentFileFilter } from './document.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';
import { ListExpiringDocumentsQueryDto } from './dto/list-expiring-documents-query.dto';

@ApiTags('document')
@ApiBearerAuth()
@Controller('documents')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.MANAGER)
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_DOCUMENT_SIZE_BYTES },
      fileFilter: documentFileFilter,
    }),
  )
  create(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateDocumentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!file) {
      throw new BadRequestException('A file is required');
    }
    return this.documentService.create(file, dto, actor);
  }

  @Get()
  list(@Query() query: ListDocumentsQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.documentService.list(query, actor);
  }

  @Get('expiring')
  listExpiring(
    @Query() query: ListExpiringDocumentsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.documentService.listExpiring(query, actor);
  }

  // Stage DM11 - the driver app's own documents, RIDER included on top of
  // the class-level OWNER/MANAGER default (RolesGuard's getAllAndOverride
  // makes a handler-level @Roles fully replace, not add to, the class
  // default - verified directly rather than assumed). Must stay ahead of
  // `:id/file` below - same fixed-segment-before-param convention used
  // throughout this codebase (e.g. ownership-plans' own `summary`/`:id`
  // ordering), even though "mine" as a single segment can't actually
  // collide with the two-segment `:id/file` pattern.
  @Get('mine')
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.RIDER)
  listMine(@CurrentUser() actor: AuthenticatedUser) {
    return this.documentService.listMine(actor);
  }

  @Get(':id/file')
  async downloadFile(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { document, absolutePath } = await this.documentService.getFile(id, actor);
    res.set({
      'Content-Type': document.mimeType,
      'Content-Disposition': `attachment; filename="${document.fileName}"`,
    });
    return new StreamableFile(createReadStream(absolutePath));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.documentService.remove(id, actor);
  }
}
