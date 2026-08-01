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
import { DailyPayment, Prisma, PaymentStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { computeRemainingUnreserved } from '../ownership-plan/ownership-plan.derivation';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto';

const AMOUNT_CAP_MULTIPLIER = 1.5;

/**
 * createPayment's return shape, for both the ordinary and plan-cascade
 * paths - purely additive over the raw DailyPayment row (id/amount/status/
 * dailyAssignmentId keep meaning exactly what they always have; the mobile
 * "Record payment" flow from patch 0010 reads only those and keeps working).
 *
 * The object itself (the "primary") is the row created against the
 * assignment named in the request, when one exists - and otherwise the
 * OLDEST allocation. A driver deep in arrears may pay against today's row
 * and have all of it consumed clearing older days, leaving today with no
 * row of its own this time.
 */
export type PaymentCreationResult = DailyPayment & {
  /** Every row this call created, oldest assignment first. Length 1 for an
   * ordinary (non-plan) payment, containing the primary itself. */
  allocations: DailyPayment[];
  /** Sum of allocations[].amount. Equals the primary's own amount for an
   * ordinary payment. */
  totalAllocated: Prisma.Decimal;
};

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

  async createPayment(
    dto: CreatePaymentDto,
    actor: AuthenticatedUser,
  ): Promise<PaymentCreationResult> {
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

    const paymentAccountId = await this.resolvePaymentAccountId(dto.paymentAccountId);

    // Plan assignments relax the over-target guard - paying more is the
    // point (§7) - and allocate via the oldest-first cascade instead.
    // Ordinary rental assignments keep today's typo-catching cap.
    if (assignment.ownershipPlanId) {
      return this.createPlanPayment(assignment, dto, actor, paymentAccountId);
    }

    const cap = new Prisma.Decimal(assignment.targetAmount).times(AMOUNT_CAP_MULTIPLIER);
    if (new Prisma.Decimal(dto.amount).greaterThan(cap)) {
      throw new BadRequestException(
        `Amount exceeds ${AMOUNT_CAP_MULTIPLIER * 100}% of the assignment's target amount`,
      );
    }

    const payment = await this.prisma.client.dailyPayment.create({
      data: {
        tenantId: actor.tenantId,
        dailyAssignmentId: dto.dailyAssignmentId,
        driverId: dto.driverId,
        amount: dto.amount,
        paymentMethod: dto.paymentMethod,
        paymentAccountId,
        status: PaymentStatus.PENDING,
      },
    });
    return {
      ...payment,
      allocations: [payment],
      totalAllocated: new Prisma.Decimal(payment.amount),
    };
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
    paymentAccountId: string | undefined,
  ): Promise<PaymentCreationResult> {
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

    // A driver can never be asked to pay more than the vehicle is worth. The
    // guard tests against remainingUnreserved (PENDING + COMPLETED), not the
    // COMPLETED-only remainingToOwn: two payments that each individually pass
    // a COMPLETED-only ceiling could otherwise both go through and jointly
    // overpay the plan while both sit PENDING. A PENDING payment reserves its
    // space until it actually fails. planAssignments' dailyPayments include
    // is already filtered to non-FAILED, so this is the same data, summed
    // without the COMPLETED-only filter.
    const amountReserved = planAssignments.reduce(
      (sum: Prisma.Decimal, a: { dailyPayments: Array<{ amount: Prisma.Decimal }> }) =>
        sum.plus(
          a.dailyPayments.reduce((s: Prisma.Decimal, p) => s.plus(p.amount), new Prisma.Decimal(0)),
        ),
      new Prisma.Decimal(0),
    );
    const remainingUnreserved = computeRemainingUnreserved(
      new Prisma.Decimal(plan.totalPrice),
      new Prisma.Decimal(plan.downPayment),
      amountReserved,
    );
    if (remainingUnreserved.lessThanOrEqualTo(0)) {
      throw new BadRequestException(
        'This ownership plan has no unreserved balance left - it is already fully paid or ' +
          'fully covered by pending payments',
      );
    }
    if (amount.greaterThan(remainingUnreserved)) {
      throw new BadRequestException(
        `Amount exceeds the ${remainingUnreserved.toFixed(2)} still unreserved on this ownership plan`,
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

    // allocations iterates oldest-first (planAssignments is ordered that way
    // and Map preserves insertion order), so `created` is oldest-first too.
    const created = await this.prisma.client.$transaction(async (tx) => {
      const rows = [];
      for (const [dailyAssignmentId, allocatedAmount] of allocations) {
        rows.push(
          await tx.dailyPayment.create({
            data: {
              tenantId: actor.tenantId,
              dailyAssignmentId,
              driverId: dto.driverId,
              amount: allocatedAmount,
              paymentMethod: dto.paymentMethod,
              paymentAccountId,
              status: PaymentStatus.PENDING,
            },
          }),
        );
      }
      return rows;
    });

    // The primary is the row against the assignment the request named, when
    // one exists - and otherwise the oldest allocation, because a driver deep
    // in arrears may pay against today's row and have all of it consumed by
    // older days, leaving today with no row at all this time.
    const primary =
      created.find((c) => c.dailyAssignmentId === dto.dailyAssignmentId) ?? created[0];
    const totalAllocated = created.reduce(
      (sum: Prisma.Decimal, c) => sum.plus(c.amount),
      new Prisma.Decimal(0),
    );
    return { ...primary, allocations: created, totalAllocated };
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

  /** Omitted => behaves exactly as before this field existed. Supplied =>
   *  must exist, belong to this tenant (the tenant-scoping extension already
   *  filters findUnique to actor.tenantId, so a cross-tenant id simply comes
   *  back null here), and be active. */
  private async resolvePaymentAccountId(paymentAccountId?: string): Promise<string | undefined> {
    if (!paymentAccountId) {
      return undefined;
    }
    const account = await this.prisma.client.paymentAccount.findUnique({
      where: { id: paymentAccountId },
    });
    if (!account || !account.isActive) {
      throw new BadRequestException('paymentAccountId does not refer to an active payment account');
    }
    return paymentAccountId;
  }
}
