import { ForbiddenException, Injectable } from '@nestjs/common';
import { PaymentStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { buildDateRangeFilter } from '../expense/expense.service';
import { ReportRangeQueryDto } from './dto/report-range-query.dto';

const MAINTENANCE_CATEGORY = 'Maintenance';

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
    throw new ForbiddenException('Only OWNER or MANAGER may view analytics');
  }
}

function money(value: Prisma.Decimal | null | undefined): string {
  return new Prisma.Decimal(value ?? 0).toFixed(2);
}

export interface PnlSummary {
  from: string | null;
  to: string | null;
  revenue: string;
  expenses: string;
  netProfit: string;
  paymentCount: number;
  expenseCount: number;
}

export interface MotorcyclePnl {
  motorcycleId: string;
  registrationNumber: string;
  revenue: string;
  expenses: string;
  netProfit: string;
}

export interface RiderRevenue {
  riderId: string;
  riderName: string;
  revenue: string;
  paymentCount: number;
}

export interface ExpenseCategory {
  category: string;
  amount: string;
  count: number;
}

/**
 * Read-only profit-and-loss analytics for owners/managers.
 *
 * Revenue = COMPLETED daily payments (money actually reconciled). Revenue is
 * dated by the assignment's assignedDate - the day the money was earned/owed -
 * NOT by paidAt (when the owner happened to reconcile it), so a period's P&L
 * reflects what the fleet earned operating on those days even if a payment was
 * reconciled later. PENDING payments are not yet counted as revenue - they show
 * up in the missed-payment digest and the dashboard's "pending" tile instead.
 *
 * Expenses = recorded Expense rows (by incurredAt) plus MaintenanceLog costs
 * (by performedAt), so maintenance is always part of the P&L even though it is
 * logged separately from ad-hoc expenses.
 *
 * Every query is tenant-scoped by the Prisma extension; the actor's role is
 * enforced here as a second gate on top of the controller's RolesGuard.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(query: ReportRangeQueryDto, actor: AuthenticatedUser): Promise<PnlSummary> {
    assertOwnerOrManager(actor);
    const range = buildDateRangeFilter(query.from, query.to);

    const [revenueAgg, expenseAgg, maintenanceAgg] = await Promise.all([
      this.prisma.client.dailyPayment.aggregate({
        _sum: { amount: true },
        _count: true,
        where: {
          status: PaymentStatus.COMPLETED,
          ...(range ? { dailyAssignment: { assignedDate: range } } : {}),
        },
      }),
      this.prisma.client.expense.aggregate({
        _sum: { amount: true },
        _count: true,
        where: { ...(range ? { incurredAt: range } : {}) },
      }),
      this.prisma.client.maintenanceLog.aggregate({
        _sum: { cost: true },
        _count: true,
        where: { ...(range ? { performedAt: range } : {}) },
      }),
    ]);

    const revenue = new Prisma.Decimal(revenueAgg._sum.amount ?? 0);
    const expenses = new Prisma.Decimal(expenseAgg._sum.amount ?? 0).plus(
      maintenanceAgg._sum.cost ?? 0,
    );

    return {
      from: query.from ?? null,
      to: query.to ?? null,
      revenue: money(revenue),
      expenses: money(expenses),
      netProfit: money(revenue.minus(expenses)),
      paymentCount: revenueAgg._count,
      expenseCount: expenseAgg._count + maintenanceAgg._count,
    };
  }

  async getPerMotorcycle(
    query: ReportRangeQueryDto,
    actor: AuthenticatedUser,
  ): Promise<MotorcyclePnl[]> {
    assertOwnerOrManager(actor);
    const range = buildDateRangeFilter(query.from, query.to);

    const [payments, expenses, maintenance] = await Promise.all([
      this.prisma.client.dailyPayment.findMany({
        where: {
          status: PaymentStatus.COMPLETED,
          ...(range ? { dailyAssignment: { assignedDate: range } } : {}),
        },
        select: { amount: true, dailyAssignment: { select: { motorcycleId: true } } },
      }),
      this.prisma.client.expense.findMany({
        where: { motorcycleId: { not: null }, ...(range ? { incurredAt: range } : {}) },
        select: { amount: true, motorcycleId: true },
      }),
      this.prisma.client.maintenanceLog.findMany({
        where: { ...(range ? { performedAt: range } : {}) },
        select: { cost: true, motorcycleId: true },
      }),
    ]);

    const revenueByMoto = new Map<string, Prisma.Decimal>();
    for (const payment of payments) {
      const id = payment.dailyAssignment.motorcycleId;
      revenueByMoto.set(id, (revenueByMoto.get(id) ?? new Prisma.Decimal(0)).plus(payment.amount));
    }

    const expenseByMoto = new Map<string, Prisma.Decimal>();
    for (const expense of expenses) {
      if (!expense.motorcycleId) continue;
      expenseByMoto.set(
        expense.motorcycleId,
        (expenseByMoto.get(expense.motorcycleId) ?? new Prisma.Decimal(0)).plus(expense.amount),
      );
    }
    for (const log of maintenance) {
      expenseByMoto.set(
        log.motorcycleId,
        (expenseByMoto.get(log.motorcycleId) ?? new Prisma.Decimal(0)).plus(log.cost),
      );
    }

    const motorcycleIds = [...new Set([...revenueByMoto.keys(), ...expenseByMoto.keys()])];
    if (motorcycleIds.length === 0) {
      return [];
    }

    const motorcycles = await this.prisma.client.motorcycle.findMany({
      where: { id: { in: motorcycleIds } },
      select: { id: true, registrationNumber: true },
    });
    const regById = new Map(motorcycles.map((m) => [m.id, m.registrationNumber]));

    const rows: MotorcyclePnl[] = motorcycleIds.map((id) => {
      const revenue = revenueByMoto.get(id) ?? new Prisma.Decimal(0);
      const expense = expenseByMoto.get(id) ?? new Prisma.Decimal(0);
      return {
        motorcycleId: id,
        registrationNumber: regById.get(id) ?? 'Unknown',
        revenue: money(revenue),
        expenses: money(expense),
        netProfit: money(revenue.minus(expense)),
      };
    });

    // Most profitable first; the client can reverse to surface low performers.
    rows.sort((a, b) => Number(b.netProfit) - Number(a.netProfit));
    return rows;
  }

  async getPerRider(query: ReportRangeQueryDto, actor: AuthenticatedUser): Promise<RiderRevenue[]> {
    assertOwnerOrManager(actor);
    const range = buildDateRangeFilter(query.from, query.to);

    const grouped = await this.prisma.client.dailyPayment.groupBy({
      by: ['riderId'],
      where: {
        status: PaymentStatus.COMPLETED,
        ...(range ? { dailyAssignment: { assignedDate: range } } : {}),
      },
      _sum: { amount: true },
      _count: true,
    });

    if (grouped.length === 0) {
      return [];
    }

    const riders = await this.prisma.client.rider.findMany({
      where: { id: { in: grouped.map((g) => g.riderId) } },
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
    });
    const nameById = new Map(riders.map((r) => [r.id, `${r.user.firstName} ${r.user.lastName}`]));

    const rows: RiderRevenue[] = grouped.map((g) => ({
      riderId: g.riderId,
      riderName: nameById.get(g.riderId) ?? 'Unknown',
      revenue: money(g._sum.amount),
      paymentCount: g._count,
    }));

    rows.sort((a, b) => Number(b.revenue) - Number(a.revenue));
    return rows;
  }

  async getExpenseBreakdown(
    query: ReportRangeQueryDto,
    actor: AuthenticatedUser,
  ): Promise<ExpenseCategory[]> {
    assertOwnerOrManager(actor);
    const range = buildDateRangeFilter(query.from, query.to);

    const [grouped, maintenanceAgg] = await Promise.all([
      this.prisma.client.expense.groupBy({
        by: ['category'],
        where: { ...(range ? { incurredAt: range } : {}) },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.client.maintenanceLog.aggregate({
        _sum: { cost: true },
        _count: true,
        where: { ...(range ? { performedAt: range } : {}) },
      }),
    ]);

    const rows: ExpenseCategory[] = grouped.map((g) => ({
      category: g.category,
      amount: money(g._sum.amount),
      count: g._count,
    }));

    // Maintenance is logged in its own table; surface it as a category so the
    // breakdown reconciles with the summary's expense total.
    if (maintenanceAgg._count > 0) {
      rows.push({
        category: MAINTENANCE_CATEGORY,
        amount: money(maintenanceAgg._sum.cost),
        count: maintenanceAgg._count,
      });
    }

    rows.sort((a, b) => Number(b.amount) - Number(a.amount));
    return rows;
  }
}
