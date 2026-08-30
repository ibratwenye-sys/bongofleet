import { ForbiddenException, Injectable } from '@nestjs/common';
import { OwnershipPlanStatus, Prisma, UserRole } from '@prisma/client';
import { positionSeverity, type PlanPositionSeverity } from '@bongofleet/shared-lib';
import { AuthenticatedUser } from '../auth/auth.types';
import { OwnershipPlanService } from './ownership-plan.service';
import { totalOwed } from './ownership-plan.derivation';

const EXPECTED_COMPLETIONS_MONTHS = 18;

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
    throw new ForbiddenException('Only OWNER or MANAGER may view the ownership summary');
  }
}

function money(value: Prisma.Decimal | number | string | null | undefined): string {
  return new Prisma.Decimal(value ?? 0).toFixed(2);
}

function monthKey(dateOrIso: Date | string): string {
  return typeof dateOrIso === 'string'
    ? dateOrIso.slice(0, 7)
    : dateOrIso.toISOString().slice(0, 7);
}

type PlanRow = Awaited<ReturnType<OwnershipPlanService['list']>>[number];

interface Bucketed {
  plan: PlanRow;
  severity: PlanPositionSeverity;
}

export interface OwnershipSummaryKpis {
  activePlanCount: number;
  onScheduleCount: number;
  slippingCount: number;
  toTerminateCount: number;
  finishingEarlyCount: number;
  missedDaysTotal: number;
  moneyAtRisk: string;
}

export interface ExpectedCompletionPoint {
  month: string;
  count: number;
}

export interface OwnershipInsight {
  title: string;
  description: string;
  planIds: string[];
}

export interface MissedDaysRow {
  planId: string;
  driverName: string;
  vehicleRegistration: string | null;
  missedStreak: number;
  valueAtRisk: string;
  recentExcusalCount: number;
  verdict: 'Terminate' | 'Watch';
  severity: 'red' | 'amber';
}

export interface ContractValueTotals {
  totalOwed: string;
  collectedToDate: string;
  paidIn: string;
  atRisk: string;
  stillToCome: string;
}

export interface TwoBalances {
  remainingToOwn: string;
  remainingToBill: string;
  arrears: string;
}

export interface OwnershipSummaryResponse {
  kpis: OwnershipSummaryKpis;
  planHealth: {
    onSchedule: number;
    slipping: number;
    toTerminate: number;
    finishingEarly: number;
  };
  insights: OwnershipInsight[];
  expectedCompletions: ExpectedCompletionPoint[];
  missedDaysTable: MissedDaysRow[];
  contractValueTotals: ContractValueTotals;
  twoBalances: TwoBalances;
}

function driverName(plan: PlanRow): string {
  return plan.driver ? `${plan.driver.user.firstName} ${plan.driver.user.lastName}` : 'Unknown';
}

/**
 * Stage UI3 - the Ownership page's single data source. Every plan-level
 * figure (daysBehind, daysAhead, consecutiveMissedDays, remainingToOwn,
 * remainingToBill, graceDays, breachAfterConsecutiveMissedDays,
 * recentExcusalCount, ...) is read straight from
 * OwnershipPlanService.list() - the exact same query and derivation the
 * Ownership table itself renders from - never re-queried or re-derived
 * here. The plan-health severity read is positionSeverity (shared-lib),
 * the same function OwnershipPage.tsx's row styling now imports too - one
 * classification, not two that could drift.
 */
@Injectable()
export class OwnershipSummaryService {
  constructor(private readonly ownershipPlanService: OwnershipPlanService) {}

