import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, UserRole, VehicleType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { AnalyticsService, COUNTED_EXPENSE } from '../analytics/analytics.service';
import { ExpenseService } from './expense.service';
import { ReportRangeQueryDto } from '../analytics/dto/report-range-query.dto';

const FUEL_CATEGORY = 'Fuel';
const REPAIRS_CATEGORY = 'Repairs';
const ALL_VEHICLE_TYPES: VehicleType[] = [
  VehicleType.MOTORBIKE,
  VehicleType.BAJAJI,
  VehicleType.CAR,
  VehicleType.TRUCK,
];

/** Stage UI3 - an adjustable threshold, not a fixed rule: a vehicle is
 *  flagged only when its cost this period is both a meaningful jump over
 *  its own baseline (30%+) AND a meaningful absolute amount (the floor
 *  stops a near-zero baseline, e.g. 500 -> 800, from flagging on noise
 *  that is a jump in percentage terms but nothing in money terms). */
const ANOMALY_MULTIPLIER = 1.3;
const ANOMALY_FLOOR = 50_000;

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
    throw new ForbiddenException('Only OWNER or MANAGER may view the expenses summary');
  }
}

function money(value: Prisma.Decimal | number | string | null | undefined): string {
  return new Prisma.Decimal(value ?? 0).toFixed(2);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface ExpenseSummaryKpis {
  spentThisMonth: string;
  fuelThisMonth: string;
  repairsThisMonth: string;
  recurringOffendersCount: number;
  claimsAwaitingApproval: number;
  costPerVehicle: string;
}

export interface CostPerVehicleTypeRow {
  vehicleType: VehicleType;
  costPerVehicle: string;
}

export interface VehicleAnomalyRow {
  motorcycleId: string;
  registrationNumber: string;
  vehicleType: VehicleType;
  currentPeriodCost: string;
  trailing3MoAvg: string;
  changePct: number;
  pattern: string;
}

/**
 * Stage UI3 - the Expenses page's single data source. spentThisMonth
 * reuses AnalyticsService.getSummary().expenses (no vehicleType filter);
 * fuelThisMonth/repairsThisMonth read AnalyticsService.getExpenseBreakdown
 * by exact category string match (free text - see getKpis' own comment);
 * claimsAwaitingApproval reuses ExpenseService.pendingCount, the same
 * query ApprovalsPage.tsx's list already filters by. None of these are
 * reimplemented here.
 */
@Injectable()
export class ExpenseSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly expenseService: ExpenseService,
  ) {}

  async getKpis(
    actor: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<{ kpis: ExpenseSummaryKpis }> {
    assertOwnerOrManager(actor);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const query: ReportRangeQueryDto = { from: isoDate(monthStart), to: isoDate(today) };

    const [summary, breakdown, pending, activeFleetCount, anomalies] = await Promise.all([
      this.analytics.getSummary(query, actor),
      this.analytics.getExpenseBreakdown(query, actor),
      this.expenseService.pendingCount(actor),
      this.prisma.client.motorcycle.count({ where: { isActive: true } }),
      this.getVehicleAnomalies(actor, now),
    ]);

    const spentThisMonth = new Prisma.Decimal(summary.expenses);
    // Category is free text (see ExpensesPage.tsx's CATEGORY_SUGGESTIONS) -
    // this only catches expenses recorded with this EXACT category string.
    // A manually-typed variant ("petrol", "fuel ") will not be counted here
    // - a known, documented limitation, not a bug.
    const fuel = breakdown.find((b) => b.category === FUEL_CATEGORY);
    const repairs = breakdown.find((b) => b.category === REPAIRS_CATEGORY);

    return {
      kpis: {
        spentThisMonth: money(spentThisMonth),
        fuelThisMonth: fuel?.amount ?? '0.00',
        repairsThisMonth: repairs?.amount ?? '0.00',
        recurringOffendersCount: anomalies.length,
        claimsAwaitingApproval: pending.count,
        costPerVehicle:
          activeFleetCount === 0 ? '0.00' : money(spentThisMonth.dividedBy(activeFleetCount)),
      },
    };
  }

  /** Stage UI3 - "Cost per vehicle, by type" rail card. Reuses the same
   *  COUNTED_EXPENSE + MaintenanceLog.cost streams AnalyticsService
   *  already sums for a given range/type, divided by that type's own
   *  active fleet count. */
  async getCostPerVehicleByType(
    query: ReportRangeQueryDto,
    actor: AuthenticatedUser,
  ): Promise<CostPerVehicleTypeRow[]> {
    assertOwnerOrManager(actor);

    const rows = await Promise.all(
      ALL_VEHICLE_TYPES.map(async (vehicleType) => {
        const [summary, activeCount] = await Promise.all([
          this.analytics.getSummary({ ...query, vehicleType }, actor),
          this.prisma.client.motorcycle.count({ where: { vehicleType, isActive: true } }),
        ]);
        const cost =
          activeCount === 0
            ? '0.00'
            : money(new Prisma.Decimal(summary.expenses).dividedBy(activeCount));
        return { vehicleType, costPerVehicle: cost };
      }),
    );
    return rows;
  }

  /**
   * Stage UI3 - "Vehicles costing more than they should" (Expenses'
   * closing row) and the KPI rail's "Recurring offenders" count (via
   * getKpis, which calls this and takes .length - never a second, parallel
   * flag computation). A vehicle is flagged when currentPeriodCost (this
   * month, so far) exceeds trailing3MoAvg * ANOMALY_MULTIPLIER AND clears
   * the ANOMALY_FLOOR - see those constants' own comment. "pattern" is the
   * vehicle's own single largest expense category this period, read from a
   * real per-vehicle groupBy - never a fixed, invented taxonomy.
   */
  async getVehicleAnomalies(
    actor: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<VehicleAnomalyRow[]> {
    assertOwnerOrManager(actor);

    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const trailingStart = new Date(
      Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 3, 1),
    );
    // The day before monthStart - the last day of the 3rd trailing month.
    const trailingEnd = new Date(monthStart.getTime() - 24 * 60 * 60 * 1000);

    const currentRange = { gte: monthStart, lt: this.addDay(today) };
    const trailingRange = { gte: trailingStart, lt: this.addDay(trailingEnd) };

    const [currentExpenses, currentMaintenance, trailingExpenses, trailingMaintenance] =
      await Promise.all([
        this.prisma.client.expense.findMany({
          where: { ...COUNTED_EXPENSE, motorcycleId: { not: null }, incurredAt: currentRange },
          select: { motorcycleId: true, amount: true, category: true },
        }),
        this.prisma.client.maintenanceLog.findMany({
          where: { performedAt: currentRange },
          select: { motorcycleId: true, cost: true },
        }),
        this.prisma.client.expense.findMany({
          where: { ...COUNTED_EXPENSE, motorcycleId: { not: null }, incurredAt: trailingRange },
          select: { motorcycleId: true, amount: true },
        }),
        this.prisma.client.maintenanceLog.findMany({
          where: { performedAt: trailingRange },
          select: { motorcycleId: true, cost: true },
        }),
      ]);

    const add = (map: Map<string, Prisma.Decimal>, id: string, amount: Prisma.Decimal | string) =>
      map.set(id, (map.get(id) ?? new Prisma.Decimal(0)).plus(amount));

    const currentByMoto = new Map<string, Prisma.Decimal>();
    for (const e of currentExpenses) add(currentByMoto, e.motorcycleId as string, e.amount);
    for (const m of currentMaintenance) add(currentByMoto, m.motorcycleId, m.cost);

    const trailingByMoto = new Map<string, Prisma.Decimal>();
    for (const e of trailingExpenses) add(trailingByMoto, e.motorcycleId as string, e.amount);
    for (const m of trailingMaintenance) add(trailingByMoto, m.motorcycleId, m.cost);

    const categoryByMoto = new Map<string, Map<string, Prisma.Decimal>>();
    for (const e of currentExpenses) {
      const motoId = e.motorcycleId as string;
      const byCategory = categoryByMoto.get(motoId) ?? new Map<string, Prisma.Decimal>();
      byCategory.set(
        e.category,
        (byCategory.get(e.category) ?? new Prisma.Decimal(0)).plus(e.amount),
      );
      categoryByMoto.set(motoId, byCategory);
    }

    const motorcycleIds = [...new Set([...currentByMoto.keys(), ...trailingByMoto.keys()])];
    if (motorcycleIds.length === 0) return [];

    const motorcycles = await this.prisma.client.motorcycle.findMany({
      where: { id: { in: motorcycleIds } },
      select: { id: true, registrationNumber: true, vehicleType: true },
    });
    const infoById = new Map(motorcycles.map((m) => [m.id, m]));

    const flagged: VehicleAnomalyRow[] = [];
    for (const motoId of motorcycleIds) {
      const current = currentByMoto.get(motoId) ?? new Prisma.Decimal(0);
      const trailingSum = trailingByMoto.get(motoId) ?? new Prisma.Decimal(0);
      const trailingAvg = trailingSum.dividedBy(3);

      const clearsFloor = current.greaterThan(ANOMALY_FLOOR);
      const clearsMultiplier = current.greaterThan(trailingAvg.times(ANOMALY_MULTIPLIER));
      if (!clearsFloor || !clearsMultiplier) continue;

      const info = infoById.get(motoId);
      const byCategory = categoryByMoto.get(motoId);
      const topCategory =
        byCategory && byCategory.size > 0
          ? [...byCategory.entries()].sort((a, b) => Number(b[1]) - Number(a[1]))[0][0]
          : 'Maintenance';
      const changePct = trailingAvg.isZero()
        ? 100
        : current.minus(trailingAvg).dividedBy(trailingAvg).times(100).round().toNumber();

      flagged.push({
        motorcycleId: motoId,
        registrationNumber: info?.registrationNumber ?? 'Unknown',
        vehicleType: info?.vehicleType ?? VehicleType.MOTORBIKE,
        currentPeriodCost: money(current),
        trailing3MoAvg: money(trailingAvg),
        changePct,
        pattern: topCategory,
      });
    }

    flagged.sort((a, b) => Number(b.currentPeriodCost) - Number(a.currentPeriodCost));
    return flagged;
  }

  private addDay(date: Date): Date {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }
}
