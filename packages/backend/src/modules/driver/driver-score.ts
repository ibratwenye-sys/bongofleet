import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DayExcusalStatus,
  DriverType,
  MaintenanceReminderKind,
  OwnershipPlanStatus,
  PaymentStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import {
  computeConsecutiveMissedDays,
  dateOnlyInDarEsSalaam,
  AssignmentPaidRow,
} from '../ownership-plan/ownership-plan.derivation';
import { determineMaintenanceDue } from '../notification/maintenance-due.util';

/**
 * Stage UI2 (§2 of the stage brief) - Ibrahim's binding decision: a
 * 3-component score (payment reliability 50pts, contract-honouring 20pts,
 * vehicle care 20pts = 90 raw points, rescaled to a 100-point display
 * score), NOT the reference mockup's 4-component one. The mockup's fourth
 * component, "conduct" (off-zone events, complaints), is left out entirely
 * rather than faked or defaulted to full marks - there is no geofencing or
 * complaints system anywhere in this codebase to compute it from. Same
 * convention as nav-config.ts documenting Alerts/Documents being left out
 * of the Stage UI1 sidebar rather than pointed at something fake: say so
 * here, in the one place a future reader will look to find out why the
 * weights don't add to 100.
 */
export type ScoreBand = 'Excellent' | 'Good' | 'Fair' | 'Watch' | 'At risk';

export function bandForDisplayScore(display: number): ScoreBand {
  if (display >= 85) return 'Excellent';
  if (display >= 70) return 'Good';
  if (display >= 55) return 'Fair';
  if (display >= 40) return 'Watch';
  return 'At risk';
}

/** Rescales the 0-90 raw total onto a 0-100 display score. Exported so the
 *  "what the score is built from" closing card can show the exact 50/20/20
 *  of 90 weighting alongside the rescale, rather than the reader having to
 *  infer it from the raw/display gap. */
export function rescaleToDisplayScore(raw: number): number {
  return Math.round((raw / 90) * 100);
}

/**
 * 0-50 pts: reliabilityRate = onTimeDays / expectedDays over the driver's
 * whole DailyAssignment history to date. Returns null when expectedDays is
 * 0 (no assignment history yet) - the caller excludes that driver from the
 * scored table entirely rather than showing a misleading 0 (a driver with
 * no history has not been unreliable; there is simply nothing to measure).
 */
export function reliabilityPoints(onTimeDays: number, expectedDays: number): number | null {
  if (expectedDays === 0) return null;
  return Math.round((onTimeDays / expectedDays) * 50);
}

export interface ContractPointsInput {
  hasPlan: boolean;
  defaulted: boolean;
  consecutiveMissedDays: number;
  breachAfterConsecutiveMissedDays: number;
}

/**
 * 0-20 pts. A driver with no OwnershipPlan at all (a daily-rental rider, or
 * a car/truck driver with no plan) gets the full 20 - deliberate modelling
 * choice: there is no contract beyond the assignment itself for them to
 * honour or breach, so "full marks" here means "nothing to breach", not
 * "assumed good". A DEFAULTED plan scores 0 regardless of the current
 * streak. Otherwise scaled down from 20 by how far the driver's current
 * consecutive-missed-days streak (computeConsecutiveMissedDays, reused
 * exactly as the ownership-plan pages already compute it) has eaten into
 * their plan's own breach threshold, floored at 0.
 */
export function contractPoints(input: ContractPointsInput): number {
  if (!input.hasPlan) return 20;
  if (input.defaulted) return 0;
  const fraction = input.consecutiveMissedDays / input.breachAfterConsecutiveMissedDays;
  return Math.max(0, Math.round(20 * (1 - fraction)));
}

