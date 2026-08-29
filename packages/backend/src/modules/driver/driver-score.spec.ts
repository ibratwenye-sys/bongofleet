import { ConfigService } from '@nestjs/config';
import { MaintenanceReminderKind, OwnershipPlanStatus, Prisma, UserRole } from '@prisma/client';
import {
  bandForDisplayScore,
  carePoints,
  contractPoints,
  DriverScoreService,
  reliabilityPoints,
  rescaleToDisplayScore,
} from './driver-score';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';

function dec(n: number) {
  return new Prisma.Decimal(n);
}

const NOW = new Date('2026-08-25T10:00:00.000Z'); // 13:00 Dar es Salaam - safely today

const owner: AuthenticatedUser = {
  userId: 'user-owner',
  tenantId: 'tenant-1',
  role: UserRole.OWNER,
  email: 'owner@example.com',
  firstName: 'O',
  lastName: 'Wner',
  jti: 'jti-owner',
};

describe('reliabilityPoints', () => {
  it('is null (excluded, not zero) when the driver has no assignment history', () => {
    expect(reliabilityPoints(0, 0)).toBeNull();
  });

  it('rounds the rate onto 50 points for a perfect record', () => {
    expect(reliabilityPoints(180, 180)).toBe(50);
  });

  it('rounds a partial rate', () => {
    expect(reliabilityPoints(146, 180)).toBe(41); // 146/180*50 = 40.55... -> 41
  });
});

describe('contractPoints', () => {
  it('gives full marks when the driver has no plan at all - nothing to breach', () => {
    expect(
      contractPoints({
        hasPlan: false,
        defaulted: false,
        consecutiveMissedDays: 99,
        breachAfterConsecutiveMissedDays: 5,
      }),
    ).toBe(20);
  });

  it('is 0 for a DEFAULTED plan regardless of the current streak', () => {
    expect(
      contractPoints({
        hasPlan: true,
        defaulted: true,
        consecutiveMissedDays: 0,
        breachAfterConsecutiveMissedDays: 5,
      }),
    ).toBe(0);
  });

  it('scales down toward the breach threshold and floors at 0', () => {
    expect(
      contractPoints({
        hasPlan: true,
        defaulted: false,
        consecutiveMissedDays: 0,
        breachAfterConsecutiveMissedDays: 5,
      }),
    ).toBe(20);
    expect(
      contractPoints({
        hasPlan: true,
        defaulted: false,
        consecutiveMissedDays: 5,
        breachAfterConsecutiveMissedDays: 5,
      }),
    ).toBe(0);
    expect(
      contractPoints({
        hasPlan: true,
        defaulted: false,
        consecutiveMissedDays: 10, // past the threshold - still floored, not negative
        breachAfterConsecutiveMissedDays: 5,
      }),
    ).toBe(0);
  });
});

describe('carePoints', () => {
  it('gives full marks when nothing is due, and when there is no assignment today (null passed by caller)', () => {
    expect(carePoints(null)).toBe(20);
  });

  it('is 12 for DUE_SOON and 0 for OVERDUE', () => {
    expect(carePoints(MaintenanceReminderKind.DUE_SOON)).toBe(12);
    expect(carePoints(MaintenanceReminderKind.OVERDUE)).toBe(0);
  });
});

describe('rescaleToDisplayScore', () => {
  it('rescales the full 90 raw points onto 100 display', () => {
    expect(rescaleToDisplayScore(90)).toBe(100);
  });

  it('rescales partial-point cases', () => {
    expect(rescaleToDisplayScore(0)).toBe(0);
    expect(rescaleToDisplayScore(34)).toBe(38); // 34/90*100 = 37.77... -> 38
    expect(rescaleToDisplayScore(77)).toBe(86); // 77/90*100 = 85.55... -> 86
  });
});

describe('bandForDisplayScore', () => {
  it('matches the mockup cut points exactly', () => {
    expect(bandForDisplayScore(85)).toBe('Excellent');
    expect(bandForDisplayScore(84)).toBe('Good');
    expect(bandForDisplayScore(70)).toBe('Good');
    expect(bandForDisplayScore(69)).toBe('Fair');
    expect(bandForDisplayScore(55)).toBe('Fair');
    expect(bandForDisplayScore(54)).toBe('Watch');
    expect(bandForDisplayScore(40)).toBe('Watch');
    expect(bandForDisplayScore(39)).toBe('At risk');
    expect(bandForDisplayScore(0)).toBe('At risk');
  });
});

