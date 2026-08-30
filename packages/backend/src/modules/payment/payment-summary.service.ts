import { ForbiddenException, Injectable } from '@nestjs/common';
import { PaymentStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { dateOnlyInDarEsSalaam } from '../ownership-plan/ownership-plan.derivation';
import { getDailyCollectionStatus } from '../../common/daily-collection-status.util';
import { buildDateRangeFilter } from '../expense/expense.service';

const UNSPECIFIED_METHOD = 'UNSPECIFIED';

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
    throw new ForbiddenException('Only OWNER or MANAGER may view the payments summary');
  }
}

function money(value: Prisma.Decimal | number | string | null | undefined): string {
  return new Prisma.Decimal(value ?? 0).toFixed(2);
}

export interface PaymentSummaryKpis {
  dueToday: string;
  receivedToday: string;
  stillOutstanding: { count: number; amount: string };
  dueThisMonth: string;
  receivedThisMonth: string;
}

export interface MethodBreakdownRow {
  method: string;
  count: number;
  amount: string;
  pendingCount: number;
  pendingAmount: string;
}

export interface OldestPendingRow {
  paymentId: string;
  driverName: string;
  amount: string;
  method: string;
  createdAt: string;
}

/**
 * Stage UI3 - the Payments page's single data source. dueToday/
 * receivedToday/stillOutstanding are getDailyCollectionStatus, reused
 * unchanged (§ no-fabrication rule: this dashboard does not have a
 * broader "all-time arrears" concept and must not invent one here) - the
 * Operations Center and this page can never disagree on what "today" or
 * "outstanding" means, because they call the same function.
 */
@Injectable()
export class PaymentSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(
    actor: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<{ kpis: PaymentSummaryKpis }> {
    assertOwnerOrManager(actor);
    const today = dateOnlyInDarEsSalaam(now);
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const [collectionStatus, dueThisMonthAgg, receivedThisMonthAgg] = await Promise.all([
      getDailyCollectionStatus(this.prisma, today),
      this.prisma.client.dailyAssignment.aggregate({
        _sum: { targetAmount: true },
        where: { assignedDate: { gte: monthStart, lt: tomorrow } },
      }),
      this.prisma.client.dailyPayment.aggregate({
        _sum: { amount: true },
        where: { status: PaymentStatus.COMPLETED, paidAt: { gte: monthStart, lt: tomorrow } },
      }),
    ]);

    const outstandingAmount = collectionStatus.outstandingRows.reduce(
      (sum, r) => sum.plus(r.balance),
      new Prisma.Decimal(0),
    );

    return {
      kpis: {
        dueToday: money(collectionStatus.dueToday),
        receivedToday: money(collectionStatus.receivedToday),
        stillOutstanding: {
          count: collectionStatus.outstandingRows.length,
          amount: money(outstandingAmount),
        },
        dueThisMonth: money(dueThisMonthAgg._sum.targetAmount),
        receivedThisMonth: money(receivedThisMonthAgg._sum.amount),
      },
    };
  }

  /**
   * Stage UI3 - real reconciliation-status data (how many payments per
   * method are still PENDING and for how much), never a claim that any
   * method reconciles itself - see payment.service.ts's
   * updatePaymentStatus, which every payment regardless of method must
   * pass through via an explicit OWNER/MANAGER action.
   */
  async getMethodBreakdown(
    from: string | undefined,
    to: string | undefined,
    actor: AuthenticatedUser,
  ): Promise<MethodBreakdownRow[]> {
    assertOwnerOrManager(actor);
    const range = buildDateRangeFilter(from, to);

    const payments = await this.prisma.client.dailyPayment.findMany({
      where: range ? { createdAt: range } : {},
      select: { paymentMethod: true, amount: true, status: true },
    });

    const byMethod = new Map<
      string,
      { count: number; amount: Prisma.Decimal; pendingCount: number; pendingAmount: Prisma.Decimal }
    >();
    for (const p of payments) {
      const method = p.paymentMethod ?? UNSPECIFIED_METHOD;
      const acc = byMethod.get(method) ?? {
        count: 0,
        amount: new Prisma.Decimal(0),
        pendingCount: 0,
        pendingAmount: new Prisma.Decimal(0),
      };
      acc.count += 1;
      acc.amount = acc.amount.plus(p.amount);
      if (p.status === PaymentStatus.PENDING) {
        acc.pendingCount += 1;
        acc.pendingAmount = acc.pendingAmount.plus(p.amount);
      }
      byMethod.set(method, acc);
    }

    const rows: MethodBreakdownRow[] = [...byMethod.entries()].map(([method, acc]) => ({
      method,
      count: acc.count,
      amount: money(acc.amount),
      pendingCount: acc.pendingCount,
      pendingAmount: money(acc.pendingAmount),
    }));
    rows.sort((a, b) => Number(b.amount) - Number(a.amount));
    return rows;
  }

  /**
   * Stage UI3 - Payments' "Needs reconciling" rail card: the real
   * reconciliation-action queue, replacing the mockup's "not deposited"
   * bank-deposit alert (no such field exists - see Exclusions). Oldest
   * PENDING first, so it reads as a worklist ("these have waited
   * longest"), not a feed. Two fixed queries (the payments, then one
   * batched driver-name lookup) regardless of how many are pending.
   */
  async getOldestPending(limit: number, actor: AuthenticatedUser): Promise<OldestPendingRow[]> {
    assertOwnerOrManager(actor);

    const payments = await this.prisma.client.dailyPayment.findMany({
      where: { status: PaymentStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true, driverId: true, amount: true, paymentMethod: true, createdAt: true },
    });
    if (payments.length === 0) return [];

    const drivers = await this.prisma.client.driver.findMany({
      where: { id: { in: [...new Set(payments.map((p) => p.driverId))] } },
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
    });
    const nameById = new Map(drivers.map((d) => [d.id, `${d.user.firstName} ${d.user.lastName}`]));

    return payments.map((p) => ({
      paymentId: p.id,
      driverName: nameById.get(p.driverId) ?? 'Unknown',
      amount: money(p.amount),
      method: p.paymentMethod ?? UNSPECIFIED_METHOD,
      createdAt: p.createdAt.toISOString(),
    }));
  }
}
