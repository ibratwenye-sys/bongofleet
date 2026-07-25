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
import { Prisma, PaymentStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto';

const AMOUNT_CAP_MULTIPLIER = 1.5;

export const ALLOWED_RECEIPT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);
export const MAX_RECEIPT_SIZE_BYTES = 10 * 1024 * 1024;

export function receiptFileFilter(
  _req: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
): void {
  if (!ALLOWED_RECEIPT_MIME_TYPES.has(file.mimetype)) {
    callback(new BadRequestException('Only JPEG, PNG, or PDF receipts are allowed'), false);
    return;
  }
  callback(null, true);
}

function sanitizeFileName(originalName: string): string {
  return originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

@Injectable()
export class PaymentService {
  private readonly uploadsDir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.uploadsDir = this.config.get<string>('UPLOADS_DIR', './uploads');
  }

  async createPayment(dto: CreatePaymentDto, actor: AuthenticatedUser) {
    const assignment = await this.prisma.client.dailyAssignment.findUnique({
      where: { id: dto.dailyAssignmentId },
    });
    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    const rider = await this.prisma.client.rider.findUnique({ where: { id: dto.riderId } });
    if (!rider) {
      throw new NotFoundException('Rider not found');
    }

    if (dto.riderId !== assignment.riderId) {
      throw new BadRequestException("riderId does not match the assignment's rider");
    }

    if (actor.role === UserRole.RIDER) {
      const ownRiderId = await this.getOwnRiderId(actor);
      if (ownRiderId !== assignment.riderId) {
        throw new ForbiddenException('You may only record payments for your own assignments');
      }
    }

    const cap = new Prisma.Decimal(assignment.targetAmount).times(AMOUNT_CAP_MULTIPLIER);
    if (new Prisma.Decimal(dto.amount).greaterThan(cap)) {
      throw new BadRequestException(
        `Amount exceeds ${AMOUNT_CAP_MULTIPLIER * 100}% of the assignment's target amount`,
      );
    }

    return this.prisma.client.dailyPayment.create({
      data: {
        tenantId: actor.tenantId,
        dailyAssignmentId: dto.dailyAssignmentId,
        riderId: dto.riderId,
        amount: dto.amount,
        paymentMethod: dto.paymentMethod,
        status: PaymentStatus.PENDING,
      },
    });
  }

  async listPayments(query: ListPaymentsQueryDto, actor: AuthenticatedUser) {
    const where: Prisma.DailyPaymentWhereInput = {};

    if (actor.role === UserRole.RIDER) {
      where.riderId = await this.getOwnRiderId(actor);
    } else if (query.riderId) {
      where.riderId = query.riderId;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.dateFrom || query.dateTo) {
      where.createdAt = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }

    return this.prisma.client.dailyPayment.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  async getPayment(id: string, actor: AuthenticatedUser) {
    const payment = await this.prisma.client.dailyPayment.findUnique({
      where: { id },
      include: { rider: true, dailyAssignment: true },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (actor.role === UserRole.RIDER) {
      const ownRiderId = await this.getOwnRiderId(actor);
      if (payment.riderId !== ownRiderId) {
        throw new NotFoundException('Payment not found');
      }
    }

    return payment;
  }

  async updatePaymentStatus(id: string, dto: UpdatePaymentDto, actor: AuthenticatedUser) {
    if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
      throw new ForbiddenException('Only OWNER or MANAGER may reconcile payments');
    }

    const payment = await this.prisma.client.dailyPayment.findUnique({ where: { id } });
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.status !== PaymentStatus.PENDING || dto.status === PaymentStatus.PENDING) {
      throw new BadRequestException(
        `Cannot transition payment from ${payment.status} to ${dto.status}`,
      );
    }

    return this.prisma.client.dailyPayment.update({
      where: { id },
      data: {
        status: dto.status,
        paymentMethod: dto.paymentMethod ?? payment.paymentMethod,
        paidAt: dto.status === PaymentStatus.COMPLETED ? new Date() : payment.paidAt,
      },
    });
  }

  async getPaymentsByAssignment(assignmentId: string, actor: AuthenticatedUser) {
    const assignment = await this.prisma.client.dailyAssignment.findUnique({
      where: { id: assignmentId },
    });
    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    if (actor.role === UserRole.RIDER) {
      const ownRiderId = await this.getOwnRiderId(actor);
      if (assignment.riderId !== ownRiderId) {
        throw new NotFoundException('Assignment not found');
      }
    }

    return this.prisma.client.dailyPayment.findMany({
      where: { dailyAssignmentId: assignmentId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async uploadReceipt(id: string, file: Express.Multer.File, actor: AuthenticatedUser) {
    const payment = await this.prisma.client.dailyPayment.findUnique({ where: { id } });
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }
    if (actor.role === UserRole.RIDER) {
      const ownRiderId = await this.getOwnRiderId(actor);
      if (payment.riderId !== ownRiderId) {
        // Same "not found" as an unknown id, so a rider can't probe others' ids.
        throw new NotFoundException('Payment not found');
      }
    }

    const fileName = `${randomUUID()}-${sanitizeFileName(file.originalname)}`;
    const storageKey = path.join(actor.tenantId, 'payment-receipts', fileName);
    const absolutePath = path.join(this.uploadsDir, storageKey);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, file.buffer);

    try {
      const updated = await this.prisma.client.dailyPayment.update({
        where: { id },
        data: {
          receiptStorageKey: storageKey,
          receiptFileName: file.originalname,
          receiptMimeType: file.mimetype,
          receiptSizeBytes: file.size,
          receiptUploadedAt: new Date(),
        },
      });
      // Replacing an earlier receipt? drop the now-orphaned file.
      if (payment.receiptStorageKey && payment.receiptStorageKey !== storageKey) {
        await fs
          .unlink(path.join(this.uploadsDir, payment.receiptStorageKey))
          .catch(() => undefined);
      }
      return updated;
    } catch (error) {
      await fs.unlink(absolutePath).catch(() => undefined);
      throw error;
    }
  }

  async getReceiptFile(id: string, actor: AuthenticatedUser) {
    const payment = await this.prisma.client.dailyPayment.findUnique({ where: { id } });
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }
    if (actor.role === UserRole.RIDER) {
      const ownRiderId = await this.getOwnRiderId(actor);
      if (payment.riderId !== ownRiderId) {
        throw new NotFoundException('Payment not found');
      }
    }
    if (!payment.receiptStorageKey) {
      throw new NotFoundException('No receipt uploaded for this payment');
    }
    const absolutePath = path.join(this.uploadsDir, payment.receiptStorageKey);
    try {
      await fs.access(absolutePath);
    } catch {
      throw new NotFoundException('Receipt file not found');
    }
    return { payment, absolutePath };
  }

  private async getOwnRiderId(actor: AuthenticatedUser): Promise<string> {
    const rider = await this.prisma.client.rider.findUnique({
      where: { userId: actor.userId },
    });
    if (!rider) {
      throw new ForbiddenException('No rider profile is associated with this account');
    }
    return rider.id;
  }
}