describe('DriverScoreService.scoreDrivers', () => {
  let service: DriverScoreService;
  let prisma: {
    client: {
      driver: { findMany: jest.Mock };
      dailyAssignment: { findMany: jest.Mock };
      ownershipPlan: { findMany: jest.Mock };
      dailyPayment: { findMany: jest.Mock };
      dayExcusal: { findMany: jest.Mock };
      motorcycle: { findMany: jest.Mock };
    };
  };
  let config: { get: jest.Mock };

  beforeEach(() => {
    prisma = {
      client: {
        driver: { findMany: jest.fn() },
        dailyAssignment: { findMany: jest.fn() },
        ownershipPlan: { findMany: jest.fn() },
        dailyPayment: { findMany: jest.fn() },
        dayExcusal: { findMany: jest.fn() },
        motorcycle: { findMany: jest.fn() },
      },
    };
    config = { get: jest.fn((_key: string, fallback?: unknown) => fallback) };
    service = new DriverScoreService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );
  });

  it('excludes a driver with no assignment history from the scored list, but keeps them in totalActiveDrivers', async () => {
    prisma.client.driver.findMany.mockResolvedValue([
      { id: 'd1', driverType: 'RIDER', user: { firstName: 'A', lastName: 'A' } },
      { id: 'd2', driverType: 'RIDER', user: { firstName: 'B', lastName: 'B' } },
    ]);
    prisma.client.dailyAssignment.findMany.mockResolvedValue([
      {
        id: 'a1',
        driverId: 'd2',
        assignedDate: new Date('2026-08-24T00:00:00.000Z'),
        targetAmount: dec(12000),
        ownershipPlanId: null,
        motorcycleId: 'm1',
      },
    ]);
    prisma.client.ownershipPlan.findMany.mockResolvedValue([]);
    prisma.client.dailyPayment.findMany.mockResolvedValue([
      { dailyAssignmentId: 'a1', amount: dec(12000), paidAt: new Date('2026-08-24T05:00:00.000Z') },
    ]);
    prisma.client.dayExcusal.findMany.mockResolvedValue([]);
    prisma.client.motorcycle.findMany.mockResolvedValue([
      { id: 'm1', registrationNumber: 'T1', currentMileage: 100, maintenanceLogs: [] },
    ]);

    const result = await service.scoreDrivers(owner, NOW);
    expect(result.totalActiveDrivers).toBe(2);
    expect(result.scores.map((s) => s.driverId)).toEqual(['d2']);
  });

  it('a driver with a full perfect history and no plan lands in Excellent (contract defaults to full marks, documented)', async () => {
    prisma.client.driver.findMany.mockResolvedValue([
      { id: 'd1', driverType: 'RIDER', user: { firstName: 'Neema', lastName: 'Joseph' } },
    ]);
    const assignments = Array.from({ length: 10 }, (_, i) => ({
      id: `a${i}`,
      driverId: 'd1',
      assignedDate: new Date(`2026-08-${10 + i}T00:00:00.000Z`),
      targetAmount: dec(12000),
      ownershipPlanId: null,
      motorcycleId: 'm1',
    }));
    prisma.client.dailyAssignment.findMany.mockResolvedValue(assignments);
    prisma.client.ownershipPlan.findMany.mockResolvedValue([]);
    prisma.client.dailyPayment.findMany.mockResolvedValue(
      assignments.map((a) => ({
        dailyAssignmentId: a.id,
        amount: dec(12000),
        paidAt: a.assignedDate,
      })),
    );
    prisma.client.dayExcusal.findMany.mockResolvedValue([]);
    prisma.client.motorcycle.findMany.mockResolvedValue([
      { id: 'm1', registrationNumber: 'T1', currentMileage: 100, maintenanceLogs: [] },
    ]);

    const result = await service.scoreDrivers(owner, NOW);
    expect(result.scores).toHaveLength(1);
    const score = result.scores[0];
    expect(score.components.reliability.points).toBe(50);
    expect(score.components.contract.points).toBe(20);
    expect(score.components.contract.hasPlan).toBe(false);
    expect(score.components.care.points).toBe(20);
    expect(score.raw).toBe(90);
    expect(score.display).toBe(100);
    expect(score.band).toBe('Excellent');
  });

  it('a DEFAULTED plan scores 0 contract points', async () => {
    prisma.client.driver.findMany.mockResolvedValue([
      { id: 'd1', driverType: 'RIDER', user: { firstName: 'A', lastName: 'A' } },
    ]);
    prisma.client.dailyAssignment.findMany.mockResolvedValue([
      {
        id: 'a1',
        driverId: 'd1',
        assignedDate: new Date('2026-08-24T00:00:00.000Z'),
        targetAmount: dec(12000),
        ownershipPlanId: 'plan-1',
        motorcycleId: 'm1',
      },
    ]);
    prisma.client.ownershipPlan.findMany.mockResolvedValue([
      {
        id: 'plan-1',
        driverId: 'd1',
        status: OwnershipPlanStatus.DEFAULTED,
        dailyAmount: dec(12000),
        breachAfterConsecutiveMissedDays: 5,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    prisma.client.dailyPayment.findMany.mockResolvedValue([]);
    prisma.client.dayExcusal.findMany.mockResolvedValue([]);
    prisma.client.motorcycle.findMany.mockResolvedValue([
      { id: 'm1', registrationNumber: 'T1', currentMileage: 100, maintenanceLogs: [] },
    ]);

    const result = await service.scoreDrivers(owner, NOW);
    expect(result.scores[0].components.contract.points).toBe(0);
    expect(result.scores[0].components.contract.defaulted).toBe(true);
  });

  it('rejects a rider/mechanic caller', async () => {
    const rider: AuthenticatedUser = { ...owner, role: UserRole.RIDER };
    await expect(service.scoreDrivers(rider, NOW)).rejects.toThrow(
      'Only OWNER or MANAGER may view driver scores',
    );
  });
});
