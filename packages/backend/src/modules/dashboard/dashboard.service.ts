import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OwnershipPlanStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { AnalyticsService } from '../analytics/analytics.service';
import { dateOnlyInDarEsSalaam } from '../ownership-plan/ownership-plan.derivation';
import { determineMaintenanceDue } from '../notification/maintenance-due.util';
import {
  getDailyCollectionStatus,
  type DailyCollectionStatus,
} from '../../common/daily-collection-status.util';
import {
  OperationsCenterAlert,
  OperationsCenterKpis,
  OperationsCenterResponse,
  OutstandingAssignmentRow,
  WorstPerformerToday,
} from './dashboard.types';

const COLLECTION_SERIES_DAYS = 14;

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
    throw new ForbiddenException('Only OWNER or MANAGER may view the operations center');
  }
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function money(value: Prisma.Decimal | null | undefined): string {
  return new Prisma.Decimal(value ?? 0).toFixed(2);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/**
 * Stage UI1 - the Operations Center's server-side KPI aggregation
 * (DESIGN_UI_DIRECTIONS.md), replacing DashboardPage.tsx's four
 * client-computed tiles built from three separate list fetches. Every
 * number here comes from a query whose count does not grow with fleet
 * size - see dashboard.service.spec.ts, which asserts the exact call
 * count against a mocked Prisma client.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly config: ConfigService,
  ) {}

  async getOperationsCenter(
    actor: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<OperationsCenterResponse> {
    assertOwnerOrManager(actor);

    const today = dateOnlyInDarEsSalaam(now);
    const todayIso = isoDate(today);
    const yesterday = addDays(today, -1);
    const seriesStart = addDays(today, -(COLLECTION_SERIES_DAYS - 1));

    const [
      fleetSize,
      collectionStatus,
      yesterdaysOnRoad,
      activeOwnershipPlanCount,
      dueBikes,
      todaysPnl,
      perMotorcycleToday,
      collectionSeries,
      recentAssignmentAlerts,
      recentDocumentAlerts,
    ] = await Promise.all([
      this.prisma.client.motorcycle.count({ where: { isActive: true } }),
      // Stage UI3 - the shared helper the Payments page's KPI rail also
      // calls, so "due today" / "received today" / "outstanding" never
      // drift between the two pages. Its own dailyAssignment.findMany call
      // (today's assignments) is what used to sit inline here.
      getDailyCollectionStatus(this.prisma, today),
      this.prisma.client.dailyAssignment.findMany({
        where: { assignedDate: { gte: yesterday, lt: today } },
        select: { motorcycleId: true },
      }),
      this.prisma.client.ownershipPlan.count({ where: { status: OwnershipPlanStatus.ACTIVE } }),
      this.prisma.client.motorcycle.findMany({
        where: {
          isActive: true,
          maintenanceLogs: {
            some: {
              OR: [{ nextServiceDate: { not: null } }, { nextServiceMileage: { not: null } }],
            },
          },
        },
        select: {
          id: true,
          currentMileage: true,
          maintenanceLogs: {
            where: {
              OR: [{ nextServiceDate: { not: null } }, { nextServiceMileage: { not: null } }],
            },
            orderBy: { performedAt: 'desc' },
            take: 1,
            select: { nextServiceDate: true, nextServiceMileage: true },
          },
        },
      }),
      this.analytics.getSummary({ from: todayIso, to: todayIso }, actor),
      this.analytics.getPerMotorcycle({ from: todayIso, to: todayIso }, actor),
      this.analytics.getDailyCollectionSeries(isoDate(seriesStart), todayIso, actor),
      this.prisma.client.assignmentAlert.findMany({
        orderBy: { sentAt: 'desc' },
        take: 3,
        select: {
          kind: true,
          sentAt: true,
          targetAmount: true,
          paidAmount: true,
          dailyAssignment: {
            select: { motorcycle: { select: { registrationNumber: true } } },
          },
        },
      }),
      this.prisma.client.documentAlert.findMany({
        orderBy: { sentAt: 'desc' },
        take: 3,
        select: {
          kind: true,
          sentAt: true,
          document: { select: { docType: true, ownerType: true, ownerId: true } },
        },
      }),
    ]);

    const kpis = this.buildKpis(
      {
        fleetSize,
        collectionStatus,
        yesterdaysOnRoad,
        activeOwnershipPlanCount,
        dueBikes,
      },
      today,
    );
    // Reuses AnalyticsService.getSummary's own P&L rather than a second,
    // parallel profit computation - see this file's header comment.
    kpis.netProfitToday = { amount: todaysPnl.netProfit };

    const worstPerformerToday = this.pickWorstPerformer(perMotorcycleToday);
    // Same ranking worstPerformerToday reads the tail of - top 3, no second
    // query (analytics.getPerMotorcycle already sorts netProfit desc).
    const topPerformersToday = perMotorcycleToday.slice(0, 3);
    const alerts = this.buildAlerts(recentAssignmentAlerts, recentDocumentAlerts, dueBikes, today);
    const outstandingAssignmentRows = await this.resolveOutstandingRows(
      collectionStatus.outstandingRows,
    );

    return {
      kpis,
      worstPerformerToday,
      topPerformersToday,
      outstandingAssignmentRows,
      alerts,
      collectionSeries,
      todaysPnl,
    };
  }

  /** Stage UI1 - one more batched query (never per-row) to turn the
   *  outstanding rows' bare motorcycleId into the registration number the
   *  table actually displays. */
  private async resolveOutstandingRows(
    rows: DailyCollectionStatus['outstandingRows'],
  ): Promise<OutstandingAssignmentRow[]> {
    if (rows.length === 0) return [];
    const motorcycles = await this.prisma.client.motorcycle.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.motorcycleId))] } },
      select: { id: true, registrationNumber: true },
    });
    const regByMotoId = new Map(motorcycles.map((m) => [m.id, m.registrationNumber]));
    return rows.map((r) => ({
      registrationNumber: regByMotoId.get(r.motorcycleId) ?? 'Unknown',
      targetAmount: money(r.targetAmount),
      paidAmount: money(r.paidAmount),
      balance: money(r.balance),
    }));
  }

  /** Stage UI1, refactored in UI3 to build collectedToday/outstandingToday
   *  from the shared getDailyCollectionStatus result instead of its own
   *  duplicate queries (see this file's header comment on
   *  getOperationsCenter's Promise.all). */
  private buildKpis(
    input: {
      fleetSize: number;
      collectionStatus: DailyCollectionStatus;
      yesterdaysOnRoad: { motorcycleId: string }[];
      activeOwnershipPlanCount: number;
      dueBikes: {
        id: string;
        currentMileage: number;
        maintenanceLogs: { nextServiceDate: Date | null; nextServiceMileage: number | null }[];
      }[];
    },
    today: Date,
  ): OperationsCenterKpis {
    const { fleetSize, collectionStatus, yesterdaysOnRoad, activeOwnershipPlanCount, dueBikes } =
      input;

    const onRoadCount = new Set(collectionStatus.todaysAssignments.map((a) => a.motorcycleId)).size;
    const onRoadYesterday = new Set(yesterdaysOnRoad.map((a) => a.motorcycleId)).size;
    const { dueToday, receivedToday, outstandingRows } = collectionStatus;
    const percentOfTarget = dueToday.isZero()
      ? 0
      : receivedToday.dividedBy(dueToday).times(100).round().toNumber();
    const outstandingAmount = outstandingRows.reduce(
      (sum, r) => sum.plus(r.balance),
      new Prisma.Decimal(0),
    );

    const withinDays = this.config.get<number>('MAINTENANCE_REMINDER_DAYS', 14);
    const mileageBuffer = this.config.get<number>('MAINTENANCE_REMINDER_MILEAGE', 500);
    let overdueCount = 0;
    let dueSoonCount = 0;
    for (const bike of dueBikes) {
      const log = bike.maintenanceLogs[0];
      if (!log) continue;
      const { kind } = determineMaintenanceDue(
        {
          currentMileage: bike.currentMileage,
          nextServiceDate: log.nextServiceDate,
          nextServiceMileage: log.nextServiceMileage,
        },
        today,
        withinDays,
        mileageBuffer,
      );
      if (kind === 'OVERDUE') overdueCount += 1;
      else if (kind === 'DUE_SOON') dueSoonCount += 1;
    }

    return {
      onTheRoad: {
        count: onRoadCount,
        fleetSize,
        deltaVsYesterday: onRoadCount - onRoadYesterday,
      },
      collectedToday: {
        amount: money(receivedToday),
        targetAmount: money(dueToday),
        percentOfTarget,
      },
      outstandingToday: { count: outstandingRows.length, amount: money(outstandingAmount) },
      activeOwnershipPlans: { count: activeOwnershipPlanCount },
      serviceDue: { count: overdueCount + dueSoonCount, overdueCount },
      // netProfitToday is filled in by the caller from analytics.getSummary
      // (avoids a second, parallel P&L computation here) - see
      // getOperationsCenter.
      netProfitToday: { amount: '0.00' },
    };
  }

  /** Stage UI1 (§ no-fabrication rule) - the rail's first slot. Reuses
   *  AnalyticsService.getPerMotorcycle exactly as already computed, sorted
   *  descending by netProfit - the worst performer is simply the last row.
   *  Null when nothing moved money today at all. */
  private pickWorstPerformer(
    perMotorcycleToday: Array<{
      motorcycleId: string;
      registrationNumber: string;
      vehicleType: string;
      revenue: string;
      expenses: string;
      netProfit: string;
    }>,
  ): WorstPerformerToday | null {
    if (perMotorcycleToday.length === 0) return null;
    return perMotorcycleToday[perMotorcycleToday.length - 1];
  }

  private buildAlerts(
    assignmentAlerts: Array<{
      kind: string;
      sentAt: Date;
      targetAmount: Prisma.Decimal;
      paidAmount: Prisma.Decimal;
      dailyAssignment: { motorcycle: { registrationNumber: string } };
    }>,
    documentAlerts: Array<{
      kind: string;
      sentAt: Date;
      document: { docType: string; ownerType: string; ownerId: string };
    }>,
    dueBikes: {
      id: string;
      currentMileage: number;
      maintenanceLogs: { nextServiceDate: Date | null; nextServiceMileage: number | null }[];
    }[],
    today: Date,
  ): OperationsCenterAlert[] {
    const withinDays = this.config.get<number>('MAINTENANCE_REMINDER_DAYS', 14);
    const mileageBuffer = this.config.get<number>('MAINTENANCE_REMINDER_MILEAGE', 500);

    const alerts: OperationsCenterAlert[] = [];

    for (const a of assignmentAlerts) {
      alerts.push({
        source: 'ASSIGNMENT',
        severity: a.kind === 'NO_PAYMENT' ? 'crit' : 'warn',
        title: `${a.kind === 'NO_PAYMENT' ? 'No payment' : 'Shortfall'} - ${a.dailyAssignment.motorcycle.registrationNumber}`,
        description: `Target ${money(a.targetAmount)}, paid ${money(a.paidAmount)}`,
        when: a.sentAt.toISOString(),
      });
    }

    for (const d of documentAlerts) {
      alerts.push({
        source: 'DOCUMENT',
        severity: d.kind === 'EXPIRED' ? 'crit' : 'warn',
        title: `${d.document.docType} ${d.kind === 'EXPIRED' ? 'expired' : 'expiring soon'}`,
        description: `${d.document.ownerType.toLowerCase()} document`,
        when: d.sentAt.toISOString(),
      });
    }

    for (const bike of dueBikes) {
      const log = bike.maintenanceLogs[0];
      if (!log) continue;
      const { kind, reasons } = determineMaintenanceDue(
        {
          currentMileage: bike.currentMileage,
          nextServiceDate: log.nextServiceDate,
          nextServiceMileage: log.nextServiceMileage,
        },
        today,
        withinDays,
        mileageBuffer,
      );
      if (kind === null) continue;
      alerts.push({
        source: 'MAINTENANCE',
        severity: kind === 'OVERDUE' ? 'crit' : 'warn',
        title: kind === 'OVERDUE' ? 'Service overdue' : 'Service due soon',
        description: reasons.join('; '),
        when: null,
      });
      if (alerts.length >= 9) break;
    }

    // Most severe first, then most recent - a fixed, small list (max ~9),
    // never scaling with fleet size (each source above is already capped).
    alerts.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'crit' ? -1 : 1;
      return (b.when ?? '').localeCompare(a.when ?? '');
    });
    return alerts.slice(0, 6);
  }
}