/**
 * 0-20 pts, a PROXY, not a historical driving-behaviour measure - document
 * that plainly, the same as reliability/contract above. Based purely on
 * whether the vehicle on the driver's current (today's) DailyAssignment is
 * due for service (determineMaintenanceDue, reused exactly as the
 * Operations Center already computes it): 20 if nothing due, 12 if
 * DUE_SOON, 0 if OVERDUE. A driver with no assignment today gets the full
 * 20 - there is nothing to penalize. Damage claims are not tracked
 * anywhere in this schema (no field on MaintenanceLog or Expense
 * distinguishes a damage repair from routine wear) and are excluded from
 * this component entirely, not just from "conduct" above.
 */
export function carePoints(dueKind: MaintenanceReminderKind | null): number {
  if (dueKind === MaintenanceReminderKind.OVERDUE) return 0;
  if (dueKind === MaintenanceReminderKind.DUE_SOON) return 12;
  return 20;
}

export interface DriverScoreComponents {
  reliability: { points: number; onTimeDays: number; expectedDays: number };
  contract: {
    points: number;
    hasPlan: boolean;
    defaulted: boolean;
    consecutiveMissedDays: number | null;
    breachAfterConsecutiveMissedDays: number | null;
  };
  care: { points: number; dueKind: MaintenanceReminderKind | null; hasAssignmentToday: boolean };
}

export interface MonthlyOnTimeRate {
  /** "YYYY-MM", oldest first. */
  month: string;
  /** null when the driver had zero assignments that month - a rate of 0
   *  would claim they were unreliable that month; they simply weren't
   *  driving. */
  rate: number | null;
}

export interface DriverScore {
  driverId: string;
  driverType: DriverType;
  firstName: string;
  lastName: string;
  registrationNumber: string | null;
  raw: number;
  display: number;
  band: ScoreBand;
  components: DriverScoreComponents;
  /** Stage UI2 (§2, "defensible to the driver") - a real, computed,
   *  plain-language shortfall, never an invented behavioural narrative
   *  ("matches a default pattern" and similar mockup phrasing has no
   *  basis in this codebase). */
  note: string;
  /**
   * Stage UI2 (§2) - no score history is persisted anywhere (DriverScore
   * is computed fresh on every request, never stored), so there is no real
   * "score six months ago" to plot. This is a genuinely different,
   * time-series quantity instead: the driver's monthly on-time-payment
   * rate over the trailing 6 months, computed fresh each time from real
   * DailyAssignment/DailyPayment history - never a stored score snapshot,
   * and never fabricated off a single current number the way a smooth
   * "score over time" line would be.
   */
  sixMonthOnTimeRate: MonthlyOnTimeRate[];
}

export interface DriverScoreboard {
  totalActiveDrivers: number;
  scores: DriverScore[];
}

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
    throw new ForbiddenException('Only OWNER or MANAGER may view driver scores');
  }
}

function money(value: Prisma.Decimal | string | number): string {
  return new Prisma.Decimal(value).toFixed(0);
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** First-of-month UTC dates for the trailing 6 calendar months, oldest
 *  first, the current month last. */
function trailingMonthStarts(today: Date, count: number): Date[] {
  const months: Date[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    months.push(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1)));
  }
  return months;
}

interface AssignmentRow {
  id: string;
  driverId: string;
  assignedDate: Date;
  targetAmount: Prisma.Decimal;
  ownershipPlanId: string | null;
  motorcycleId: string;
}

interface PaymentRow {
  dailyAssignmentId: string;
  amount: Prisma.Decimal;
  paidAt: Date | null;
}

/**
 * Stage UI2 - the batched queries the score needs, plus the pure
 * computation above. Tenant-scoped as usual via the Prisma tenant
 * extension; every query here is fixed-count regardless of fleet/driver
 * size (see driver-score.spec.ts and the scoreboard e2e spec's query-count
 * assertion), never a per-driver loop.
 */
@Injectable()
export class DriverScoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async scoreDrivers(actor: AuthenticatedUser, now: Date = new Date()): Promise<DriverScoreboard> {
    assertOwnerOrManager(actor);

    const today = dateOnlyInDarEsSalaam(now);

