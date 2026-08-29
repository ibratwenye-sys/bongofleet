import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  MotorcycleStatus,
  Prisma,
  TransportJobStatus,
  UserRole,
  VehicleType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { AnalyticsService, COUNTED_EXPENSE } from '../analytics/analytics.service';
import { dateOnlyInDarEsSalaam } from '../ownership-plan/ownership-plan.derivation';
import { getIdleVehicles } from '../../common/idle-vehicles.util';
import { computeTransportProgress } from './transport-progress';
import { TransportService } from './transport.service';
import {
  MarginDeclineFlag,
  TransportAlert,
  TransportOperationsResponse,
  TransportTripRow,
  VehicleTransportSummary,
} from './transport-operations.types';

/** Stage UI2 (§6) - only flag a decline when the current month's margin is
 *  at least this many points below the vehicle's own trailing average; a
 *  business judgement call (no design doc pins a number), not a
 *  statistical test - documented here so the next reader knows it is
 *  deliberately a plain threshold. */
const MARGIN_DECLINE_THRESHOLD_POINTS = 10;
const MARGIN_HISTORY_MONTHS = 7; // current + up to 6 prior

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
    throw new ForbiddenException('Only OWNER or MANAGER may view transport operations');
  }
}

function money(value: Prisma.Decimal | number | string | null | undefined): string {
  return new Prisma.Decimal(value ?? 0).toFixed(2);
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function marginPercent(revenue: Prisma.Decimal, expenses: Prisma.Decimal): number | null {
  if (revenue.isZero()) return null;
  return revenue.minus(expenses).dividedBy(revenue).times(100).toNumber();
}

/**
 * Stage UI2 (§6) - the Transport page's single data source. Same
 * OWNER/MANAGER gate and batched-query discipline as the other four new
 * pages this stage, and wraps TransportService.vehicleSummary() for the
 * ranked table rather than reimplementing per-vehicle P&L a second time.
 */
@Injectable()
export class TransportOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly transport: TransportService,
  ) {}

  async getOperationsSummary(
    actor: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<TransportOperationsResponse> {
    assertOwnerOrManager(actor);

    const today = dateOnlyInDarEsSalaam(now);
    const todayIso = today.toISOString().slice(0, 10);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const monthStartIso = monthStart.toISOString().slice(0, 10);
    const historyStart = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (MARGIN_HISTORY_MONTHS - 1), 1),
    );

    // Phase 1 - everything that needs only the actor and a date range,
    // fetched together.
    const [
      transportVehicles,
      fleetSummaryThisMonth,
      perVehicleThisMonth,
      vehicleSummaryTable,
      inTransitJobRow,
      idleVehiclesAllTypes,
      tripsThisMonth,
    ] = await Promise.all([
      this.prisma.client.motorcycle.findMany({
        where: { isActive: true, vehicleType: { in: [VehicleType.CAR, VehicleType.TRUCK] } },
        select: { id: true, status: true, vehicleType: true, registrationNumber: true },
      }),
      this.analytics.getSummary({ from: monthStartIso, to: todayIso }, actor),
      this.analytics.getPerMotorcycle({ from: monthStartIso, to: todayIso }, actor),
      this.transport.vehicleSummary({ dateFrom: monthStartIso, dateTo: todayIso }, actor),
      this.prisma.client.transportJob.findFirst({
        where: { status: TransportJobStatus.IN_TRANSIT },
        orderBy: { pickedUpAt: 'desc' },
        select: {
          reference: true,
          origin: true,
          destination: true,
          cargo: true,
          pickedUpAt: true,
          expectedDistanceKm: true,
          motorcycle: { select: { id: true, registrationNumber: true } },
          driver: { select: { user: { select: { firstName: true, lastName: true } } } },
        },
      }),
      getIdleVehicles(this.prisma, today),
      this.buildTripsThisMonth(monthStartIso, todayIso, actor),
    ]);

    // Phase 2 - depends on Phase 1's vehicle/job ids.
    const transportVehicleIds = transportVehicles.map((v) => v.id);
    const vehicleSummaryIds = vehicleSummaryTable.map((v) => v.motorcycleId);
    const [historyJobs, fuelExpensesThisMonth] = await Promise.all([
      transportVehicleIds.length > 0
        ? this.prisma.client.transportJob.findMany({
            where: {
              motorcycleId: { in: transportVehicleIds },
              scheduledDate: { gte: historyStart, lt: tomorrow },
            },
            select: { id: true, motorcycleId: true, revenue: true, scheduledDate: true },
          })
        : Promise.resolve([]),
      vehicleSummaryIds.length > 0
        ? this.sumFuelForVehicles(vehicleSummaryIds, monthStart, tomorrow)
        : Promise.resolve(new Prisma.Decimal(0)),
    ]);

    // Phase 3 - depends on Phase 2's job ids.
    const historyExpenses =
      historyJobs.length > 0
        ? await this.prisma.client.expense.groupBy({
            by: ['transportJobId'],
            where: { transportJobId: { in: historyJobs.map((j) => j.id) }, ...COUNTED_EXPENSE },
            _sum: { amount: true },
          })
        : [];
    const expenseByJob = new Map(historyExpenses.map((e) => [e.transportJobId, e._sum.amount]));

    const { marginDeclineFlag, flaggedVehicleMarginTrend } = this.findMarginDecline(
      transportVehicles,
      historyJobs,
      expenseByJob,
      monthKey(today),
    );

    const inTransitJob = inTransitJobRow
      ? await this.buildInTransitJob(inTransitJobRow, now)
      : null;

    const idleTransportVehicles = idleVehiclesAllTypes.filter(
      (v) => v.vehicleType === VehicleType.CAR || v.vehicleType === VehicleType.TRUCK,
    );
    const alerts = this.buildAlerts(transportVehicles, idleTransportVehicles);

    const trucksCount = transportVehicles.filter((v) => v.vehicleType === VehicleType.TRUCK).length;
    const carsCount = transportVehicles.filter((v) => v.vehicleType === VehicleType.CAR).length;

    const transportRevenueThisMonth = new Prisma.Decimal(fleetSummaryThisMonth.transportRevenue);
    const allRevenueThisMonth = new Prisma.Decimal(fleetSummaryThisMonth.revenue);
    const transportExpensesThisMonth = vehicleSummaryTable.reduce(
      (sum, v) => sum.plus(v.expenses),
      new Prisma.Decimal(0),
    );
    const transportNetThisMonth = transportRevenueThisMonth.minus(transportExpensesThisMonth);
    const transportMarginPercent = transportRevenueThisMonth.isZero()
      ? 0
      : transportNetThisMonth.dividedBy(transportRevenueThisMonth).times(100).toNumber();

    const motorbikeRows = perVehicleThisMonth.filter(
      (p) => p.vehicleType === VehicleType.MOTORBIKE,
    );
    const motorbikeRevenue = motorbikeRows.reduce(
      (s, p) => s.plus(p.revenue),
      new Prisma.Decimal(0),
    );
    const motorbikeNet = motorbikeRows.reduce((s, p) => s.plus(p.netProfit), new Prisma.Decimal(0));
    const motorbikeMarginPercent = motorbikeRevenue.isZero()
      ? null
      : motorbikeNet.dividedBy(motorbikeRevenue).times(100).toNumber();

    const otherExpensesThisMonth = transportExpensesThisMonth.minus(fuelExpensesThisMonth);

    return {
      kpis: {
        fleetCount: { count: transportVehicles.length, trucks: trucksCount, cars: carsCount },
        tripsThisMonth: {
          count: vehicleSummaryTable.reduce((sum, v) => sum + v.jobCount, 0),
          inTransitNow: inTransitJob ? 1 : 0,
        },
        revenueThisMonth: {
          amount: money(transportRevenueThisMonth),
          percentOfAllRevenue: allRevenueThisMonth.isZero()
            ? 0
            : Math.round(
                transportRevenueThisMonth.dividedBy(allRevenueThisMonth).times(100).toNumber(),
              ),
        },
        costsThisMonth: {
          amount: money(transportExpensesThisMonth),
          percentFuel: transportExpensesThisMonth.isZero()
            ? 0
            : Math.round(
                fuelExpensesThisMonth.dividedBy(transportExpensesThisMonth).times(100).toNumber(),
              ),
        },
        netThisMonth: {
          amount: money(transportNetThisMonth),
          perVehicleAverage:
            transportVehicles.length === 0
              ? '0.00'
              : money(transportNetThisMonth.dividedBy(transportVehicles.length)),
        },
        marginThisMonth: {
          percent: Math.round(transportMarginPercent),
          vsMotorbikeMarginPercent:
            motorbikeMarginPercent === null ? null : Math.round(motorbikeMarginPercent),
        },
      },
      perVehicleThisMonth: vehicleSummaryTable as VehicleTransportSummary[],
      inTransitJob,
      marginDeclineFlag,
      alerts,
      tripsThisMonth,
      flaggedVehicleMarginTrend,
      marginSplit: {
        fuel: money(fuelExpensesThisMonth),
        other: money(otherExpensesThisMonth),
        profit: money(transportNetThisMonth),
        fuelPercent: transportRevenueThisMonth.isZero()
          ? 0
          : Math.round(
              fuelExpensesThisMonth.dividedBy(transportRevenueThisMonth).times(100).toNumber(),
            ),
        otherPercent: transportRevenueThisMonth.isZero()
          ? 0
          : Math.round(
              otherExpensesThisMonth.dividedBy(transportRevenueThisMonth).times(100).toNumber(),
            ),
        profitPercent: Math.round(transportMarginPercent),
      },
    };
  }

  /**
   * Only fires when the vehicle has >= 2 PRIOR months of history (besides
   * the current one) with revenue - the exact rule Stage UI2's §8 asks
   * unit tests to cover at the boundary. Ties broken by the largest
   * decline; a null return means the rail falls back to `alerts` instead.
   */
  private findMarginDecline(
    vehicles: { id: string; registrationNumber: string }[],
    historyJobs: {
      id: string;
      motorcycleId: string;
      revenue: Prisma.Decimal;
      scheduledDate: Date;
    }[],
    expenseByJob: Map<string | null, Prisma.Decimal | null>,
    thisMonthKey: string,
  ): {
    marginDeclineFlag: MarginDeclineFlag | null;
    flaggedVehicleMarginTrend: { month: string; marginPercent: number | null }[] | null;
  } {
    const monthByVehicle = new Map<
      string,
      Map<string, { revenue: Prisma.Decimal; expenses: Prisma.Decimal }>
    >();
    for (const job of historyJobs) {
      const key = monthKey(job.scheduledDate);
      const byMonth = monthByVehicle.get(job.motorcycleId) ?? new Map();
      const acc = byMonth.get(key) ?? {
        revenue: new Prisma.Decimal(0),
        expenses: new Prisma.Decimal(0),
      };
      acc.revenue = acc.revenue.plus(job.revenue);
      acc.expenses = acc.expenses.plus(expenseByJob.get(job.id) ?? 0);
      byMonth.set(key, acc);
      monthByVehicle.set(job.motorcycleId, byMonth);
    }

    let best: MarginDeclineFlag | null = null;
    let bestTrend: { month: string; marginPercent: number | null }[] | null = null;
    for (const vehicle of vehicles) {
      const byMonth = monthByVehicle.get(vehicle.id);
      if (!byMonth) continue;
      const current = byMonth.get(thisMonthKey);
      if (!current) continue;
      const currentMargin = marginPercent(current.revenue, current.expenses);
      if (currentMargin === null) continue;

      const priorMargins = [...byMonth.entries()]
        .filter(([key]) => key !== thisMonthKey)
        .map(([, m]) => marginPercent(m.revenue, m.expenses))
        .filter((m): m is number => m !== null);
      if (priorMargins.length < 2) continue;

      const priorAverage = priorMargins.reduce((a, b) => a + b, 0) / priorMargins.length;
      const decline = priorAverage - currentMargin;
      if (decline < MARGIN_DECLINE_THRESHOLD_POINTS) continue;

      const bestDecline = best
        ? best.priorAverageMarginPercent - best.currentMarginPercent
        : -Infinity;
      if (decline > bestDecline) {
        best = {
          motorcycleId: vehicle.id,
          registrationNumber: vehicle.registrationNumber,
          currentMarginPercent: Math.round(currentMargin),
          priorAverageMarginPercent: Math.round(priorAverage),
          priorMonthCount: priorMargins.length,
        };
        bestTrend = [...byMonth.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([month, m]) => ({ month, marginPercent: marginPercent(m.revenue, m.expenses) }));
      }
    }
    return { marginDeclineFlag: best, flaggedVehicleMarginTrend: bestTrend };
  }

  private async buildInTransitJob(
    job: {
      reference: string | null;
      origin: string;
      destination: string;
      cargo: string | null;
      pickedUpAt: Date | null;
      expectedDistanceKm: Prisma.Decimal | null;
      motorcycle: { id: string; registrationNumber: string };
      driver: { user: { firstName: string; lastName: string } } | null;
    },
    now: Date,
  ) {
    const pickedUpAt = job.pickedUpAt ?? now;
    const fixes = await this.prisma.client.gpsLocation.findMany({
      where: { motorcycleId: job.motorcycle.id, recordedAt: { gte: pickedUpAt } },
      orderBy: { recordedAt: 'asc' },
      select: { latitude: true, longitude: true, recordedAt: true },
    });
    const progress = computeTransportProgress(
      fixes,
      job.expectedDistanceKm ? job.expectedDistanceKm.toNumber() : null,
      pickedUpAt,
      now,
    );
    return {
      reference: job.reference,
      origin: job.origin,
      destination: job.destination,
      registrationNumber: job.motorcycle.registrationNumber,
      driverName: job.driver ? `${job.driver.user.firstName} ${job.driver.user.lastName}` : null,
      cargo: job.cargo,
      progress,
    };
  }

  private buildAlerts(
    transportVehicles: { id: string; status: MotorcycleStatus; registrationNumber: string }[],
    idleTransportVehicles: Awaited<ReturnType<typeof getIdleVehicles>>,
  ): TransportAlert[] {
    const alerts: TransportAlert[] = idleTransportVehicles.map((v) => ({
      source: 'ASSIGNMENT',
      severity: v.daysUnassigned >= 7 ? 'crit' : 'warn',
      title: `${v.registrationNumber} parked ${v.daysUnassigned} day${v.daysUnassigned === 1 ? '' : 's'}`,
      description: v.reason,
    }));
    for (const v of transportVehicles) {
      if (v.status === MotorcycleStatus.MAINTENANCE) {
        alerts.push({
          source: 'MAINTENANCE',
          severity: 'warn',
          title: `${v.registrationNumber} in workshop`,
          description: 'Currently in MAINTENANCE status.',
        });
      }
    }
    return alerts.slice(0, 6);
  }

  private async buildTripsThisMonth(
    from: string,
    to: string,
    actor: AuthenticatedUser,
  ): Promise<TransportTripRow[]> {
    const jobs = await this.transport.listJobs({ dateFrom: from, dateTo: to }, actor);
    return (jobs as unknown as Array<Record<string, unknown>>).map((job) => ({
      id: job.id as string,
      reference: (job.reference as string | null) ?? null,
      origin: job.origin as string,
      destination: job.destination as string,
      registrationNumber:
        (job.motorcycle as { registrationNumber: string } | null)?.registrationNumber ?? 'Unknown',
      cargo: (job.cargo as string | null) ?? null,
      revenue: money(job.revenue as Prisma.Decimal),
      expensesTotal: money(job.expensesTotal as Prisma.Decimal),
      netProfit: money(job.netProfit as Prisma.Decimal),
      status: job.status as string,
    }));
  }

  private async sumFuelForVehicles(
    motorcycleIds: string[],
    from: Date,
    to: Date,
  ): Promise<Prisma.Decimal> {
    const rows = await this.prisma.client.expense.findMany({
      where: {
        motorcycleId: { in: motorcycleIds },
        incurredAt: { gte: from, lt: to },
        category: { contains: 'fuel', mode: 'insensitive' },
        ...COUNTED_EXPENSE,
      },
      select: { amount: true },
    });
    return rows.reduce((sum, r) => sum.plus(r.amount), new Prisma.Decimal(0));
  }
}
