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
      transportJob: { aggregate: jest.Mock; findMany: jest.Mock };
      expense: { aggregate: jest.Mock; findMany: jest.Mock; groupBy: jest.Mock };
      maintenanceLog: { aggregate: jest.Mock; findMany: jest.Mock };
      motorcycle: { findMany: jest.Mock; count: jest.Mock };
      driver: { findMany: jest.Mock };
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

  const driver: AuthenticatedUser = { ...owner, role: UserRole.RIDER };

  beforeEach(() => {
    prisma = {
      client: {
        dailyPayment: { aggregate: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
        transportJob: { aggregate: jest.fn(), findMany: jest.fn() },
        expense: { aggregate: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
        maintenanceLog: { aggregate: jest.fn(), findMany: jest.fn() },
        motorcycle: { findMany: jest.fn(), count: jest.fn() },
        driver: { findMany: jest.fn() },
      },
    };
    // Sensible transport defaults; individual tests override.
    prisma.client.transportJob.aggregate.mockResolvedValue({ _sum: { revenue: null }, _count: 0 });
    prisma.client.transportJob.findMany.mockResolvedValue([]);
    service = new AnalyticsService(prisma as unknown as PrismaService);
  });

  describe('getSummary', () => {
    it('rejects a driver', async () => {
      await expect(service.getSummary({}, driver)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('combines rental + transport revenue, minus expenses + maintenance', async () => {
      prisma.client.dailyPayment.aggregate.mockResolvedValue({
        _sum: { amount: dec(150000) },
        _count: 12,
      });
      prisma.client.transportJob.aggregate.mockResolvedValue({
        _sum: { revenue: dec(50000) },
        _count: 2,
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
        vehicleType: null,
        revenue: '200000.00',
        rentalRevenue: '150000.00',
        transportRevenue: '50000.00',
        expenses: '50000.00',
        netProfit: '150000.00',
        paymentCount: 12,
        transportJobCount: 2,
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
        { id: 'moto-1', registrationNumber: 'KDA-1', vehicleType: 'MOTORBIKE' },
        { id: 'moto-2', registrationNumber: 'KDA-2', vehicleType: 'BAJAJI' },
      ]);

      const rows = await service.getPerMotorcycle({}, owner);

      expect(rows).toEqual([
        {
          motorcycleId: 'moto-1',
          registrationNumber: 'KDA-1',
          vehicleType: 'MOTORBIKE',
          revenue: '10000.00',
          expenses: '1000.00',
          netProfit: '9000.00',
        },
        {
          motorcycleId: 'moto-2',
          registrationNumber: 'KDA-2',
          vehicleType: 'BAJAJI',
          revenue: '3000.00',
          expenses: '500.00',
          netProfit: '2500.00',
        },
      ]);
    });

    it('folds transport-job revenue into a vehicle P&L', async () => {
      prisma.client.dailyPayment.findMany.mockResolvedValue([]);
      prisma.client.transportJob.findMany.mockResolvedValue([
        { revenue: dec(500000), motorcycleId: 'truck-1' },
        { revenue: dec(300000), motorcycleId: 'truck-1' },
      ]);
      prisma.client.expense.findMany.mockResolvedValue([
        { amount: dec(200000), motorcycleId: 'truck-1' },
      ]);
      prisma.client.maintenanceLog.findMany.mockResolvedValue([]);
      prisma.client.motorcycle.findMany.mockResolvedValue([
        { id: 'truck-1', registrationNumber: 'T-1', vehicleType: 'TRUCK' },
      ]);

      const rows = await service.getPerMotorcycle({ vehicleType: 'TRUCK' }, owner);

      expect(rows[0]).toEqual({
        motorcycleId: 'truck-1',
        registrationNumber: 'T-1',
        vehicleType: 'TRUCK',
        revenue: '800000.00',
        expenses: '200000.00',
        netProfit: '600000.00',
      });
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

  describe('getPerDriver', () => {
    it('sums completed payments per driver, names them, and sorts by revenue desc', async () => {
      prisma.client.dailyPayment.groupBy.mockResolvedValue([
        { driverId: 'driver-1', _sum: { amount: dec(5000) }, _count: 2 },
        { driverId: 'driver-2', _sum: { amount: dec(9000) }, _count: 3 },
      ]);
      prisma.client.driver.findMany.mockResolvedValue([
        { id: 'driver-1', user: { firstName: 'Ali', lastName: 'One' } },
        { id: 'driver-2', user: { firstName: 'Bea', lastName: 'Two' } },
      ]);

      const rows = await service.getPerDriver({}, owner);

      expect(rows).toEqual([
        { driverId: 'driver-2', driverName: 'Bea Two', revenue: '9000.00', paymentCount: 3 },
        { driverId: 'driver-1', driverName: 'Ali One', revenue: '5000.00', paymentCount: 2 },
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

  describe('getDailyCollectionSeries', () => {
    it('buckets COMPLETED payments by their assignment date, one point per day including zero-amount days', async () => {
      prisma.client.dailyPayment.findMany.mockResolvedValue([
        {
          amount: dec(5000),
          dailyAssignment: { assignedDate: new Date('2026-08-01T00:00:00.000Z') },
        },
        {
          amount: dec(3000),
          dailyAssignment: { assignedDate: new Date('2026-08-01T00:00:00.000Z') },
        },
        {
          amount: dec(7000),
          dailyAssignment: { assignedDate: new Date('2026-08-03T00:00:00.000Z') },
        },
      ]);

      const points = await service.getDailyCollectionSeries('2026-08-01', '2026-08-03', owner);

      expect(points).toEqual([
        { date: '2026-08-01', amount: '8000.00' },
        { date: '2026-08-02', amount: '0.00' }, // no payments that day - still a point, not a gap
        { date: '2026-08-03', amount: '7000.00' },
      ]);
    });

    it('rejects a driver, same as every other analytics method', async () => {
      await expect(
        service.getDailyCollectionSeries('2026-08-01', '2026-08-01', driver),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('a single-day range still returns exactly one point', async () => {
      prisma.client.dailyPayment.findMany.mockResolvedValue([]);
      const points = await service.getDailyCollectionSeries('2026-08-05', '2026-08-05', owner);
      expect(points).toEqual([{ date: '2026-08-05', amount: '0.00' }]);
    });
  });

  describe('getPnlBySegment', () => {
    // Per-type rental revenue/expenses (hand-picked, all distinct so a mixed-up
    // row would fail loudly); transport revenue stays at the beforeEach default
    // (0) throughout so only one revenue stream needs mocking here.
    const RENTAL: Record<string, number> = {
      MOTORBIKE: 100000,
      BAJAJI: 20000,
      CAR: 9000,
      TRUCK: 0,
    };
    const EXPENSES: Record<string, number> = {
      MOTORBIKE: 40000,
      BAJAJI: 5000,
      CAR: 3000,
      TRUCK: 0,
    };
    const COUNTS: Record<string, number> = { MOTORBIKE: 10, BAJAJI: 2, CAR: 1, TRUCK: 1 };
    // Deliberately NOT the sum of the four rows above (129000 / 48000) - if
    // the implementation ever "fixed" the totals row by summing the four
    // already-rounded segment strings client-side instead of calling
    // getSummary(query) a fifth time with no vehicleType filter, this test
    // would catch it: the sum and this fixture disagree on purpose.
    const TOTAL_RENTAL = 999000;
    const TOTAL_EXPENSES = 333000;

    beforeEach(() => {
      prisma.client.dailyPayment.aggregate.mockImplementation(
        async ({
          where,
        }: {
          where?: { dailyAssignment?: { motorcycle?: { vehicleType?: string } } };
        }) => {
          const vt = where?.dailyAssignment?.motorcycle?.vehicleType;
          return { _sum: { amount: dec(vt ? RENTAL[vt] : TOTAL_RENTAL) }, _count: 1 };
        },
      );
      prisma.client.expense.aggregate.mockImplementation(
        async ({ where }: { where?: { motorcycle?: { vehicleType?: string } } }) => {
          const vt = where?.motorcycle?.vehicleType;
          return { _sum: { amount: dec(vt ? EXPENSES[vt] : TOTAL_EXPENSES) }, _count: 1 };
        },
      );
      prisma.client.maintenanceLog.aggregate.mockResolvedValue({ _sum: { cost: null }, _count: 0 });
      prisma.client.motorcycle.count.mockImplementation(
        async ({ where }: { where: { vehicleType: string } }) => COUNTS[where.vehicleType] ?? 0,
      );
    });

    it('rejects a driver', async () => {
      await expect(service.getPnlBySegment({}, driver)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('computes vehicleCount, revenue/expenses/netProfit (reusing getSummary), netProfitPerVehicle, and marginPct per segment, plus a real (not summed) totals row', async () => {
      const rows = await service.getPnlBySegment({}, owner);

      expect(rows).toEqual([
        {
          vehicleType: 'MOTORBIKE',
          vehicleCount: 10,
          revenue: '100000.00',
          expenses: '40000.00',
          netProfit: '60000.00',
          netProfitPerVehicle: '6000.00',
          marginPct: 60, // round(60000/100000*100)
        },
        {
          vehicleType: 'BAJAJI',
          vehicleCount: 2,
          revenue: '20000.00',
          expenses: '5000.00',
          netProfit: '15000.00',
          netProfitPerVehicle: '7500.00',
          marginPct: 75,
        },
        {
          vehicleType: 'CAR',
          vehicleCount: 1,
          revenue: '9000.00',
          expenses: '3000.00',
          netProfit: '6000.00',
          netProfitPerVehicle: '6000.00',
          marginPct: 67, // round(6000/9000*100) = round(66.67)
        },
        {
          vehicleType: 'TRUCK',
          vehicleCount: 1,
          revenue: '0.00',
          expenses: '0.00',
          netProfit: '0.00',
          netProfitPerVehicle: '0.00',
          marginPct: 0, // revenue is 0, not > 0 - never a divide-by-zero margin
        },
        {
          vehicleType: 'TOTAL',
          vehicleCount: 14, // 10 + 2 + 1 + 1, a plain integer sum
          revenue: '999000.00', // from the distinct no-vehicleType getSummary call
          expenses: '333000.00',
          netProfit: '666000.00',
          netProfitPerVehicle: '47571.43', // 666000 / 14, rounded to 2dp
          marginPct: 67, // round(666000/999000*100) = round(66.67)
        },
      ]);
    });

    it('a vehicle type with zero active vehicles gets netProfitPerVehicle 0.00, not a division error', async () => {
      prisma.client.motorcycle.count.mockResolvedValue(0);
      const rows = await service.getPnlBySegment({}, owner);
      for (const row of rows.filter((r) => r.vehicleType !== 'TOTAL')) {
        expect(row.vehicleCount).toBe(0);
        expect(row.netProfitPerVehicle).toBe('0.00');
      }
    });
  });

  describe('getMonthlyPnlSeries', () => {
    const NOW = new Date('2026-08-15T00:00:00.000Z');

    it('rejects a driver', async () => {
      await expect(service.getMonthlyPnlSeries(3, {}, driver, NOW)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('buckets rental + transport revenue and expense + maintenance cost by calendar month, oldest first, gaps included', async () => {
      // 3 months back from August 2026 = June, July, August. No activity in
      // July at all - it must still appear as a zero point, not be skipped.
      prisma.client.dailyPayment.findMany.mockResolvedValue([
        {
          amount: dec(10000),
          dailyAssignment: { assignedDate: new Date('2026-06-10T00:00:00.000Z') },
        },
        {
          amount: dec(4000),
          dailyAssignment: { assignedDate: new Date('2026-08-02T00:00:00.000Z') },
        },
      ]);
      prisma.client.transportJob.findMany.mockResolvedValue([
        { revenue: dec(50000), scheduledDate: new Date('2026-08-05T00:00:00.000Z') },
      ]);
      prisma.client.expense.findMany.mockResolvedValue([
        { amount: dec(3000), incurredAt: new Date('2026-06-20T00:00:00.000Z') },
      ]);
      prisma.client.maintenanceLog.findMany.mockResolvedValue([
        { cost: dec(1000), performedAt: new Date('2026-08-10T00:00:00.000Z') },
      ]);

      const points = await service.getMonthlyPnlSeries(3, {}, owner, NOW);

      expect(points).toEqual([
        { month: '2026-06', revenue: '10000.00', expenses: '3000.00', netProfit: '7000.00' },
        { month: '2026-07', revenue: '0.00', expenses: '0.00', netProfit: '0.00' },
        { month: '2026-08', revenue: '54000.00', expenses: '1000.00', netProfit: '53000.00' },
      ]);
    });

    it('queries the [monthsBack-1 months ago, today] window, inclusive of the current partial month', async () => {
      prisma.client.dailyPayment.findMany.mockResolvedValue([]);
      prisma.client.transportJob.findMany.mockResolvedValue([]);
      prisma.client.expense.findMany.mockResolvedValue([]);
      prisma.client.maintenanceLog.findMany.mockResolvedValue([]);

      await service.getMonthlyPnlSeries(2, {}, owner, NOW);

      const where = prisma.client.dailyPayment.findMany.mock.calls[0][0].where;
      expect(where.dailyAssignment.assignedDate.gte).toEqual(new Date('2026-07-01T00:00:00.000Z'));
      expect(where.dailyAssignment.assignedDate.lt).toEqual(new Date('2026-08-16T00:00:00.000Z'));
    });
  });
});
