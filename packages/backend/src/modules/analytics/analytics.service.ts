import { ForbiddenException, Injectable } from '@nestjs/common';
import { PaymentStatus, Prisma, UserRole, VehicleType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { buildDateRangeFilter } from '../expense/expense.service';
import { ReportRangeQueryDto } from './dto/report-range-query.dto';

const MAINTENANCE_CATEGORY = 'Maintenance';

type DateRange = ReturnType<typeof buildDateRangeFilter>;

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
  vehicleType: VehicleType | null;
  revenue: string;
  rentalRevenue: string;
  transportRevenue: string;
  expenses: string;
  netProfit: string;
  paymentCount: number;
  transportJobCount: number;
  expenseCount: number;
}

export interface MotorcyclePnl {
  motorcycleId: string;
  registrationNumber: string;
  vehicleType: VehicleType;
  revenue: string;
  expenses: string;
  netProfit: string;
}

export interface DriverRevenue {
  driverId: string;
  driverName: string;
  revenue: string;
  paymentCount: number;
}

export interface ExpenseCategory {
  category: string;
  amount: string;
  count: number;
}

/**
 * Read-only profit-and-loss analytics for owners/managers, optionally scoped to
 * one vehicle category (motorbike/bajaji/car/truck).
 *
 * Revenue has two streams: RENTAL revenue = COMPLETED daily payments (money
 * reconciled; dated by the assignment's assignedDate), and TRANSPORT revenue =
 * transport-job revenue (dated by scheduledDate). Motorbikes/bajaji earn the
 * former, cars/trucks the latter; a category report therefore shows the stream
 * that category actually earns, and the overall report combines both.
 *
 * Expenses = Expense rows (by incurredAt) + MaintenanceLog costs (by
 * performedAt). Category scoping filters every stream through the vehicle's type.
 * Every query is tenant-scoped by the Prisma extension; role is re-checked here.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private paymentWhere(range: DateRange, vt?: VehicleType): Prisma.DailyPaymentWhereInput {
    const assignment: Prisma.DailyAssignmentWhereInput = {};
    if (range) assignment.assignedDate = range;
    if (vt) assignment.motorcycle = { vehicleType: vt };
    return {
      status: PaymentStatus.COMPLETED,
      ...(Object.keys(assignment).length ? { dailyAssignment: assignment } : {}),
    };
  }

  private transportWhere(range: DateRange, vt?: VehicleType): Prisma.TransportJobWhereInput {
    return {
      ...(range ? { scheduledDate: range } : {}),
      ...(vt ? { motorcycle: { vehicleType: vt } } : {}),
    };
  }

  private expenseWhere(range: DateRange, vt?: VehicleType): Prisma.ExpenseWhereInput {
    return {
      ...(range ? { incurredAt: range } : {}),
      ...(vt ? { motorcycle: { vehicleType: vt } } : {}),
    };
  }

  private maintenanceWhere(range: DateRange, vt?: VehicleType): Prisma.MaintenanceLogWhereInput {
    return {
      ...(range ? { performedAt: range } : {}),
      ...(vt ? { motorcycle: { vehicleType: vt } } : {}),
    };
  }

  async getSummary(query: ReportRangeQueryDto, actor: AuthenticatedUser): Promise<PnlSummary> {
    assertOwnerOrManager(actor);
    const range = buildDateRangeFilter(query.from, query.to);
    const vt = query.vehicleType;

    const [rentalAgg, transportAgg, expenseAgg, maintenanceAgg] = await Promise.all([
      this.prisma.client.dailyPayment.aggregate({
        _sum: { amount: true },
        _count: true,
        where: this.paymentWhere(range, vt),
      }),
      this.prisma.client.transportJob.aggregate({
        _sum: { revenue: true },
        _count: true,
        where: this.transportWhere(range, vt),
      }),
      this.prisma.client.expense.aggregate({
        _sum: { amount: true },
        _count: true,
        where: this.expenseWhere(range, vt),
      }),
      this.prisma.client.maintenanceLog.aggregate({
        _sum: { cost: true },
        _count: true,
        where: this.maintenanceWhere(range, vt),
      }),
    ]);

    const rentalRevenue = new Prisma.Decimal(rentalAgg._sum.amount ?? 0);
    const transportRevenue = new Prisma.Decimal(transportAgg._sum.revenue ?? 0);
    const revenue = rentalRevenue.plus(transportRevenue);
    const expenses = new Prisma.Decimal(expenseAgg._sum.amount ?? 0).plus(
      maintenanceAgg._sum.cost ?? 0,
    );

    return {
      from: query.from ?? null,
      to: query.to ?? null,
      vehicleType: vt ?? null,
      revenue: money(revenue),
      rentalRevenue: money(rentalRevenue),
      transportRevenue: money(transportRevenue),
      expenses: money(expenses),
      netProfit: money(revenue.minus(expenses)),
      paymentCount: rentalAgg._count,
      transportJobCount: transportAgg._count,
      expenseCount: expenseAgg._count + maintenanceAgg._count,
    };
  }

  async getPerMotorcycle(
    query: ReportRangeQueryDto,
    actor: AuthenticatedUser,
  ): Promise<MotorcyclePnl[]> {
    assertOwnerOrManager(actor);
    const range = buildDateRangeFilter(query.from, query.to);
    const vt = query.vehicleType;

    const [payments, transportJobs, expenses, maintenance] = await Promise.all([
      this.prisma.client.dailyPayment.findMany({
        where: this.paymentWhere(range, vt),
        select: { amount: true, dailyAssignment: { select: { motorcycleId: true } } },
      }),
      this.prisma.client.transportJob.findMany({
        where: this.transportWhere(range, vt),
        select: { revenue: true, motorcycleId: true },
      }),
      this.prisma.client.expense.findMany({
        where: { motorcycleId: { not: null }, ...this.expenseWhere(range, vt) },
        select: { amount: true, motorcycleId: true },
      }),
      this.prisma.client.maintenanceLog.findMany({
        where: this.maintenanceWhere(range, vt),
        select: { cost: true, motorcycleId: true },
      }),
    ]);

    const add = (map: Map<string, Prisma.Decimal>, id: string, amount: Prisma.Decimal | string) =>
      map.set(id, (map.get(id) ?? new Prisma.Decimal(0)).plus(amount));

    const revenueByMoto = new Map<string, Prisma.Decimal>();
    for (const p of payments) add(revenueByMoto, p.dailyAssignment.motorcycleId, p.amount);
    for (const j of transportJobs) add(revenueByMoto, j.motorcycleId, j.revenue);

    const expenseByMoto = new Map<string, Prisma.Decimal>();
    for (const e of expenses) {
      if (e.motorcycleId) add(expenseByMoto, e.motorcycleId, e.amount);
    }
    for (const log of maintenance) add(expenseByMoto, log.motorcycleId, log.cost);

    const motorcycleIds = [...new Set([...revenueByMoto.keys(), ...expenseByMoto.keys()])];
    if (motorcycleIds.length === 0) {
      return [];
    }

    const motorcycles = await this.prisma.client.motorcycle.findMany({
      where: { id: { in: motorcycleIds } },
      select: { id: true, registrationNumber: true, vehicleType: true },
    });
    const infoById = new Map(motorcycles.map((m) => [m.id, m]));

    const rows: MotorcyclePnl[] = motorcycleIds.map((id) => {
      const revenue = revenueByMoto.get(id) ?? new Prisma.Decimal(0);
      const expense = expenseByMoto.get(id) ?? new Prisma.Decimal(0);
      return {
        motorcycleId: id,
        registrationNumber: infoById.get(id)?.registrationNumber ?? 'Unknown',
        vehicleType: infoById.get(id)?.vehicleType ?? VehicleType.MOTORBIKE,
        revenue: money(revenue),
        expenses: money(expense),
        netProfit: money(revenue.minus(expense)),
      };
    });

    rows.sort((a, b) => Number(b.netProfit) - Number(a.netProfit));
    return rows;
  }

  async getPerDriver(
    query: ReportRangeQueryDto,
    actor: AuthenticatedUser,
  ): Promise<DriverRevenue[]> {
    assertOwnerOrManager(actor);
    const range = buildDateRangeFilter(query.from, query.to);

    const grouped = await this.prisma.client.dailyPayment.groupBy({
      by: ['driverId'],
      where: this.paymentWhere(range, query.vehicleType),
      _sum: { amount: true },
      _count: true,
    });

    if (grouped.length === 0) {
      return [];
    }

    const drivers = await this.prisma.client.driver.findMany({
      where: { id: { in: grouped.map((g) => g.driverId) } },
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
    });
    const nameById = new Map(drivers.map((d) => [d.id, `${d.user.firstName} ${d.user.lastName}`]));

    const rows: DriverRevenue[] = grouped.map((g) => ({
      driverId: g.driverId,
      driverName: nameById.get(g.driverId) ?? 'Unknown',
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
    const vt = query.vehicleType;

    const [grouped, maintenanceAgg] = await Promise.all([
      this.prisma.client.expense.groupBy({
        by: ['category'],
        where: this.expenseWhere(range, vt),
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.client.maintenanceLog.aggregate({
        _sum: { cost: true },
        _count: true,
        where: this.maintenanceWhere(range, vt),
      }),
    ]);

    const rows: ExpenseCategory[] = grouped.map((g) => ({
      category: g.category,
      amount: money(g._sum.amount),
      count: g._count,
    }));

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
