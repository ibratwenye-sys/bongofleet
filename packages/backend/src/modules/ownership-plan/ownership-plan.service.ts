import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DayExcusalStatus,
  DepositHandling,
  OwnershipPlanStatus,
  PaymentStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { PaymentService } from '../payment/payment.service';
import { describeMismatch, isCompatible } from '../../common/driver-vehicle-compatibility';
import {
  AssignmentPaidRow,
  computeRemainingToBill,
  derivePlanFigures,
  DerivedPlanFigures,
} from './ownership-plan.derivation';
import { buildInstalmentRow } from './ownership-plan-generator.service';
import { CreateOwnershipPlanDto } from './dto/create-ownership-plan.dto';
import { UpdateOwnershipPlanDto } from './dto/update-ownership-plan.dto';

// Mirrors the schema's own default (Stage F2 Part 1: "siku ... mfululizo" is
// consecutive calendar days, no weekend exclusion) - used only to validate an
// omitted activeWeekdays for duplicates before create() hands off to the
// Prisma column default itself.
const DEFAULT_ACTIVE_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

function assertOwner(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER) {
    throw new ForbiddenException('Only OWNER may manage ownership plans');
  }
}

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
    throw new ForbiddenException('Only OWNER or MANAGER may view ownership plans');
  }
}

