import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentOwnerType, DocumentType, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { DocumentService } from '../document/document.service';
import { renderContractPdf } from './ownership-plan-contract.pdf';

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
    throw new ForbiddenException('Only OWNER or MANAGER may manage ownership plan contracts');
  }
}

/**
 * §9. Generation reuses DocumentService.create() end to end - same storage-key
 * convention, same uploads directory, a real Document row - by handing it a
 * synthetic in-memory "upload" of the rendered PDF. No second way to write a
 * file. Reading has to be its own code, though: DocumentController/
 * DocumentService.getFile() are OWNER/MANAGER-only, and the driver on the
 * plan must also be able to fetch their own contract - the one place in the
 * system a driver reads a document by id.
 */
@Injectable()
export class OwnershipPlanContractService {
  private readonly uploadsDir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly documentService: DocumentService,
    private readonly config: ConfigService,
  ) {
    this.uploadsDir = this.config.get<string>('UPLOADS_DIR', './uploads');
  }

  async generate(planId: string, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    const plan = await this.prisma.client.ownershipPlan.findUnique({ where: { id: planId } });
    if (!plan) {
      throw new NotFoundException('Ownership plan not found');
    }

    const [driver, motorcycle, tenant] = await Promise.all([
      this.prisma.client.driver.findUnique({
        where: { id: plan.driverId },
        include: { user: { select: { firstName: true, lastName: true } } },
      }),
      this.prisma.client.motorcycle.findUnique({ where: { id: plan.motorcycleId } }),
      this.prisma.client.tenant.findUnique({ where: { id: actor.tenantId } }),
    ]);
    if (!driver || !motorcycle || !tenant) {
      throw new NotFoundException('Driver, vehicle, or tenant for this ownership plan not found');
    }

    const buffer = await renderContractPdf({
      businessName: tenant.name,
      driverName: `${driver.user.firstName} ${driver.user.lastName}`,
      driverNationalId: driver.nationalId,
      vehicleMakeModel:
        [motorcycle.make, motorcycle.model].filter(Boolean).join(' ') || 'Not on file',
      registrationNumber: motorcycle.registrationNumber,
      totalPrice: plan.totalPrice,
      downPayment: plan.downPayment,
      dailyAmount: plan.dailyAmount,
      activeWeekdays: plan.activeWeekdays,
      graceDays: plan.graceDays,
      startDate: plan.startDate,
      contractEndDate: plan.contractEndDate,
    });

    // A synthetic "upload" - DocumentService.create() never inspects `stream`
    // (MemoryStorage-only fields are all that matters: buffer/size/mimetype).
    const file: Express.Multer.File = {
      fieldname: 'file',
      originalname: `hire-purchase-contract-${plan.id}.pdf`,
      encoding: '7bit',
      mimetype: 'application/pdf',
      size: buffer.length,
      buffer,
      stream: Readable.from(Buffer.alloc(0)),
      destination: '',
      filename: '',
      path: '',
    };

    // Regenerating creates a NEW Document row rather than replacing the old
    // one - contract terms are the kind of thing people argue about later.
    return this.documentService.create(
      file,
      {
        ownerType: DocumentOwnerType.OWNERSHIP_PLAN,
        ownerId: plan.id,
        docType: DocumentType.HIRE_PURCHASE_CONTRACT,
      },
      actor,
    );
  }

  async getLatest(planId: string, actor: AuthenticatedUser) {
    const plan = await this.getPlanOrThrow(planId);
    await this.assertCanRead(plan, actor);

    // Newest wins: an uploaded signed scan supersedes the generated PDF
    // automatically, and a deliberate regeneration afterwards supersedes the
    // scan - acceptable because the same person (OWNER/MANAGER) controls both.
    const document = await this.prisma.client.document.findFirst({
      where: {
        ownerType: DocumentOwnerType.OWNERSHIP_PLAN,
        ownerId: planId,
        docType: DocumentType.HIRE_PURCHASE_CONTRACT,
      },
      // Tiebreaker in case two documents land in the same millisecond.
      orderBy: [{ uploadedAt: 'desc' }, { createdAt: 'desc' }],
    });
    if (!document) {
      throw new NotFoundException('No contract has been generated or uploaded for this plan yet');
    }

    const absolutePath = path.join(this.uploadsDir, document.storageKey);
    try {
      await fs.access(absolutePath);
    } catch {
      throw new NotFoundException('Contract file not found');
    }
    return { document, absolutePath };
  }

  async listAll(planId: string, actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);
    await this.getPlanOrThrow(planId);

    return this.prisma.client.document.findMany({
      where: {
        ownerType: DocumentOwnerType.OWNERSHIP_PLAN,
        ownerId: planId,
        docType: DocumentType.HIRE_PURCHASE_CONTRACT,
      },
      // Tiebreaker in case two documents land in the same millisecond.
      orderBy: [{ uploadedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  private async getPlanOrThrow(planId: string) {
    const plan = await this.prisma.client.ownershipPlan.findUnique({ where: { id: planId } });
    if (!plan) {
      throw new NotFoundException('Ownership plan not found');
    }
    return plan;
  }

  /**
   * OWNER/MANAGER of the tenant, or the driver on this specific plan - no one
   * else, including other drivers in the same tenant. Deliberately not the
   * uniform "NotFound to avoid leaking existence" pattern used elsewhere
   * (e.g. OwnershipPlanService.get): a same-tenant driver who isn't on the
   * plan gets an explicit Forbidden, while a genuinely cross-tenant request
   * gets NotFound because the tenant-scoped query above never finds the plan.
   */
  private async assertCanRead(plan: { driverId: string }, actor: AuthenticatedUser): Promise<void> {
    if (actor.role === UserRole.OWNER || actor.role === UserRole.MANAGER) {
      return;
    }
    if (actor.role === UserRole.RIDER) {
      const driver = await this.prisma.client.driver.findUnique({
        where: { userId: actor.userId },
      });
      if (driver && driver.id === plan.driverId) {
        return;
      }
    }
    throw new ForbiddenException('Not authorized to view this contract');
  }
}
