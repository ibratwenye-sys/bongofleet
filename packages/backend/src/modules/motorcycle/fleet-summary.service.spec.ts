import { ConfigService } from '@nestjs/config';
import { Prisma, UserRole } from '@prisma/client';
import { FleetSummaryService } from './fleet-summary.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
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

describe('FleetSummaryService.getSummary', () => {
  let service: FleetSummaryService;
  let prisma: {
    client: {
      motorcycle: { findMany: jest.Mock };
      dailyAssignment: { findMany: jest.Mock };
      dailyPayment: { aggregate: jest.Mock; groupBy: jest.Mock };
      assignmentAlert: { findMany: jest.Mock };
      documentAlert: { findMany: jest.Mock };
    };
  };
  let analytics: { getPerMotorcycle: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(() => {
    prisma = {
      client: {
        motorcycle: { findMany: jest.fn() },
        dailyAssignment: { findMany: jest.fn() },
        dailyPayment: { aggregate: jest.fn(), groupBy: jest.fn() },
        assignmentAlert: { findMany: jest.fn() },
        documentAlert: { findMany: jest.fn() },
      },
    };
    analytics = { getPerMotorcycle: jest.fn() };
    config = { get: jest.fn((_key: string, fallback?: unknown) => fallback) };

    prisma.client.motorcycle.findMany
      .mockResolvedValueOnce([
        {
          id: 'm1',
          registrationNumber: 'T1',
          vehicleType: 'MOTORBIKE',
          status: 'ACTIVE',
          operatingArea: 'Kariakoo',
          currentMileage: 100,
          maintenanceLogs: [],
        },
        {
          id: 'm2',
          registrationNumber: 'T2',
          vehicleType: 'MOTORBIKE',
          status: 'ACTIVE',
          operatingArea: null,
          currentMileage: 100,
          maintenanceLogs: [],
        },
      ])
      // getIdleVehicles' own candidate query - m2 has no assignment today.
      .mockResolvedValueOnce([
        {
          id: 'm2',
          registrationNumber: 'T2',
          vehicleType: 'MOTORBIKE',
          operatingArea: null,
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      ]);
    prisma.client.dailyAssignment.findMany
      .mockResolvedValueOnce([
        { motorcycleId: 'm1', driver: { user: { firstName: 'A', lastName: 'B' } } },
      ])
      .mockResolvedValueOnce([]) // month assignments
      .mockResolvedValueOnce([]); // getIdleVehicles' last-assignment lookup
    prisma.client.dailyPayment.aggregate.mockResolvedValue({ _sum: { amount: dec(5000) } });
    analytics.getPerMotorcycle.mockResolvedValue([
      {
        motorcycleId: 'm1',
        registrationNumber: 'T1',
        vehicleType: 'MOTORBIKE',
        revenue: '5000.00',
        expenses: '0.00',
        netProfit: '5000.00',
      },
    ]);
    prisma.client.assignmentAlert.findMany.mockResolvedValue([]);
    prisma.client.documentAlert.findMany.mockResolvedValue([]);

    service = new FleetSummaryService(
      prisma as unknown as PrismaService,
      analytics as unknown as AnalyticsService,
      config as unknown as ConfigService,
    );
  });

  it('rejects a rider', async () => {
    const rider: AuthenticatedUser = { ...owner, role: UserRole.RIDER };
    await expect(service.getSummary(rider, NOW)).rejects.toThrow(
      'Only OWNER or MANAGER may view the fleet summary',
    );
  });

  it('computes on-road, idle, and workshop counts from the fixture', async () => {
    const result = await service.getSummary(owner, NOW);
    expect(result.kpis.totalVehicles.count).toBe(2);
    expect(result.kpis.onRoadToday.count).toBe(1);
    expect(result.kpis.idleToday.count).toBe(1);
    expect(result.idleVehicles[0].motorcycleId).toBe('m2');
  });

  it('the area panel groups only vehicles with operatingArea set, and counts the rest as unset', async () => {
    const result = await service.getSummary(owner, NOW);
    const motorbikeGroup = result.areaGroups.find((g) => g.vehicleType === 'MOTORBIKE');
    expect(motorbikeGroup?.areas).toEqual([{ area: 'Kariakoo', count: 1 }]);
    expect(motorbikeGroup?.unset).toBe(1);
  });

  it('runs a fixed, small number of queries - not one per vehicle', async () => {
    await service.getSummary(owner, NOW);
    // motorcycle.findMany: main fleet list + getIdleVehicles' candidates.
    expect(prisma.client.motorcycle.findMany).toHaveBeenCalledTimes(2);
    // dailyAssignment.findMany: today's, this month's, getIdleVehicles' last-assignment lookup.
    expect(prisma.client.dailyAssignment.findMany).toHaveBeenCalledTimes(3);
    expect(prisma.client.dailyPayment.aggregate).toHaveBeenCalledTimes(1);
    expect(analytics.getPerMotorcycle).toHaveBeenCalledTimes(1);
    expect(prisma.client.assignmentAlert.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.client.documentAlert.findMany).toHaveBeenCalledTimes(1);
  });
});
