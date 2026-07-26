import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DriverType, OwnershipPlanStatus, PaymentStatus, Prisma, UserRole } from '@prisma/client';
import { OwnershipPlanService } from './ownership-plan.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';

describe('OwnershipPlanService', () => {
  let service: OwnershipPlanService;
  let prisma: {
    client: {
      driver: { findUnique: jest.Mock; findMany: jest.Mock };
      motorcycle: { findUnique: jest.Mock; findMany: jest.Mock };
      ownershipPlan: {
        findFirst: jest.Mock;
        findMany: jest.Mock;
        findUnique: jest.Mock;
        create: jest.Mock;
        update: jest.Mock;
      };
      dailyAssignment: { findMany: jest.Mock };
      dailyPayment: { groupBy: jest.Mock };
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
    totalPrice: 1_800_000,
    startDate: '2026-03-03',
  };

  beforeEach(async () => {
    prisma = {
      client: {
        driver: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
        motorcycle: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
        ownershipPlan: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn(),
          findUnique: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
        },
        dailyAssignment: { findMany: jest.fn().mockResolvedValue([]) },
        dailyPayment: { groupBy: jest.fn().mockResolvedValue([]) },
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

    it('throws BadRequest when totalPrice does not exceed downPayment', async () => {
      await expect(
        service.create({ ...dto, totalPrice: 100_000, downPayment: 100_000 }, owner),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequest when activeWeekdays has duplicates', async () => {
      await expect(
        service.create({ ...dto, activeWeekdays: [1, 2, 2, 3] }, owner),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('defaults activeWeekdays to Mon-Sat when omitted, letting the DB default apply', async () => {
      prisma.client.ownershipPlan.create.mockResolvedValue({ id: 'plan-1' });

      await service.create(dto, owner);

      const { data } = prisma.client.ownershipPlan.create.mock.calls[0][0];
      expect(data.activeWeekdays).toBeUndefined();
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
          totalPrice: new Prisma.Decimal(1_800_000),
          downPayment: new Prisma.Decimal(0),
          contractEndDate: null,
          activeWeekdays: [1, 2, 3, 4, 5, 6],
          status: OwnershipPlanStatus.ACTIVE,
        },
        {
          id: 'plan-2',
          driverId: 'driver-2',
          motorcycleId: 'veh-2',
          dailyAmount: new Prisma.Decimal(15000),
          totalPrice: new Prisma.Decimal(2_000_000),
          downPayment: new Prisma.Decimal(0),
          contractEndDate: null,
          activeWeekdays: [1, 2, 3, 4, 5, 6],
          status: OwnershipPlanStatus.ACTIVE,
        },
      ];
      prisma.client.ownershipPlan.findMany.mockResolvedValue(plans);
      prisma.client.dailyAssignment.findMany.mockResolvedValue([
        { id: 'a1', ownershipPlanId: 'plan-1', targetAmount: new Prisma.Decimal(24000) },
        { id: 'a2', ownershipPlanId: 'plan-2', targetAmount: new Prisma.Decimal(30000) },
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
          totalPrice: new Prisma.Decimal(500000),
          downPayment: new Prisma.Decimal(0),
          contractEndDate: null,
          activeWeekdays: [1, 2, 3, 4, 5, 6],
          status: OwnershipPlanStatus.ACTIVE,
        },
        {
          id: 'plan-current',
          driverId: 'd2',
          motorcycleId: 'v2',
          dailyAmount: new Prisma.Decimal(12000),
          totalPrice: new Prisma.Decimal(500000),
          downPayment: new Prisma.Decimal(0),
          contractEndDate: null,
          activeWeekdays: [1, 2, 3, 4, 5, 6],
          status: OwnershipPlanStatus.ACTIVE,
        },
      ]);
      prisma.client.dailyAssignment.findMany.mockResolvedValue([
        { id: 'a1', ownershipPlanId: 'plan-a-lot-behind', targetAmount: new Prisma.Decimal(60000) },
        { id: 'a2', ownershipPlanId: 'plan-current', targetAmount: new Prisma.Decimal(12000) },
      ]);
      prisma.client.dailyPayment.groupBy.mockResolvedValue([
        { dailyAssignmentId: 'a2', _sum: { amount: new Prisma.Decimal(12000) } },
      ]);

      const result = await service.list(owner);

      expect(result[0].id).toBe('plan-a-lot-behind');
      expect(result[1].id).toBe('plan-current');
    });
  });

  describe('get', () => {
    const plan = {
      id: 'plan-1',
      tenantId: 'tenant-1',
      driverId: 'driver-1',
      motorcycleId: 'veh-1',
      dailyAmount: new Prisma.Decimal(12000),
      totalPrice: new Prisma.Decimal(1_800_000),
      downPayment: new Prisma.Decimal(0),
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
        { id: 'a1', ownershipPlanId: 'plan-1', targetAmount: new Prisma.Decimal(12000) },
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
        { id: 'a1', ownershipPlanId: 'plan-1', targetAmount: new Prisma.Decimal(12000) },
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
  });

  describe('update', () => {
    const activePlan = {
      id: 'plan-1',
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

    it('rejects totalPrice not exceeding downPayment', async () => {
      await expect(
        service.update('plan-1', { downPayment: 1_800_000 }, owner),
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
  });
});