function dateOnly(date: Date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function assertNoDuplicateWeekdays(activeWeekdays: number[]): void {
  if (new Set(activeWeekdays).size !== activeWeekdays.length) {
    throw new BadRequestException('activeWeekdays must not contain duplicates');
  }
}

/** Stage G10 - the first active weekday on or after startDate: if startDate
 *  itself is active, that's the one. Same walk-forward the generator's own
 *  backfill loop does over activeWeekdays, just bounded to a single step
 *  here since there is exactly one row to place (the eager deposit day). */
function firstActiveWeekdayOnOrAfter(startDate: Date, activeWeekdays: number[]): Date {
  const cursor = dateOnly(startDate);
  while (!activeWeekdays.includes(cursor.getUTCDay())) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return cursor;
}

/** guarantorId must belong to driverId - same-tenant is automatic (the
 *  tenant-scoping Prisma extension merges actor.tenantId into the query),
 *  so a guarantor from another tenant already looks not-found; this adds
 *  the same-driver check the extension can't express. Wrong tenant or wrong
 *  driver both read as the same NotFound - never a Forbidden that would
 *  confirm the id belongs to someone else. */
async function assertGuarantorBelongsToDriver(
  prisma: PrismaService,
  guarantorId: string,
  driverId: string,
): Promise<void> {
  const guarantor = await prisma.client.guarantor.findUnique({ where: { id: guarantorId } });
  if (!guarantor || guarantor.driverId !== driverId) {
    throw new NotFoundException('Guarantor not found');
  }
}

type PlanRow = {
  id: string;
  dailyAmount: Prisma.Decimal;
  instalmentCount: number;
  contractEndDate: Date | null;
  startDate: Date;
  activeWeekdays: number[];
};

@Injectable()
export class OwnershipPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentService: PaymentService,
  ) {}

  async create(dto: CreateOwnershipPlanDto, actor: AuthenticatedUser) {
    assertOwner(actor);

    const driver = await this.prisma.client.driver.findUnique({
      where: { id: dto.driverId },
      include: { user: { select: { firstName: true, lastName: true } } },
    });
    if (!driver || !driver.isActive) {
      throw new NotFoundException('Driver not found');
    }

    const vehicle = await this.prisma.client.motorcycle.findUnique({
      where: { id: dto.motorcycleId },
    });
    if (!vehicle || !vehicle.isActive) {
      throw new NotFoundException('Vehicle not found');
    }

    if (!isCompatible(driver.driverType, vehicle.vehicleType)) {
      throw new BadRequestException(
        describeMismatch(
          {
            name: `${driver.user.firstName} ${driver.user.lastName}`,
            driverType: driver.driverType,
          },
          { registrationNumber: vehicle.registrationNumber, vehicleType: vehicle.vehicleType },
        ),
      );
    }

    if (dto.guarantorId) {
      await assertGuarantorBelongsToDriver(this.prisma, dto.guarantorId, dto.driverId);
    }

    const activeWeekdays = dto.activeWeekdays ?? DEFAULT_ACTIVE_WEEKDAYS;
    assertNoDuplicateWeekdays(activeWeekdays);

    const existingDriverPlan = await this.prisma.client.ownershipPlan.findFirst({
      where: {
        tenantId: actor.tenantId,
        driverId: dto.driverId,
        status: OwnershipPlanStatus.ACTIVE,
      },
    });
    if (existingDriverPlan) {
      throw new ConflictException('This driver already has an active ownership plan');
    }

    const existingVehiclePlan = await this.prisma.client.ownershipPlan.findFirst({
      where: {
        tenantId: actor.tenantId,
        motorcycleId: dto.motorcycleId,
        status: OwnershipPlanStatus.ACTIVE,
      },
    });
    if (existingVehiclePlan) {
      throw new ConflictException('This vehicle already has an active ownership plan');
    }

    const depositHandling = dto.depositHandling ?? DepositHandling.APPLIED;

    let plan;
    try {
      plan = await this.prisma.client.ownershipPlan.create({
        data: {
          tenantId: actor.tenantId,
          driverId: dto.driverId,
          motorcycleId: dto.motorcycleId,
          guarantorId: dto.guarantorId,
          dailyAmount: dto.dailyAmount,
          instalmentCount: dto.instalmentCount,
          totalPrice: dto.totalPrice,
          downPayment: dto.downPayment ?? 0,
          depositHandling,
          startDate: new Date(dto.startDate),
          contractEndDate: dto.contractEndDate ? new Date(dto.contractEndDate) : undefined,
          activeWeekdays: dto.activeWeekdays,
          graceDays: dto.graceDays,
          lateFeeAmount: dto.lateFeeAmount,
          breachAfterConsecutiveMissedDays: dto.breachAfterConsecutiveMissedDays,
          notes: dto.notes,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Backstop: the partial unique index caught a race the findFirst check above missed.
        throw new ConflictException('This vehicle already has an active ownership plan');
      }
      throw error;
    }

    // Stage G10 (§9e) - APPLIED + a real down payment must be allocated, not
    // sit as an inert number on the row - see allocateAppliedDeposit. Not
    // wrapped in the same transaction as the create() above: this whole
    // sequence (eager assignment + payment cascade) is a best-effort
    // follow-up, deliberately, not nested inside a Prisma transaction with
    // the plan row - see allocateAppliedDeposit's own comment for why. A
    // failure here throws up to the OWNER who just submitted the form
    // rather than silently leaving the deposit unallocated.
    const downPayment = new Prisma.Decimal(dto.downPayment ?? 0);
    if (depositHandling === DepositHandling.APPLIED && downPayment.greaterThan(0)) {
      await this.allocateAppliedDeposit(plan, downPayment, actor);
    }

    return plan;
  }

  /**
   * Stage G10 (§9e) - APPLIED deposit handling: the down payment must show
   * up in amountPaid/netPosition immediately (a 60,000 deposit against a
   * 12,000/day plan should read as ahead by the same §7 math), not sit as an
   * inert number on the row. A brand-new plan has zero DailyAssignment rows
   * - those normally come from the nightly generator - so this eagerly
   * creates the plan's first instalment (buildInstalmentRow, shared with
   * the generator so the two row shapes can never drift) and allocates the
   * deposit against it through payment.service.ts's own tested cascade
   * (createPayment), rather than writing a DailyPayment row directly.
   *
   * confirmLargeAmount: true is correct here even though its >90-days'-worth
   * cap exists to catch a fat-fingered extra zero - this is a configured
   * deposit amount the owner already typed into the plan form, not a typo
   * risk.
   *
   * The resulting payment is completed immediately rather than left PENDING
   * for a manual Reconcile (payment.service.ts's normal lifecycle, and
   * PaymentsPage's "Reconcile" action) - a down payment taken at contract
   * signing is money already in the owner's hand at that moment, the same
   * economic event as a completed transaction, not a pending reconciliation
   * awaiting confirmation.
   *
   * Deliberately not nested in create()'s transaction: PaymentService always
   * runs its own Prisma calls against this.prisma.client, never an injected
   * tx, and retrofitting transaction-parameter support across its tested
   * cascade/overpayment-guard logic for this one caller risked disturbing it
   * more than the (narrow, and never silent) window this leaves - a plan
   * committed with no eager assignment/deposit allocated yet, recoverable by
   * hand (record an ordinary payment against a manually-created assignment).
   */
  private async allocateAppliedDeposit(
    plan: {
      id: string;
      tenantId: string;
      driverId: string;
      motorcycleId: string;
      dailyAmount: Prisma.Decimal;
      instalmentCount: number;
      startDate: Date;
      activeWeekdays: number[];
    },
    downPayment: Prisma.Decimal,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const assignedDate = firstActiveWeekdayOnOrAfter(plan.startDate, plan.activeWeekdays);
    // No assignment/payment exists yet for this plan - amountBilled is 0, so
    // this is exactly totalOwed (§4), the same "remainingToOwn is just
    // totalOwed at creation time" the generator's own first-day math reduces
    // to. buildInstalmentRow's min() against dailyAmount only ever matters
    // for a plan's FINAL day; it costs nothing to route through the same
    // shared function regardless.
    const remainingToBill = computeRemainingToBill(
      plan.dailyAmount,
      plan.instalmentCount,
      new Prisma.Decimal(0),
    );
    const { row } = buildInstalmentRow(plan.tenantId, plan, assignedDate, remainingToBill);

    let assignment;
    try {
      assignment = await this.prisma.client.dailyAssignment.create({ data: row });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Either the (astronomically rare) ride-reference collision, or a
        // real one: a manual assignment already exists for this driver on
        // the plan's first active day. Either way, surface it rather than
        // crash on a raw Prisma error - the plan row already exists, so the
        // owner needs a clear next step, not a stack trace.
        throw new BadRequestException(
          `Could not allocate the deposit - this driver already has an assignment on ` +
            `${assignedDate.toISOString().slice(0, 10)}, this plan's first active day. The ` +
            'plan was created; resolve that conflict, or record the deposit as a manual ' +
            'payment once it is clear.',
        );
      }
      throw error;
    }

    const payment = await this.paymentService.createPayment(
      {
        dailyAssignmentId: assignment.id,
        driverId: plan.driverId,
        amount: downPayment.toNumber(),
        confirmLargeAmount: true,
      },
      actor,
    );
    await this.paymentService.updatePaymentStatus(
      payment.id,
      { status: PaymentStatus.COMPLETED },
      actor,
    );
  }

  async list(actor: AuthenticatedUser) {
    assertOwnerOrManager(actor);

    const plans = await this.prisma.client.ownershipPlan.findMany({
      where: { tenantId: actor.tenantId },
      orderBy: { createdAt: 'desc' },
    });
    if (plans.length === 0) {
      return [];
    }

    const [figuresById, driverById, motorcycleById] = await Promise.all([
      this.batchDerivedFigures(plans),
      this.driversById([...new Set(plans.map((p) => p.driverId))]),
      this.motorcyclesById([...new Set(plans.map((p) => p.motorcycleId))]),
    ]);

    return plans
      .map((plan) => ({
        ...plan,
        driver: driverById.get(plan.driverId) ?? null,
        motorcycle: motorcycleById.get(plan.motorcycleId) ?? null,
        ...(figuresById.get(plan.id) as DerivedPlanFigures),
      }))
      .sort((a, b) => b.daysBehind - a.daysBehind); // problems surface first
  }

  async get(id: string, actor: AuthenticatedUser) {
    const plan = await this.prisma.client.ownershipPlan.findUnique({ where: { id } });
    if (!plan) {
      throw new NotFoundException('Ownership plan not found');
    }
    await this.assertCanView(plan, actor);

    const [figuresById, driver, motorcycle] = await Promise.all([
      this.batchDerivedFigures([plan]),
      this.prisma.client.driver.findUnique({
        where: { id: plan.driverId },
        include: { user: { select: { firstName: true, lastName: true } } },
      }),
      this.prisma.client.motorcycle.findUnique({ where: { id: plan.motorcycleId } }),
    ]);

    return { ...plan, driver, motorcycle, ...(figuresById.get(plan.id) as DerivedPlanFigures) };
  }

  /**
   * Stage G Part 3b - the plan detail page's day-by-day ledger: every
   * DailyAssignment the generator has created for this plan, each with what
   * was owed that day, what was actually paid (COMPLETED only, same filter
   * batchDerivedFigures uses), and a running position (cumulative paid -
   * cumulative owed) so a driver's day of falling behind is visible exactly
   * where it happened, not just as today's single netPosition number.
   * Same access rule as get() - OWNER/MANAGER any plan, the DRIVER their own.
   */
  async ledger(id: string, actor: AuthenticatedUser) {
    const plan = await this.prisma.client.ownershipPlan.findUnique({ where: { id } });
    if (!plan) {
      throw new NotFoundException('Ownership plan not found');
    }
    await this.assertCanView(plan, actor);

    const assignments = await this.prisma.client.dailyAssignment.findMany({
      where: { ownershipPlanId: id },
      orderBy: { assignedDate: 'asc' },
      select: { id: true, assignedDate: true, targetAmount: true },
    });

    const paidByAssignment = new Map<string, Prisma.Decimal>();
    if (assignments.length > 0) {
      const paid = await this.prisma.client.dailyPayment.groupBy({
        by: ['dailyAssignmentId'],
        where: {
          dailyAssignmentId: { in: assignments.map((a) => a.id) },
          status: PaymentStatus.COMPLETED,
        },
        _sum: { amount: true },
      });
      for (const row of paid) {
        paidByAssignment.set(row.dailyAssignmentId, row._sum.amount ?? new Prisma.Decimal(0));
      }
    }

    let cumulativeOwed = new Prisma.Decimal(0);
    let cumulativePaid = new Prisma.Decimal(0);
    return assignments.map((assignment) => {
      const paid = paidByAssignment.get(assignment.id) ?? new Prisma.Decimal(0);
      cumulativeOwed = cumulativeOwed.plus(assignment.targetAmount);
      cumulativePaid = cumulativePaid.plus(paid);
      return {
        assignedDate: assignment.assignedDate.toISOString().slice(0, 10),
        owed: assignment.targetAmount.toFixed(2),
        paid: paid.toFixed(2),
        runningPosition: cumulativePaid.minus(cumulativeOwed).toFixed(2),
      };
    });
  }

  async update(id: string, dto: UpdateOwnershipPlanDto, actor: AuthenticatedUser) {
    assertOwner(actor);

    const existing = await this.prisma.client.ownershipPlan.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Ownership plan not found');
    }

    const data: Prisma.OwnershipPlanUpdateInput = {};

    if (dto.guarantorId !== undefined) {
      if (dto.guarantorId !== null) {
        await assertGuarantorBelongsToDriver(this.prisma, dto.guarantorId, existing.driverId);
      }
      data.guarantorId = dto.guarantorId;
    }

    if (dto.dailyAmount !== undefined) data.dailyAmount = dto.dailyAmount;
    if (dto.instalmentCount !== undefined) data.instalmentCount = dto.instalmentCount;
    if (dto.totalPrice !== undefined) data.totalPrice = dto.totalPrice;
    if (dto.downPayment !== undefined) data.downPayment = dto.downPayment;

    // contractEndDate is the date on the signed paper - only an explicit
    // owner edit here moves it. Paying early or falling behind never should.
    if (dto.contractEndDate !== undefined) {
      data.contractEndDate = new Date(dto.contractEndDate);
    }
    if (dto.activeWeekdays !== undefined) {
      assertNoDuplicateWeekdays(dto.activeWeekdays);
      data.activeWeekdays = dto.activeWeekdays;
    }
    if (dto.graceDays !== undefined) data.graceDays = dto.graceDays;
    if (dto.lateFeeAmount !== undefined) data.lateFeeAmount = dto.lateFeeAmount;
    if (dto.breachAfterConsecutiveMissedDays !== undefined) {
      data.breachAfterConsecutiveMissedDays = dto.breachAfterConsecutiveMissedDays;
    }
    if (dto.notes !== undefined) data.notes = dto.notes;

    // Stage G10 - completion checklist. Each is a genuine toggle: true
    // stamps *At to now, false clears it back to null (see the DTO comment).
    if (dto.registrationCardHandedOver !== undefined) {
      data.registrationCardHandedOverAt = dto.registrationCardHandedOver ? new Date() : null;
    }
    if (dto.spareKeyHandedOver !== undefined) {
      data.spareKeyHandedOverAt = dto.spareKeyHandedOver ? new Date() : null;
    }
    if (dto.nameTransferConfirmed !== undefined) {
      data.nameTransferConfirmedAt = dto.nameTransferConfirmed ? new Date() : null;
    }
    if (dto.depositReturned !== undefined) {
      if (existing.depositHandling !== DepositHandling.HELD_REFUNDABLE) {
        throw new BadRequestException(
          'depositReturned can only be set on a HELD_REFUNDABLE plan - an APPLIED deposit was ' +
            'already credited to the schedule, so there is nothing to return',
        );
      }
      data.depositReturnedAt = dto.depositReturned ? new Date() : null;
    }

    if (dto.status !== undefined && dto.status !== existing.status) {
      if (existing.status !== OwnershipPlanStatus.ACTIVE) {
        throw new BadRequestException(
          `Cannot transition an ownership plan from ${existing.status} to ${dto.status}`,
        );
      }
      if (
        dto.status !== OwnershipPlanStatus.COMPLETED &&
        dto.status !== OwnershipPlanStatus.DEFAULTED &&
        dto.status !== OwnershipPlanStatus.CANCELLED
      ) {
        throw new BadRequestException(
          `An ownership plan can only move from ACTIVE to COMPLETED, DEFAULTED, or CANCELLED`,
        );
      }
      data.status = dto.status;
      if (dto.status === OwnershipPlanStatus.COMPLETED) {
        data.completedAt = new Date();
      }
      if (dto.status === OwnershipPlanStatus.DEFAULTED) {
        data.defaultedAt = new Date();
      }
    }

    return this.prisma.client.ownershipPlan.update({ where: { id }, data });
  }

  /**
   * Derived figures for a batch of plans in three queries total, never one
   * per plan: assignment target amounts (grouped in memory by plan),
   * completed-payment sums for exactly those assignments (grouped in memory
   * back to their plan), and Stage G4's APPROVED excusals (grouped by plan,
   * independent of the assignment rows - an excusal can predate the
   * assignment it will eventually apply to). That same excusals query now
   * also feeds recentExcusalCount (Stage G5 Part 3) - derivePlanFigures
   * reads the count out of the same excusedDatesByPlan rows, so recency
   * windowing is a second READ of data already in memory, not a fourth
   * query.
   */
  private async batchDerivedFigures(plans: PlanRow[]): Promise<Map<string, DerivedPlanFigures>> {
    const today = dateOnly();
    const planIds = plans.map((p) => p.id);

    // No date filter here: amountBilled asks what has been committed across
    // the plan's whole life, not what has come due (see
    // ownership-plan.derivation.ts). amountDue is split out from the same
    // rows in memory rather than queried separately.
    const assignments = await this.prisma.client.dailyAssignment.findMany({
      where: { ownershipPlanId: { in: planIds } },
      select: { id: true, ownershipPlanId: true, targetAmount: true, assignedDate: true },
    });

    const amountDueByPlan = new Map<string, Prisma.Decimal>();
    const amountBilledByPlan = new Map<string, Prisma.Decimal>();
    const planIdByAssignment = new Map<string, string>();
    for (const a of assignments) {
      const planId = a.ownershipPlanId as string;
      planIdByAssignment.set(a.id, planId);
      amountBilledByPlan.set(
        planId,
        (amountBilledByPlan.get(planId) ?? new Prisma.Decimal(0)).plus(a.targetAmount),
      );
      if (a.assignedDate.getTime() <= today.getTime()) {
        amountDueByPlan.set(
          planId,
          (amountDueByPlan.get(planId) ?? new Prisma.Decimal(0)).plus(a.targetAmount),
        );
      }
    }

    const amountPaidByPlan = new Map<string, Prisma.Decimal>();
    const paidByAssignment = new Map<string, Prisma.Decimal>();
    const assignmentIds = assignments.map((a) => a.id);
    if (assignmentIds.length > 0) {
      const paid = await this.prisma.client.dailyPayment.groupBy({
        by: ['dailyAssignmentId'],
        where: { dailyAssignmentId: { in: assignmentIds }, status: PaymentStatus.COMPLETED },
        _sum: { amount: true },
      });
      for (const row of paid) {
        const amount = row._sum.amount ?? new Prisma.Decimal(0);
        paidByAssignment.set(row.dailyAssignmentId, amount);
        const planId = planIdByAssignment.get(row.dailyAssignmentId);
        if (!planId) continue;
        amountPaidByPlan.set(
          planId,
          (amountPaidByPlan.get(planId) ?? new Prisma.Decimal(0)).plus(amount),
        );
      }
    }

    // Same rows already fetched above, reshaped per plan for
    // computeConsecutiveMissedDays - no extra query.
    const assignmentPaymentsByPlan = new Map<string, AssignmentPaidRow[]>();
    for (const a of assignments) {
      const planId = a.ownershipPlanId as string;
      const rows = assignmentPaymentsByPlan.get(planId) ?? [];
      rows.push({
        assignedDate: a.assignedDate,
        targetAmount: a.targetAmount,
        paidAmount: paidByAssignment.get(a.id) ?? new Prisma.Decimal(0),
      });
      assignmentPaymentsByPlan.set(planId, rows);
    }

    // Stage G4 - only APPROVED rows count; REQUESTED must never suppress the
    // breach flag and DECLINED/revoked must never have suppressed it either
    // (see computeConsecutiveMissedDays). No date filter: an excusal for a
    // future date is accepted before its assignment row exists and simply
    // has nothing to match yet (see DayExcusal's own comment).
    const excusals = await this.prisma.client.dayExcusal.findMany({
      where: { ownershipPlanId: { in: planIds }, status: DayExcusalStatus.APPROVED },
      select: { ownershipPlanId: true, excusedDate: true },
    });
    const excusedDatesByPlan = new Map<string, Date[]>();
    for (const e of excusals) {
      const dates = excusedDatesByPlan.get(e.ownershipPlanId) ?? [];
      dates.push(e.excusedDate);
      excusedDatesByPlan.set(e.ownershipPlanId, dates);
    }

    const result = new Map<string, DerivedPlanFigures>();
    for (const plan of plans) {
      result.set(
        plan.id,
        derivePlanFigures(
          {
            dailyAmount: plan.dailyAmount,
            instalmentCount: plan.instalmentCount,
            amountDue: amountDueByPlan.get(plan.id) ?? new Prisma.Decimal(0),
            amountPaid: amountPaidByPlan.get(plan.id) ?? new Prisma.Decimal(0),
            amountBilled: amountBilledByPlan.get(plan.id) ?? new Prisma.Decimal(0),
            contractEndDate: plan.contractEndDate,
            startDate: plan.startDate,
            activeWeekdays: plan.activeWeekdays,
            assignmentPayments: assignmentPaymentsByPlan.get(plan.id) ?? [],
            excusedDates: excusedDatesByPlan.get(plan.id) ?? [],
          },
          today,
        ),
      );
    }
    return result;
  }

  private async driversById(driverIds: string[]) {
    if (driverIds.length === 0) return new Map();
    const drivers = await this.prisma.client.driver.findMany({
      where: { id: { in: driverIds } },
      include: { user: { select: { firstName: true, lastName: true } } },
    });
    return new Map(drivers.map((d) => [d.id, d]));
  }

  private async motorcyclesById(motorcycleIds: string[]) {
    if (motorcycleIds.length === 0) return new Map();
    const motorcycles = await this.prisma.client.motorcycle.findMany({
      where: { id: { in: motorcycleIds } },
    });
    return new Map(motorcycles.map((m) => [m.id, m]));
  }

  private async getOwnDriverId(actor: AuthenticatedUser): Promise<string> {
    const driver = await this.prisma.client.driver.findUnique({
      where: { userId: actor.userId },
    });
    if (!driver) {
      throw new ForbiddenException('No driver profile is associated with this account');
    }
    return driver.id;
  }

  /** OWNER/MANAGER may view any plan; a RIDER only their own - shared by
   *  get() and ledger(). Same "not found" as an unknown id for a driver
   *  probing another driver's plan, so the response never confirms the id
   *  is real. */
  private async assertCanView(plan: { driverId: string }, actor: AuthenticatedUser): Promise<void> {
    if (actor.role === UserRole.RIDER) {
      const ownDriverId = await this.getOwnDriverId(actor);
      if (plan.driverId !== ownDriverId) {
        throw new NotFoundException('Ownership plan not found');
      }
      return;
    }
    if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
      throw new ForbiddenException('Not authorized to view this ownership plan');
    }
  }
}
