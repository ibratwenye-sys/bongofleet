import { ForbiddenException, Injectable } from '@nestjs/common';
import { MotorcycleStatus, PaymentStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { dateOnlyInDarEsSalaam } from '../ownership-plan/ownership-plan.derivation';
import { getIdleVehicles } from '../../common/idle-vehicles.util';
import { AssignmentInsight, AssignmentSummaryResponse } from './assignment-summary.types';

const STOCK_SERIES_DAYS = 14;
/** Stage UI2 (§5) - the gap the second rail insight names a specific
 *  vehicle for, beyond the first insight's biggest-cost vehicle. A
 *  business judgement call (no design doc pins a specific number), chosen
 *  to read as "worth a manager's attention" rather than "assigned
 *  yesterday". */
const NOTABLE_GAP_DAYS = 7;

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
    throw new ForbiddenException('Only OWNER or MANAGER may view the assignments summary');
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

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Stage UI2 (§5) - the Assignments page's single data source. Same
 * OWNER/MANAGER gate and batched-query discipline as
 * dashboard.service.ts/fleet-summary.service.ts, and reuses
 * getIdleVehicles exactly (§3's shared-query requirement) rather than a
 * second, divergent "vehicles in stock" query.
 */
@Injectable()
export class AssignmentSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(
    actor: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<AssignmentSummaryResponse> {
    assertOwnerOrManager(actor);

    const today = dateOnlyInDarEsSalaam(now);
    const tomorrow = addDays(today, 1);
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const seriesStart = addDays(today, -(STOCK_SERIES_DAYS - 1));

    const [vehicles, todaysAssignments, seriesAssignments, monthAssignments, idleVehicles] =
      await Promise.all([
        this.prisma.client.motorcycle.findMany({
          where: { isActive: true, status: { not: MotorcycleStatus.RETIRED } },
          select: { id: true, status: true, vehicleType: true },
        }),
        this.prisma.client.dailyAssignment.findMany({
          where: { assignedDate: { gte: today, lt: tomorrow } },
          select: { motorcycleId: true },
        }),
        this.prisma.client.dailyAssignment.findMany({
          where: { assignedDate: { gte: seriesStart, lt: tomorrow } },
          select: { motorcycleId: true, assignedDate: true },
        }),
        this.prisma.client.dailyAssignment.findMany({
          where: { assignedDate: { gte: monthStart, lt: tomorrow } },
          select: { id: true, motorcycleId: true, targetAmount: true },
        }),
        getIdleVehicles(this.prisma, today),
      ]);

    const statusByMoto = new Map(vehicles.map((v) => [v.id, v.status]));
    const todaysMotoIds = new Set(todaysAssignments.map((a) => a.motorcycleId));

    let movingToday = 0;
    let assignedInWorkshopToday = 0;
    for (const motoId of todaysMotoIds) {
      if (statusByMoto.get(motoId) === MotorcycleStatus.MAINTENANCE) assignedInWorkshopToday += 1;
      else movingToday += 1;
    }

    const dailyStockSeries = this.buildDailySeries(
      seriesAssignments,
      seriesStart,
      today,
      vehicles.length,
    );

    const monthAssignmentIds = monthAssignments.map((a) => a.id);
    const paidByAssignment =
      monthAssignmentIds.length > 0
        ? await this.prisma.client.dailyPayment.groupBy({
            by: ['dailyAssignmentId'],
            where: {
              dailyAssignmentId: { in: monthAssignmentIds },
              status: PaymentStatus.COMPLETED,
            },
            _sum: { amount: true },
          })
        : [];
    const paidById = new Map(paidByAssignment.map((p) => [p.dailyAssignmentId, p._sum.amount]));

    let endedWithPayment = 0;
    let endedWithNothing = 0;
    let valueOfUnpaidDays = new Prisma.Decimal(0);
    for (const a of monthAssignments) {
      const paid = new Prisma.Decimal(paidById.get(a.id) ?? 0);
      if (paid.greaterThan(0)) {
        endedWithPayment += 1;
      } else {
        endedWithNothing += 1;
        valueOfUnpaidDays = valueOfUnpaidDays.plus(a.targetAmount);
      }
    }

    const costOfIdlenessThisMonth = idleVehicles.reduce((sum, v) => {
      if (!v.dailyTarget) return sum;
      const effectiveStart =
        new Date(v.sinceDate).getTime() > monthStart.getTime() ? new Date(v.sinceDate) : monthStart;
      const idleDaysThisMonth = Math.max(
        0,
        Math.round((today.getTime() - effectiveStart.getTime()) / (24 * 60 * 60 * 1000)),
      );
      return sum.plus(new Prisma.Decimal(v.dailyTarget).times(idleDaysThisMonth));
    }, new Prisma.Decimal(0));

    const insights: AssignmentInsight[] = [];
    if (costOfIdlenessThisMonth.greaterThan(0) && idleVehicles[0]) {
      insights.push({
        title: `Idle stock has cost ${money(costOfIdlenessThisMonth)} TZS this month`,
        description: `${idleVehicles[0].registrationNumber} is the single biggest contributor - ${idleVehicles[0].reason.toLowerCase()}.`,
        motorcycleId: idleVehicles[0].motorcycleId,
      });
    }
    const secondGap = idleVehicles.slice(1).find((v) => v.daysUnassigned >= NOTABLE_GAP_DAYS);
    if (secondGap) {
      insights.push({
        title: `${secondGap.registrationNumber} has sat unassigned for ${secondGap.daysUnassigned} days`,
        description: secondGap.reason,
        motorcycleId: secondGap.motorcycleId,
      });
    }

    const idleByType = new Map<
      string,
      { count: number; amount: Prisma.Decimal; top: { reg: string; amount: Prisma.Decimal } | null }
    >();
    for (const v of idleVehicles) {
      const acc = idleByType.get(v.vehicleType) ?? {
        count: 0,
        amount: new Prisma.Decimal(0),
        top: null,
      };
      acc.count += 1;
      const rowAmount = new Prisma.Decimal(v.lostSoFar ?? 0);
      acc.amount = acc.amount.plus(rowAmount);
      if (!acc.top || rowAmount.greaterThan(acc.top.amount)) {
        acc.top = { reg: v.registrationNumber, amount: rowAmount };
      }
      idleByType.set(v.vehicleType, acc);
    }
    const idlenessCostByType = [...idleByType.entries()]
      .map(([vehicleType, acc]) => ({
        vehicleType,
        count: acc.count,
        amount: money(acc.amount),
        topContributor: acc.top?.reg ?? null,
      }))
      .sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount));

    const idleTargetLostToday = idleVehicles.reduce(
      (sum, v) => sum.plus(new Prisma.Decimal(v.dailyTarget ?? 0)),
      new Prisma.Decimal(0),
    );

    return {
      kpis: {
        assignedToday: {
          count: todaysMotoIds.size,
          fleetSize: vehicles.length,
          percentOfFleet:
            vehicles.length === 0 ? 0 : Math.round((todaysMotoIds.size / vehicles.length) * 100),
        },
        movingToday: {
          count: movingToday,
          percentActuallyEarning:
            vehicles.length === 0 ? 0 : Math.round((movingToday / vehicles.length) * 100),
        },
        assignedInWorkshopToday: { count: assignedInWorkshopToday },
        inStockToday: { count: idleVehicles.length, targetLost: money(idleTargetLostToday) },
        createdThisMonth: {
          count: monthAssignments.length,
          percentEndedWithPayment:
            monthAssignments.length === 0
              ? 0
              : Math.round((endedWithPayment / monthAssignments.length) * 100),
        },
        costOfIdlenessThisMonth: { amount: money(costOfIdlenessThisMonth) },
      },
      dailyStockSeries,
      utilisationToday: {
        moving: movingToday,
        workshop: assignedInWorkshopToday,
        inStock: idleVehicles.length,
      },
      insights,
      unassignedNow: idleVehicles,
      thisMonth: {
        created: monthAssignments.length,
        endedWithPayment,
        endedWithNothing,
        valueOfUnpaidDays: money(valueOfUnpaidDays),
      },
      idlenessCostByType,
    };
  }

  private buildDailySeries(
    rows: { motorcycleId: string; assignedDate: Date }[],
    from: Date,
    to: Date,
    fleetSize: number,
  ) {
    const outByDate = new Map<string, Set<string>>();
    for (const r of rows) {
      const key = isoDate(r.assignedDate);
      const set = outByDate.get(key) ?? new Set<string>();
      set.add(r.motorcycleId);
      outByDate.set(key, set);
    }
    const points = [];
    const cursor = new Date(from);
    while (cursor.getTime() <= to.getTime()) {
      const key = isoDate(cursor);
      const outCount = outByDate.get(key)?.size ?? 0;
      // fleetSize is CURRENT active fleet size, applied to every day in the
      // window (this codebase does not snapshot historical fleet size) -
      // an approximation for older days if vehicles were added/retired
      // since, same convention as every other "as of today" fleet-size
      // read in this codebase.
      points.push({ date: key, outCount, inStockCount: Math.max(0, fleetSize - outCount) });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return points;
  }
}
