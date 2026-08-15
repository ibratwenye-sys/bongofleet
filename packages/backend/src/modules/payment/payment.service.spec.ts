import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentStatus, Prisma, UserRole } from '@prisma/client';
import { derivePlanFigures } from '../ownership-plan/ownership-plan.derivation';
import { PaymentService } from './payment.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';

describe('PaymentService', () => {
  let service: PaymentService;
  let prisma: {
    client: {
      dailyAssignment: { findUnique: jest.Mock; findMany: jest.Mock };
      driver: { findUnique: jest.Mock };
      ownershipPlan: { findUnique: jest.Mock };
      dailyPayment: {
        findUnique: jest.Mock;
        findMany: jest.Mock;
        create: jest.Mock;
        update: jest.Mock;
      };
      $transaction: jest.Mock;
    };
  };

  const owner: AuthenticatedUser = {
    userId: 'user-owner',
    tenantId: 'tenant-1',
    role: UserRole.OWNER,
    email: 'owner@example.com',
    firstName: 'O',
    lastName: 'Wner',
    jti: 'jti-owner',
  };

  const driverActor: AuthenticatedUser = {
    userId: 'user-driver',
    tenantId: 'tenant-1',
    role: UserRole.RIDER,
    email: 'driver@example.com',
    firstName: 'D',
    lastName: 'River',
    jti: 'jti-driver',
  };

  const assignment = {
    id: 'assignment-1',
    tenantId: 'tenant-1',
    driverId: 'driver-1',
    motorcycleId: 'moto-1',
    targetAmount: 50000,
    assignedDate: new Date('2026-07-01'),
  };

  const driver = { id: 'driver-1', tenantId: 'tenant-1', userId: 'user-driver' };

  beforeEach(async () => {
    prisma = {
      client: {
        dailyAssignment: { findUnique: jest.fn(), findMany: jest.fn() },
        driver: { findUnique: jest.fn() },
        ownershipPlan: { findUnique: jest.fn() },
        dailyPayment: {
          findUnique: jest.fn(),
          findMany: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
        },
        $transaction: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => './uploads' } },
      ],
    }).compile();

    service = moduleRef.get(PaymentService);
  });

  describe('createPayment', () => {
    const dto = { dailyAssignmentId: 'assignment-1', driverId: 'driver-1', amount: 40000 };

    it('succeeds for a valid owner request', async () => {
      prisma.client.dailyAssignment.findUnique.mockResolvedValue(assignment);
      prisma.client.driver.findUnique.mockResolvedValue(driver);
      prisma.client.dailyPayment.create.mockResolvedValue({ id: 'payment-1', ...dto });

      const result = await service.createPayment(dto, owner);

      expect(prisma.client.dailyPayment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: owner.tenantId,
            status: PaymentStatus.PENDING,
          }),
        }),
      );
      // Purely additive: every field a caller reading only id/amount/status/
      // dailyAssignmentId (patch 0010's mobile flow) relies on is unchanged.
      expect(result).toMatchObject({ id: 'payment-1', ...dto });
      expect(result.allocations).toHaveLength(1);
      expect(result.allocations[0]).toEqual({ id: 'payment-1', ...dto });
      expect(result.totalAllocated.toFixed(2)).toBe(new Prisma.Decimal(dto.amount).toFixed(2));
    });

    it('throws NotFound when the assignment does not exist', async () => {
      prisma.client.dailyAssignment.findUnique.mockResolvedValue(null);

      await expect(service.createPayment(dto, owner)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFound when the driver does not exist', async () => {
      prisma.client.dailyAssignment.findUnique.mockResolvedValue(assignment);
      prisma.client.driver.findUnique.mockResolvedValue(null);

      await expect(service.createPayment(dto, owner)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequest when amount exceeds 150% of the target amount', async () => {
      prisma.client.dailyAssignment.findUnique.mockResolvedValue(assignment);
      prisma.client.driver.findUnique.mockResolvedValue(driver);

      await expect(service.createPayment({ ...dto, amount: 76000 }, owner)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("throws Forbidden when a RIDER records a payment for another driver's assignment", async () => {
      // assignment/dto both reference driver-1, but the calling RIDER's own
      // profile (looked up by userId) is a *different* driver (driver-2).
      const someoneElsesDriver = { id: 'driver-1', tenantId: 'tenant-1', userId: 'user-other' };
      const callersOwnDriver = { id: 'driver-2', tenantId: 'tenant-1', userId: 'user-driver' };

      prisma.client.dailyAssignment.findUnique.mockResolvedValue(assignment);
      prisma.client.driver.findUnique.mockImplementation(
        ({ where }: { where: { id?: string; userId?: string } }) => {
          if (where.id) return someoneElsesDriver;
          if (where.userId) return callersOwnDriver;
          return null;
        },
      );

      await expect(service.createPayment(dto, driverActor)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('createPayment - plan assignment overpayment allocation (§7)', () => {
    const plan = {
      id: 'plan-1',
      dailyAmount: new Prisma.Decimal(12000),
      instalmentCount: 150, // totalOwed = 12,000 x 150 = 1,800,000
      totalPrice: new Prisma.Decimal(1_800_000),
      downPayment: new Prisma.Decimal(0),
    };

    function planAssignment(
      id: string,
      date: string,
      target: number,
      payments: Array<{ amount: number; status: PaymentStatus }> = [],
    ) {
      return {
        id,
        assignedDate: new Date(date),
        targetAmount: new Prisma.Decimal(target),
        dailyPayments: payments.map((p) => ({
          amount: new Prisma.Decimal(p.amount),
          status: p.status,
        })),
      };
    }

    let txDailyPaymentCreate: jest.Mock;

    beforeEach(() => {
      prisma.client.driver.findUnique.mockResolvedValue(driver);
      prisma.client.ownershipPlan.findUnique.mockResolvedValue(plan);
      let counter = 0;
      txDailyPaymentCreate = jest.fn().mockImplementation(({ data }) => {
        counter += 1;
        return { id: `payment-${counter}`, ...data };
      });
      prisma.client.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
        fn({ dailyPayment: { create: txDailyPaymentCreate } }),
      );
    });

    it('a three-days-behind driver paying one lump sum lands every day at exactly zero outstanding', async () => {
      const d1 = planAssignment('a1', '2026-07-01', 12000);
      const d2 = planAssignment('a2', '2026-07-02', 12000);
      const d3 = planAssignment('a3', '2026-07-03', 12000);
      prisma.client.dailyAssignment.findUnique.mockResolvedValue({
        id: 'a3',
        driverId: 'driver-1',
        ownershipPlanId: 'plan-1',
      });
      prisma.client.dailyAssignment.findMany.mockResolvedValue([d1, d2, d3]);

      const result = await service.createPayment(
        { dailyAssignmentId: 'a3', driverId: 'driver-1', amount: 36000 },
        owner,
      );

      expect(txDailyPaymentCreate).toHaveBeenCalledTimes(3);
      expect(result.allocations).toHaveLength(3);
      expect(result.allocations.map((a) => a.dailyAssignmentId)).toEqual(['a1', 'a2', 'a3']); // oldest first
      expect(result.totalAllocated.toFixed(2)).toBe('36000.00'); // no orphaned money
      for (const p of result.allocations) {
        expect(new Prisma.Decimal(p.amount).toFixed(2)).toBe('12000.00'); // none over, none under
      }
    });

    it('when the cascade fully consumes older arrears, the primary is the oldest allocation, not the named assignment', async () => {
      // Two older unpaid days, plus today (a3, the one named in the request).
      // A lump sum exactly covering the two older days leaves a3 with no row
      // at all this time - the primary must not be a3.
      const d1 = planAssignment('a1', '2026-07-01', 12000);
      const d2 = planAssignment('a2', '2026-07-02', 12000);
      const d3 = planAssignment('a3', '2026-07-03', 12000);
      prisma.client.dailyAssignment.findUnique.mockResolvedValue({
        id: 'a3',
        driverId: 'driver-1',
        ownershipPlanId: 'plan-1',
      });
      prisma.client.dailyAssignment.findMany.mockResolvedValue([d1, d2, d3]);

      const result = await service.createPayment(
        { dailyAssignmentId: 'a3', driverId: 'driver-1', amount: 24000 },
        owner,
      );

      expect(result.allocations).toHaveLength(2);
      expect(result.allocations.map((a) => a.dailyAssignmentId)).toEqual(['a1', 'a2']);
      expect(result.dailyAssignmentId).toBe('a1'); // the oldest, not a3
      expect(result.totalAllocated.toFixed(2)).toBe('24000.00');
    });

    it('a driver paying 60,000 against an already-current 12,000 day comes out five days ahead, with no orphaned money', async () => {
      // Already fully paid for today (12,000 completed) - a fresh 60,000
      // top-up is pure surplus, none of it needed to "cover" today again.
      const today = planAssignment('a-today', '2026-07-01', 12000, [
        { amount: 12000, status: PaymentStatus.COMPLETED },
      ]);
      prisma.client.dailyAssignment.findUnique.mockResolvedValue({
        id: 'a-today',
        driverId: 'driver-1',
        ownershipPlanId: 'plan-1',
      });
      prisma.client.dailyAssignment.findMany.mockResolvedValue([today]);

      const result = await service.createPayment(
        { dailyAssignmentId: 'a-today', driverId: 'driver-1', amount: 60000 },
        owner,
      );

      expect(txDailyPaymentCreate).toHaveBeenCalledTimes(1);
      expect(result.totalAllocated.toFixed(2)).toBe('60000.00'); // no orphaned money
      expect(result.allocations).toHaveLength(1);
      expect(new Prisma.Decimal(result.allocations[0].amount).toFixed(2)).toBe('60000.00');

      // Once reconciled to COMPLETED, this is what "five days ahead" means:
      // 72,000 paid (12,000 already + 60,000 new) against a 12,000 amountDue.
      const figures = derivePlanFigures({
        dailyAmount: new Prisma.Decimal(12000),
        instalmentCount: 150, // totalOwed = 12,000 x 150 = 1,800,000
        amountDue: new Prisma.Decimal(12000),
        amountPaid: new Prisma.Decimal(72000),
        amountBilled: new Prisma.Decimal(12000),
        contractEndDate: null,
        activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
        assignmentPayments: [],
        excusedDates: [],
      });
      expect(figures.daysAhead).toBe(5);
    });

    it('an overpayment on a NON-plan assignment is still rejected (ownershipPlanId null)', async () => {
      prisma.client.dailyAssignment.findUnique.mockResolvedValue({
        ...assignment,
        ownershipPlanId: null,
      });

      await expect(
        service.createPayment(
          { dailyAssignmentId: 'assignment-1', driverId: 'driver-1', amount: 76000 },
          owner,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.client.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a payment above the 90-day cap without confirmLargeAmount', async () => {
      prisma.client.ownershipPlan.findUnique.mockResolvedValue({
        ...plan,
        instalmentCount: 500, // totalOwed = 6,000,000 - plenty of headroom
      });
      prisma.client.dailyAssignment.findUnique.mockResolvedValue({
        id: 'a-today',
        driverId: 'driver-1',
        ownershipPlanId: 'plan-1',
      });
      prisma.client.dailyAssignment.findMany.mockResolvedValue([
        planAssignment('a-today', '2026-07-01', 12000),
      ]);

      // 90 * 12,000 = 1,080,000 - one shilling over needs confirmation.
      await expect(
        service.createPayment(
          { dailyAssignmentId: 'a-today', driverId: 'driver-1', amount: 1_080_001 },
          owner,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.client.$transaction).not.toHaveBeenCalled();

      // With confirmation, and enough remainingToOwn headroom, it proceeds.
      const result = await service.createPayment(
        {
          dailyAssignmentId: 'a-today',
          driverId: 'driver-1',
          amount: 1_080_001,
          confirmLargeAmount: true,
        },
        owner,
      );
      expect(result).toBeDefined();
      expect(prisma.client.$transaction).toHaveBeenCalled();
    });

    it('rejects an overpayment that would exceed remainingToOwn, rather than completing the plan with an orphaned excess', async () => {
      prisma.client.ownershipPlan.findUnique.mockResolvedValue({
        ...plan,
        instalmentCount: 1, // totalOwed = 12,000
      });
      prisma.client.dailyAssignment.findUnique.mockResolvedValue({
        id: 'a-today',
        driverId: 'driver-1',
        ownershipPlanId: 'plan-1',
      });
      prisma.client.dailyAssignment.findMany.mockResolvedValue([
        planAssignment('a-today', '2026-07-01', 12000),
      ]);

      // remainingToOwn = 12,000 - 0 = 12,000; 15,000 would overpay the vehicle.
      await expect(
        service.createPayment(
          { dailyAssignmentId: 'a-today', driverId: 'driver-1', amount: 15000 },
          owner,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.client.$transaction).not.toHaveBeenCalled();
    });

    // lateFeeAmount is a printed contract term (Stage F2 Part 3), never an
    // input to the overpayment guard. remainingUnreserved has no
    // lateFeeAmount parameter to begin with, so this pins the actual
    // regression risk: the same plan row (now carrying lateFeeAmount) must
    // still reject at exactly the same remainingToOwn boundary as before
    // that column existed.
    it('rejects the same overpayment at the same boundary whether or not the plan has a lateFeeAmount set', async () => {
      prisma.client.ownershipPlan.findUnique.mockResolvedValue({
        ...plan,
        instalmentCount: 1, // totalOwed = 12,000
        lateFeeAmount: new Prisma.Decimal(2000),
        breachAfterConsecutiveMissedDays: 5,
      });
      prisma.client.dailyAssignment.findUnique.mockResolvedValue({
        id: 'a-today',
        driverId: 'driver-1',
        ownershipPlanId: 'plan-1',
      });
      prisma.client.dailyAssignment.findMany.mockResolvedValue([
        planAssignment('a-today', '2026-07-01', 12000),
      ]);

      await expect(
        service.createPayment(
          { dailyAssignmentId: 'a-today', driverId: 'driver-1', amount: 15000 },
          owner,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.client.$transaction).not.toHaveBeenCalled();
    });

    it('two PENDING payments that individually pass a COMPLETED-only ceiling are jointly rejected by the second one', async () => {
      prisma.client.ownershipPlan.findUnique.mockResolvedValue({
        ...plan,
        instalmentCount: 2, // totalOwed = 24,000
      });
      prisma.client.dailyAssignment.findUnique.mockResolvedValue({
        id: 'a1',
        driverId: 'driver-1',
        ownershipPlanId: 'plan-1',
      });
      // Call 1 sees no existing payments; call 2 sees call 1's own PENDING
      // 15,000 already reserved against the same assignment.
      prisma.client.dailyAssignment.findMany
        .mockResolvedValueOnce([planAssignment('a1', '2026-07-01', 12000, [])])
        .mockResolvedValueOnce([
          planAssignment('a1', '2026-07-01', 12000, [
            { amount: 15000, status: PaymentStatus.PENDING },
          ]),
        ]);

      // remainingToOwn (COMPLETED-only) is 24,000 for BOTH calls, since
      // neither payment ever completes - a COMPLETED-only ceiling would wave
      // both of these 15,000 payments through, jointly overpaying by 6,000.
      const first = await service.createPayment(
        { dailyAssignmentId: 'a1', driverId: 'driver-1', amount: 15000 },
        owner,
      );
      expect(first).toBeDefined();

      await expect(
        service.createPayment(
          { dailyAssignmentId: 'a1', driverId: 'driver-1', amount: 15000 },
          owner,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('listPayments', () => {
    it('returns tenant-scoped results for OWNER, respecting the driverId filter', async () => {
      prisma.client.dailyPayment.findMany.mockResolvedValue([{ id: 'p1' }]);

      await service.listPayments({ driverId: 'driver-9' }, owner);

      expect(prisma.client.dailyPayment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ driverId: 'driver-9' }) }),
      );
    });

    it('force-scopes a RIDER to their own payments regardless of query params', async () => {
      prisma.client.driver.findUnique.mockResolvedValue(driver);
      prisma.client.dailyPayment.findMany.mockResolvedValue([{ id: 'p1' }]);

      await service.listPayments({ driverId: 'someone-elses-driver-id' }, driverActor);

      expect(prisma.client.dailyPayment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ driverId: driver.id }) }),
      );
    });
  });

  describe('updatePaymentStatus', () => {
    const payment = {
      id: 'payment-1',
      status: PaymentStatus.PENDING,
      paymentMethod: null,
      paidAt: null,
    };

    it('sets paidAt when moving to COMPLETED', async () => {
      prisma.client.dailyPayment.findUnique.mockResolvedValue(payment);
      prisma.client.dailyPayment.update.mockResolvedValue({
        ...payment,
        status: PaymentStatus.COMPLETED,
        paidAt: new Date(),
      });

      await service.updatePaymentStatus('payment-1', { status: PaymentStatus.COMPLETED }, owner);

      expect(prisma.client.dailyPayment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: PaymentStatus.COMPLETED,
            paidAt: expect.any(Date),
          }),
        }),
      );
    });

    it('throws Forbidden when called by a RIDER', async () => {
      await expect(
        service.updatePaymentStatus('payment-1', { status: PaymentStatus.COMPLETED }, driverActor),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.client.dailyPayment.findUnique).not.toHaveBeenCalled();
    });
  });
});
