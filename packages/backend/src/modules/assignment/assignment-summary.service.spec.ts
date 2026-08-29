import { Prisma, UserRole } from '@prisma/client';
import { AssignmentSummaryService } from './assignment-summary.service';
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

describe('AssignmentSummaryService.getSummary', () => {
  let service: AssignmentSummaryService;
  let prisma: {
    client: {
      motorcycle: { findMany: jest.Mock };
      dailyAssignment: { findMany: jest.Mock };
      dailyPayment: { groupBy: jest.Mock };
    };
  };

  beforeEach(() => {
    prisma = {
      client: {
        motorcycle: { findMany: jest.fn() },
        dailyAssignment: { findMany: jest.fn() },
        dailyPayment: { groupBy: jest.fn() },
      },
    };

    prisma.client.motorcycle.findMany
      .mockResolvedValueOnce([
        { id: 'm1', status: 'ACTIVE', vehicleType: 'MOTORBIKE' },
        { id: 'm2', status: 'MAINTENANCE', vehicleType: 'MOTORBIKE' },
        { id: 'm3', status: 'ACTIVE', vehicleType: 'BAJAJI' },
      ])
      .mockResolvedValueOnce([
        // getIdleVehicles candidates: m3 has no assignment today.
        {
          id: 'm3',
          registrationNumber: 'T3',
          vehicleType: 'BAJAJI',
          operatingArea: null,
          createdAt: new Date('2026-08-10T00:00:00.000Z'),
        },
      ]);

    prisma.client.dailyAssignment.findMany
      .mockResolvedValueOnce([{ motorcycleId: 'm1' }, { motorcycleId: 'm2' }]) // today
      .mockResolvedValueOnce([
        { motorcycleId: 'm1', assignedDate: new Date('2026-08-25T00:00:00.000Z') },
      ]) // 14-day series
      .mockResolvedValueOnce([{ id: 'a1', motorcycleId: 'm1', targetAmount: dec(12000) }]) // this month
      .mockResolvedValueOnce([]); // getIdleVehicles' last-assignment lookup for m3

    prisma.client.dailyPayment.groupBy.mockResolvedValue([
      { dailyAssignmentId: 'a1', _sum: { amount: dec(12000) } },
    ]);

    service = new AssignmentSummaryService(prisma as unknown as PrismaService);
  });

  it('rejects a rider', async () => {
    const rider: AuthenticatedUser = { ...owner, role: UserRole.RIDER };
    await expect(service.getSummary(rider, NOW)).rejects.toThrow(
      'Only OWNER or MANAGER may view the assignments summary',
    );
  });

  it('splits today into moving vs assigned-in-workshop by vehicle status', async () => {
    const result = await service.getSummary(owner, NOW);
    expect(result.kpis.assignedToday.count).toBe(2);
    expect(result.kpis.movingToday.count).toBe(1);
    expect(result.kpis.assignedInWorkshopToday.count).toBe(1);
    expect(result.kpis.inStockToday.count).toBe(1);
  });

  it('classifies this month by whether any payment was recorded', async () => {
    const result = await service.getSummary(owner, NOW);
    expect(result.thisMonth.created).toBe(1);
    expect(result.thisMonth.endedWithPayment).toBe(1);
    expect(result.thisMonth.endedWithNothing).toBe(0);
  });

  it('the daily stock series has exactly 14 points, oldest first', async () => {
    const result = await service.getSummary(owner, NOW);
    expect(result.dailyStockSeries).toHaveLength(14);
    expect(result.dailyStockSeries[13].date).toBe('2026-08-25');
  });

  it('runs a fixed, small number of queries', async () => {
    await service.getSummary(owner, NOW);
    expect(prisma.client.motorcycle.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.client.dailyAssignment.findMany).toHaveBeenCalledTimes(4);
    expect(prisma.client.dailyPayment.groupBy).toHaveBeenCalledTimes(1);
  });
});
