import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { dateOnlyInDarEsSalaam } from '../ownership-plan/ownership-plan.derivation';
import { determineMaintenanceDue } from '../notification/maintenance-due.util';
import {
  MaintenanceInsight,
  MaintenanceSummaryResponse,
  NeedsBookingRow,
  RepeatVisitVehicle,
} from './maintenance-summary.types';

/** Stage UI2 (§7) - "2 or more MaintenanceLog entries within a rolling
 *  45-day window" is Ibrahim's own definition, documented as a heuristic
 *  since there is no system-level "recurring fault" concept to key off
 *  instead (a description-text match would be a guess dressed up as a
 *  fact). */
const REPEAT_VISIT_WINDOW_DAYS = 45;

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
    throw new ForbiddenException('Only OWNER or MANAGER may view the maintenance summary');
  }
}

function money(value: Prisma.Decimal | number | string | null | undefined): string {
  return new Prisma.Decimal(value ?? 0).toFixed(2);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/**
 * Stage UI2 (§7) - the Maintenance page's single data source. Reuses
 * determineMaintenanceDue exactly as dashboard.service.ts already does,
 * same OWNER/MANAGER gate (matching GET /maintenance today - no MECHANIC
 * access, this codebase's maintenance.controller.ts has never granted it)
 * and batched-query discipline.
 */
@Injectable()
export class MaintenanceSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getSummary(
    actor: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<MaintenanceSummaryResponse> {
    assertOwnerOrManager(actor);

    const today = dateOnlyInDarEsSalaam(now);
    const tomorrow = addDays(today, 1);
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const windowStart = addDays(today, -(REPEAT_VISIT_WINDOW_DAYS - 1));

    const [vehicles, todaysAssignments, completedLogs, recentLogs] = await Promise.all([
      this.prisma.client.motorcycle.findMany({
        where: { isActive: true },
        select: {
          id: true,
          registrationNumber: true,
          vehicleType: true,
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
      this.prisma.client.dailyAssignment.findMany({
        where: { assignedDate: { gte: today, lt: tomorrow } },
        select: {
          motorcycleId: true,
          driver: { select: { user: { select: { firstName: true, lastName: true } } } },
        },
      }),
      this.prisma.client.maintenanceLog.findMany({
        where: { performedAt: { gte: monthStart, lt: tomorrow } },
        select: {
          id: true,
          motorcycleId: true,
          description: true,
          performedAt: true,
          mileageAtService: true,
          nextServiceDate: true,
          nextServiceMileage: true,
          cost: true,
        },
      }),
      this.prisma.client.maintenanceLog.findMany({
        where: { performedAt: { gte: windowStart, lt: tomorrow } },
        select: { motorcycleId: true, cost: true },
      }),
    ]);

    const driverByMoto = new Map(
      todaysAssignments.map((a) => [
        a.motorcycleId,
        `${a.driver.user.firstName} ${a.driver.user.lastName}`,
      ]),
    );
    const regByMoto = new Map(vehicles.map((v) => [v.id, v.registrationNumber]));
    const typeByMoto = new Map(vehicles.map((v) => [v.id, v.vehicleType]));

    const withinDays7 = 7;
    const withinDays30 = 30;
    const mileageBuffer = this.config.get<number>('MAINTENANCE_REMINDER_MILEAGE', 500);

    let overdueCount = 0;
    let dueWithin7 = 0;
    let dueWithin30Only = 0;
    const needsBooking: NeedsBookingRow[] = [];
    const atRisk: NeedsBookingRow[] = [];

    for (const v of vehicles) {
      const log = v.maintenanceLogs[0];
      if (!log) continue;

      const at7 = determineMaintenanceDue(
        { currentMileage: v.currentMileage, ...log },
        today,
        withinDays7,
        mileageBuffer,
      );
      const at30 = determineMaintenanceDue(
        { currentMileage: v.currentMileage, ...log },
        today,
        withinDays30,
        mileageBuffer,
      );

      if (at7.kind === 'OVERDUE') {
        overdueCount += 1;
      } else if (at7.kind === 'DUE_SOON') {
        dueWithin7 += 1;
      } else if (at30.kind === 'DUE_SOON') {
        dueWithin30Only += 1;
      }

      if (at30.kind === null) continue;

      const row: NeedsBookingRow = {
        motorcycleId: v.id,
        registrationNumber: v.registrationNumber,
        vehicleType: v.vehicleType,
        currentDriver: driverByMoto.get(v.id) ?? null,
        reasons: at30.reasons,
        odometer: v.currentMileage,
        nextServiceDate: log.nextServiceDate
          ? log.nextServiceDate.toISOString().slice(0, 10)
          : null,
        nextServiceMileage: log.nextServiceMileage,
        status: at30.kind,
      };
      atRisk.push(row);
      // "Needs booking" (main slot) is overdue-or-due-within-7 only, per
      // the stage brief; due-within-30 alone is shown in the pipeline
      // panel and the at-risk rail card, not the urgent booking queue.
      if (at7.kind !== null) needsBooking.push(row);
    }

    const nothingDueCount = vehicles.length - overdueCount - dueWithin7 - dueWithin30Only;

    const repeatByMoto = new Map<string, { count: number; totalSpend: Prisma.Decimal }>();
    for (const log of recentLogs) {
      const acc = repeatByMoto.get(log.motorcycleId) ?? {
        count: 0,
        totalSpend: new Prisma.Decimal(0),
      };
      acc.count += 1;
      acc.totalSpend = acc.totalSpend.plus(log.cost);
      repeatByMoto.set(log.motorcycleId, acc);
    }
    const repeatVisitVehicles: RepeatVisitVehicle[] = [...repeatByMoto.entries()]
      .filter(([, acc]) => acc.count >= 2)
      .map(([motorcycleId, acc]) => ({
        motorcycleId,
        registrationNumber: regByMoto.get(motorcycleId) ?? 'Unknown',
        visitCount: acc.count,
        totalSpend: money(acc.totalSpend),
      }))
      .sort((a, b) => b.visitCount - a.visitCount);

    const insights: MaintenanceInsight[] = [];
    const worstRepeat = repeatVisitVehicles[0];
    if (worstRepeat) {
      insights.push({
        title: `${worstRepeat.registrationNumber} has been serviced ${worstRepeat.visitCount} times in ${REPEAT_VISIT_WINDOW_DAYS} days`,
        description: `${money(worstRepeat.totalSpend)} TZS spent across those visits.`,
        motorcycleId: worstRepeat.motorcycleId,
      });
    }
    if (dueWithin7 > 0) {
      insights.push({
        title: `${dueWithin7} vehicle${dueWithin7 === 1 ? '' : 's'} due soon`,
        description: `Due within 7 days - book while the workshop has capacity.`,
        motorcycleId: null,
      });
    }

    const completedThisMonth = completedLogs.map((log) => ({
      id: log.id,
      motorcycleId: log.motorcycleId,
      registrationNumber: regByMoto.get(log.motorcycleId) ?? 'Unknown',
      description: log.description,
      performedAt: log.performedAt.toISOString().slice(0, 10),
      mileageAtService: log.mileageAtService,
      nextServiceDate: log.nextServiceDate ? log.nextServiceDate.toISOString().slice(0, 10) : null,
      nextServiceMileage: log.nextServiceMileage,
      cost: money(log.cost),
    }));

    const spendByType = new Map<string, Prisma.Decimal>();
    for (const log of completedLogs) {
      const type = typeByMoto.get(log.motorcycleId) ?? 'MOTORBIKE';
      spendByType.set(type, (spendByType.get(type) ?? new Prisma.Decimal(0)).plus(log.cost));
    }

    const completedCostTotal = completedLogs.reduce(
      (sum, l) => sum.plus(l.cost),
      new Prisma.Decimal(0),
    );

    return {
      kpis: {
        overdue: { count: overdueCount },
        dueWithin7Days: { count: dueWithin7 },
        dueWithin30Days: { count: dueWithin30Only },
        nothingDue: {
          count: nothingDueCount,
          percentOfFleet:
            vehicles.length === 0 ? 0 : Math.round((nothingDueCount / vehicles.length) * 100),
        },
        completedThisMonth: { count: completedLogs.length, cost: money(completedCostTotal) },
        repeatVisits: { count: repeatVisitVehicles.length },
      },
      needsBooking,
      servicePipeline: [
        {
          bucket: 'OVERDUE',
          count: overdueCount,
          share: this.share(overdueCount, vehicles.length),
        },
        { bucket: 'DUE_7', count: dueWithin7, share: this.share(dueWithin7, vehicles.length) },
        {
          bucket: 'DUE_30',
          count: dueWithin30Only,
          share: this.share(dueWithin30Only, vehicles.length),
        },
        {
          bucket: 'NOTHING_DUE',
          count: nothingDueCount,
          share: this.share(nothingDueCount, vehicles.length),
        },
      ],
      insights,
      atRisk,
      completedThisMonth,
      spendByVehicleType: [...spendByType.entries()]
        .map(([vehicleType, amount]) => ({ vehicleType, amount: money(amount) }))
        .sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount)),
      repeatVisitVehicles,
    };
  }

  private share(count: number, total: number): number {
    return total === 0 ? 0 : Math.round((count / total) * 100);
  }
}