  async getSummary(
    actor: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<OwnershipSummaryResponse> {
    assertOwnerOrManager(actor);

    const allPlans = await this.ownershipPlanService.list(actor);
    const activePlans = allPlans.filter((p) => p.status === OwnershipPlanStatus.ACTIVE);

    const bucketed: Bucketed[] = activePlans.map((plan) => ({
      plan,
      severity: positionSeverity(
        plan.daysBehind,
        plan.consecutiveMissedDays,
        plan.graceDays,
        plan.breachAfterConsecutiveMissedDays,
      ),
    }));

    const toTerminate = bucketed.filter((b) => b.severity === 'red');
    const slipping = bucketed.filter((b) => b.severity === 'amber');
    const finishingEarly = bucketed.filter((b) => b.severity === 'ok' && b.plan.daysAhead > 0);
    const onSchedule = bucketed.filter((b) => b.severity === 'ok' && b.plan.daysAhead === 0);
    const flagged = bucketed.filter((b) => b.severity !== 'ok');

    const missedDaysTotal = flagged.reduce((sum, b) => sum + b.plan.consecutiveMissedDays, 0);
    // Cumulative money position (daysBehind), not the current streak
    // (consecutiveMissedDays) - a deliberately different quantity from the
    // missed-days table's own per-row "value at risk" column below. See
    // ownership-plan.derivation.ts's own comment on why these two numbers
    // must never be conflated.
    const moneyAtRiskDecimal = flagged.reduce(
      (sum, b) => sum.plus(new Prisma.Decimal(b.plan.daysBehind).times(b.plan.dailyAmount)),
      new Prisma.Decimal(0),
    );

    const kpis: OwnershipSummaryKpis = {
      activePlanCount: activePlans.length,
      onScheduleCount: onSchedule.length,
      slippingCount: slipping.length,
      toTerminateCount: toTerminate.length,
      finishingEarlyCount: finishingEarly.length,
      missedDaysTotal,
      moneyAtRisk: money(moneyAtRiskDecimal),
    };

    const insights = this.buildInsights(toTerminate, finishingEarly);
    const expectedCompletions = this.buildExpectedCompletions(activePlans, now);
    const missedDaysTable = this.buildMissedDaysTable([...toTerminate, ...slipping]);
    const contractValueTotals = this.buildContractValueTotals(allPlans, moneyAtRiskDecimal);
    const twoBalances = this.buildTwoBalances(activePlans);

    return {
      kpis,
      planHealth: {
        onSchedule: onSchedule.length,
        slipping: slipping.length,
        toTerminate: toTerminate.length,
        finishingEarly: finishingEarly.length,
      },
      insights,
      expectedCompletions,
      missedDaysTable,
      contractValueTotals,
      twoBalances,
    };
  }

  /** Two real rankings, nothing invented beyond what they say. */
  private buildInsights(toTerminate: Bucketed[], finishingEarly: Bucketed[]): OwnershipInsight[] {
    const insights: OwnershipInsight[] = [];

    if (toTerminate.length > 0) {
      const maxMissed = Math.max(...toTerminate.map((b) => b.plan.consecutiveMissedDays));
      const worst = toTerminate.filter((b) => b.plan.consecutiveMissedDays === maxMissed);
      insights.push({
        title: `${maxMissed} day${maxMissed === 1 ? '' : 's'} missed in a row`,
        description: `${worst.map((b) => driverName(b.plan)).join(', ')} - flagged for termination review.`,
        planIds: worst.map((b) => b.plan.id),
      });
    }

    if (finishingEarly.length > 0) {
      const maxAhead = Math.max(...finishingEarly.map((b) => b.plan.daysAhead));
      const best = finishingEarly.filter((b) => b.plan.daysAhead === maxAhead);
      insights.push({
        title: `${maxAhead} day${maxAhead === 1 ? '' : 's'} ahead of schedule`,
        description: `${best.map((b) => driverName(b.plan)).join(', ')} - ready to prep an early finish.`,
        planIds: best.map((b) => b.plan.id),
      });
    }

    return insights;
  }

  /** Stage UI3 - keyed by (contractEndDate ?? derivedEndDate), the exact
   *  same precedence EndDateCell (OwnershipPage.tsx) already displays.
   *  Every month in the next 18 gets a point, zero included, same "no
   *  gaps" convention as every other chart series in this codebase. */
  private buildExpectedCompletions(activePlans: PlanRow[], now: Date): ExpectedCompletionPoint[] {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const months: string[] = [];
    for (let i = 0; i < EXPECTED_COMPLETIONS_MONTHS; i++) {
      const cursor = new Date(monthStart);
      cursor.setUTCMonth(cursor.getUTCMonth() + i);
      months.push(monthKey(cursor));
    }

    const counts = new Map<string, number>();
    for (const plan of activePlans) {
      const key = plan.contractEndDate
        ? monthKey(plan.contractEndDate)
        : monthKey(plan.derivedEndDate);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return months.map((month) => ({ month, count: counts.get(month) ?? 0 }));
  }

  private buildMissedDaysTable(rows: Bucketed[]): MissedDaysRow[] {
    return rows
      .map(({ plan, severity }): MissedDaysRow => ({
        planId: plan.id,
        driverName: driverName(plan),
        vehicleRegistration: plan.motorcycle?.registrationNumber ?? null,
        missedStreak: plan.consecutiveMissedDays,
        valueAtRisk: money(new Prisma.Decimal(plan.consecutiveMissedDays).times(plan.dailyAmount)),
        recentExcusalCount: plan.recentExcusalCount,
        verdict: severity === 'red' ? 'Terminate' : 'Watch',
        severity: severity as 'red' | 'amber',
      }))
      .sort((a, b) => b.missedStreak - a.missedStreak);
  }

  /** Stage UI3 - across ALL plans regardless of status (a completed or
   *  cancelled plan's history still counts toward what this fleet has
   *  ever billed/collected); atRisk is ACTIVE-only, reusing the same
   *  moneyAtRisk this method's caller already computed - never a second,
   *  parallel definition. */
  private buildContractValueTotals(
    allPlans: PlanRow[],
    moneyAtRiskDecimal: Prisma.Decimal,
  ): ContractValueTotals {
    const totalOwedDecimal = allPlans.reduce(
      (sum, p) => sum.plus(totalOwed(new Prisma.Decimal(p.dailyAmount), p.instalmentCount)),
      new Prisma.Decimal(0),
    );
    const collectedToDate = allPlans.reduce(
      (sum, p) => sum.plus(new Prisma.Decimal(p.amountPaid)),
      new Prisma.Decimal(0),
    );
    const stillToCome = Prisma.Decimal.max(
      0,
      totalOwedDecimal.minus(collectedToDate).minus(moneyAtRiskDecimal),
    );

    return {
      totalOwed: money(totalOwedDecimal),
      collectedToDate: money(collectedToDate),
      paidIn: money(collectedToDate),
      atRisk: money(moneyAtRiskDecimal),
      stillToCome: money(stillToCome),
    };
  }

  /** Stage UI3 - "Two balances, never one": remainingToOwn (what the
   *  driver still has to PAY) and remainingToBill (what the generator may
   *  still BILL) are genuinely different quantities - see
   *  ownership-plan.derivation.ts's own comment on why. arrears is what
   *  has been billed but not yet paid: sum(remainingToBill) -
   *  sum(amountPaid), floored at 0 (a plan paid ahead of its billing
   *  should not show negative arrears). */
  private buildTwoBalances(activePlans: PlanRow[]): TwoBalances {
    const remainingToOwn = activePlans.reduce(
      (sum, p) => sum.plus(new Prisma.Decimal(p.remainingToOwn)),
      new Prisma.Decimal(0),
    );
    const remainingToBill = activePlans.reduce(
      (sum, p) => sum.plus(new Prisma.Decimal(p.remainingToBill)),
      new Prisma.Decimal(0),
    );
    const amountPaid = activePlans.reduce(
      (sum, p) => sum.plus(new Prisma.Decimal(p.amountPaid)),
      new Prisma.Decimal(0),
    );
    const arrears = Prisma.Decimal.max(0, remainingToBill.minus(amountPaid));

    return {
      remainingToOwn: money(remainingToOwn),
      remainingToBill: money(remainingToBill),
      arrears: money(arrears),
    };
  }
}
