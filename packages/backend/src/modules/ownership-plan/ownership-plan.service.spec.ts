import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  DayExcusalStatus,
  DriverType,
  OwnershipPlanStatus,
  PaymentStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { OwnershipPlanService } from './ownership-plan.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';

describe('OwnershipPlanService', () => {
  let service: OwnershipPlanService;
  let prisma: {
    client: {
      driver: { findUnique: jest.Mock; findMany: jest.Mock };
      motorcycle: { findUnique: jest.Mock; findMany: jest.Mock };
      guarantor: { findUnique: jest.Mock };
      ownershipPlan: {
        findFirst: jest.Mock;
        findMany: jest.Mock;
        findUnique: jest.Mock;
        create: jest.Mock;
        update: jest.Mock;
      };
      dailyAssignment: { findMany: jest.Mock };
      dailyPayment: { groupBy: jest.Mock };
      dayExcusal: { findMany: jest.Mock };
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

  const manager: AuthenticatedUser = {
    ...owner,
    role: UserRole.MANAGER,
    userId: 'user-manager',
    email: 'manager@example.com',
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

  const driver = {
    id: 'driver-1',
    tenantId: 'tenant-1',
    userId: 'user-driver',
    isActive: true,
    driverType: DriverType.RIDER,
    user: { firstName: 'Juma', lastName: 'Hassan' },
  };

  const motorcycle = {
    id: 'veh-1',
    tenantId: 'tenant-1',
    isActive: true,
    vehicleType: 'MOTORBIKE',
    registrationNumber: 'T123 ABC',
  };

  const dto = {
    driverId: 'driver-1',
    motorcycleId: 'veh-1',
    dailyAmount: 12000,
    instalmentCount: 150, // totalOwed = 12,000 x 150 = 1,800,000
    totalPrice: 1_800_000,
    startDate: '2026-03-03',
  };

  beforeEach(async () => {
    prisma = {
      client: {
        driver: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
        motorcycle: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
        guarantor: { findUnique: jest.fn() },
        ownershipPlan: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn(),
          findUnique: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
        },
        dailyAssignment: { findMany: jest.fn().mockResolvedValue([]) },
        dailyPayment: { groupBy: jest.fn().mockResolvedValue([]) },
        dayExcusal: { findMany: jest.fn().mockResolvedValue([]) },
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [OwnershipPlanService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(OwnershipPlanService);
  });

  describe('create', () => {
    beforeEach(() => {
      prisma.client.driver.findUnique.mockResolvedValue(driver);
      prisma.client.motorcycle.findUnique.mockResolvedValue(motorcycle);
    });

    it('succeeds for a valid OWNER request', async () => {
      prisma.client.ownershipPlan.create.mockResolvedValue({ id: 'plan-1', ...dto });

      const result = await service.create(dto, owner);

      expect(result).toEqual({ id: 'plan-1', ...dto });
      expect(prisma.client.ownershipPlan.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tenantId: owner.tenantId, driverId: 'driver-1' }),
        }),
      );
    });

    it('throws Forbidden for a MANAGER', async () => {
      await expect(service.create(dto, manager)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.client.driver.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFound when the driver does not exist', async () => {
      prisma.client.driver.findUnique.mockResolvedValue(null);
      await expect(service.create(dto, owner)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFound when the vehicle does not exist', async () => {
      prisma.client.motorcycle.findUnique.mockResolvedValue(null);
      await expect(service.create(dto, owner)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequest when the driver category does not cover the vehicle', async () => {
      prisma.client.motorcycle.findUnique.mockResolvedValue({
        ...motorcycle,
        vehicleType: 'TRUCK',
      });

      await expect(service.create(dto, owner)).rejects.toThrow(
        'Juma Hassan is a rider and cannot be assigned T123 ABC, which is a truck.',
      );
    });

    it('throws Conflict when the driver already has an active plan', async () => {
      prisma.client.ownershipPlan.findFirst.mockResolvedValueOnce({ id: 'existing-plan' });

      await expect(service.create(dto, owner)).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws Conflict when the vehicle already has an active plan', async () => {
      prisma.client.ownershipPlan.findFirst
        .mockResolvedValueOnce(null) // driver check passes
        .mockResolvedValueOnce({ id: 'existing-plan' }); // vehicle check fails

      await expect(service.create(dto, owner)).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws Conflict when the partial unique index catches a race the findFirst check missed', async () => {
      prisma.client.ownershipPlan.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: '7.9.0',
        }),
      );

      await expect(service.create(dto, owner)).rejects.toBeInstanceOf(ConflictException);
    });

    // Stage G7: totalPrice/downPayment no longer feed totalOwed - the old
    // "totalPrice must exceed downPayment" cross-field check existed only to
    // keep that arithmetic sane, and has been removed along with it.
    // totalPrice/downPayment are now printed-only figures, independent of
    // instalmentCount/dailyAmount, and may legitimately relate to each other
    // however the owner declares.

    it('throws BadRequest when activeWeekdays has duplicates', async () => {
      await expect(
        service.create({ ...dto, activeWeekdays: [1, 2, 2, 3] }, owner),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('leaves activeWeekdays out of the create() call when omitted, letting the DB default (all seven days) apply', async () => {
      prisma.client.ownershipPlan.create.mockResolvedValue({ id: 'plan-1' });

      await service.create(dto, owner);

      const { data } = prisma.client.ownershipPlan.create.mock.calls[0][0];
      expect(data.activeWeekdays).toBeUndefined();
    });

    describe('guarantorId (Stage G Part 3)', () => {
      it('accepts a guarantor belonging to the same driver and passes it through to create()', async () => {
        prisma.client.guarantor.findUnique.mockResolvedValue({
          id: 'guarantor-1',
          driverId: 'driver-1',
        });
        prisma.client.ownershipPlan.create.mockResolvedValue({ id: 'plan-1' });

        await service.create({ ...dto, guarantorId: 'guarantor-1' }, owner);

        const { data } = prisma.client.ownershipPlan.create.mock.calls[0][0];
        expect(data.guarantorId).toBe('guarantor-1');
      });

      it('throws NotFound (never Forbidden) for a guarantor belonging to a different driver', async () => {
        prisma.client.guarantor.findUnique.mockResolvedValue({
          id: 'guarantor-1',
          driverId: 'some-other-driver',
        });

        await expect(
          service.create({ ...dto, guarantorId: 'guarantor-1' }, owner),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(prisma.client.ownershipPlan.create).not.toHaveBeenCalled();
      });

      it('throws NotFound (never Forbidden) for a guarantor from another tenant', async () => {
        // The tenant-scoping Prisma extension merges actor.tenantId into
        // every query in production - a cross-tenant guarantorId simply
        // never matches a row, so findUnique resolving null is exactly
        // what that looks like here.
        prisma.client.guarantor.findUnique.mockResolvedValue(null);

        await expect(
          service.create({ ...dto, guarantorId: 'guarantor-from-another-tenant' }, owner),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(prisma.client.ownershipPlan.create).not.toHaveBeenCalled();
      });

      it('never queries guarantor when guarantorId is omitted', async () => {
        prisma.client.ownershipPlan.create.mockResolvedValue({ id: 'plan-1' });

        await service.create(dto, owner);

        expect(prisma.client.guarantor.findUnique).not.toHaveBeenCalled();
      });
    });
  });

  describe('list', () => {
    it('forbids a RIDER', async () => {
      await expect(service.list(driverActor)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('computes figures for many plans with exactly one assignment query and one payment query', async () => {
      const plans = [
        {
          id: 'plan-1',
          driverId: 'driver-1',
          motorcycleId: 'veh-1',
          dailyAmount: new Prisma.Decimal(12000),
          instalmentCount: 150, // totalOwed = 12,000 x 150 = 1,800,000
          totalPrice: new Prisma.Decimal(1_800_000),
          downPayment: new Prisma.Decimal(0),
          startDate: new Date('2026-06-01T00:00:00.000Z'),
          contractEndDate: null,
          activeWeekdays: [1, 2, 3, 4, 5, 6],
          status: OwnershipPlanStatus.ACTIVE,
        },
        {
          id: 'plan-2',
          driverId: 'driver-2',
          motorcycleId: 'veh-2',
          dailyAmount: new Prisma.Decimal(15000),
          instalmentCount: 134, // totalOwed = 15,000 x 134 = 2,010,000
          totalPrice: new Prisma.Decimal(2_000_000),
          downPayment: new Prisma.Decimal(0),
          startDate: new Date('2026-06-01T00:00:00.000Z'),
          contractEndDate: null,
          activeWeekdays: [1, 2, 3, 4, 5, 6],
          status: OwnershipPlanStatus.ACTIVE,
        },
      ];
      prisma.client.ownershipPlan.findMany.mockResolvedValue(plans);
      prisma.client.dailyAssignment.findMany.mockResolvedValue([
        {
          id: 'a1',
          ownershipPlanId: 'plan-1',
          targetAmount: new Prisma.Decimal(24000),
          assignedDate: new Date('2026-07-01'),
        },
        {
          id: 'a2',
          ownershipPlanId: 'plan-2',
          targetAmount: new Prisma.Decimal(30000),
          assignedDate: new Date('2026-07-01'),
        },
      ]);
      prisma.client.dailyPayment.groupBy.mockResolvedValue([
        { dailyAssignmentId: 'a1', _sum: { amount: new Prisma.Decimal(12000) } },
      ]);

      const result = await service.list(owner);

      expect(prisma.client.dailyAssignment.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.client.dailyPayment.groupBy).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(2);
      expect(result.find((p) => p.id === 'plan-1')?.amountDue).toBe('24000.00');
      expect(result.find((p) => p.id === 'plan-1')?.amountPaid).toBe('12000.00');
      expect(result.find((p) => p.id === 'plan-2')?.amountPaid).toBe('0.00');
    });

    it('sorts by days behind, worst first', async () => {
      prisma.client.ownershipPlan.findMany.mockResolvedValue([
        {
          id: 'plan-a-lot-behind',
          driverId: 'd1',
          motorcycleId: 'v1',
          dailyAmount: new Prisma.Decimal(12000),
          instalmentCount: 42, // totalOwed = 12,000 x 42 = 504,000
          totalPrice: new Prisma.Decimal(500000),
          downPayment: new Prisma.Decimal(0),
          startDate: new Date('2026-06-01T00:00:00.000Z'),
          contractEndDate: null,
          activeWeekdays: [1, 2, 3, 4, 5, 6],
          status: OwnershipPlanStatus.ACTIVE,
        },
        {
          id: 'plan-current',
          driverId: 'd2',
          motorcycleId: 'v2',
          dailyAmount: new Prisma.Decimal(12000),
          instalmentCount: 42, // totalOwed = 12,000 x 42 = 504,000
          totalPrice: new Prisma.Decimal(500000),
          downPayment: new Prisma.Decimal(0),
          startDate: new Date('2026-06-01T00:00:00.000Z'),
          contractEndDate: null,
          activeWeekdays: [1, 2, 3, 4, 5, 6],
          status: OwnershipPlanStatus.ACTIVE,
        },
      ]);
      prisma.client.dailyAssignment.findMany.mockResolvedValue([
        {
          id: 'a1',
          ownershipPlanId: 'plan-a-lot-behind',
          targetAmount: new Prisma.Decimal(60000),
          assignedDate: new Date('2026-07-01'),
        },
        {
          id: 'a2',
          ownershipPlanId: 'plan-current',
          targetAmount: new Prisma.Decimal(12000),
          assignedDate: new Date('2026-07-01'),
        },
      ]);
      prisma.client.dailyPayment.groupBy.mockResolvedValue([
        { dailyAssignmentId: 'a2', _sum: { amount: new Prisma.Decimal(12000) } },
      ]);

      const result = await service.list(owner);

      expect(result[0].id).toBe('plan-a-lot-behind');
      expect(result[1].id).toBe('plan-current');
    });

    it('Stage G2 Part 1: threads per-assignment payment rows through to consecutiveMissedDays, independent of daysBehind', async () => {
      // plan-1: two assigned days in the past, the most recent one unpaid -
      // a one-day-behind AND a one-day-missed-streak, same number here.
      // plan-2: three assigned days, the earliest paid then the latest two
      // unpaid - daysBehind (2) and consecutiveMissedDays (2) still agree
      // here; the derivation-level tests already cover the case where they
      // diverge. This test is only proving the service wires the rows
      // through at all, not re-proving the arithmetic.
      prisma.client.ownershipPlan.findMany.mockResolvedValue([
        {
          id: 'plan-1',
          driverId: 'driver-1',
          motorcycleId: 'veh-1',
          dailyAmount: new Prisma.Decimal(12000),
          instalmentCount: 150, // totalOwed = 12,000 x 150 = 1,800,000
          totalPrice: new Prisma.Decimal(1_800_000),
          downPayment: new Prisma.Decimal(0),
          startDate: new Date('2026-06-01T00:00:00.000Z'),
          contractEndDate: null,
          activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
          status: OwnershipPlanStatus.ACTIVE,
        },
        {
          id: 'plan-2',
          driverId: 'driver-2',
          motorcycleId: 'veh-2',
          dailyAmount: new Prisma.Decimal(12000),
          instalmentCount: 150, // totalOwed = 12,000 x 150 = 1,800,000
          totalPrice: new Prisma.Decimal(1_800_000),
          downPayment: new Prisma.Decimal(0),
          startDate: new Date('2026-06-01T00:00:00.000Z'),
          contractEndDate: null,
          activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
          status: OwnershipPlanStatus.ACTIVE,
        },
      ]);
      prisma.client.dailyAssignment.findMany.mockResolvedValue([
        {
          id: 'p1-a1',
          ownershipPlanId: 'plan-1',
          targetAmount: new Prisma.Decimal(12000),
          assignedDate: new Date('2026-07-01'),
        },
        {
          id: 'p1-a2',
          ownershipPlanId: 'plan-1',
          targetAmount: new Prisma.Decimal(12000),
          assignedDate: new Date('2026-07-02'),
        },
        {
          id: 'p2-a1',
          ownershipPlanId: 'plan-2',
          targetAmount: new Prisma.Decimal(12000),
          assignedDate: new Date('2026-07-01'),
        },
        {
          id: 'p2-a2',
          ownershipPlanId: 'plan-2',
          targetAmount: new Prisma.Decimal(12000),
          assignedDate: new Date('2026-07-02'),
        },
        {
          id: 'p2-a3',
          ownershipPlanId: 'plan-2',
          targetAmount: new Prisma.Decimal(12000),
          assignedDate: new Date('2026-07-03'),
        },
      ]);
      prisma.client.dailyPayment.groupBy.mockResolvedValue([
        { dailyAssignmentId: 'p1-a1', _sum: { amount: new Prisma.Decimal(12000) } },
        { dailyAssignmentId: 'p2-a1', _sum: { amount: new Prisma.Decimal(12000) } },
      ]);

      const result = await service.list(owner);

      expect(result.find((p) => p.id === 'plan-1')?.consecutiveMissedDays).toBe(1);
      expect(result.find((p) => p.id === 'plan-2')?.consecutiveMissedDays).toBe(2);
    });

    it('Stage G4: threads APPROVED excusals through to consecutiveMissedDays, per plan, without touching any money figure', async () => {
      prisma.client.ownershipPlan.findMany.mockResolvedValue([
        {
          id: 'plan-1',
          driverId: 'driver-1',
          motorcycleId: 'veh-1',
          dailyAmount: new Prisma.Decimal(12000),
          instalmentCount: 150, // totalOwed = 12,000 x 150 = 1,800,000
          totalPrice: new Prisma.Decimal(1_800_000),
          downPayment: new Prisma.Decimal(0),
          startDate: new Date('2026-06-01T00:00:00.000Z'),
          contractEndDate: null,
          activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
          status: OwnershipPlanStatus.ACTIVE,
        },
      ]);
      // Two unpaid, elapsed assigned days - an unexcused streak of 2.
      prisma.client.dailyAssignment.findMany.mockResolvedValue([
        {
          id: 'a1',
          ownershipPlanId: 'plan-1',
          targetAmount: new Prisma.Decimal(12000),
          assignedDate: new Date('2026-07-01'),
        },
        {
          id: 'a2',
          ownershipPlanId: 'plan-1',
          targetAmount: new Prisma.Decimal(12000),
          assignedDate: new Date('2026-07-02'),
        },
      ]);
      prisma.client.dailyPayment.groupBy.mockResolvedValue([]);
      // 2026-07-01 has an APPROVED excusal - transparent, so only 2026-07-02
      // should count.
      prisma.client.dayExcusal.findMany.mockResolvedValue([
        { ownershipPlanId: 'plan-1', excusedDate: new Date('2026-07-01') },
      ]);

      const [before] = await service.list(owner);
      expect(before.consecutiveMissedDays).toBe(1);

      // Same money figures regardless of the excusal - it never touches them.
      expect(before.amountDue).toBe('24000.00');
      expect(before.amountPaid).toBe('0.00');
      expect(before.amountBilled).toBe('24000.00');
      expect(before.remainingToOwn).toBe('1800000.00');
      expect(before.remainingToBill).toBe('1776000.00');

      // Confirm it's the excusal doing the work: without it, both days count.
      prisma.client.dayExcusal.findMany.mockResolvedValue([]);
      const [withoutExcusal] = await service.list(owner);
      expect(withoutExcusal.consecutiveMissedDays).toBe(2);
      expect(withoutExcusal.amountDue).toBe(before.amountDue);
      expect(withoutExcusal.amountPaid).toBe(before.amountPaid);
      expect(withoutExcusal.amountBilled).toBe(before.amountBilled);
      expect(withoutExcusal.remainingToOwn).toBe(before.remainingToOwn);
      expect(withoutExcusal.remainingToBill).toBe(before.remainingToBill);
    });

    it('Stage G5 Part 3/4: recentExcusalCount is correct per plan, counts only APPROVED rows inside the window, and costs exactly one dayExcusal query for the whole fleet', async () => {
      const today = new Date();
      const daysAgo = (n: number) => {
        const d = new Date(today);
        d.setUTCDate(d.getUTCDate() - n);
        return d;
      };

      prisma.client.ownershipPlan.findMany.mockResolvedValue([
        {
          id: 'plan-1',
          driverId: 'driver-1',
          motorcycleId: 'veh-1',
          dailyAmount: new Prisma.Decimal(12000),
          instalmentCount: 150, // totalOwed = 12,000 x 150 = 1,800,000
          totalPrice: new Prisma.Decimal(1_800_000),
          downPayment: new Prisma.Decimal(0),
          startDate: new Date('2026-06-01T00:00:00.000Z'),
          contractEndDate: null,
          activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
          status: OwnershipPlanStatus.ACTIVE,
        },
        {
          id: 'plan-2',
          driverId: 'driver-2',
          motorcycleId: 'veh-2',
          dailyAmount: new Prisma.Decimal(12000),
          instalmentCount: 150, // totalOwed = 12,000 x 150 = 1,800,000
          totalPrice: new Prisma.Decimal(1_800_000),
          downPayment: new Prisma.Decimal(0),
          startDate: new Date('2026-06-01T00:00:00.000Z'),
          contractEndDate: null,
          activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
          status: OwnershipPlanStatus.ACTIVE,
        },
        {
          id: 'plan-3',
          driverId: 'driver-3',
          motorcycleId: 'veh-3',
          dailyAmount: new Prisma.Decimal(12000),
          instalmentCount: 150, // totalOwed = 12,000 x 150 = 1,800,000
          totalPrice: new Prisma.Decimal(1_800_000),
          downPayment: new Prisma.Decimal(0),
          startDate: new Date('2026-06-01T00:00:00.000Z'),
          contractEndDate: null,
          activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
          status: OwnershipPlanStatus.ACTIVE,
        },
      ]);
      prisma.client.dailyAssignment.findMany.mockResolvedValue([]);
      prisma.client.dailyPayment.groupBy.mockResolvedValue([]);
      // plan-1: two recent APPROVED excusals -> 2. plan-2: one recent, one
      // stale (>90 days) APPROVED excusal -> 1. plan-3: no excusals -> 0.
      // The APPROVED-only filter is the query's own `where`, asserted below
      // (findMany is mocked, so a REQUESTED/DECLINED row here would still
      // wrongly count if the service ever stopped filtering by status).
      prisma.client.dayExcusal.findMany.mockResolvedValue([
        { ownershipPlanId: 'plan-1', excusedDate: daysAgo(5) },
        { ownershipPlanId: 'plan-1', excusedDate: daysAgo(80) },
        { ownershipPlanId: 'plan-2', excusedDate: daysAgo(10) },
        { ownershipPlanId: 'plan-2', excusedDate: daysAgo(120) },
      ]);

      const result = await service.list(owner);

      expect(result.find((p) => p.id === 'plan-1')?.recentExcusalCount).toBe(2);
      expect(result.find((p) => p.id === 'plan-2')?.recentExcusalCount).toBe(1);
      expect(result.find((p) => p.id === 'plan-3')?.recentExcusalCount).toBe(0);

      // The no-N+1 proof: one query for all three plans, not three.
      expect(prisma.client.dayExcusal.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.client.dayExcusal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: DayExcusalStatus.APPROVED }),
        }),
      );
    });
  });

  describe('get', () => {
    const plan = {
      id: 'plan-1',
      tenantId: 'tenant-1',
      driverId: 'driver-1',
      motorcycleId: 'veh-1',
      dailyAmount: new Prisma.Decimal(12000),
      instalmentCount: 150, // totalOwed = 12,000 x 150 = 1,800,000
      totalPrice: new Prisma.Decimal(1_800_000),
      downPayment: new Prisma.Decimal(0),
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      contractEndDate: new Date('2027-02-12T00:00:00.000Z'),
      activeWeekdays: [1, 2, 3, 4, 5, 6],
      status: OwnershipPlanStatus.ACTIVE,
    };

    beforeEach(() => {
      prisma.client.ownershipPlan.findUnique.mockResolvedValue(plan);
      prisma.client.driver.findUnique.mockResolvedValue(driver);
      prisma.client.motorcycle.findUnique.mockResolvedValue(motorcycle);
    });

    it('throws NotFound for an unknown plan', async () => {
      prisma.client.ownershipPlan.findUnique.mockResolvedValue(null);
      await expect(service.get('nope', owner)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets an OWNER view any plan', async () => {
      const result = await service.get('plan-1', owner);
      expect(result.id).toBe('plan-1');
    });

    it('lets the DRIVER on the plan view it', async () => {
      prisma.client.driver.findUnique.mockImplementation(
        ({ where }: { where: { userId?: string; id?: string } }) => {
          if (where.userId) return Promise.resolve({ id: 'driver-1', userId: 'user-driver' });
          return Promise.resolve(driver);
        },
      );

      const result = await service.get('plan-1', driverActor);
      expect(result.id).toBe('plan-1');
    });

    it("does not let a different driver view someone else's plan", async () => {
      prisma.client.driver.findUnique.mockImplementation(
        ({ where }: { where: { userId?: string; id?: string } }) => {
          if (where.userId) return Promise.resolve({ id: 'driver-2', userId: 'user-driver' });
          return Promise.resolve(driver);
        },
      );

      await expect(service.get('plan-1', driverActor)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('excludes a FAILED/PENDING payment from amountPaid by filtering the query to COMPLETED', async () => {
      prisma.client.dailyAssignment.findMany.mockResolvedValue([
        {
          id: 'a1',
          ownershipPlanId: 'plan-1',
          targetAmount: new Prisma.Decimal(12000),
          assignedDate: new Date('2026-07-01'),
        },
      ]);
      prisma.client.dailyPayment.groupBy.mockResolvedValue([]);

      const result = await service.get('plan-1', owner);

      expect(result.amountPaid).toBe('0.00');
      expect(prisma.client.dailyPayment.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: PaymentStatus.COMPLETED }),
        }),
      );
    });

    it('leaves contractEndDate unchanged across calls even as amountPaid changes', async () => {
      prisma.client.dailyAssignment.findMany.mockResolvedValue([
        {
          id: 'a1',
          ownershipPlanId: 'plan-1',
          targetAmount: new Prisma.Decimal(12000),
          assignedDate: new Date('2026-07-01'),
        },
      ]);
      prisma.client.dailyPayment.groupBy.mockResolvedValueOnce([]);

      const before = await service.get('plan-1', owner);
      expect(before.amountPaid).toBe('0.00');
      expect(before.contractEndDate).toEqual(plan.contractEndDate);

      // A payment is recorded between the two reads.
      prisma.client.dailyPayment.groupBy.mockResolvedValueOnce([
        { dailyAssignmentId: 'a1', _sum: { amount: new Prisma.Decimal(12000) } },
      ]);
      const after = await service.get('plan-1', owner);

      expect(after.amountPaid).toBe('12000.00');
      expect(after.contractEndDate).toEqual(before.contractEndDate);
    });

    // lateFeeAmount is a printed contract term (Stage F2 Part 3), never an
    // input to figure derivation. This guards the actual regression risk:
    // batchDerivedFigures spreads the whole raw plan row (including
    // lateFeeAmount) into its computation - a future "helpful" edit that
    // starts reading plan.lateFeeAmount there would change every figure
    // below without this test noticing anything except the diff itself.
    it('produces byte-identical derived figures whether or not the plan has a lateFeeAmount set', async () => {
      prisma.client.dailyAssignment.findMany.mockResolvedValue([
        {
          id: 'a1',
          ownershipPlanId: 'plan-1',
          targetAmount: new Prisma.Decimal(12000),
          assignedDate: new Date('2026-07-01'),
        },
      ]);
      prisma.client.dailyPayment.groupBy.mockResolvedValue([
        { dailyAssignmentId: 'a1', _sum: { amount: new Prisma.Decimal(12000) } },
      ]);

      prisma.client.ownershipPlan.findUnique.mockResolvedValueOnce({
        ...plan,
        lateFeeAmount: new Prisma.Decimal(2000),
        breachAfterConsecutiveMissedDays: 5,
      });
      const withFine = await service.get('plan-1', owner);

      prisma.client.ownershipPlan.findUnique.mockResolvedValueOnce({
        ...plan,
        lateFeeAmount: null,
        breachAfterConsecutiveMissedDays: 5,
      });
      const withoutFine = await service.get('plan-1', owner);

      const omitLateFeeAmount = (value: Record<string, unknown>): Record<string, unknown> =>
        Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'lateFeeAmount'));
      const restWithFine = omitLateFeeAmount(withFine as Record<string, unknown>);
      const restWithoutFine = omitLateFeeAmount(withoutFine as Record<string, unknown>);
      expect(restWithFine).toEqual(restWithoutFine);
      expect(restWithFine.amountBilled).toBe(restWithoutFine.amountBilled);
      expect(restWithFine.amountPaid).toBe(restWithoutFine.amountPaid);
      expect(restWithFine.remainingToOwn).toBe(restWithoutFine.remainingToOwn);
      expect(restWithFine.remainingToBill).toBe(restWithoutFine.remainingToBill);
    });
  });

  describe('ledger (Stage G Part 3b)', () => {
    const plan = {
      id: 'plan-1',
      tenantId: 'tenant-1',
      driverId: 'driver-1',
      motorcycleId: 'veh-1',
    };

    beforeEach(() => {
      prisma.client.ownershipPlan.findUnique.mockResolvedValue(plan);
    });

    it('throws NotFound for an unknown plan', async () => {
      prisma.client.ownershipPlan.findUnique.mockResolvedValue(null);
      await expect(service.ledger('nope', owner)).rejects.toBeInstanceOf(NotFoundException);
    });

    it("does not let a different driver view someone else's plan", async () => {
      prisma.client.driver.findUnique.mockResolvedValue({ id: 'driver-2', userId: 'user-driver' });
      await expect(service.ledger('plan-1', driverActor)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns owed/paid/running position per day, in date order, with a correct running total', async () => {
      prisma.client.dailyAssignment.findMany.mockResolvedValue([
        {
          id: 'a1',
          assignedDate: new Date('2026-08-03'),
          targetAmount: new Prisma.Decimal(12000),
        },
        {
          id: 'a2',
          assignedDate: new Date('2026-08-04'),
          targetAmount: new Prisma.Decimal(12000),
        },
        {
          id: 'a3',
          assignedDate: new Date('2026-08-05'),
          targetAmount: new Prisma.Decimal(12000),
        },
      ]);
      prisma.client.dailyPayment.groupBy.mockResolvedValue([
        { dailyAssignmentId: 'a1', _sum: { amount: new Prisma.Decimal(12000) } },
        // a2 short-paid, a3 not paid at all - the driver falls behind starting a2.
        { dailyAssignmentId: 'a2', _sum: { amount: new Prisma.Decimal(5000) } },
      ]);

      const rows = await service.ledger('plan-1', owner);

      expect(rows).toEqual([
        { assignedDate: '2026-08-03', owed: '12000.00', paid: '12000.00', runningPosition: '0.00' },
        {
          assignedDate: '2026-08-04',
          owed: '12000.00',
          paid: '5000.00',
          runningPosition: '-7000.00',
        },
        {
          assignedDate: '2026-08-05',
          owed: '12000.00',
          paid: '0.00',
          runningPosition: '-19000.00',
        },
      ]);
    });

    it('returns an empty ledger, not an error, for a plan with no assignments yet', async () => {
      prisma.client.dailyAssignment.findMany.mockResolvedValue([]);

      const rows = await service.ledger('plan-1', owner);

      expect(rows).toEqual([]);
      expect(prisma.client.dailyPayment.groupBy).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    const activePlan = {
      id: 'plan-1',
      driverId: 'driver-1',
      status: OwnershipPlanStatus.ACTIVE,
      totalPrice: new Prisma.Decimal(1_800_000),
      downPayment: new Prisma.Decimal(0),
    };

    beforeEach(() => {
      prisma.client.ownershipPlan.findUnique.mockResolvedValue(activePlan);
      prisma.client.ownershipPlan.update.mockImplementation(({ data }) => ({
        ...activePlan,
        ...data,
      }));
    });

    it('forbids a MANAGER', async () => {
      await expect(
        service.update('plan-1', { status: OwnershipPlanStatus.COMPLETED }, manager),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('stamps completedAt on ACTIVE -> COMPLETED', async () => {
      const result = await service.update(
        'plan-1',
        { status: OwnershipPlanStatus.COMPLETED },
        owner,
      );
      expect(result.status).toBe(OwnershipPlanStatus.COMPLETED);
      expect(result.completedAt).toBeInstanceOf(Date);
    });

    it('stamps defaultedAt on ACTIVE -> DEFAULTED', async () => {
      const result = await service.update(
        'plan-1',
        { status: OwnershipPlanStatus.DEFAULTED },
        owner,
      );
      expect(result.status).toBe(OwnershipPlanStatus.DEFAULTED);
      expect(result.defaultedAt).toBeInstanceOf(Date);
    });

    it('allows ACTIVE -> CANCELLED', async () => {
      const result = await service.update(
        'plan-1',
        { status: OwnershipPlanStatus.CANCELLED },
        owner,
      );
      expect(result.status).toBe(OwnershipPlanStatus.CANCELLED);
    });

    it('rejects transitioning out of COMPLETED', async () => {
      prisma.client.ownershipPlan.findUnique.mockResolvedValue({
        ...activePlan,
        status: OwnershipPlanStatus.COMPLETED,
      });

      await expect(
        service.update('plan-1', { status: OwnershipPlanStatus.ACTIVE }, owner),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects duplicate activeWeekdays', async () => {
      await expect(
        service.update('plan-1', { activeWeekdays: [1, 1, 2] }, owner),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('does not touch contractEndDate unless explicitly given', async () => {
      const result = await service.update('plan-1', { notes: 'just a note' }, owner);
      expect(result).not.toHaveProperty('contractEndDate');
    });

    describe('guarantorId (Stage G Part 3)', () => {
      it('accepts a guarantor belonging to the plan driver and updates it', async () => {
        prisma.client.guarantor.findUnique.mockResolvedValue({
          id: 'guarantor-1',
          driverId: 'driver-1',
        });

        const result = await service.update('plan-1', { guarantorId: 'guarantor-1' }, owner);

        expect(result.guarantorId).toBe('guarantor-1');
      });

      it('clears guarantorId when explicitly passed null, without a guarantor lookup', async () => {
        const result = await service.update('plan-1', { guarantorId: null }, owner);

        expect(result.guarantorId).toBeNull();
        expect(prisma.client.guarantor.findUnique).not.toHaveBeenCalled();
      });

      it('leaves guarantorId untouched when omitted from the payload', async () => {
        const result = await service.update('plan-1', { notes: 'x' }, owner);

        expect(result).not.toHaveProperty('guarantorId');
        expect(prisma.client.guarantor.findUnique).not.toHaveBeenCalled();
      });

      it('throws NotFound (never Forbidden) for a guarantor belonging to a different driver', async () => {
        prisma.client.guarantor.findUnique.mockResolvedValue({
          id: 'guarantor-1',
          driverId: 'some-other-driver',
        });

        await expect(
          service.update('plan-1', { guarantorId: 'guarantor-1' }, owner),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(prisma.client.ownershipPlan.update).not.toHaveBeenCalled();
      });

      it('throws NotFound (never Forbidden) for a guarantor from another tenant', async () => {
        prisma.client.guarantor.findUnique.mockResolvedValue(null);

        await expect(
          service.update('plan-1', { guarantorId: 'guarantor-from-another-tenant' }, owner),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(prisma.client.ownershipPlan.update).not.toHaveBeenCalled();
      });
    });
  });
});
