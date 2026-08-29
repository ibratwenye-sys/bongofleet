import { ConfigService } from '@nestjs/config';
import { Prisma, UserRole } from '@prisma/client';
import { MaintenanceSummaryService } from './maintenance-summary.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';

function dec(n: number) {
  return new Prisma.Decimal(n);
}

const NOW = new Date('2026-08-25T10:00:00.000Z');

const owner: AuthenticatedUser = {
  userId: 'user-owner',
  tenantId: 'tenant-1',
  role: UserRole.OWNER,
  email: 'owner@example.com',
  firstName: 'O',
  lastName: 'Wner',
  jti: 'jti-owner',
};

describe('MaintenanceSummaryService.getSummary', () => {
  let service: MaintenanceSummaryService;
  let prisma: {
    client: {
      motorcycle: { findMany: jest.Mock };
      dailyAssignment: { findMany: jest.Mock };
      maintenanceLog: { findMany: jest.Mock };
    };
  };
  let config: { get: jest.Mock };

  beforeEach(() => {
    prisma = {
      client: {
        motorcycle: { findMany: jest.fn() },
        dailyAssignment: { findMany: jest.fn().mockResolvedValue([]) },
        maintenanceLog: { findMany: jest.fn() },
      },
    };
    config = { get: jest.fn((_key: string, fallback?: unknown) => fallback) };
    service = new MaintenanceSummaryService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );
  });

  it('rejects a rider', async () => {
    const rider: AuthenticatedUser = { ...owner, role: UserRole.RIDER };
    await expect(service.getSummary(rider, NOW)).rejects.toThrow(
      'Only OWNER or MANAGER may view the maintenance summary',
    );
  });

  it('buckets vehicles into overdue / due-7 / due-30 / nothing-due, mutually exclusive', async () => {
    prisma.client.motorcycle.findMany.mockResolvedValue([
      {
        id: 'm-overdue',
        registrationNumber: 'T1',
        vehicleType: 'MOTORBIKE',
        currentMileage: 100,
        maintenanceLogs: [
          { nextServiceDate: new Date('2026-08-01T00:00:00.000Z'), nextServiceMileage: null },
        ],
      },
      {
        id: 'm-due7',
        registrationNumber: 'T2',
        vehicleType: 'MOTORBIKE',
        currentMileage: 100,
        maintenanceLogs: [
          { nextServiceDate: new Date('2026-08-28T00:00:00.000Z'), nextServiceMileage: null },
        ],
      },
      {
        id: 'm-due30',
        registrationNumber: 'T3',
        vehicleType: 'MOTORBIKE',
        currentMileage: 100,
        maintenanceLogs: [
          { nextServiceDate: new Date('2026-09-15T00:00:00.000Z'), nextServiceMileage: null },
        ],
      },
      {
        id: 'm-fine',
        registrationNumber: 'T4',
        vehicleType: 'MOTORBIKE',
        currentMileage: 100,
        maintenanceLogs: [],
      },
    ]);
    prisma.client.maintenanceLog.findMany.mockResolvedValue([]);

    const result = await service.getSummary(owner, NOW);
    expect(result.kpis.overdue.count).toBe(1);
    expect(result.kpis.dueWithin7Days.count).toBe(1);
    expect(result.kpis.dueWithin30Days.count).toBe(1);
    expect(result.kpis.nothingDue.count).toBe(1);
  });

  it('flags a vehicle with exactly 2 visits in the 45-day window as a repeat visit', async () => {
    prisma.client.motorcycle.findMany.mockResolvedValue([]);
    prisma.client.maintenanceLog.findMany
      .mockResolvedValueOnce([]) // completedThisMonth
      .mockResolvedValueOnce([
        { motorcycleId: 'm1', cost: dec(50000) },
        { motorcycleId: 'm1', cost: dec(30000) },
      ]); // recentLogs (45-day window)

    const result = await service.getSummary(owner, NOW);
    expect(result.kpis.repeatVisits.count).toBe(1);
    expect(result.repeatVisitVehicles[0]).toMatchObject({
      motorcycleId: 'm1',
      visitCount: 2,
      totalSpend: '80000.00',
    });
  });

  it('does not flag a vehicle with exactly 1 visit', async () => {
    prisma.client.motorcycle.findMany.mockResolvedValue([]);
    prisma.client.maintenanceLog.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ motorcycleId: 'm1', cost: dec(50000) }]);

    const result = await service.getSummary(owner, NOW);
    expect(result.kpis.repeatVisits.count).toBe(0);
  });
});
