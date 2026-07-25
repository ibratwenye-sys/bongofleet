import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TransportJobStatus, UserRole } from '@prisma/client';
import { TransportService } from './transport.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';

describe('TransportService', () => {
  let service: TransportService;
  let prisma: {
    client: {
      motorcycle: { findUnique: jest.Mock; findMany: jest.Mock };
      rider: { findUnique: jest.Mock };
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

  const riderActor: AuthenticatedUser = { ...owner, role: UserRole.RIDER, userId: 'user-rider' };

  const truck = { id: 'veh-1', tenantId: 'tenant-1', isActive: true, vehicleType: 'TRUCK' };

  beforeEach(async () => {
    prisma = {
      client: {
        motorcycle: { findUnique: jest.fn(), findMany: jest.fn() },
        rider: { findUnique: jest.fn() },
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
      await expect(service.createJob(dto, riderActor)).rejects.toBeInstanceOf(ForbiddenException);
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

      const result = await service.createJob({ ...dto, ownerDriven: true, riderId: 'r-1' }, owner);

      expect(result.riderId).toBeNull();
      expect(result.ownerDriven).toBe(true);
      expect(result.reference).toMatch(/^BF-[0-9A-HJKMNP-TV-Z]{8}$/);
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
      expect(result.netProfit).toBe('350000.00');
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
