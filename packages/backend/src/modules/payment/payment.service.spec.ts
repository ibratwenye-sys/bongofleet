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
      expect(result).toEqual({ id: 'payment-1', ...dto });
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

      const result = (await service.createPayment(
        { dailyAssignmentId: 'a3', driverId: 'driver-1', amount: 36000 },
        owner,
      )) as Array<{ amount: Prisma.Decimal }>;

      expect(txDailyPaymentCreate).toHaveBeenCalledTimes(3);
      const total = result.reduce(
        (sum: Prisma.Decimal, p: { amount: Prisma.Decimal }) => sum.plus(p.amount),
        new Prisma.Decimal(0),
      );
      expect(total.toFixed(2)).toBe('36000.00'); // no orphaned money
      for (const p of result as Array<{ amount: Prisma.Decimal }>) {
        expect(p.amount.toFixed(2)).toBe('12000.00'); // none over, none under
      }
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
      const total = (result as Array<{ amount: Prisma.Decimal }>).reduce(
        (sum, p) => sum.plus(p.amount),
        new Prisma.Decimal(0),
      );
      expect(total.toFixed(2)).toBe('60000.00'); // no orphaned money
      expect((result as Array<{ amount: Prisma.Decimal }>)[0].amount.toFixed(2)).toBe('60000.00');

      // Once reconciled to COMPLETED, this is what "five days ahead" means:
      // 72,000 paid (12,000 already + 60,000 new) against a 12,000 amountDue.
      const figures = derivePlanFigures({
        dailyAmount: new Prisma.Decimal(12000),
        totalPrice: new Prisma.Decimal(1_800_000),
        downPayment: new Prisma.Decimal(0),
        amountDue: new Prisma.Decimal(12000),
        amountPaid: new Prisma.Decimal(72000),
        amountBilled: new Prisma.Decimal(12000),
        contractEndDate: null,
        activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
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
        totalPrice: new Prisma.Decimal(5_000_000),
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
        totalPrice: new Prisma.Decimal(10000),
      });
      prisma.client.dailyAssignment.findUnique.mockResolvedValue({
        id: 'a-today',
        driverId: 'driver-1',
        ownershipPlanId: 'plan-1',
      });
      prisma.client.dailyAssignment.findMany.mockResolvedValue([
        planAssignment('a-today', '2026-07-01', 12000),
      ]);

      // remainingToOwn = 10,000 - 0 = 10,000; 15,000 would overpay the vehicle.
      await expect(
        service.createPayment(
          { dailyAssignmentId: 'a-today', driverId: 'driver-1', amount: 15000 },
          owner,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.client.$transaction).not.toHaveBeenCalled();
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
