import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AssignmentService } from './assignment.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';

describe('AssignmentService', () => {
  let service: AssignmentService;
  let prisma: {
    client: {
      motorcycle: { findUnique: jest.Mock };
      driver: { findUnique: jest.Mock };
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

  const driverActor: AuthenticatedUser = {
    userId: 'user-driver',
    tenantId: 'tenant-1',
    role: UserRole.RIDER,
    email: 'driver@example.com',
    firstName: 'D',
    lastName: 'River',
    jti: 'jti-driver',
  };

  const motorcycle = { id: 'moto-1', tenantId: 'tenant-1', isActive: true };
  const driver = { id: 'driver-1', tenantId: 'tenant-1', userId: 'user-driver', isActive: true };

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
