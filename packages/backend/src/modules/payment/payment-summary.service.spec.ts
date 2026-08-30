import { ForbiddenException } from '@nestjs/common';
import { PaymentStatus, Prisma, UserRole } from '@prisma/client';
import { PaymentSummaryService } from './payment-summary.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';

function dec(n: number) {
  return new Prisma.Decimal(n);
}

// 10:00Z is 13:00 in Africa/Dar_es_Salaam (UTC+3) - safely inside the same
// local calendar day, so "today" below is unambiguous.
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
const driver: AuthenticatedUser = { ...owner, role: UserRole.RIDER };

describe('PaymentSummaryService', () => {
  let service: PaymentSummaryService;
  let prisma: {
    client: {
      dailyAssignment: { findMany: jest.Mock; aggregate: jest.Mock };
      dailyPayment: { aggregate: jest.Mock; groupBy: jest.Mock; findMany: jest.Mock };
      driver: { findMany: jest.Mock };
    };
  };

  beforeEach(() => {
    prisma = {
      client: {
        dailyAssignment: { findMany: jest.fn(), aggregate: jest.fn() },
        dailyPayment: { aggregate: jest.fn(), groupBy: jest.fn(), findMany: jest.fn() },
        driver: { findMany: jest.fn() },
      },
    };
    service = new PaymentSummaryService(prisma as unknown as PrismaService);
  });

  describe('getSummary', () => {
    beforeEach(() => {
      // getDailyCollectionStatus's own two queries.
      prisma.client.dailyAssignment.findMany.mockResolvedValue([
        { id: 'a1', motorcycleId: 'moto-1', targetAmount: dec(12000) },
        { id: 'a2', motorcycleId: 'moto-2', targetAmount: dec(15000) },
      ]);
      prisma.client.dailyPayment.aggregate.mockResolvedValueOnce({ _sum: { amount: dec(20000) } }); // receivedToday
      prisma.client.dailyPayment.groupBy.mockResolvedValue([
        { dailyAssignmentId: 'a1', _sum: { amount: dec(12000) } },
      ]);
      // dueThisMonth aggregate (dailyAssignment) and receivedThisMonth
      // aggregate (dailyPayment's SECOND call - the first was receivedToday
      // above, inside getDailyCollectionStatus).
      prisma.client.dailyAssignment.aggregate.mockResolvedValue({
        _sum: { targetAmount: dec(300000) },
      });
      prisma.client.dailyPayment.aggregate.mockResolvedValueOnce({
        _sum: { amount: dec(250000) },
      });
    });

    it('rejects a driver', async () => {
      await expect(service.getSummary(driver, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('reuses getDailyCollectionStatus for dueToday/receivedToday/stillOutstanding, and computes dueThisMonth/receivedThisMonth separately', async () => {
      const result = await service.getSummary(owner, NOW);

      expect(result.kpis).toEqual({
        dueToday: '27000.00', // 12000 + 15000, from getDailyCollectionStatus
        receivedToday: '20000.00',
        // a1 is fully paid (target 12000, groupBy shows 12000 paid) so it's
        // not outstanding; a2 has no completed payment at all, so its full
        // 15000 target is outstanding.
        stillOutstanding: { count: 1, amount: '15000.00' },
        dueThisMonth: '300000.00',
        receivedThisMonth: '250000.00',
      });
    });

    it('scopes the this-month queries to [1st of this month, tomorrow)', async () => {
      await service.getSummary(owner, NOW);

      const assignmentWhere = prisma.client.dailyAssignment.aggregate.mock.calls[0][0].where;
      expect(assignmentWhere.assignedDate.gte).toEqual(new Date('2026-08-01T00:00:00.000Z'));
      expect(assignmentWhere.assignedDate.lt).toEqual(new Date('2026-08-26T00:00:00.000Z'));

      // dailyPayment.aggregate: call 0 is getDailyCollectionStatus's own
      // "today" aggregate, call 1 is receivedThisMonth.
      const paymentWhere = prisma.client.dailyPayment.aggregate.mock.calls[1][0].where;
      expect(paymentWhere.status).toBe(PaymentStatus.COMPLETED);
      expect(paymentWhere.paidAt.gte).toEqual(new Date('2026-08-01T00:00:00.000Z'));
      expect(paymentWhere.paidAt.lt).toEqual(new Date('2026-08-26T00:00:00.000Z'));
    });
  });

  describe('getMethodBreakdown', () => {
    it('rejects a driver', async () => {
      await expect(service.getMethodBreakdown(undefined, undefined, driver)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('groups by method (null -> UNSPECIFIED), counting PENDING separately, sorted by amount desc', async () => {
      prisma.client.dailyPayment.findMany.mockResolvedValue([
        { paymentMethod: 'CASH', amount: dec(10000), status: PaymentStatus.COMPLETED },
        { paymentMethod: 'CASH', amount: dec(5000), status: PaymentStatus.PENDING },
        { paymentMethod: 'MOBILE_MONEY', amount: dec(30000), status: PaymentStatus.COMPLETED },
        { paymentMethod: 'MOBILE_MONEY', amount: dec(8000), status: PaymentStatus.PENDING },
        { paymentMethod: 'MOBILE_MONEY', amount: dec(2000), status: PaymentStatus.PENDING },
        { paymentMethod: null, amount: dec(1000), status: PaymentStatus.FAILED },
      ]);

      const rows = await service.getMethodBreakdown('2026-08-01', '2026-08-31', owner);

      expect(rows).toEqual([
        {
          method: 'MOBILE_MONEY',
          count: 3,
          amount: '40000.00', // 30000 + 8000 + 2000
          pendingCount: 2,
          pendingAmount: '10000.00', // 8000 + 2000
        },
        {
          method: 'CASH',
          count: 2,
          amount: '15000.00',
          pendingCount: 1,
          pendingAmount: '5000.00',
        },
        {
          method: 'UNSPECIFIED',
          count: 1,
          amount: '1000.00',
          pendingCount: 0, // FAILED, not PENDING - never counted as pending
          pendingAmount: '0.00',
        },
      ]);
    });

    it('returns an empty array when there are no payments in range', async () => {
      prisma.client.dailyPayment.findMany.mockResolvedValue([]);
      expect(await service.getMethodBreakdown('2026-08-01', '2026-08-31', owner)).toEqual([]);
    });
  });

  describe('getOldestPending', () => {
    it('rejects a driver', async () => {
      await expect(service.getOldestPending(8, driver)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('orders PENDING payments oldest-first and resolves real driver names in one batched query', async () => {
      prisma.client.dailyPayment.findMany.mockResolvedValue([
        {
          id: 'p1',
          driverId: 'driver-1',
          amount: dec(12000),
          paymentMethod: 'CASH',
          createdAt: new Date('2026-08-01T08:00:00.000Z'),
        },
        {
          id: 'p2',
          driverId: 'driver-2',
          amount: dec(9000),
          paymentMethod: null,
          createdAt: new Date('2026-08-02T08:00:00.000Z'),
        },
      ]);
      prisma.client.driver.findMany.mockResolvedValue([
        { id: 'driver-1', user: { firstName: 'Ali', lastName: 'One' } },
        { id: 'driver-2', user: { firstName: 'Bea', lastName: 'Two' } },
      ]);

      const rows = await service.getOldestPending(8, owner);

      expect(rows).toEqual([
        {
          paymentId: 'p1',
          driverName: 'Ali One',
          amount: '12000.00',
          method: 'CASH',
          createdAt: '2026-08-01T08:00:00.000Z',
        },
        {
          paymentId: 'p2',
          driverName: 'Bea Two',
          amount: '9000.00',
          method: 'UNSPECIFIED',
          createdAt: '2026-08-02T08:00:00.000Z',
        },
      ]);

      const findManyArgs = prisma.client.dailyPayment.findMany.mock.calls[0][0];
      expect(findManyArgs.where.status).toBe(PaymentStatus.PENDING);
      expect(findManyArgs.orderBy).toEqual({ createdAt: 'asc' });
      expect(findManyArgs.take).toBe(8);
    });

    it('skips the driver lookup entirely when there is nothing pending', async () => {
      prisma.client.dailyPayment.findMany.mockResolvedValue([]);
      expect(await service.getOldestPending(8, owner)).toEqual([]);
      expect(prisma.client.driver.findMany).not.toHaveBeenCalled();
    });
  });
});
