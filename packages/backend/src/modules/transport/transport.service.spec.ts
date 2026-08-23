import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { validate } from 'class-validator';
import { DriverType, OwnershipPlanStatus, TransportJobStatus, UserRole } from '@prisma/client';
import { TransportService } from './transport.service';
import { CreateTransportJobDto } from './dto/create-transport-job.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';

describe('TransportService', () => {
  let service: TransportService;
  let prisma: {
    client: {
      motorcycle: { findUnique: jest.Mock; findMany: jest.Mock };
      driver: { findUnique: jest.Mock };
      ownershipPlan: { findFirst: jest.Mock };
      transportJob: {
        create: jest.Mock;
        findMany: jest.Mock;
        findUnique: jest.Mock;
        update: jest.Mock;
        delete: jest.Mock;
      };
      expense: { groupBy: jest.Mock };
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

  const driverActor: AuthenticatedUser = { ...owner, role: UserRole.RIDER, userId: 'user-driver' };

  const truck = {
    id: 'veh-1',
    tenantId: 'tenant-1',
    isActive: true,
    vehicleType: 'TRUCK',
    registrationNumber: 'T123 ABC',
  };

  function makeDriver(driverType: DriverType) {
    return {
      id: 'driver-1',
      tenantId: 'tenant-1',
      userId: 'user-driver',
      isActive: true,
      driverType,
      user: { firstName: 'Juma', lastName: 'Hassan' },
    };
  }

  beforeEach(async () => {
    prisma = {
      client: {
        motorcycle: { findUnique: jest.fn(), findMany: jest.fn() },
        driver: { findUnique: jest.fn() },
        ownershipPlan: { findFirst: jest.fn().mockResolvedValue(null) },
        transportJob: {
          create: jest.fn(),
          findMany: jest.fn(),
          findUnique: jest.fn(),
          update: jest.fn(),
          delete: jest.fn(),
        },
        expense: { groupBy: jest.fn() },
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [TransportService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(TransportService);
  });

  const dto = {
    motorcycleId: 'veh-1',
    origin: 'Dar',
    destination: 'Mwanza',
    revenue: 500000,
    scheduledDate: '2026-07-25',
  };

  describe('createJob', () => {
    it('forbids a RIDER', async () => {
      await expect(service.createJob(dto, driverActor)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws NotFound when the vehicle is missing', async () => {
      prisma.client.motorcycle.findUnique.mockResolvedValue(null);
      await expect(service.createJob(dto, owner)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('owner-driven jobs carry no driver and get a BF- reference', async () => {
      prisma.client.motorcycle.findUnique.mockResolvedValue(truck);
      prisma.client.transportJob.create.mockImplementation(({ data }) => ({
        id: 'job-1',
        ...data,
      }));

      const result = await service.createJob({ ...dto, ownerDriven: true, driverId: 'r-1' }, owner);

      expect(result.driverId).toBeNull();
      expect(result.ownerDriven).toBe(true);
      expect(result.reference).toMatch(/^BF-[0-9A-HJKMNP-TV-Z]{8}$/);
    });
  });

  describe('createJob - driver category compatibility', () => {
    const jobDto = { ...dto, driverId: 'driver-1' };

    beforeEach(() => {
      prisma.client.motorcycle.findUnique.mockResolvedValue(truck);
      prisma.client.transportJob.create.mockImplementation(({ data }) => ({
        id: 'job-1',
        ...data,
      }));
    });

    it('allows a TRUCK_DRIVER on a TRUCK job', async () => {
      prisma.client.driver.findUnique.mockResolvedValue(makeDriver(DriverType.TRUCK_DRIVER));

      const result = await service.createJob(jobDto, owner);

      expect(result).toBeDefined();
      expect(prisma.client.transportJob.create).toHaveBeenCalled();
    });

    it.each([[DriverType.RIDER], [DriverType.CAR_DRIVER]])(
      'rejects a %s on a TRUCK job, with no override',
      async (driverType) => {
        prisma.client.driver.findUnique.mockResolvedValue(makeDriver(driverType));

        await expect(service.createJob(jobDto, owner)).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.client.transportJob.create).not.toHaveBeenCalled();
      },
    );

    it('names both sides of the mismatch in the error message', async () => {
      prisma.client.driver.findUnique.mockResolvedValue(makeDriver(DriverType.RIDER));

      await expect(service.createJob(jobDto, owner)).rejects.toThrow(
        'Juma Hassan is a rider and cannot be assigned T123 ABC, which is a truck.',
      );
    });

    it('an OWNER override with a valid reason succeeds and persists all three columns', async () => {
      prisma.client.driver.findUnique.mockResolvedValue(makeDriver(DriverType.RIDER));

      const reason = 'Owner is personally driving the truck today.';
      await service.createJob({ ...jobDto, categoryOverrideReason: reason }, owner);

      expect(prisma.client.transportJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            categoryOverrideReason: reason,
            categoryOverrideByUserId: owner.userId,
            categoryOverrideAt: expect.any(Date),
          }),
        }),
      );
    });

    it('a MANAGER attempting the override is rejected, even with a reason', async () => {
      prisma.client.driver.findUnique.mockResolvedValue(makeDriver(DriverType.RIDER));

      const reason = 'Manager insists on driving the truck today.';
      await expect(
        service.createJob({ ...jobDto, categoryOverrideReason: reason }, manager),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.client.transportJob.create).not.toHaveBeenCalled();
    });

    it('a compatible job created without a reason leaves all three columns unset', async () => {
      prisma.client.driver.findUnique.mockResolvedValue(makeDriver(DriverType.TRUCK_DRIVER));

      await service.createJob(jobDto, owner);

      const { data } = prisma.client.transportJob.create.mock.calls[0][0];
      expect(data.categoryOverrideReason).toBeUndefined();
      expect(data.categoryOverrideByUserId).toBeUndefined();
      expect(data.categoryOverrideAt).toBeUndefined();
    });
  });

  describe("createJob - vehicle on another driver's active ownership plan", () => {
    const jobDto = { ...dto, driverId: 'driver-1' };
    const otherDriver = makeDriver(DriverType.TRUCK_DRIVER);
    otherDriver.id = 'driver-2';
    otherDriver.user = { firstName: 'Asha', lastName: 'Mbwana' };

    beforeEach(() => {
      prisma.client.motorcycle.findUnique.mockResolvedValue(truck);
      prisma.client.transportJob.create.mockImplementation(({ data }) => ({
        id: 'job-1',
        ...data,
      }));
      prisma.client.driver.findUnique.mockImplementation(({ where }) =>
        Promise.resolve(
          where.id === 'driver-2' ? otherDriver : makeDriver(DriverType.TRUCK_DRIVER),
        ),
      );
    });

    it("assigning the vehicle to the plan's own driver succeeds", async () => {
      prisma.client.ownershipPlan.findFirst.mockResolvedValue({
        id: 'plan-1',
        driverId: 'driver-1',
        status: OwnershipPlanStatus.ACTIVE,
      });

      const result = await service.createJob(jobDto, owner);

      expect(result).toBeDefined();
      expect(prisma.client.transportJob.create).toHaveBeenCalled();
    });

    it('assigning the vehicle to a different driver is rejected, hard, with no override', async () => {
      prisma.client.ownershipPlan.findFirst.mockResolvedValue({
        id: 'plan-1',
        driverId: 'driver-2', // Asha Mbwana's plan
        status: OwnershipPlanStatus.ACTIVE,
      });

      await expect(service.createJob(jobDto, owner)).rejects.toThrow(
        'T123 ABC is on an active ownership plan for Asha Mbwana and cannot be assigned to Juma Hassan.',
      );
      expect(prisma.client.transportJob.create).not.toHaveBeenCalled();

      await expect(
        service.createJob({ ...jobDto, categoryOverrideReason: 'Owner insists.' }, owner),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it.each([
      OwnershipPlanStatus.COMPLETED,
      OwnershipPlanStatus.CANCELLED,
      OwnershipPlanStatus.DEFAULTED,
    ])('a vehicle whose plan is %s is freely assignable to a different driver', async () => {
      prisma.client.ownershipPlan.findFirst.mockResolvedValue(null);

      const result = await service.createJob(jobDto, owner);

      expect(result).toBeDefined();
      expect(prisma.client.transportJob.create).toHaveBeenCalled();
    });
  });

  describe('CreateTransportJobDto - categoryOverrideReason validation', () => {
    function makeDto(overrides: Partial<CreateTransportJobDto> = {}): CreateTransportJobDto {
      const instance = new CreateTransportJobDto();
      instance.motorcycleId = 'veh-1';
      instance.origin = 'Dar';
      instance.destination = 'Mwanza';
      instance.revenue = 500000;
      instance.scheduledDate = '2026-07-25';
      Object.assign(instance, overrides);
      return instance;
    }

    it('accepts a reason of 10 or more characters', async () => {
      const dto = makeDto({ categoryOverrideReason: 'Owner is driving personally.' });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('rejects a reason shorter than 10 characters', async () => {
      const dto = makeDto({ categoryOverrideReason: 'too short' });
      const errors = await validate(dto);
      expect(errors).not.toHaveLength(0);
      expect(errors.some((e) => e.property === 'categoryOverrideReason')).toBe(true);
    });

    it('accepts no reason at all (override not requested)', async () => {
      const dto = makeDto();
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });

  describe('getJob P&L', () => {
    it('computes netProfit = revenue - expenses', async () => {
      prisma.client.transportJob.findUnique.mockResolvedValue({
        id: 'job-1',
        revenue: '500000',
        expenses: [{ amount: '120000' }, { amount: '30000' }],
      });

      const result = await service.getJob('job-1', owner);

      expect(result.expensesTotal).toBe('150000.00');
      // Stage DM4 - getJob's return type is now a role-conditional union
      // (RIDER's response omits revenue/netProfit); TS can't statically know
      // this call used an OWNER actor, so the cast asserts what's true at
      // runtime rather than widening the real (correct) return type.
      expect((result as unknown as { netProfit: string }).netProfit).toBe('350000.00');
    });

    it('throws NotFound for an unknown job', async () => {
      prisma.client.transportJob.findUnique.mockResolvedValue(null);
      await expect(service.getJob('nope', owner)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateJob', () => {
    it('stamps pickedUpAt when moving to IN_TRANSIT', async () => {
      prisma.client.transportJob.findUnique.mockResolvedValue({
        id: 'job-1',
        status: 'SCHEDULED',
        ownerDriven: true,
        pickedUpAt: null,
        deliveredAt: null,
      });
      prisma.client.transportJob.update.mockImplementation(({ data }) => data);

      const data = await service.updateJob(
        'job-1',
        { status: TransportJobStatus.IN_TRANSIT },
        owner,
      );

      expect(data.status).toBe(TransportJobStatus.IN_TRANSIT);
      expect(data.pickedUpAt).toBeInstanceOf(Date);
    });
  });

  describe('updateJob - driver category compatibility', () => {
    const existingJob = {
      id: 'job-1',
      status: 'SCHEDULED',
      ownerDriven: false,
      motorcycleId: 'veh-1',
      pickedUpAt: null,
      deliveredAt: null,
    };

    beforeEach(() => {
      prisma.client.transportJob.findUnique.mockResolvedValue(existingJob);
      prisma.client.motorcycle.findUnique.mockResolvedValue(truck);
      prisma.client.transportJob.update.mockImplementation(({ data }) => data);
    });

    it('rejects a PATCH that reassigns to an incompatible driver, with no override', async () => {
      prisma.client.driver.findUnique.mockResolvedValue(makeDriver(DriverType.RIDER));

      await expect(
        service.updateJob('job-1', { driverId: 'driver-1' }, owner),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.client.transportJob.update).not.toHaveBeenCalled();
    });

    it('an OWNER override with a valid reason succeeds and persists all three columns', async () => {
      prisma.client.driver.findUnique.mockResolvedValue(makeDriver(DriverType.RIDER));

      const reason = 'Owner is personally driving the truck today.';
      const data = await service.updateJob(
        'job-1',
        { driverId: 'driver-1', categoryOverrideReason: reason },
        owner,
      );

      expect(data.categoryOverrideReason).toBe(reason);
      expect(data.categoryOverrideByUserId).toBe(owner.userId);
      expect(data.categoryOverrideAt).toBeInstanceOf(Date);
    });

    it('a MANAGER override attempt is rejected, even with a reason', async () => {
      prisma.client.driver.findUnique.mockResolvedValue(makeDriver(DriverType.RIDER));

      const reason = 'Manager insists on driving the truck today.';
      await expect(
        service.updateJob(
          'job-1',
          { driverId: 'driver-1', categoryOverrideReason: reason },
          manager,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.client.transportJob.update).not.toHaveBeenCalled();
    });

    it('allows a compatible reassignment without a reason, leaving override columns unset', async () => {
      prisma.client.driver.findUnique.mockResolvedValue(makeDriver(DriverType.TRUCK_DRIVER));

      const data = await service.updateJob('job-1', { driverId: 'driver-1' }, owner);

      expect(data.categoryOverrideReason).toBeUndefined();
      expect(data.categoryOverrideByUserId).toBeUndefined();
      expect(data.categoryOverrideAt).toBeUndefined();
    });
  });

  describe("updateJob - vehicle on another driver's active ownership plan", () => {
    const existingJob = {
      id: 'job-1',
      status: 'SCHEDULED',
      ownerDriven: false,
      motorcycleId: 'veh-1',
      pickedUpAt: null,
      deliveredAt: null,
    };
    const otherDriver = makeDriver(DriverType.TRUCK_DRIVER);
    otherDriver.id = 'driver-2';
    otherDriver.user = { firstName: 'Asha', lastName: 'Mbwana' };

    beforeEach(() => {
      prisma.client.transportJob.findUnique.mockResolvedValue(existingJob);
      prisma.client.motorcycle.findUnique.mockResolvedValue(truck);
      prisma.client.transportJob.update.mockImplementation(({ data }) => data);
      prisma.client.driver.findUnique.mockImplementation(({ where }) =>
        Promise.resolve(
          where.id === 'driver-2' ? otherDriver : makeDriver(DriverType.TRUCK_DRIVER),
        ),
      );
    });

    it("reassigning to the plan's own driver succeeds", async () => {
      prisma.client.ownershipPlan.findFirst.mockResolvedValue({
        id: 'plan-1',
        driverId: 'driver-1',
        status: OwnershipPlanStatus.ACTIVE,
      });

      const data = await service.updateJob('job-1', { driverId: 'driver-1' }, owner);

      expect(data).toBeDefined();
      expect(prisma.client.transportJob.update).toHaveBeenCalled();
    });

    it('reassigning to a different driver is rejected, hard, with no override', async () => {
      prisma.client.ownershipPlan.findFirst.mockResolvedValue({
        id: 'plan-1',
        driverId: 'driver-2',
        status: OwnershipPlanStatus.ACTIVE,
      });

      await expect(service.updateJob('job-1', { driverId: 'driver-1' }, owner)).rejects.toThrow(
        'T123 ABC is on an active ownership plan for Asha Mbwana and cannot be assigned to Juma Hassan.',
      );
      expect(prisma.client.transportJob.update).not.toHaveBeenCalled();

      await expect(
        service.updateJob(
          'job-1',
          { driverId: 'driver-1', categoryOverrideReason: 'Owner insists.' },
          owner,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it.each([
      OwnershipPlanStatus.COMPLETED,
      OwnershipPlanStatus.CANCELLED,
      OwnershipPlanStatus.DEFAULTED,
    ])('a vehicle whose plan is %s is freely reassignable to a different driver', async () => {
      prisma.client.ownershipPlan.findFirst.mockResolvedValue(null);

      const data = await service.updateJob('job-1', { driverId: 'driver-1' }, owner);

      expect(data).toBeDefined();
      expect(prisma.client.transportJob.update).toHaveBeenCalled();
    });
  });

  describe('deleteJob', () => {
    it('blocks deletion when the job has expenses', async () => {
      prisma.client.transportJob.findUnique.mockResolvedValue({
        id: 'job-1',
        expenses: [{ id: 'e-1' }],
      });
      await expect(service.deleteJob('job-1', owner)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('vehicleSummary', () => {
    it('rolls up revenue minus job expenses per vehicle', async () => {
      prisma.client.transportJob.findMany.mockResolvedValue([
        { id: 'j1', motorcycleId: 'veh-1', revenue: '500000' },
        { id: 'j2', motorcycleId: 'veh-1', revenue: '300000' },
      ]);
      prisma.client.expense.groupBy.mockResolvedValue([
        { transportJobId: 'j1', _sum: { amount: '150000' } },
        { transportJobId: 'j2', _sum: { amount: '400000' } },
      ]);
      prisma.client.motorcycle.findMany.mockResolvedValue([
        { id: 'veh-1', registrationNumber: 'T-123', vehicleType: 'TRUCK' },
      ]);

      const [row] = await service.vehicleSummary({}, owner);

      expect(row.registrationNumber).toBe('T-123');
      expect(row.jobCount).toBe(2);
      expect(row.revenue).toBe('800000.00');
      expect(row.expenses).toBe('550000.00');
      expect(row.netProfit).toBe('250000.00');
    });
  });
});