    const drivers = await this.prisma.client.driver.findMany({
      where: { isActive: true },
      select: {
        id: true,
        driverType: true,
        user: { select: { firstName: true, lastName: true } },
      },
    });
    const driverIds = drivers.map((d) => d.id);
    if (driverIds.length === 0) {
      return { totalActiveDrivers: 0, scores: [] };
    }

    const [assignments, plans] = await Promise.all([
      this.prisma.client.dailyAssignment.findMany({
        where: { driverId: { in: driverIds } },
        select: {
          id: true,
          driverId: true,
          assignedDate: true,
          targetAmount: true,
          ownershipPlanId: true,
          motorcycleId: true,
        },
      }),
      this.prisma.client.ownershipPlan.findMany({
        where: { driverId: { in: driverIds } },
        select: {
          id: true,
          driverId: true,
          status: true,
          dailyAmount: true,
          breachAfterConsecutiveMissedDays: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const assignmentIds = assignments.map((a) => a.id);
    const planIds = plans.map((p) => p.id);

    // Reliability, vehicle care, and "current vehicle" all read "to date" -
    // a manually-created assignment can legitimately be dated in the
    // future (the create-assignment form allows any date), and that must
    // not count as a day the driver has already been reliable or
    // unreliable about. computeConsecutiveMissedDays (used below for the
    // contract component) already has its own elapsed-day boundary, so
    // this filter is only applied to the rows built from `historical`.
    const historical = (assignments as AssignmentRow[]).filter(
      (a) => a.assignedDate.getTime() <= today.getTime(),
    );

    const [payments, excusals] = await Promise.all([
      assignmentIds.length > 0
        ? this.prisma.client.dailyPayment.findMany({
            where: { dailyAssignmentId: { in: assignmentIds }, status: PaymentStatus.COMPLETED },
            select: { dailyAssignmentId: true, amount: true, paidAt: true },
          })
        : Promise.resolve([] as PaymentRow[]),
      planIds.length > 0
        ? this.prisma.client.dayExcusal.findMany({
            where: { ownershipPlanId: { in: planIds }, status: DayExcusalStatus.APPROVED },
            select: { ownershipPlanId: true, excusedDate: true },
          })
        : Promise.resolve([] as { ownershipPlanId: string; excusedDate: Date }[]),
    ]);

    // Every motorcycle this batch might need a plate or a maintenance
    // status for: today's assigned vehicle (vehicle care) and the most
    // recently assigned vehicle (display only) - one combined lookup, not
    // two, and never one per driver.
    const todaysAssignmentByDriver = new Map<string, AssignmentRow>();
    const latestAssignmentByDriver = new Map<string, AssignmentRow>();
    for (const a of historical) {
      if (dateOnlyInDarEsSalaam(a.assignedDate).getTime() === today.getTime()) {
        todaysAssignmentByDriver.set(a.driverId, a);
      }
      const latest = latestAssignmentByDriver.get(a.driverId);
      if (!latest || a.assignedDate.getTime() > latest.assignedDate.getTime()) {
        latestAssignmentByDriver.set(a.driverId, a);
      }
    }
    const neededMotorcycleIds = [
      ...new Set(
        [...todaysAssignmentByDriver.values(), ...latestAssignmentByDriver.values()].map(
          (a) => a.motorcycleId,
        ),
      ),
    ];
    const motorcycles =
      neededMotorcycleIds.length > 0
        ? await this.prisma.client.motorcycle.findMany({
            where: { id: { in: neededMotorcycleIds } },
            select: {
              id: true,
              registrationNumber: true,
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
          })
        : [];
    const motorcycleById = new Map(motorcycles.map((m) => [m.id, m]));

    // Per-assignment paid totals: BOTH the "paid on or before its own due
    // date" figure (reliability's on-time definition) and the plain total
    // (what computeConsecutiveMissedDays needs, same convention as
    // ownership-plan.service.ts's batchDerivedFigures) - one pass over the
    // same payment rows for both, never two queries.
    const onTimePaidByAssignment = new Map<string, Prisma.Decimal>();
    const totalPaidByAssignment = new Map<string, Prisma.Decimal>();
    const assignmentById = new Map(assignments.map((a) => [a.id, a as AssignmentRow]));
    for (const p of payments as PaymentRow[]) {
      totalPaidByAssignment.set(
        p.dailyAssignmentId,
        (totalPaidByAssignment.get(p.dailyAssignmentId) ?? new Prisma.Decimal(0)).plus(p.amount),
      );
      const assignment = assignmentById.get(p.dailyAssignmentId);
      if (!assignment || !p.paidAt) continue;
      if (dateOnlyInDarEsSalaam(p.paidAt).getTime() <= assignment.assignedDate.getTime()) {
        onTimePaidByAssignment.set(
          p.dailyAssignmentId,
          (onTimePaidByAssignment.get(p.dailyAssignmentId) ?? new Prisma.Decimal(0)).plus(p.amount),
        );
      }
    }

    const excusedDatesByPlan = new Map<string, Date[]>();
    for (const e of excusals) {
      const list = excusedDatesByPlan.get(e.ownershipPlanId) ?? [];
      list.push(e.excusedDate);
      excusedDatesByPlan.set(e.ownershipPlanId, list);
    }

    // Prefer the driver's ACTIVE plan; else their most recently created
    // one. Plans are already ordered createdAt desc above, so the first
    // one encountered per driver is that driver's most recent - only
    // overridden below if a (necessarily older, since at most one plan is
    // ever ACTIVE at a time) ACTIVE plan turns up later in the scan.
    const planByDriver = new Map<string, (typeof plans)[number]>();
    for (const plan of plans) {
      const existing = planByDriver.get(plan.driverId);
      if (!existing) {
        planByDriver.set(plan.driverId, plan);
      } else if (
        existing.status !== OwnershipPlanStatus.ACTIVE &&
        plan.status === OwnershipPlanStatus.ACTIVE
      ) {
        planByDriver.set(plan.driverId, plan);
      }
    }

    const assignmentsByDriver = new Map<string, AssignmentRow[]>();
    for (const a of historical) {
      const list = assignmentsByDriver.get(a.driverId) ?? [];
      list.push(a);
      assignmentsByDriver.set(a.driverId, list);
    }

    const monthStarts = trailingMonthStarts(today, 6);

    const scores: DriverScore[] = [];
    for (const driver of drivers) {
      const driverAssignments = assignmentsByDriver.get(driver.id) ?? [];
      const expectedDays = driverAssignments.length;
      const relPoints = reliabilityPoints(
        driverAssignments.filter((a) =>
          (onTimePaidByAssignment.get(a.id) ?? new Prisma.Decimal(0)).greaterThanOrEqualTo(
            a.targetAmount,
          ),
        ).length,
        expectedDays,
      );
      if (relPoints === null) continue; // no assignment history - excluded, not shown as 0

      const onTimeDaysExact = driverAssignments.filter((a) =>
        (onTimePaidByAssignment.get(a.id) ?? new Prisma.Decimal(0)).greaterThanOrEqualTo(
          a.targetAmount,
        ),
      ).length;

      const plan = planByDriver.get(driver.id) ?? null;
      const defaulted = plan?.status === OwnershipPlanStatus.DEFAULTED;
      let consecutiveMissedDays: number | null = null;
      if (plan && !defaulted) {
        const planAssignments = driverAssignments.filter((a) => a.ownershipPlanId === plan.id);
        const rows: AssignmentPaidRow[] = planAssignments.map((a) => ({
          assignedDate: a.assignedDate,
          targetAmount: a.targetAmount,
          paidAmount: totalPaidByAssignment.get(a.id) ?? new Prisma.Decimal(0),
        }));
        consecutiveMissedDays = computeConsecutiveMissedDays(
          rows,
          now,
          excusedDatesByPlan.get(plan.id) ?? [],
        );
      }
      const conPoints = contractPoints({
        hasPlan: plan !== null,
        defaulted,
        consecutiveMissedDays: consecutiveMissedDays ?? 0,
        breachAfterConsecutiveMissedDays: plan?.breachAfterConsecutiveMissedDays ?? 1,
      });

      const todaysAssignment = todaysAssignmentByDriver.get(driver.id) ?? null;
      let dueKind: MaintenanceReminderKind | null = null;
      if (todaysAssignment) {
        const bike = motorcycleById.get(todaysAssignment.motorcycleId);
        if (bike) {
          const withinDays = this.config.get<number>('MAINTENANCE_REMINDER_DAYS', 14);
          const mileageBuffer = this.config.get<number>('MAINTENANCE_REMINDER_MILEAGE', 500);
          const log = bike.maintenanceLogs[0];
          if (log) {
            dueKind = determineMaintenanceDue(
              { currentMileage: bike.currentMileage, ...log },
              today,
              withinDays,
              mileageBuffer,
            ).kind;
          }
        }
      }
      const carePts = carePoints(dueKind);

      const raw = relPoints + conPoints + carePts;
      const display = rescaleToDisplayScore(raw);

      const latest = latestAssignmentByDriver.get(driver.id) ?? null;
      const registrationNumber = latest
        ? (motorcycleById.get(latest.motorcycleId)?.registrationNumber ?? null)
        : null;

      const note = this.buildNote({
        plan,
        defaulted,
        consecutiveMissedDays,
        expectedDays,
        onTimeDays: onTimeDaysExact,
      });

      const sixMonthOnTimeRate: MonthlyOnTimeRate[] = monthStarts.map((start) => {
        const key = monthKey(start);
        const monthAssignments = driverAssignments.filter((a) => monthKey(a.assignedDate) === key);
        if (monthAssignments.length === 0) return { month: key, rate: null };
        const onTime = monthAssignments.filter((a) =>
          (onTimePaidByAssignment.get(a.id) ?? new Prisma.Decimal(0)).greaterThanOrEqualTo(
            a.targetAmount,
          ),
        ).length;
        return { month: key, rate: onTime / monthAssignments.length };
      });

      scores.push({
        driverId: driver.id,
        driverType: driver.driverType,
        firstName: driver.user.firstName,
        lastName: driver.user.lastName,
        registrationNumber,
        raw,
        display,
        band: bandForDisplayScore(display),
        components: {
          reliability: { points: relPoints, onTimeDays: onTimeDaysExact, expectedDays },
          contract: {
            points: conPoints,
            hasPlan: plan !== null,
            defaulted,
            consecutiveMissedDays,
            breachAfterConsecutiveMissedDays: plan?.breachAfterConsecutiveMissedDays ?? null,
          },
          care: { points: carePts, dueKind, hasAssignmentToday: todaysAssignment !== null },
        },
        note,
        sixMonthOnTimeRate,
      });
    }

    scores.sort((a, b) => a.display - b.display); // worst first
    return { totalActiveDrivers: drivers.length, scores };
  }

  private buildNote(input: {
    plan: { dailyAmount: Prisma.Decimal } | null;
    defaulted: boolean;
    consecutiveMissedDays: number | null;
    expectedDays: number;
    onTimeDays: number;
  }): string {
    if (input.plan && input.defaulted) {
      return 'Plan defaulted.';
    }
    if (input.plan && (input.consecutiveMissedDays ?? 0) > 0) {
      const owed = new Prisma.Decimal(input.plan.dailyAmount).times(input.consecutiveMissedDays!);
      return `${input.consecutiveMissedDays} day${input.consecutiveMissedDays === 1 ? '' : 's'} behind, ~TZS ${money(owed)} owed`;
    }
    const missed = input.expectedDays - input.onTimeDays;
    if (missed > 0) {
      return `${missed} of ${input.expectedDays} assignments not paid on time`;
    }
    return 'Fully on schedule.';
  }
}
