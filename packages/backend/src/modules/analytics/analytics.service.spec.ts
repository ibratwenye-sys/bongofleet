import { ForbiddenException } from '@nestjs/common';
import { PaymentStatus, Prisma, UserRole } from '@prisma/client';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';

function dec(n: number) {
  return new Prisma.Decimal(n);
}

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let prisma: {
    client: {
      dailyPayment: { aggregate: jest.Mock; findMany: jest.Mock; groupBy: jest.Mock };
      expense: { aggregate: jest.Mock; findMany: jest.Mock; groupBy: jest.Mock };
      maintenanceLog: { aggregate: jest.Mock; findMany: jest.Mock };
      motorcycle: { findMany: jest.Mock };
      rider: { findMany: jest.Mock };
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

  const rider: AuthenticatedUser = { ...owner, role: UserRole.RIDER };

  beforeEach(() => {
    prisma = {
      client: {
        dailyPayment: { aggregate: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
        expense: { aggregate: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
        maintenanceLog: { aggregate: jest.fn(), findMany: jest.fn() },
        motorcycle: { findMany: jest.fn() },
        rider: { findMany: jest.fn() },
      },
    };
    service = new AnalyticsService(prisma as unknown as PrismaService);
  });

  describe('getSummary', () => {
    it('rejects a rider', async () => {
      await expect(service.getSummary({}, rider)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('computes net profit = revenue - (expenses + maintenance)', async () => {
      prisma.client.dailyPayment.aggregate.mockResolvedValue({
        _sum: { amount: dec(150000) },
        _count: 12,
      });
      prisma.client.expense.aggregate.mockResolvedValue({
        _sum: { amount: dec(40000) },
        _count: 5,
      });
      prisma.client.maintenanceLog.aggregate.mockResolvedValue({
        _sum: { cost: dec(10000) },
        _count: 2,
      });

      const result = await service.getSummary({ from: '2026-07-01', to: '2026-07-31' }, owner);

      expect(result).toEqual({
        from: '2026-07-01',
        to: '2026-07-31',
        revenue: '150000.00',
        expenses: '50000.00',
        netProfit: '100000.00',
        paymentCount: 12,
        expenseCount: 7,
      });
    });

    it('treats missing sums as zero (empty period)', async () => {
      prisma.client.dailyPayment.aggregate.mockResolvedValue({ _sum: { amount: null }, _count: 0 });
      prisma.client.expense.aggregate.mockResolvedValue({ _sum: { amount: null }, _count: 0 });
      prisma.client.maintenanceLog.aggregate.mockResolvedValue({ _sum: { cost: null }, _count: 0 });

      const result = await service.getSummary({}, owner);

      expect(result.revenue).toBe('0.00');
      expect(result.expenses).toBe('0.00');
      expect(result.netProfit).toBe('0.00');
      expect(result.from).toBeNull();
    });

    it('only filters the revenue query on COMPLETED payments', async () => {
      prisma.client.dailyPayment.aggregate.mockResolvedValue({ _sum: { amount: null }, _count: 0 });
      prisma.client.expense.aggregate.mockResolvedValue({ _sum: { amount: null }, _count: 0 });
      prisma.client.maintenanceLog.aggregate.mockResolvedValue({ _sum: { cost: null }, _count: 0 });

      await service.getSummary({ from: '2026-07-01' }, owner);

      const where = prisma.client.dailyPayment.aggregate.mock.calls[0][0].where;
      expect(where.status).toBe(PaymentStatus.COMPLETED);
      expect(where.dailyAssignment.assignedDate.gte).toEqual(new Date('2026-07-01T00:00:00.000Z'));
    });
  });

  describe('getPerMotorcycle', () => {
    it('joins revenue and expenses per bike and sorts most profitable first', async () => {
      prisma.client.dailyPayment.findMany.mockResolvedValue([
        { amount: dec(8000), dailyAssignment: { motorcycleId: 'moto-1' } },
        { amount: dec(2000), dailyAssignment: { motorcycleId: 'moto-1' } },
        { amount: dec(3000), dailyAssignment: { motorcycleId: 'moto-2' } },
      ]);
      prisma.client.expense.findMany.mockResolvedValue([
        { amount: dec(1000), motorcycleId: 'moto-1' },
      ]);
      prisma.client.maintenanceLog.findMany.mockResolvedValue([
        { cost: dec(500), motorcycleId: 'moto-2' },
      ]);
      prisma.client.motorcycle.findMany.mockResolvedValue([
        { id: 'moto-1', registrationNumber: 'KDA-1' },
        { id: 'moto-2', registrationNumber: 'KDA-2' },
      ]);

      const rows = await service.getPerMotorcycle({}, owner);

      expect(rows).toEqual([
        {
          motorcycleId: 'moto-1',
          registrationNumber: 'KDA-1',
          revenue: '10000.00',
          expenses: '1000.00',
          netProfit: '9000.00',
        },
        {
          motorcycleId: 'moto-2',
          registrationNumber: 'KDA-2',
          revenue: '3000.00',
          expenses: '500.00',
          netProfit: '2500.00',
        },
      ]);
    });

    it('includes a bike that only has expenses (negative profit)', async () => {
      prisma.client.dailyPayment.findMany.mockResolvedValue([]);
      prisma.client.expense.findMany.mockResolvedValue([
        { amount: dec(2000), motorcycleId: 'moto-idle' },
      ]);
      prisma.client.maintenanceLog.findMany.mockResolvedValue([]);
      prisma.client.motorcycle.findMany.mockResolvedValue([
        { id: 'moto-idle', registrationNumber: 'KDA-IDLE' },
      ]);

      const rows = await service.getPerMotorcycle({}, owner);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        revenue: '0.00',
        expenses: '2000.00',
        netProfit: '-2000.00',
      });
    });

    it('returns an empty array when there is no activity', async () => {
      prisma.client.dailyPayment.findMany.mockResolvedValue([]);
      prisma.client.expense.findMany.mockResolvedValue([]);
      prisma.client.maintenanceLog.findMany.mockResolvedValue([]);

      expect(await service.getPerMotorcycle({}, owner)).toEqual([]);
      expect(prisma.client.motorcycle.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getPerRider', () => {
    it('sums completed payments per rider, names them, and sorts by revenue desc', async () => {
      prisma.client.dailyPayment.groupBy.mockResolvedValue([
        { riderId: 'rider-1', _sum: { amount: dec(5000) }, _count: 2 },
        { riderId: 'rider-2', _sum: { amount: dec(9000) }, _count: 3 },
      ]);
      prisma.client.rider.findMany.mockResolvedValue([
        { id: 'rider-1', user: { firstName: 'Ali', lastName: 'One' } },
        { id: 'rider-2', user: { firstName: 'Bea', lastName: 'Two' } },
      ]);

      const rows = await service.getPerRider({}, owner);

      expect(rows).toEqual([
        { riderId: 'rider-2', riderName: 'Bea Two', revenue: '9000.00', paymentCount: 3 },
        { riderId: 'rider-1', riderName: 'Ali One', revenue: '5000.00', paymentCount: 2 },
      ]);
    });
  });

  describe('getExpenseBreakdown', () => {
    it('groups expenses by category and appends maintenance, sorted by amount desc', async () => {
      prisma.client.expense.groupBy.mockResolvedValue([
        { category: 'Fuel', _sum: { amount: dec(30000) }, _count: 10 },
        { category: 'Repairs', _sum: { amount: dec(5000) }, _count: 2 },
      ]);
      prisma.client.maintenanceLog.aggregate.mockResolvedValue({
        _sum: { cost: dec(12000) },
        _count: 3,
      });

      const rows = await service.getExpenseBreakdown({}, owner);

      expect(rows).toEqual([
        { category: 'Fuel', amount: '30000.00', count: 10 },
        { category: 'Maintenance', amount: '12000.00', count: 3 },
        { category: 'Repairs', amount: '5000.00', count: 2 },
      ]);
    });

    it('omits the maintenance row when there are no maintenance logs', async () => {
      prisma.client.expense.groupBy.mockResolvedValue([
        { category: 'Fuel', _sum: { amount: dec(100) }, _count: 1 },
      ]);
      prisma.client.maintenanceLog.aggregate.mockResolvedValue({ _sum: { cost: null }, _count: 0 });

      const rows = await service.getExpenseBreakdown({}, owner);

      expect(rows).toEqual([{ category: 'Fuel', amount: '100.00', count: 1 }]);
    });
  });
});
