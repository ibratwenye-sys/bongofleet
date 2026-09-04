import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { ExpenseStatus, UserRole } from '@prisma/client';
import { ExpenseService } from './expense.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';

describe('ExpenseService', () => {
  let service: ExpenseService;
  let prisma: {
    client: {
      driver: { findUnique: jest.Mock };
      transportJob: { findMany: jest.Mock };
      expense: { create: jest.Mock };
    };
  };

  const driverActor: AuthenticatedUser = {
    userId: 'user-driver',
    tenantId: 'tenant-1',
    role: UserRole.RIDER,
    email: 'driver@example.com',
    firstName: 'Juma',
    lastName: 'Hassan',
    jti: 'jti-driver',
  };

  beforeEach(async () => {
    prisma = {
      client: {
        driver: { findUnique: jest.fn().mockResolvedValue({ id: 'driver-1' }) },
        transportJob: { findMany: jest.fn() },
        expense: {
          create: jest
            .fn()
            .mockImplementation(({ data }) => Promise.resolve({ id: 'expense-1', ...data })),
        },
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ExpenseService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => './uploads' } },
      ],
    }).compile();
    service = moduleRef.get(ExpenseService);
  });

  const dto = { category: 'Fuel', amount: 5000, incurredAt: '2026-09-04' };

  describe('submitForJob', () => {
    it('resolves to the single IN_TRANSIT job', async () => {
      prisma.client.transportJob.findMany.mockResolvedValueOnce([
        { id: 'job-1', motorcycleId: 'veh-1' },
      ]);

      const result = await service.submitForJob(dto, driverActor);

      expect(result.transportJobId).toBe('job-1');
      expect(result.motorcycleId).toBe('veh-1');
      expect(result.dailyAssignmentId).toBeUndefined();
      expect(result.status).toBe(ExpenseStatus.PENDING);
      expect(result.submittedByRiderId).toBe('driver-1');
      expect(result.submittedByUserId).toBe('user-driver');
      // Only the IN_TRANSIT query ran - never fell through to SCHEDULED.
      expect(prisma.client.transportJob.findMany).toHaveBeenCalledTimes(1);
    });

    it('falls back to the soonest SCHEDULED job (scheduledDate asc, createdAt asc) when there is no IN_TRANSIT one', async () => {
      prisma.client.transportJob.findMany
        .mockResolvedValueOnce([]) // IN_TRANSIT query
        .mockResolvedValueOnce([{ id: 'job-2', motorcycleId: 'veh-2' }]); // SCHEDULED query

      const result = await service.submitForJob(dto, driverActor);

      expect(result.transportJobId).toBe('job-2');
      expect(result.motorcycleId).toBe('veh-2');
      const scheduledCallArgs = prisma.client.transportJob.findMany.mock.calls[1][0];
      expect(scheduledCallArgs.orderBy).toEqual([{ scheduledDate: 'asc' }, { createdAt: 'asc' }]);
      expect(scheduledCallArgs.take).toBe(1);
    });

    it('throws "no active or upcoming job" when there is neither an IN_TRANSIT nor a SCHEDULED job', async () => {
      prisma.client.transportJob.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      await expect(service.submitForJob(dto, driverActor)).rejects.toThrow(
        new BadRequestException('You have no active or upcoming job right now.'),
      );
      expect(prisma.client.expense.create).not.toHaveBeenCalled();
    });

    it('throws the ambiguity error when more than one job is IN_TRANSIT, without guessing', async () => {
      prisma.client.transportJob.findMany.mockResolvedValueOnce([
        { id: 'job-1', motorcycleId: 'veh-1' },
        { id: 'job-2', motorcycleId: 'veh-2' },
      ]);

      await expect(service.submitForJob(dto, driverActor)).rejects.toThrow(
        new BadRequestException(
          "You have more than one active job right now - this isn't supported yet.",
        ),
      );
      expect(prisma.client.expense.create).not.toHaveBeenCalled();
    });
  });
});
