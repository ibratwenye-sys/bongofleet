import { ForbiddenException, Injectable } from '@nestjs/common';
import { ExpenseStatus, PaymentStatus, Prisma, UserRole, VehicleType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { buildDateRangeFilter } from '../expense/expense.service';
import { ReportRangeQueryDto } from './dto/report-range-query.dto';

const MAINTENANCE_CATEGORY = 'Maintenance';

/**
 * Stage H1 (DESIGN_RIDER_EXPENSES.md). A PENDING or REJECTED expense is not
 * yet, or never was, a real cost - it must not move P&L until an
 * OWNER/MANAGER approves it (H2). Folded into expenseWhere() below, the one
 * shared where-builder already used everywhere Expense feeds into P&L (the
 * tenant-summary aggregate, the per-motorcycle rollup, and the category
 * groupBy) - every one of those inherits this filter automatically, rather
 * than needing to be touched individually.
 */
export const COUNTED_EXPENSE: Prisma.ExpenseWhereInput = { status: ExpenseStatus.APPROVED };

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

export interface DailyCollectionPoint {
  date: string;
  amount: string;
}

export interface SegmentPnl {
  vehicleType: VehicleType | 'TOTAL';
  vehicleCount: number;
  revenue: string;
  expenses: string;
  netProfit: string;
  netProfitPerVehicle: string;
  marginPct: number;
}

export interface MonthlyPnlPoint {
  month: string;
  revenue: string;
  expenses: string;
  netProfit: string;
}

const ALL_VEHICLE_TYPES: VehicleType[] = [
  VehicleType.MOTORBIKE,
  VehicleType.BAJAJI,
  VehicleType.CAR,
  VehicleType.TRUCK,
];

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
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
      ...COUNTED_EXPENSE,
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

  /**
   * Stage UI1 - the Operations Center's "collection - last 14 days" chart.
   * Reuses paymentWhere's exact same COMPLETED-dailyPayment/assignedDate-
   * range filter every other revenue figure in this service already uses
   * (rather than a second, possibly-drifting definition of "collected"),
   * just bucketed per day instead of summed into one total. One query,
   * grouped in memory the same way getPerMotorcycle already does - Prisma
   * can't groupBy a related model's date column directly.
   *
   * Every day in [from, to] appears in the result, zero-amount days
   * included, so a chart can plot a fixed number of bars without a caller
   * having to fill gaps itself.
   */
  async getDailyCollectionSeries(
    from: string,
    to: string,
    actor: AuthenticatedUser,
  ): Promise<DailyCollectionPoint[]> {
    assertOwnerOrManager(actor);
    const range = buildDateRangeFilter(from, to);

    const payments = await this.prisma.client.dailyPayment.findMany({
      where: this.paymentWhere(range),
      select: { amount: true, dailyAssignment: { select: { assignedDate: true } } },
    });

    const byDate = new Map<string, Prisma.Decimal>();
    for (const p of payments) {
      const key = p.dailyAssignment.assignedDate.toISOString().slice(0, 10);
      byDate.set(key, (byDate.get(key) ?? new Prisma.Decimal(0)).plus(p.amount));
    }

    const points: DailyCollectionPoint[] = [];
    const cursor = new Date(`${from}T00:00:00.000Z`);
    const end = new Date(`${to}T00:00:00.000Z`);
    while (cursor.getTime() <= end.getTime()) {
      const key = cursor.toISOString().slice(0, 10);
      points.push({ date: key, amount: money(byDate.get(key)) });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return points;
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

  /**
   * Stage UI3 - Reports' "Profit and loss by segment" table. Each row's
   * revenue/expenses/netProfit is exactly getSummary({...query,
   * vehicleType}) for that type - reused, not reimplemented - so this can
   * never drift from what the rest of the app already calls "revenue" for
   * a category. vehicleCount is fleet composition (active vehicles of that
   * type right now), independent of the date range: "how many trucks do I
   * own" answers a different question than "how many trucks earned this
   * period" and the two must not be conflated into one number.
   *
   * The totals row is its own getSummary(query) call with no vehicleType
   * filter - the real all-vehicles total, not a client-side sum of four
   * already-rounded per-segment strings (which can be off by a cent).
   * vehicleCount on the totals row is a plain integer sum, which has no
   * such rounding hazard.
   */
  async getPnlBySegment(
    query: ReportRangeQueryDto,
    actor: AuthenticatedUser,
  ): Promise<SegmentPnl[]> {
    assertOwnerOrManager(actor);

    const [counts, summaries, totalSummary] = await Promise.all([
      Promise.all(
        ALL_VEHICLE_TYPES.map((vt) =>
          this.prisma.client.motorcycle.count({ where: { vehicleType: vt, isActive: true } }),
        ),
      ),
      Promise.all(
        ALL_VEHICLE_TYPES.map((vt) => this.getSummary({ ...query, vehicleType: vt }, actor)),
      ),
      this.getSummary(query, actor),
    ]);

    const rows = ALL_VEHICLE_TYPES.map((vt, i) => this.toSegmentRow(vt, counts[i], summaries[i]));
    const totalVehicleCount = counts.reduce((sum, c) => sum + c, 0);
    rows.push(this.toSegmentRow('TOTAL', totalVehicleCount, totalSummary));
    return rows;
  }

  private toSegmentRow(
    vehicleType: VehicleType | 'TOTAL',
    vehicleCount: number,
    summary: PnlSummary,
  ): SegmentPnl {
    const revenue = new Prisma.Decimal(summary.revenue);
    const netProfit = new Prisma.Decimal(summary.netProfit);
    const netProfitPerVehicle =
      vehicleCount > 0 ? netProfit.dividedBy(vehicleCount) : new Prisma.Decimal(0);
    const marginPct = revenue.greaterThan(0)
      ? netProfit.dividedBy(revenue).times(100).round().toNumber()
      : 0;
    return {
      vehicleType,
      vehicleCount,
      revenue: summary.revenue,
      expenses: summary.expenses,
      netProfit: summary.netProfit,
      netProfitPerVehicle: money(netProfitPerVehicle),
      marginPct,
    };
  }

  /**
   * Stage UI3 - Reports' "Revenue and profit by month" table and the
   * closing row's margin-trend chart. Same four revenue/expense streams as
   * getSummary (paymentWhere/transportWhere/expenseWhere/maintenanceWhere,
   * reused unchanged), bucketed by calendar month instead of summed into
   * one total - findMany + in-memory grouping, the same technique
   * getDailyCollectionSeries already uses for its per-day buckets, since
   * Prisma cannot groupBy a related model's date column directly.
   *
   * Every month in [monthsBack-1 months ago, this month] appears even at
   * zero, same "no gaps" contract as getDailyCollectionSeries - a chart
   * can plot a fixed number of bars without filling gaps itself.
   */
  async getMonthlyPnlSeries(
    monthsBack: number,
    query: Pick<ReportRangeQueryDto, 'vehicleType'>,
    actor: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<MonthlyPnlPoint[]> {
    assertOwnerOrManager(actor);
    const vt = query.vehicleType;

    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const startMonth = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (monthsBack - 1), 1),
    );
    const range = buildDateRangeFilter(isoDate(startMonth), isoDate(today));

    const [payments, transportJobs, expenses, maintenance] = await Promise.all([
      this.prisma.client.dailyPayment.findMany({
        where: this.paymentWhere(range, vt),
        select: { amount: true, dailyAssignment: { select: { assignedDate: true } } },
      }),
      this.prisma.client.transportJob.findMany({
        where: this.transportWhere(range, vt),
        select: { revenue: true, scheduledDate: true },
      }),
      this.prisma.client.expense.findMany({
        where: this.expenseWhere(range, vt),
        select: { amount: true, incurredAt: true },
      }),
      this.prisma.client.maintenanceLog.findMany({
        where: this.maintenanceWhere(range, vt),
        select: { cost: true, performedAt: true },
      }),
    ]);

    const revenueByMonth = new Map<string, Prisma.Decimal>();
    const expenseByMonth = new Map<string, Prisma.Decimal>();
    const add = (map: Map<string, Prisma.Decimal>, key: string, amount: Prisma.Decimal | string) =>
      map.set(key, (map.get(key) ?? new Prisma.Decimal(0)).plus(amount));

    for (const p of payments)
      add(revenueByMonth, monthKey(p.dailyAssignment.assignedDate), p.amount);
    for (const j of transportJobs) add(revenueByMonth, monthKey(j.scheduledDate), j.revenue);
    for (const e of expenses) add(expenseByMonth, monthKey(e.incurredAt), e.amount);
    for (const m of maintenance) add(expenseByMonth, monthKey(m.performedAt), m.cost);

    const points: MonthlyPnlPoint[] = [];
    const cursor = new Date(startMonth);
    for (let i = 0; i < monthsBack; i++) {
      const key = monthKey(cursor);
      const revenue = revenueByMonth.get(key) ?? new Prisma.Decimal(0);
      const expenseTotal = expenseByMonth.get(key) ?? new Prisma.Decimal(0);
      points.push({
        month: key,
        revenue: money(revenue),
        expenses: money(expenseTotal),
        netProfit: money(revenue.minus(expenseTotal)),
      });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return points;
  }
}
