import { ConfigService } from '@nestjs/config';
import { Prisma, UserRole } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AuthenticatedUser } from '../auth/auth.types';

function dec(n: number) {
  return new Prisma.Decimal(n);
}

// 10:00Z is 13:00 in Africa/Dar_es_Salaam (UTC+3) - safely inside the same
// local calendar day, so "today" below is unambiguous.
const NOW = new Date('2026-08-25T10:00:00.000Z');

describe('DashboardService.getOperationsCenter', () => {
  let service: DashboardService;
  let prisma: {
    client: {
      motorcycle: { count: jest.Mock; findMany: jest.Mock };
      dailyAssignment: { findMany: jest.Mock };
      dailyPayment: { aggregate: jest.Mock; groupBy: jest.Mock };
      ownershipPlan: { count: jest.Mock };
      assignmentAlert: { findMany: jest.Mock };
      documentAlert: { findMany: jest.Mock };
    };
  };
  let analytics: {
    getSummary: jest.Mock;
    getPerMotorcycle: jest.Mock;
    getDailyCollectionSeries: jest.Mock;
  };
  let config: { get: jest.Mock };

  const owner: AuthenticatedUser = {
    userId: 'user-owner',
    tenantId: 'tenant-1',
    role: UserRole.OWNER,
    email: 'owner@example.com',
    firstName: 'O',
    lastName: 'Wner',
    jti: 'jti-owner',
  };

  const driver: AuthenticatedUser = { ...owner, role: UserRole.RIDER };

  beforeEach(() => {
    prisma = {
      client: {
        motorcycle: { count: jest.fn(), findMany: jest.fn() },
        dailyAssignment: { findMany: jest.fn() },
        dailyPayment: { aggregate: jest.fn(), groupBy: jest.fn() },
        ownershipPlan: { count: jest.fn() },
        assignmentAlert: { findMany: jest.fn() },
        documentAlert: { findMany: jest.fn() },
      },
    };
    analytics = {
      getSummary: jest.fn(),
      getPerMotorcycle: jest.fn(),
      getDailyCollectionSeries: jest.fn(),
    };
    config = {
      get: jest.fn((_key: string, fallback?: unknown) => fallback),
    };

    prisma.client.motorcycle.count.mockResolvedValue(10);
    // Two calls: today's on-road, yesterday's on-road.
    prisma.client.dailyAssignment.findMany
      .mockResolvedValueOnce([
        { id: 'a1', motorcycleId: 'moto-1', targetAmount: dec(12000) },
        { id: 'a2', motorcycleId: 'moto-2', targetAmount: dec(15000) },
        { id: 'a3', motorcycleId: 'moto-3', targetAmount: dec(10000) },
      ])
      .mockResolvedValueOnce([{ motorcycleId: 'moto-1' }, { motorcycleId: 'moto-2' }]);
    prisma.client.dailyPayment.aggregate.mockResolvedValue({ _sum: { amount: dec(20000) } });
    prisma.client.ownershipPlan.count.mockResolvedValue(5);
    // Two DIFFERENT motorcycle.findMany calls, in this order: the due-bikes
    // query (initial Promise.all), then resolveOutstandingRows' own
    // registration-number lookup (after buildKpis resolves).
    prisma.client.motorcycle.findMany
      .mockResolvedValueOnce([
        {
          id: 'moto-4',
          currentMileage: 5000,
          maintenanceLogs: [
            { nextServiceDate: new Date('2026-08-01T00:00:00.000Z'), nextServiceMileage: null },
          ],
        },
        {
          id: 'moto-5',
          currentMileage: 5000,
          maintenanceLogs: [
            { nextServiceDate: new Date('2026-08-30T00:00:00.000Z'), nextServiceMileage: null },
          ],
        },
      ])
      .mockResolvedValueOnce([
        { id: 'moto-2', registrationNumber: 'T222 BBB' },
        { id: 'moto-3', registrationNumber: 'T333 CCC' },
      ]);
    prisma.client.dailyPayment.groupBy.mockResolvedValue([
      { dailyAssignmentId: 'a1', _sum: { amount: dec(12000) } },
      { dailyAssignmentId: 'a2', _sum: { amount: dec(8000) } },
    ]);
    prisma.client.assignmentAlert.findMany.mockResolvedValue([
      {
        kind: 'NO_PAYMENT',
        sentAt: new Date('2026-08-25T06:00:00.000Z'),
        targetAmount: dec(12000),
        paidAmount: dec(0),
        dailyAssignment: { motorcycle: { registrationNumber: 'T111 AAA' } },
      },
    ]);
    prisma.client.documentAlert.findMany.mockResolvedValue([
      {
        kind: 'EXPIRED',
        sentAt: new Date('2026-08-24T06:00:00.000Z'),
        document: { docType: 'INSURANCE', ownerType: 'MOTORCYCLE', ownerId: 'moto-4' },
      },
    ]);
    analytics.getSummary.mockResolvedValue({
      from: '2026-08-25',
      to: '2026-08-25',
      vehicleType: null,
      revenue: '45000.00',
      rentalRevenue: '45000.00',
      transportRevenue: '0.00',
      expenses: '20000.00',
      netProfit: '25000.00',
      paymentCount: 3,
      transportJobCount: 0,
      expenseCount: 1,
    });
    analytics.getPerMotorcycle.mockResolvedValue([
      {
        motorcycleId: 'moto-2',
        registrationNumber: 'T222 BBB',
        vehicleType: 'MOTORBIKE',
        revenue: '15000.00',
        expenses: '6000.00',
        netProfit: '9000.00',
      },
      {
        motorcycleId: 'moto-3',
        registrationNumber: 'T333 CCC',
        vehicleType: 'MOTORBIKE',
        revenue: '0.00',
        expenses: '2000.00',
        netProfit: '-2000.00',
      },
    ]);
    analytics.getDailyCollectionSeries.mockResolvedValue(
      Array.from({ length: 14 }, (_, i) => ({ date: `2026-08-${12 + i}`, amount: '1000.00' })),
    );

    service = new DashboardService(
      prisma as unknown as PrismaService,
      analytics as unknown as AnalyticsService,
      config as unknown as ConfigService,
    );
  });

  it('rejects a driver', async () => {
    await expect(service.getOperationsCenter(driver, NOW)).rejects.toThrow(
      'Only OWNER or MANAGER may view the operations center',
    );
  });

  it('computes all six real KPI numbers from the fixture', async () => {
    const result = await service.getOperationsCenter(owner, NOW);

    expect(result.kpis).toEqual({
      onTheRoad: { count: 3, fleetSize: 10, deltaVsYesterday: 1 }, // 3 today - 2 yesterday
      collectedToday: {
        amount: '20000.00',
        targetAmount: '37000.00',
        percentOfTarget: 54, // round(20000 / 37000 * 100)
      },
      outstandingToday: { count: 2, amount: '17000.00' }, // a2 short 7000, a3 short 10000
      activeOwnershipPlans: { count: 5 },
      serviceDue: { count: 2, overdueCount: 1 },
      netProfitToday: { amount: '25000.00' }, // straight from analytics.getSummary
    });
  });

  it('the rail slot is the worst performer today (lowest netProfit), reused from getPerMotorcycle - never invented commentary', async () => {
    const result = await service.getOperationsCenter(owner, NOW);
    expect(result.worstPerformerToday).toEqual({
      motorcycleId: 'moto-3',
      registrationNumber: 'T333 CCC',
      vehicleType: 'MOTORBIKE',
      revenue: '0.00',
      expenses: '2000.00',
      netProfit: '-2000.00',
    });
  });

  it('is null when nothing moved money today at all', async () => {
    analytics.getPerMotorcycle.mockResolvedValue([]);
    const result = await service.getOperationsCenter(owner, NOW);
    expect(result.worstPerformerToday).toBeNull();
  });

  it('merges real alerts from all three sources, most severe first', async () => {
    const result = await service.getOperationsCenter(owner, NOW);
    const sources = result.alerts.map((a) => a.source);
    expect(sources).toEqual(expect.arrayContaining(['ASSIGNMENT', 'DOCUMENT', 'MAINTENANCE']));
    // crit-severity rows (NO_PAYMENT, EXPIRED, OVERDUE) sort before warn ones.
    const critIndex = result.alerts.findIndex((a) => a.severity === 'crit');
    const warnIndex = result.alerts.findIndex((a) => a.severity === 'warn');
    expect(critIndex).toBeLessThan(warnIndex);
  });

  it('passes today straight through to getSummary/getPerMotorcycle, and a 14-day window to getDailyCollectionSeries', async () => {
    await service.getOperationsCenter(owner, NOW);
    expect(analytics.getSummary).toHaveBeenCalledWith(
      { from: '2026-08-25', to: '2026-08-25' },
      owner,
    );
    expect(analytics.getPerMotorcycle).toHaveBeenCalledWith(
      { from: '2026-08-25', to: '2026-08-25' },
      owner,
    );
    expect(analytics.getDailyCollectionSeries).toHaveBeenCalledWith(
      '2026-08-12',
      '2026-08-25',
      owner,
    );
  });

  it("the closing row's top-performers card reuses the same getPerMotorcycle ranking, top 3, most profitable first", async () => {
    const result = await service.getOperationsCenter(owner, NOW);
    expect(result.topPerformersToday).toEqual([
      expect.objectContaining({ motorcycleId: 'moto-2', netProfit: '9000.00' }),
      expect.objectContaining({ motorcycleId: 'moto-3', netProfit: '-2000.00' }),
    ]);
  });

  it('the outstanding-assignments table resolves real registration numbers for each short row, never a driver name it never fetched', async () => {
    const result = await service.getOperationsCenter(owner, NOW);
    expect(result.outstandingAssignmentRows).toEqual([
      {
        registrationNumber: 'T222 BBB',
        targetAmount: '15000.00',
        paidAmount: '8000.00',
        balance: '7000.00',
      },
      {
        registrationNumber: 'T333 CCC',
        targetAmount: '10000.00',
        paidAmount: '0.00',
        balance: '10000.00',
      },
    ]);
  });

  it('the collection series passes straight through from analytics, unmodified', async () => {
    const result = await service.getOperationsCenter(owner, NOW);
    expect(result.collectionSeries).toHaveLength(14);
    expect(result.todaysPnl.netProfit).toBe('25000.00');
  });

  /**
   * Stage UI1 - the required "does not scale with fleet size" proof: every
   * Prisma call and every AnalyticsService call fires EXACTLY ONCE (or
   * twice for the two-different-days dailyAssignment.findMany call) no
   * matter how many rows the fixture returns. If any of this were
   * implemented as a per-motorcycle loop, the mock it loops over would be
   * called once per row instead of once total - this would then fail as
   * soon as the fixture above had more than one row.
   */
  it('runs a fixed, small number of queries - not one per motorcycle/assignment', async () => {
    await service.getOperationsCenter(owner, NOW);

    expect(prisma.client.motorcycle.count).toHaveBeenCalledTimes(1);
    expect(prisma.client.dailyAssignment.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.client.dailyPayment.aggregate).toHaveBeenCalledTimes(1);
    expect(prisma.client.ownershipPlan.count).toHaveBeenCalledTimes(1);
    // Once for due bikes, once for resolveOutstandingRows' registration
    // lookup - both fixed, neither scales with fleet size.
    expect(prisma.client.motorcycle.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.client.dailyPayment.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.client.assignmentAlert.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.client.documentAlert.findMany).toHaveBeenCalledTimes(1);
    expect(analytics.getSummary).toHaveBeenCalledTimes(1);
    expect(analytics.getPerMotorcycle).toHaveBeenCalledTimes(1);
    expect(analytics.getDailyCollectionSeries).toHaveBeenCalledTimes(1);
  });
});
