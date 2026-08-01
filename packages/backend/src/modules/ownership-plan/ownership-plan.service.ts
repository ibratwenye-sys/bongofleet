import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OwnershipPlanStatus, PaymentStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { describeMismatch, isCompatible } from '../../common/driver-vehicle-compatibility';
import { derivePlanFigures, DerivedPlanFigures } from './ownership-plan.derivation';
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

type PlanRow = {
  id: string;
  dailyAmount: Prisma.Decimal;
  totalPrice: Prisma.Decimal;
  downPayment: Prisma.Decimal;
  contractEndDate: Date | null;
  activeWeekdays: number[];
};

@Injectable()
export class OwnershipPlanService {
  constructor(private readonly prisma: PrismaService) {}

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

    const activeWeekdays = dto.activeWeekdays ?? DEFAULT_ACTIVE_WEEKDAYS;
    assertNoDuplicateWeekdays(activeWeekdays);

    const totalPrice = new Prisma.Decimal(dto.totalPrice);
    const downPayment = new Prisma.Decimal(dto.downPayment ?? 0);
    if (totalPrice.lessThanOrEqualTo(downPayment)) {
      throw new BadRequestException('totalPrice must be greater than downPayment');
    }

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

    try {
      return await this.prisma.client.ownershipPlan.create({
        data: {
          tenantId: actor.tenantId,
          driverId: dto.driverId,
          motorcycleId: dto.motorcycleId,
          dailyAmount: dto.dailyAmount,
          totalPrice: dto.totalPrice,
          downPayment: dto.downPayment ?? 0,
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

    if (actor.role === UserRole.RIDER) {
      const ownDriverId = await this.getOwnDriverId(actor);
      if (plan.driverId !== ownDriverId) {
        // Same "not found" as an unknown id, so a driver can't probe others' plans.
        throw new NotFoundException('Ownership plan not found');
      }
    } else if (actor.role !== UserRole.OWNER && actor.role !== UserRole.MANAGER) {
      throw new ForbiddenException('Not authorized to view this ownership plan');
    }

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

  async update(id: string, dto: UpdateOwnershipPlanDto, actor: AuthenticatedUser) {
    assertOwner(actor);

    const existing = await this.prisma.client.ownershipPlan.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Ownership plan not found');
    }

    const data: Prisma.OwnershipPlanUpdateInput = {};

    if (dto.dailyAmount !== undefined) data.dailyAmount = dto.dailyAmount;
    if (dto.totalPrice !== undefined) data.totalPrice = dto.totalPrice;
    if (dto.downPayment !== undefined) data.downPayment = dto.downPayment;

    const resultingTotalPrice = new Prisma.Decimal(dto.totalPrice ?? existing.totalPrice);
    const resultingDownPayment = new Prisma.Decimal(dto.downPayment ?? existing.downPayment);
    if (resultingTotalPrice.lessThanOrEqualTo(resultingDownPayment)) {
      throw new BadRequestException('totalPrice must be greater than downPayment');
    }

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
   * Derived figures for a batch of plans in two queries total, never one per
   * plan: assignment target amounts (grouped in memory by plan), then
   * completed-payment sums for exactly those assignments (grouped in memory
   * back to their plan).
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
    const assignmentIds = assignments.map((a) => a.id);
    if (assignmentIds.length > 0) {
      const paid = await this.prisma.client.dailyPayment.groupBy({
        by: ['dailyAssignmentId'],
        where: { dailyAssignmentId: { in: assignmentIds }, status: PaymentStatus.COMPLETED },
        _sum: { amount: true },
      });
      for (const row of paid) {
        const planId = planIdByAssignment.get(row.dailyAssignmentId);
        if (!planId) continue;
        amountPaidByPlan.set(
          planId,
          (amountPaidByPlan.get(planId) ?? new Prisma.Decimal(0)).plus(row._sum.amount ?? 0),
        );
      }
    }

    const result = new Map<string, DerivedPlanFigures>();
    for (const plan of plans) {
      result.set(
        plan.id,
        derivePlanFigures(
          {
            dailyAmount: plan.dailyAmount,
            totalPrice: plan.totalPrice,
            downPayment: plan.downPayment,
            amountDue: amountDueByPlan.get(plan.id) ?? new Prisma.Decimal(0),
            amountPaid: amountPaidByPlan.get(plan.id) ?? new Prisma.Decimal(0),
            amountBilled: amountBilledByPlan.get(plan.id) ?? new Prisma.Decimal(0),
            contractEndDate: plan.contractEndDate,
            activeWeekdays: plan.activeWeekdays,
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
}
