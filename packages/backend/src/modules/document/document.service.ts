import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentOwnerType, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { CreateDocumentDto } from './dto/create-document.dto';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';
import { ListExpiringDocumentsQueryDto } from './dto/list-expiring-documents-query.dto';

export type DocumentExpiryStatus = 'VALID' | 'EXPIRING_SOON' | 'EXPIRED';

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
    throw new ForbiddenException('Only OWNER or MANAGER may manage documents');
  }
}

export function computeDocumentStatus(
  expiryDate: Date | null,
  withinDays: number,
  now: Date = new Date(),
): DocumentExpiryStatus {
  if (!expiryDate) {
    return 'VALID';
  }
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const horizon = new Date(today);
  horizon.setUTCDate(horizon.getUTCDate() + withinDays);

  if (expiryDate.getTime() < today.getTime()) {
    return 'EXPIRED';
  }
  if (expiryDate.getTime() <= horizon.getTime()) {
    return 'EXPIRING_SOON';
  }
  return 'VALID';
}

function sanitizeFileName(originalName: string): string {
  return originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

@Injectable()
export class DocumentService {
  private readonly uploadsDir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.uploadsDir = this.config.get<string>('UPLOADS_DIR', './uploads');
  }

  private async assertOwnerExists(ownerType: DocumentOwnerType, ownerId: string): Promise<void> {
    let found: unknown;
    if (ownerType === DocumentOwnerType.RIDER) {
      found = await this.prisma.client.rider.findUnique({ where: { id: ownerId } });
    } else if (ownerType === DocumentOwnerType.MOTORCYCLE) {
      found = await this.prisma.client.motorcycle.findUnique({ where: { id: ownerId } });
    } else {
      found = await this.prisma.client.guarantor.findUnique({ where: { id: ownerId } });
    }
    if (!found) {
      throw new NotFoundException(`${ownerType.toLowerCase()} not found`);
    }
  }

  async create(file: Express.Multer.File, dto: CreateDocumentDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);
    await this.assertOwnerExists(dto.ownerType, dto.ownerId);

    const fileName = `${randomUUID()}-${sanitizeFileName(file.originalname)}`;
    const storageKey = path.join(actor.tenantId, fileName);
    const absolutePath = path.join(this.uploadsDir, storageKey);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, file.buffer);

    try {
      return await this.prisma.client.document.create({
        data: {
          tenantId: actor.tenantId,
          ownerType: dto.ownerType,
          ownerId: dto.ownerId,
          docType: dto.docType,
          referenceNumber: dto.referenceNumber,
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
          fileName: file.originalname,
          mimeType: file.mimetype,
          storageKey,
          sizeBytes: file.size,
          uploadedAt: new Date(),
        },
      });
    } catch (error) {
      await fs.unlink(absolutePath).catch(() => undefined);
      throw error;
    }
  }

  async list(query: ListDocumentsQueryDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    return this.prisma.client.document.findMany({
      where: { ownerType: query.ownerType, ownerId: query.ownerId },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async getFile(id: string, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    const document = await this.prisma.client.document.findUnique({ where: { id } });
    if (!document) {
      throw new NotFoundException('Document not found');
    }

    const absolutePath = path.join(this.uploadsDir, document.storageKey);
    try {
      await fs.access(absolutePath);
    } catch {
      throw new NotFoundException('Document file not found');
    }

    return { document, absolutePath };
  }

  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    assertOwnerOrManager(actor);

    const document = await this.prisma.client.document.findUnique({ where: { id } });
    if (!document) {
      throw new NotFoundException('Document not found');
    }

    await fs.unlink(path.join(this.uploadsDir, document.storageKey)).catch(() => undefined);
    await this.prisma.client.document.delete({ where: { id } });
  }

  async listExpiring(query: ListExpiringDocumentsQueryDto, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    const withinDays = query.withinDays ?? 30;
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const horizon = new Date(today);
    horizon.setUTCDate(horizon.getUTCDate() + withinDays);

    const documents = await this.prisma.client.document.findMany({
      where: { expiryDate: { not: null, lte: horizon } },
      orderBy: { expiryDate: 'asc' },
    });

    const ownerLabels = await this.buildOwnerLabels(documents);

    return documents.map((doc) => ({
      ...doc,
      status: computeDocumentStatus(doc.expiryDate, withinDays, now),
      ownerLabel: ownerLabels.get(`${doc.ownerType}:${doc.ownerId}`) ?? 'Unknown',
    }));
  }

  private async buildOwnerLabels(
    documents: Array<{ ownerType: DocumentOwnerType; ownerId: string }>,
  ): Promise<Map<string, string>> {
    const labels = new Map<string, string>();

    const idsByType = new Map<DocumentOwnerType, Set<string>>();
    for (const doc of documents) {
      const set = idsByType.get(doc.ownerType) ?? new Set<string>();
      set.add(doc.ownerId);
      idsByType.set(doc.ownerType, set);
    }

    const riderIds = [...(idsByType.get(DocumentOwnerType.RIDER) ?? [])];
    if (riderIds.length > 0) {
      const riders = await this.prisma.client.rider.findMany({
        where: { id: { in: riderIds } },
        include: { user: { select: { firstName: true, lastName: true } } },
      });
      for (const rider of riders) {
        labels.set(
          `${DocumentOwnerType.RIDER}:${rider.id}`,
          `${rider.user.firstName} ${rider.user.lastName}`,
        );
      }
    }

    const motorcycleIds = [...(idsByType.get(DocumentOwnerType.MOTORCYCLE) ?? [])];
    if (motorcycleIds.length > 0) {
      const motorcycles = await this.prisma.client.motorcycle.findMany({
        where: { id: { in: motorcycleIds } },
      });
      for (const motorcycle of motorcycles) {
        labels.set(
          `${DocumentOwnerType.MOTORCYCLE}:${motorcycle.id}`,
          motorcycle.registrationNumber,
        );
      }
    }

    const guarantorIds = [...(idsByType.get(DocumentOwnerType.GUARANTOR) ?? [])];
    if (guarantorIds.length > 0) {
      const guarantors = await this.prisma.client.guarantor.findMany({
        where: { id: { in: guarantorIds } },
      });
      for (const guarantor of guarantors) {
        labels.set(
          `${DocumentOwnerType.GUARANTOR}:${guarantor.id}`,
          `${guarantor.firstName} ${guarantor.lastName}`,
        );
      }
    }

    return labels;
  }
}

export const ALLOWED_DOCUMENT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);
export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;

export function documentFileFilter(
  _req: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
): void {
  if (!ALLOWED_DOCUMENT_MIME_TYPES.has(file.mimetype)) {
    callback(new BadRequestException('Only JPEG, PNG, or PDF files are allowed'), false);
    return;
  }
  callback(null, true);
}
