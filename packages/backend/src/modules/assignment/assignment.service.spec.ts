import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { validate } from 'class-validator';
import { DriverType, OwnershipPlanStatus, UserRole, VehicleType } from '@prisma/client';
import { AssignmentService } from './assignment.service';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';

describe('AssignmentService', () => {
  let service: AssignmentService;
  let prisma: {
    client: {
      motorcycle: { findUnique: jest.Mock };
      driver: { findUnique: jest.Mock };
      ownershipPlan: { findFirst: jest.Mock };
      dailyAssignment: {
        findFirst: jest.Mock;
        findUnique: jest.Mock;
        create: jest.Mock;
        delete: jest.Mock;
      };
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
    userId: 'user-manager',
    tenantId: 'tenant-1',
    role: UserRole.MANAGER,
    email: 'manager@example.com',
    firstName: 'M',
    lastName: 'Anager',
    jti: 'jti-manager',
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

  const motorcycle = {
    id: 'moto-1',
    tenantId: 'tenant-1',
    isActive: true,
    vehicleType: VehicleType.MOTORBIKE,
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

  const driver = makeDriver(DriverType.RIDER);

  const dto = {
    motorcycleId: 'moto-1',
    driverId: 'driver-1',
    assignedDate: '2026-07-01',
    targetAmount: 50000,
  };

  beforeEach(async () => {
    prisma = {
      client: {
        motorcycle: { findUnique: jest.fn() },
        driver: { findUnique: jest.fn() },
        ownershipPlan: { findFirst: jest.fn().mockResolvedValue(null) },
        dailyAssignment: {
          findFirst: jest.fn(),
          findUnique: jest.fn(),
          create: jest.fn(),
          delete: jest.fn(),
        },
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [AssignmentService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(AssignmentService);
  });

  describe('createAssignment', () => {
    it('succeeds for a valid owner request', async () => {
      prisma.client.motorcycle.findUnique.mockResolvedValue(motorcycle);
      prisma.client.driver.findUnique.mockResolvedValue(driver);
      prisma.client.dailyAssignment.findFirst.mockResolvedValue(null);
      prisma.client.dailyAssignment.create.mockResolvedValue({ id: 'assignment-1', ...dto });

      const result = await service.createAssignment(dto, owner);

      expect(prisma.client.dailyAssignment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ tenantId: owner.tenantId }) }),
      );
      expect(result).toEqual({ id: 'assignment-1', ...dto });
    });

    it('throws NotFound when the motorcycle does not exist', async () => {
      prisma.client.motorcycle.findUnique.mockResolvedValue(null);

      await expect(service.createAssignment(dto, owner)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFound when the driver does not exist', async () => {
      prisma.client.motorcycle.findUnique.mockResolvedValue(motorcycle);
      prisma.client.driver.findUnique.mockResolvedValue(null);

      await expect(service.createAssignment(dto, owner)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws Conflict when the motorcycle is already booked that date', async () => {
      prisma.client.motorcycle.findUnique.mockResolvedValue(motorcycle);
      prisma.client.driver.findUnique.mockResolvedValue(driver);
      prisma.client.dailyAssignment.findFirst.mockResolvedValueOnce({ id: 'existing' });

      await expect(service.createAssignment(dto, owner)).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws Conflict when the driver is already booked that date', async () => {
      prisma.client.motorcycle.findUnique.mockResolvedValue(motorcycle);
      prisma.client.driver.findUnique.mockResolvedValue(driver);
      prisma.client.dailyAssignment.findFirst
        .mockResolvedValueOnce(null) // bike check passes
        .mockResolvedValueOnce({ id: 'existing' }); // driver check fails

      await expect(service.createAssignment(dto, owner)).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws Forbidden when a RIDER attempts to create an assignment, with no Prisma calls made', async () => {
      await expect(service.createAssignment(dto, driverActor)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.client.motorcycle.findUnique).not.toHaveBeenCalled();
      expect(prisma.client.driver.findUnique).not.toHaveBeenCalled();
      expect(prisma.client.dailyAssignment.create).not.toHaveBeenCalled();
    });
  });

  describe("createAssignment - vehicle on another driver's active ownership plan", () => {
    const otherDriver = {
      ...driver,
      id: 'driver-2',
      user: { firstName: 'Asha', lastName: 'Mbwana' },
    };

    beforeEach(() => {
      prisma.client.dailyAssignment.findFirst.mockResolvedValue(null);
      prisma.client.dailyAssignment.create.mockImplementation(({ data }) => ({
        id: 'assignment-1',
        ...data,
      }));
      prisma.client.driver.findUnique.mockImplementation(({ where }) =>
        Promise.resolve(where.id === 'driver-2' ? otherDriver : driver),
      );
    });

    it("assigning the vehicle to the plan's own driver succeeds", async () => {
      prisma.client.motorcycle.findUnique.mockResolvedValue(motorcycle);
      prisma.client.ownershipPlan.findFirst.mockResolvedValue({
        id: 'plan-1',
        driverId: 'driver-1',
        status: OwnershipPlanStatus.ACTIVE,
      });

      const result = await service.createAssignment(dto, owner);

      expect(result).toBeDefined();
      expect(prisma.client.dailyAssignment.create).toHaveBeenCalled();
    });

    it('assigning the vehicle to a different driver is rejected, hard, with no override', async () => {
      prisma.client.motorcycle.findUnique.mockResolvedValue(motorcycle);
      prisma.client.ownershipPlan.findFirst.mockResolvedValue({
        id: 'plan-1',
        driverId: 'driver-2', // Asha Mbwana's plan
        status: OwnershipPlanStatus.ACTIVE,
      });

      await expect(service.createAssignment(dto, owner)).rejects.toThrow(
        'T123 ABC is on an active ownership plan for Asha Mbwana and cannot be assigned to Juma Hassan.',
      );
      expect(prisma.client.dailyAssignment.create).not.toHaveBeenCalled();

      // Not even an OWNER-supplied reason overrides this - it isn't offered.
      await expect(
        service.createAssignment({ ...dto, categoryOverrideReason: 'Owner insists.' }, owner),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it.each([
      OwnershipPlanStatus.COMPLETED,
      OwnershipPlanStatus.CANCELLED,
      OwnershipPlanStatus.DEFAULTED,
    ])('a vehicle whose plan is %s is freely assignable to a different driver', async () => {
      prisma.client.motorcycle.findUnique.mockResolvedValue(motorcycle);
      // A non-ACTIVE plan never matches the findFirst({ status: ACTIVE }) query.
      prisma.client.ownershipPlan.findFirst.mockResolvedValue(null);

      const result = await service.createAssignment(dto, owner);

      expect(result).toBeDefined();
      expect(prisma.client.dailyAssignment.create).toHaveBeenCalled();
    });
  });

  describe('createAssignment - driver category compatibility', () => {
    beforeEach(() => {
      prisma.client.dailyAssignment.findFirst.mockResolvedValue(null);
      prisma.client.dailyAssignment.create.mockImplementation(({ data }) => ({
        id: 'assignment-1',
        ...data,
      }));
    });

    it.each([
      [DriverType.RIDER, VehicleType.MOTORBIKE],
      [DriverType.RIDER, VehicleType.BAJAJI],
      [DriverType.CAR_DRIVER, VehicleType.CAR],
      [DriverType.TRUCK_DRIVER, VehicleType.TRUCK],
    ])('allows a %s to be assigned a %s', async (driverType, vehicleType) => {
      prisma.client.motorcycle.findUnique.mockResolvedValue({ ...motorcycle, vehicleType });
      prisma.client.driver.findUnique.mockResolvedValue(makeDriver(driverType));

      const result = await service.createAssignment(dto, owner);

      expect(result).toBeDefined();
      expect(prisma.client.dailyAssignment.create).toHaveBeenCalled();
    });

    it.each([
      [DriverType.RIDER, VehicleType.CAR],
      [DriverType.RIDER, VehicleType.TRUCK],
      [DriverType.CAR_DRIVER, VehicleType.MOTORBIKE],
      [DriverType.CAR_DRIVER, VehicleType.BAJAJI],
      [DriverType.CAR_DRIVER, VehicleType.TRUCK],
      [DriverType.TRUCK_DRIVER, VehicleType.MOTORBIKE],
      [DriverType.TRUCK_DRIVER, VehicleType.BAJAJI],
      [DriverType.TRUCK_DRIVER, VehicleType.CAR],
    ])('rejects a %s assigned a %s, with no override', async (driverType, vehicleType) => {
      prisma.client.motorcycle.findUnique.mockResolvedValue({ ...motorcycle, vehicleType });
      prisma.client.driver.findUnique.mockResolvedValue(makeDriver(driverType));

      await expect(service.createAssignment(dto, owner)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.client.dailyAssignment.create).not.toHaveBeenCalled();
    });

    it('names both sides of the mismatch in the error message', async () => {
      prisma.client.motorcycle.findUnique.mockResolvedValue({
        ...motorcycle,
        vehicleType: VehicleType.TRUCK,
        registrationNumber: 'T123 ABC',
      });
      prisma.client.driver.findUnique.mockResolvedValue(makeDriver(DriverType.RIDER));

      await expect(service.createAssignment(dto, owner)).rejects.toThrow(
        'Juma Hassan is a rider and cannot be assigned T123 ABC, which is a truck.',
      );
    });

    it('an OWNER override with a valid reason succeeds and persists all three columns', async () => {
      prisma.client.motorcycle.findUnique.mockResolvedValue({
        ...motorcycle,
        vehicleType: VehicleType.TRUCK,
      });
      prisma.client.driver.findUnique.mockResolvedValue(makeDriver(DriverType.RIDER));

      const reason = 'Owner is personally driving the truck today.';
      await service.createAssignment({ ...dto, categoryOverrideReason: reason }, owner);

      expect(prisma.client.dailyAssignment.create).toHaveBeenCalledWith(
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
      prisma.client.motorcycle.findUnique.mockResolvedValue({
        ...motorcycle,
        vehicleType: VehicleType.TRUCK,
      });
      prisma.client.driver.findUnique.mockResolvedValue(makeDriver(DriverType.RIDER));

      const reason = 'Manager insists on driving the truck today.';
      await expect(
        service.createAssignment({ ...dto, categoryOverrideReason: reason }, manager),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.client.dailyAssignment.create).not.toHaveBeenCalled();
    });

    it('a compatible assignment created without a reason leaves all three columns unset', async () => {
      prisma.client.motorcycle.findUnique.mockResolvedValue(motorcycle);
      prisma.client.driver.findUnique.mockResolvedValue(makeDriver(DriverType.RIDER));

      await service.createAssignment(dto, owner);

      const { data } = prisma.client.dailyAssignment.create.mock.calls[0][0];
      expect(data.categoryOverrideReason).toBeUndefined();
      expect(data.categoryOverrideByUserId).toBeUndefined();
      expect(data.categoryOverrideAt).toBeUndefined();
    });
  });

  describe('CreateAssignmentDto - categoryOverrideReason validation', () => {
    function makeDto(overrides: Partial<CreateAssignmentDto> = {}): CreateAssignmentDto {
      const instance = new CreateAssignmentDto();
      instance.motorcycleId = 'moto-1';
      instance.driverId = 'driver-1';
      instance.assignedDate = '2026-07-01';
      instance.targetAmount = 50000;
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

  describe('deleteAssignment', () => {
    it('throws BadRequest when the assignment has payments recorded against it', async () => {
      prisma.client.dailyAssignment.findUnique.mockResolvedValue({
        id: 'assignment-1',
        dailyPayments: [{ id: 'payment-1' }],
      });

      await expect(service.deleteAssignment('assignment-1', owner)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.client.dailyAssignment.delete).not.toHaveBeenCalled();
    });

    it('deletes when there are no payments', async () => {
      prisma.client.dailyAssignment.findUnique.mockResolvedValue({
        id: 'assignment-1',
        dailyPayments: [],
      });

      await service.deleteAssignment('assignment-1', owner);

      expect(prisma.client.dailyAssignment.delete).toHaveBeenCalledWith({
        where: { id: 'assignment-1' },
      });
    });
  });
});
