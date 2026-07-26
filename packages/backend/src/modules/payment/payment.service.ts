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
import { computeRemainingToOwn } from '../ownership-plan/ownership-plan.derivation';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto';

const AMOUNT_CAP_MULTIPLIER = 1.5;

/**
 * A plan payment above this many days' worth of the plan's daily amount
 * needs an explicit confirmLargeAmount - the difference between 120,000 and
 * 1,200,000 is one keystroke on a phone.
 */
const PLAN_PAYMENT_CAP_DAYS = 90;

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

    const driver = await this.prisma.client.driver.findUnique({ where: { id: dto.driverId } });
    if (!driver) {
      throw new NotFoundException('Driver not found');
    }

    if (dto.driverId !== assignment.driverId) {
      throw new BadRequestException("driverId does not match the assignment's driver");
    }

    if (actor.role === UserRole.RIDER) {
      const ownDriverId = await this.getOwnDriverId(actor);
      if (ownDriverId !== assignment.driverId) {
        throw new ForbiddenException('You may only record payments for your own assignments');
      }
    }

    // Plan assignments relax the over-target guard - paying more is the
    // point (§7) - and allocate via the oldest-first cascade instead.
    // Ordinary rental assignments keep today's typo-catching cap.
    if (assignment.ownershipPlanId) {
      return this.createPlanPayment(assignment, dto, actor);
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
        driverId: dto.driverId,
        amount: dto.amount,
        paymentMethod: dto.paymentMethod,
        status: PaymentStatus.PENDING,
      },
    });
  }

  /**
   * §7 overpayment allocation. The incoming amount is a pool distributed
   * across the plan's assignments oldest-first, then forward in date order;
   * whatever survives after every assignment is fully covered sits as
   * surplus on the most recent one (ordinarily today's) - which netPosition
   * reads as days ahead. One transaction, so a partial cascade never persists.
   *
   * This does NOT touch amountBilled/remainingToBill (Part 1): overpaying
   * shrinks the deficit in amountPaid/remainingToOwn only. The generator
   * still creates each day's row until remainingToBill is exhausted - there
   * is no credit ledger and no consumption step here.
   */
  private async createPlanPayment(
    assignment: { ownershipPlanId: string | null },
    dto: CreatePaymentDto,
    actor: AuthenticatedUser,
  ) {
    const planId = assignment.ownershipPlanId as string;
    const plan = await this.prisma.client.ownershipPlan.findUnique({ where: { id: planId } });
    if (!plan) {
      throw new NotFoundException('Ownership plan not found');
    }

    const amount = new Prisma.Decimal(dto.amount);
    const cap = new Prisma.Decimal(plan.dailyAmount).times(PLAN_PAYMENT_CAP_DAYS);
    if (amount.greaterThan(cap) && !dto.confirmLargeAmount) {
      throw new BadRequestException(
        `Amount exceeds ${PLAN_PAYMENT_CAP_DAYS} days' worth of the plan's daily amount - ` +
          'resubmit with confirmLargeAmount to proceed',
      );
    }

    const planAssignments = await this.prisma.client.dailyAssignment.findMany({
      where: { ownershipPlanId: planId },
      orderBy: { assignedDate: 'asc' },
      include: { dailyPayments: { where: { status: { not: PaymentStatus.FAILED } } } },
    });

    // A driver can never be asked to pay more than the vehicle is worth: the
    // vehicle is exactly what remainingToOwn (COMPLETED payments only, the
    // canonical figure from Part 1) says is still outstanding.
    const amountPaidCompleted = planAssignments.reduce(
      (
        sum: Prisma.Decimal,
        a: { dailyPayments: Array<{ amount: Prisma.Decimal; status: PaymentStatus }> },
      ) =>
        sum.plus(
          a.dailyPayments.reduce(
            (s: Prisma.Decimal, p) => (p.status === PaymentStatus.COMPLETED ? s.plus(p.amount) : s),
            new Prisma.Decimal(0),
          ),
        ),
      new Prisma.Decimal(0),
    );
    const remainingToOwn = computeRemainingToOwn(
      new Prisma.Decimal(plan.totalPrice),
      new Prisma.Decimal(plan.downPayment),
      amountPaidCompleted,
    );
    if (remainingToOwn.lessThanOrEqualTo(0)) {
      throw new BadRequestException(
        'This ownership plan is already fully paid - no further plan payments are needed',
      );
    }
    if (amount.greaterThan(remainingToOwn)) {
      throw new BadRequestException(
        `Amount exceeds the ${remainingToOwn.toFixed(2)} still owed on this ownership plan`,
      );
    }

    // Oldest-first: how much each assignment still needs, before this payment.
    const remainingByAssignment = new Map<string, Prisma.Decimal>();
    for (const a of planAssignments) {
      const covered = a.dailyPayments.reduce(
        (sum: Prisma.Decimal, p: { amount: Prisma.Decimal }) => sum.plus(p.amount),
        new Prisma.Decimal(0),
      );
      remainingByAssignment.set(
        a.id,
        Prisma.Decimal.max(0, new Prisma.Decimal(a.targetAmount).minus(covered)),
      );
    }

    let pool = amount;
    const allocations = new Map<string, Prisma.Decimal>();
    for (const a of planAssignments) {
      if (pool.lessThanOrEqualTo(0)) break;
      const remaining = remainingByAssignment.get(a.id) as Prisma.Decimal;
      if (remaining.lessThanOrEqualTo(0)) continue;
      const take = Prisma.Decimal.min(pool, remaining);
      allocations.set(a.id, (allocations.get(a.id) ?? new Prisma.Decimal(0)).plus(take));
      pool = pool.minus(take);
    }

    if (pool.greaterThan(0)) {
      // Every assignment is fully covered - the rest is surplus against the
      // most recent one (ordinarily today), which is what buys days ahead.
      const latest = planAssignments[planAssignments.length - 1];
      allocations.set(latest.id, (allocations.get(latest.id) ?? new Prisma.Decimal(0)).plus(pool));
      pool = new Prisma.Decimal(0);
    }

    return this.prisma.client.$transaction(async (tx) => {
      const created = [];
      for (const [dailyAssignmentId, allocatedAmount] of allocations) {
        created.push(
          await tx.dailyPayment.create({
            data: {
              tenantId: actor.tenantId,
              dailyAssignmentId,
              driverId: dto.driverId,
              amount: allocatedAmount,
              paymentMethod: dto.paymentMethod,
              status: PaymentStatus.PENDING,
            },
          }),
        );
      }
      return created;
    });
  }

  async listPayments(query: ListPaymentsQueryDto, actor: AuthenticatedUser) {
    const where: Prisma.DailyPaymentWhereInput = {};

    if (actor.role === UserRole.RIDER) {
      where.driverId = await this.getOwnDriverId(actor);
    } else if (query.driverId) {
      where.driverId = query.driverId;
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
      include: { driver: true, dailyAssignment: true },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (actor.role === UserRole.RIDER) {
      const ownDriverId = await this.getOwnDriverId(actor);
      if (payment.driverId !== ownDriverId) {
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
      const ownDriverId = await this.getOwnDriverId(actor);
      if (assignment.driverId !== ownDriverId) {
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
      const ownDriverId = await this.getOwnDriverId(actor);
      if (payment.driverId !== ownDriverId) {
        // Same "not found" as an unknown id, so a driver can't probe others' ids.
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
      const ownDriverId = await this.getOwnDriverId(actor);
      if (payment.driverId !== ownDriverId) {
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

  private async getOwnDriverId(actor: AuthenticatedUser): Promise<string> {
    const driver = await this.prisma.client.driver.findUnique({
      where: { userId: actor.userId },
    });
    if (!driver) {
      throw new ForbiddenException('No driver profile is associated with this account');
    }
    return driver.id;
  }
}
