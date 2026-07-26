import { ForbiddenException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { OwnershipPlanStatus, PaymentStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { requestContext } from '../../common/context/request-context';
import { generateRideReference } from '../../common/reference.util';
import { computeRemainingToBill, computeRemainingToOwn } from './ownership-plan.derivation';

export const OWNERSHIP_PLAN_GENERATOR_CRON_JOB = 'ownership-plan-generator';

/** Marker recorded as the acting user for system-initiated (cron) work. */
const SYSTEM_USER_ID = 'system:ownership-plan-generator';

export interface BlockedInstalment {
  planId: string;
  driverId: string;
  assignedDate: string;
  reason: string;
}

export interface UnbackfilledGap {
  planId: string;
  driverId: string;
  missedActiveWeekdays: number;
  earliestMissedDate: string;
}

export interface OwnershipPlanGenerationResult {
  tenantsScanned: number;
  plansScanned: number;
  assignmentsCreated: number;
  plansCompleted: number;
  blocked: BlockedInstalment[];
  unbackfilledGaps: UnbackfilledGap[];
}

function dateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Active-weekday dates in [from, toExclusive). Used only to size a reported gap. */
function countActiveWeekdaysInRange(
  from: Date,
  toExclusive: Date,
  activeWeekdays: number[],
): number {
  let count = 0;
  for (let cursor = from; cursor.getTime() < toExclusive.getTime(); cursor = addDays(cursor, 1)) {
    if (activeWeekdays.includes(cursor.getUTCDay())) {
      count += 1;
    }
  }
  return count;
}

type PlanRow = {
  id: string;
  driverId: string;
  motorcycleId: string;
  dailyAmount: Prisma.Decimal;
  totalPrice: Prisma.Decimal;
  downPayment: Prisma.Decimal;
  startDate: Date;
  activeWeekdays: number[];
};

/**
 * Nightly instalment generator for hire-purchase ownership plans
 * (DESIGN_HIRE_PURCHASE.md §6). Follows missed-payment-notification.service.ts
 * exactly: CronJob + SchedulerRegistry, an early return in tests, per-tenant
 * fail-closed context, one tenant's failure never stopping the rest.
 *
 * The manual-run endpoint (POST /ownership-plans/generate) calls `generate()`
 * directly - the same code path as the cron - which is the only way the
 * idempotency guarantee (check #2 below) actually means anything.
 */
@Injectable()
export class OwnershipPlanGeneratorService implements OnModuleInit {
  private readonly logger = new Logger(OwnershipPlanGeneratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    // Never self-schedule inside tests - specs call generate() directly.
    if (this.config.get<string>('NODE_ENV') === 'test') {
      return;
    }

    const expression = this.config.get<string>('OWNERSHIP_PLAN_GENERATOR_CRON', '5 0 * * *');
    const timeZone = this.config.get<string>('DOCUMENT_EXPIRY_TZ', 'Africa/Dar_es_Salaam');

    const job = new CronJob(
      expression,
      () => {
        this.generate().catch((error: unknown) => {
          this.logger.error(
            'Scheduled ownership-plan generation failed',
            error instanceof Error ? error.stack : String(error),
          );
        });
      },
      null,
      false,
      timeZone,
    );

    this.schedulerRegistry.addCronJob(OWNERSHIP_PLAN_GENERATOR_CRON_JOB, job);
    job.start();
    this.logger.log(`Ownership-plan generator scheduled: "${expression}" (${timeZone})`);
  }

  /**
   * POST /ownership-plans/generate. Scoped to the acting OWNER's own tenant
   * (the cron's tenant loop is a system-wide concern; a single owner must
   * never be able to trigger generation for someone else's fleet). Calls the
   * exact same generateForTenant() the cron uses per tenant - not a parallel
   * implementation - which is what makes the idempotency guarantee hold
   * regardless of what triggered the run.
   */
  async runManual(actor: AuthenticatedUser): Promise<OwnershipPlanGenerationResult> {
    if (actor.role !== UserRole.OWNER) {
      throw new ForbiddenException('Only OWNER may run the ownership-plan generator');
    }
    const tenantResult = await this.generateForTenant(actor.tenantId, new Date());
    return { ...tenantResult, tenantsScanned: 1 };
  }

  async generate(now: Date = new Date()): Promise<OwnershipPlanGenerationResult> {
    const tenants = await requestContext.runUnscoped(() =>
      this.prisma.client.tenant.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
      }),
    );

    const result: OwnershipPlanGenerationResult = {
      tenantsScanned: tenants.length,
      plansScanned: 0,
      assignmentsCreated: 0,
      plansCompleted: 0,
      blocked: [],
      unbackfilledGaps: [],
    };

    for (const tenant of tenants) {
      try {
        const tenantResult = await this.generateForTenant(tenant.id, now);
        result.plansScanned += tenantResult.plansScanned;
        result.assignmentsCreated += tenantResult.assignmentsCreated;
        result.plansCompleted += tenantResult.plansCompleted;
        result.blocked.push(...tenantResult.blocked);
        result.unbackfilledGaps.push(...tenantResult.unbackfilledGaps);
      } catch (error) {
        this.logger.error(
          `Ownership-plan generation failed for tenant ${tenant.id} (${tenant.name}) - continuing`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    this.logger.log(
      `Ownership-plan generation done: ${result.tenantsScanned} tenant(s) scanned, ` +
        `${result.plansScanned} plan(s), ${result.assignmentsCreated} assignment(s) created, ` +
        `${result.plansCompleted} plan(s) completed`,
    );
    if (result.unbackfilledGaps.length > 0) {
      this.logger.warn(
        `Ownership-plan generation: ${result.unbackfilledGaps.length} plan(s) have a gap beyond ` +
          'the backfill lookback window and were not fully backfilled - needs owner attention',
      );
    }
    return result;
  }

  private async generateForTenant(
    tenantId: string,
    now: Date,
  ): Promise<OwnershipPlanGenerationResult> {
    return requestContext.run({ tenantId, userId: SYSTEM_USER_ID, role: UserRole.OWNER }, () =>
      this.generateForTenantScoped(tenantId, now),
    );
  }

  private async generateForTenantScoped(
    tenantId: string,
    now: Date,
  ): Promise<OwnershipPlanGenerationResult> {
    const result: OwnershipPlanGenerationResult = {
      tenantsScanned: 0,
      plansScanned: 0,
      assignmentsCreated: 0,
      plansCompleted: 0,
      blocked: [],
      unbackfilledGaps: [],
    };

    const today = dateOnly(now);
    const lookbackDays = this.config.get<number>('OWNERSHIP_PLAN_BACKFILL_LOOKBACK_DAYS', 14);
    const windowStart = addDays(today, -lookbackDays);

    const plans: PlanRow[] = await this.prisma.client.ownershipPlan.findMany({
      where: { tenantId, status: OwnershipPlanStatus.ACTIVE },
      select: {
        id: true,
        driverId: true,
        motorcycleId: true,
        dailyAmount: true,
        totalPrice: true,
        downPayment: true,
        startDate: true,
        activeWeekdays: true,
      },
    });
    result.plansScanned = plans.length;
    if (plans.length === 0) {
      return result;
    }

    const planIds = plans.map((p) => p.id);
    const driverIds = plans.map((p) => p.driverId);

    // Existing assignments already generated for these plans (any date) -
    // gives amountPaid inputs, amountBilled (Part 1: what has been committed,
    // not what has come due), and each plan's most recent generated date, all
    // in one query, never one per plan.
    const planAssignments = await this.prisma.client.dailyAssignment.findMany({
      where: { ownershipPlanId: { in: planIds } },
      select: { id: true, ownershipPlanId: true, assignedDate: true, targetAmount: true },
    });

    const lastAssignedDateByPlan = new Map<string, Date>();
    const planIdByAssignmentId = new Map<string, string>();
    const amountBilledByPlan = new Map<string, Prisma.Decimal>();
    for (const a of planAssignments) {
      const planId = a.ownershipPlanId as string;
      planIdByAssignmentId.set(a.id, planId);
      const prev = lastAssignedDateByPlan.get(planId);
      if (!prev || a.assignedDate.getTime() > prev.getTime()) {
        lastAssignedDateByPlan.set(planId, a.assignedDate);
      }
      amountBilledByPlan.set(
        planId,
        (amountBilledByPlan.get(planId) ?? new Prisma.Decimal(0)).plus(a.targetAmount),
      );
    }

    const amountPaidByPlan = new Map<string, Prisma.Decimal>();
    if (planAssignments.length > 0) {
      const paid = await this.prisma.client.dailyPayment.groupBy({
        by: ['dailyAssignmentId'],
        where: {
          dailyAssignmentId: { in: planAssignments.map((a) => a.id) },
          status: PaymentStatus.COMPLETED,
        },
        _sum: { amount: true },
      });
      for (const row of paid) {
        const planId = planIdByAssignmentId.get(row.dailyAssignmentId);
        if (!planId) continue;
        amountPaidByPlan.set(
          planId,
          (amountPaidByPlan.get(planId) ?? new Prisma.Decimal(0)).plus(row._sum.amount ?? 0),
        );
      }
    }

    // Every assignment for these drivers within the lookback window,
    // regardless of which plan (or no plan) it belongs to - one query, used
    // to detect both "already generated" and "a manual assignment is in the
    // way" without a per-date query inside the loop below.
    const existingAssignments = await this.prisma.client.dailyAssignment.findMany({
      where: {
        tenantId,
        driverId: { in: driverIds },
        assignedDate: { gte: windowStart, lte: today },
      },
      select: { driverId: true, assignedDate: true, ownershipPlanId: true },
    });
    const existingByDriverDate = new Map<string, string | null>();
    for (const a of existingAssignments) {
      existingByDriverDate.set(`${a.driverId}|${isoDate(a.assignedDate)}`, a.ownershipPlanId);
    }

    const toCreate: Prisma.DailyAssignmentCreateManyInput[] = [];
    const completedPlanIds: string[] = [];

    for (const plan of plans) {
      const amountPaid = amountPaidByPlan.get(plan.id) ?? new Prisma.Decimal(0);
      const amountBilled = amountBilledByPlan.get(plan.id) ?? new Prisma.Decimal(0);
      const remainingToOwn = computeRemainingToOwn(plan.totalPrice, plan.downPayment, amountPaid);

      // Two separate checks with two separate outcomes (Part 1). Paid off
      // (remainingToOwn <= 0) -> COMPLETED, stop entirely: a fully paid
      // driver must never be billed again, backfill included. This is
      // invariant for the rest of this run (no payment happens mid-run), so
      // checking it once here is equivalent to checking it on every date.
      if (remainingToOwn.lessThanOrEqualTo(0)) {
        completedPlanIds.push(plan.id);
        result.plansCompleted += 1;
        continue;
      }

      // Fully billed but not yet paid off -> stay ACTIVE, stop generating.
      // Unlike remainingToOwn, this DOES change within the run: it is a
      // running counter that decrements by each row this run creates, which
      // is what caps a non-paying driver's arrears at the price of the
      // vehicle instead of billing them forever.
      let remainingToBill = computeRemainingToBill(plan.totalPrice, plan.downPayment, amountBilled);
      if (remainingToBill.lessThanOrEqualTo(0)) {
        continue;
      }

      const lastAssignedDate = lastAssignedDateByPlan.get(plan.id);
      const naturalStart = lastAssignedDate
        ? addDays(lastAssignedDate, 1)
        : dateOnly(plan.startDate);

      if (naturalStart.getTime() < windowStart.getTime()) {
        const missedActiveWeekdays = countActiveWeekdaysInRange(
          naturalStart,
          windowStart,
          plan.activeWeekdays,
        );
        if (missedActiveWeekdays > 0) {
          result.unbackfilledGaps.push({
            planId: plan.id,
            driverId: plan.driverId,
            missedActiveWeekdays,
            earliestMissedDate: isoDate(naturalStart),
          });
          this.logger.warn(
            `Ownership plan ${plan.id}: ${missedActiveWeekdays} active weekday(s) unbilled before ` +
              `the ${lookbackDays}-day lookback window (earliest ${isoDate(naturalStart)}) - not ` +
              'backfilled; needs owner attention',
          );
        }
      }

      const backfillStart =
        naturalStart.getTime() > windowStart.getTime() ? naturalStart : windowStart;

      for (
        let cursor = backfillStart;
        cursor.getTime() <= today.getTime();
        cursor = addDays(cursor, 1)
      ) {
        if (!plan.activeWeekdays.includes(cursor.getUTCDay())) {
          continue;
        }

        const key = `${plan.driverId}|${isoDate(cursor)}`;
        const existingPlanId = existingByDriverDate.get(key);
        if (existingPlanId !== undefined) {
          if (existingPlanId !== plan.id) {
            // A manual assignment (or, in principle, a stale one from a
            // different plan) already occupies this driver+date. Skip and
            // report it rather than silently rewriting history.
            result.blocked.push({
              planId: plan.id,
              driverId: plan.driverId,
              assignedDate: isoDate(cursor),
              reason:
                existingPlanId === null
                  ? 'a manual (non-plan) assignment already exists for this driver on this date'
                  : 'an assignment for a different ownership plan already exists for this driver on this date',
            });
          }
          continue; // either this plan's own row (idempotent) or blocked.
        }

        // Fully billed partway through this run's own backfill - stop here,
        // stay ACTIVE. remainingToOwn was already confirmed positive above
        // and does not change mid-run, so this is never a completion.
        if (remainingToBill.lessThanOrEqualTo(0)) {
          break;
        }

        const targetAmount = Prisma.Decimal.min(plan.dailyAmount, remainingToBill);
        toCreate.push({
          tenantId,
          driverId: plan.driverId,
          motorcycleId: plan.motorcycleId,
          assignedDate: cursor,
          targetAmount,
          ownershipPlanId: plan.id,
          reference: generateRideReference(),
        });
        remainingToBill = remainingToBill.minus(targetAmount);
        // Mark it taken immediately so nothing else in this same run can
        // double-book this driver+date.
        existingByDriverDate.set(key, plan.id);
      }
    }

    if (toCreate.length > 0) {
      await this.prisma.client.dailyAssignment.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
      result.assignmentsCreated += toCreate.length;
    }

    if (completedPlanIds.length > 0) {
      await this.prisma.client.ownershipPlan.updateMany({
        where: { id: { in: completedPlanIds } },
        data: { status: OwnershipPlanStatus.COMPLETED, completedAt: now },
      });
    }

    return result;
  }
}
