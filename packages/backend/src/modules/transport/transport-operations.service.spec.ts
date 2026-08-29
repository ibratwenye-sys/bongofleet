import { Prisma, UserRole } from '@prisma/client';
import { TransportOperationsService } from './transport-operations.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { TransportService } from './transport.service';
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

function emptyPnl() {
  return {
    from: null,
    to: null,
    vehicleType: null,
    revenue: '0.00',
    rentalRevenue: '0.00',
    transportRevenue: '0.00',
    expenses: '0.00',
    netProfit: '0.00',
    paymentCount: 0,
    transportJobCount: 0,
    expenseCount: 0,
  };
}

describe('TransportOperationsService.getOperationsSummary', () => {
  let service: TransportOperationsService;
  let prisma: {
    client: {
      motorcycle: { findMany: jest.Mock };
      transportJob: { findFirst: jest.Mock; findMany: jest.Mock };
      expense: { groupBy: jest.Mock; findMany: jest.Mock };
      gpsLocation: { findMany: jest.Mock };
      dailyAssignment: { findMany: jest.Mock };
    };
  };
  let analytics: { getSummary: jest.Mock; getPerMotorcycle: jest.Mock };
  let transport: { vehicleSummary: jest.Mock; listJobs: jest.Mock };

  beforeEach(() => {
    prisma = {
      client: {
        motorcycle: { findMany: jest.fn().mockResolvedValue([]) },
        transportJob: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
        },
        expense: {
          groupBy: jest.fn().mockResolvedValue([]),
          findMany: jest.fn().mockResolvedValue([]),
        },
        gpsLocation: { findMany: jest.fn().mockResolvedValue([]) },
        // getIdleVehicles' own last-assignment lookup - always empty here,
        // so every fixture vehicle reads as "never assigned" rather than
        // crashing on a missing createdAt.
        dailyAssignment: { findMany: jest.fn().mockResolvedValue([]) },
      },
    };
    analytics = {
      getSummary: jest.fn().mockResolvedValue(emptyPnl()),
      getPerMotorcycle: jest.fn().mockResolvedValue([]),
    };
    transport = {
      vehicleSummary: jest.fn().mockResolvedValue([]),
      listJobs: jest.fn().mockResolvedValue([]),
    };

    service = new TransportOperationsService(
      prisma as unknown as PrismaService,
      analytics as unknown as AnalyticsService,
      transport as unknown as TransportService,
    );
  });

  it('rejects a rider', async () => {
    const rider: AuthenticatedUser = { ...owner, role: UserRole.RIDER };
    await expect(service.getOperationsSummary(rider, NOW)).rejects.toThrow(
      'Only OWNER or MANAGER may view transport operations',
    );
  });

  it('with no vehicles at all, returns zeroed KPIs and no margin-decline flag', async () => {
    const result = await service.getOperationsSummary(owner, NOW);
    expect(result.kpis.fleetCount.count).toBe(0);
    expect(result.marginDeclineFlag).toBeNull();
    expect(result.inTransitJob).toBeNull();
  });

  it('flags a margin decline only with 2+ prior months of history, at the exact boundary', async () => {
    prisma.client.motorcycle.findMany.mockResolvedValue([
      {
        id: 'm1',
        status: 'ACTIVE',
        vehicleType: 'TRUCK',
        registrationNumber: 'T1',
        operatingArea: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    // Current month (Aug): revenue 100k, expenses 90k -> 10% margin.
    // Two prior months (Jun, Jul) at 50% margin each -> 40pt decline, over threshold.
    prisma.client.transportJob.findMany.mockResolvedValue([
      {
        id: 'j-aug',
        motorcycleId: 'm1',
        revenue: dec(100000),
        scheduledDate: new Date('2026-08-10T00:00:00.000Z'),
      },
      {
        id: 'j-jul',
        motorcycleId: 'm1',
        revenue: dec(100000),
        scheduledDate: new Date('2026-07-10T00:00:00.000Z'),
      },
      {
        id: 'j-jun',
        motorcycleId: 'm1',
        revenue: dec(100000),
        scheduledDate: new Date('2026-06-10T00:00:00.000Z'),
      },
    ]);
    prisma.client.expense.groupBy.mockResolvedValue([
      { transportJobId: 'j-aug', _sum: { amount: dec(90000) } },
      { transportJobId: 'j-jul', _sum: { amount: dec(50000) } },
      { transportJobId: 'j-jun', _sum: { amount: dec(50000) } },
    ]);

    const result = await service.getOperationsSummary(owner, NOW);
    expect(result.marginDeclineFlag).not.toBeNull();
    expect(result.marginDeclineFlag?.motorcycleId).toBe('m1');
    expect(result.marginDeclineFlag?.priorMonthCount).toBe(2);
    expect(result.flaggedVehicleMarginTrend).not.toBeNull();
  });

  it('does not flag with only 1 prior month of history', async () => {
    prisma.client.motorcycle.findMany.mockResolvedValue([
      {
        id: 'm1',
        status: 'ACTIVE',
        vehicleType: 'TRUCK',
        registrationNumber: 'T1',
        operatingArea: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    prisma.client.transportJob.findMany.mockResolvedValue([
      {
        id: 'j-aug',
        motorcycleId: 'm1',
        revenue: dec(100000),
        scheduledDate: new Date('2026-08-10T00:00:00.000Z'),
      },
      {
        id: 'j-jul',
        motorcycleId: 'm1',
        revenue: dec(100000),
        scheduledDate: new Date('2026-07-10T00:00:00.000Z'),
      },
    ]);
    prisma.client.expense.groupBy.mockResolvedValue([
      { transportJobId: 'j-aug', _sum: { amount: dec(90000) } },
      { transportJobId: 'j-jul', _sum: { amount: dec(50000) } },
    ]);

    const result = await service.getOperationsSummary(owner, NOW);
    expect(result.marginDeclineFlag).toBeNull();
  });
});
