import { ForbiddenException } from '@nestjs/common';
import { Prisma, UserRole, VehicleType } from '@prisma/client';
import { ExpenseSummaryService } from './expense-summary.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { ExpenseService } from './expense.service';
import { AuthenticatedUser } from '../auth/auth.types';

function dec(n: number) {
  return new Prisma.Decimal(n);
}

// 10:00Z is 13:00 in Africa/Dar_es_Salaam - safely inside August 2026.
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

describe('ExpenseSummaryService', () => {
  let service: ExpenseSummaryService;
  let prisma: {
    client: {
      motorcycle: { count: jest.Mock; findMany: jest.Mock };
      expense: { findMany: jest.Mock };
      maintenanceLog: { findMany: jest.Mock };
    };
  };
  let analytics: { getSummary: jest.Mock; getExpenseBreakdown: jest.Mock };
  let expenseService: { pendingCount: jest.Mock };

  beforeEach(() => {
    prisma = {
      client: {
        motorcycle: { count: jest.fn(), findMany: jest.fn() },
        expense: { findMany: jest.fn() },
        maintenanceLog: { findMany: jest.fn() },
      },
    };
    analytics = { getSummary: jest.fn(), getExpenseBreakdown: jest.fn() };
    expenseService = { pendingCount: jest.fn() };
    service = new ExpenseSummaryService(
      prisma as unknown as PrismaService,
      analytics as unknown as AnalyticsService,
      expenseService as unknown as ExpenseService,
    );
  });

  describe('getKpis', () => {
    beforeEach(() => {
      analytics.getSummary.mockResolvedValue({ expenses: '150000.00' });
      analytics.getExpenseBreakdown.mockResolvedValue([
        { category: 'Fuel', amount: '80000.00', count: 10 },
        { category: 'Repairs', amount: '30000.00', count: 3 },
        { category: 'Spare parts', amount: '40000.00', count: 2 },
      ]);
      expenseService.pendingCount.mockResolvedValue({ count: 4 });
      prisma.client.motorcycle.count.mockResolvedValue(10);
      jest.spyOn(service, 'getVehicleAnomalies').mockResolvedValue([
        {
          motorcycleId: 'm1',
          registrationNumber: 'R1',
          vehicleType: VehicleType.MOTORBIKE,
          currentPeriodCost: '100000.00',
          trailing3MoAvg: '50000.00',
          changePct: 100,
          pattern: 'Fuel',
        },
      ]);
    });

    it('rejects a driver', async () => {
      await expect(service.getKpis(driver, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('reuses getSummary/getExpenseBreakdown/pendingCount, and derives costPerVehicle and recurringOffendersCount from them', async () => {
      const result = await service.getKpis(owner, NOW);

      expect(result.kpis).toEqual({
        spentThisMonth: '150000.00',
        fuelThisMonth: '80000.00',
        repairsThisMonth: '30000.00',
        recurringOffendersCount: 1, // .length of the (mocked) anomalies list
        claimsAwaitingApproval: 4,
        costPerVehicle: '15000.00', // 150000 / 10
      });
    });

    it('reads 0.00 for fuel/repairs when that exact category never appears in the breakdown (free-text limitation, not a bug)', async () => {
      analytics.getExpenseBreakdown.mockResolvedValue([
        { category: 'petrol', amount: '80000.00', count: 10 }, // typo'd variant, not "Fuel"
      ]);
      const result = await service.getKpis(owner, NOW);
      expect(result.kpis.fuelThisMonth).toBe('0.00');
      expect(result.kpis.repairsThisMonth).toBe('0.00');
    });

    it('costPerVehicle is 0.00, not a division error, when the fleet is empty', async () => {
      prisma.client.motorcycle.count.mockResolvedValue(0);
      const result = await service.getKpis(owner, NOW);
      expect(result.kpis.costPerVehicle).toBe('0.00');
    });

    it('scopes getSummary/getExpenseBreakdown to [1st of month, today]', async () => {
      await service.getKpis(owner, NOW);
      expect(analytics.getSummary).toHaveBeenCalledWith(
        { from: '2026-08-01', to: '2026-08-25' },
        owner,
      );
      expect(analytics.getExpenseBreakdown).toHaveBeenCalledWith(
        { from: '2026-08-01', to: '2026-08-25' },
        owner,
      );
    });
  });

  describe('getCostPerVehicleByType', () => {
    it('rejects a driver', async () => {
      await expect(service.getCostPerVehicleByType({}, driver)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("divides each type's expense total by that type's own active fleet count", async () => {
      const expensesByType: Record<string, string> = {
        MOTORBIKE: '100000.00',
        BAJAJI: '20000.00',
        CAR: '0.00',
        TRUCK: '90000.00',
      };
      const countsByType: Record<string, number> = {
        MOTORBIKE: 10,
        BAJAJI: 2,
        CAR: 0,
        TRUCK: 3,
      };
      analytics.getSummary.mockImplementation(async (q: { vehicleType: string }) => ({
        expenses: expensesByType[q.vehicleType],
      }));
      prisma.client.motorcycle.count.mockImplementation(
        async ({ where }: { where: { vehicleType: string } }) => countsByType[where.vehicleType],
      );

      const rows = await service.getCostPerVehicleByType({}, owner);

      expect(rows).toEqual([
        { vehicleType: 'MOTORBIKE', costPerVehicle: '10000.00' }, // 100000/10
        { vehicleType: 'BAJAJI', costPerVehicle: '10000.00' }, // 20000/2
        { vehicleType: 'CAR', costPerVehicle: '0.00' }, // 0 active vehicles -> 0, not an error
        { vehicleType: 'TRUCK', costPerVehicle: '30000.00' }, // 90000/3
      ]);
    });
  });

  describe('getVehicleAnomalies', () => {
    it('rejects a driver', async () => {
      prisma.client.expense.findMany.mockResolvedValue([]);
      prisma.client.maintenanceLog.findMany.mockResolvedValue([]);
      await expect(service.getVehicleAnomalies(driver, NOW)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('flags a vehicle whose current cost clears BOTH the multiplier and the floor, computing changePct and the top category', async () => {
      // moto-flagged: trailing 3mo total 60000 (avg 20000), current 100000.
      // 100000 > 20000*1.3=26000 AND 100000 > 50000 floor -> flagged.
      // changePct = (100000-20000)/20000*100 = 400.
      prisma.client.expense.findMany.mockImplementation(
        async ({ where }: { where: { incurredAt: { gte: Date } } }) => {
          const isCurrentPeriod =
            where.incurredAt.gte.getTime() === new Date('2026-08-01T00:00:00.000Z').getTime();
          if (isCurrentPeriod) {
            return [
              { motorcycleId: 'moto-flagged', amount: dec(70000), category: 'Fuel' },
              { motorcycleId: 'moto-flagged', amount: dec(20000), category: 'Repairs' },
            ];
          }
          return [{ motorcycleId: 'moto-flagged', amount: dec(60000), category: 'Fuel' }];
        },
      );
      prisma.client.maintenanceLog.findMany.mockImplementation(
        async ({ where }: { where: { performedAt: { gte: Date } } }) => {
          const isCurrentPeriod =
            where.performedAt.gte.getTime() === new Date('2026-08-01T00:00:00.000Z').getTime();
          return isCurrentPeriod ? [{ motorcycleId: 'moto-flagged', cost: dec(10000) }] : [];
        },
      );
      prisma.client.motorcycle.findMany.mockResolvedValue([
        { id: 'moto-flagged', registrationNumber: 'REG-1', vehicleType: VehicleType.MOTORBIKE },
      ]);

      const rows = await service.getVehicleAnomalies(owner, NOW);

      expect(rows).toEqual([
        {
          motorcycleId: 'moto-flagged',
          registrationNumber: 'REG-1',
          vehicleType: VehicleType.MOTORBIKE,
          currentPeriodCost: '100000.00', // 70000 + 20000 + 10000 (expenses + maintenance)
          trailing3MoAvg: '20000.00', // 60000 / 3
          changePct: 400,
          pattern: 'Fuel', // 70000 > 20000 (Repairs) this period
        },
      ]);
    });

    it('does NOT flag a vehicle that clears the multiplier but not the absolute floor (near-zero baseline noise)', async () => {
      // trailing avg 1000 (3000/3), current 2000: 2000 > 1000*1.3=1300 (clears
      // multiplier) but 2000 is not > 50000 floor -> not flagged.
      prisma.client.expense.findMany.mockImplementation(
        async ({ where }: { where: { incurredAt: { gte: Date } } }) => {
          const isCurrentPeriod =
            where.incurredAt.gte.getTime() === new Date('2026-08-01T00:00:00.000Z').getTime();
          return isCurrentPeriod
            ? [{ motorcycleId: 'moto-small', amount: dec(2000), category: 'Fuel' }]
            : [{ motorcycleId: 'moto-small', amount: dec(3000), category: 'Fuel' }];
        },
      );
      prisma.client.maintenanceLog.findMany.mockResolvedValue([]);
      prisma.client.motorcycle.findMany.mockResolvedValue([
        { id: 'moto-small', registrationNumber: 'REG-2', vehicleType: VehicleType.MOTORBIKE },
      ]);

      const rows = await service.getVehicleAnomalies(owner, NOW);
      expect(rows).toEqual([]);
    });

    it('does NOT flag a vehicle whose cost clears the floor but not the multiplier (a consistently expensive vehicle, not an anomaly)', async () => {
      // trailing avg 100000, current 120000: clears the 50000 floor but
      // 120000 is not > 100000*1.3=130000 -> not flagged.
      prisma.client.expense.findMany.mockImplementation(
        async ({ where }: { where: { incurredAt: { gte: Date } } }) => {
          const isCurrentPeriod =
            where.incurredAt.gte.getTime() === new Date('2026-08-01T00:00:00.000Z').getTime();
          return isCurrentPeriod
            ? [{ motorcycleId: 'moto-big', amount: dec(120000), category: 'Fuel' }]
            : [{ motorcycleId: 'moto-big', amount: dec(300000), category: 'Fuel' }]; // 300000/3=100000 avg
        },
      );
      prisma.client.maintenanceLog.findMany.mockResolvedValue([]);
      prisma.client.motorcycle.findMany.mockResolvedValue([
        { id: 'moto-big', registrationNumber: 'REG-3', vehicleType: VehicleType.TRUCK },
      ]);

      const rows = await service.getVehicleAnomalies(owner, NOW);
      expect(rows).toEqual([]);
    });

    it('a vehicle with no trailing history at all (avg 0) is flagged at changePct 100 when it clears the floor, never a divide-by-zero', async () => {
      prisma.client.expense.findMany.mockImplementation(
        async ({ where }: { where: { incurredAt: { gte: Date } } }) => {
          const isCurrentPeriod =
            where.incurredAt.gte.getTime() === new Date('2026-08-01T00:00:00.000Z').getTime();
          return isCurrentPeriod
            ? [{ motorcycleId: 'moto-new', amount: dec(60000), category: 'Repairs' }]
            : [];
        },
      );
      prisma.client.maintenanceLog.findMany.mockResolvedValue([]);
      prisma.client.motorcycle.findMany.mockResolvedValue([
        { id: 'moto-new', registrationNumber: 'REG-4', vehicleType: VehicleType.CAR },
      ]);

      const rows = await service.getVehicleAnomalies(owner, NOW);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        trailing3MoAvg: '0.00',
        changePct: 100,
        pattern: 'Repairs',
      });
    });

    it('scopes the trailing window to the 3 full calendar months before the current one', async () => {
      prisma.client.expense.findMany.mockResolvedValue([]);
      prisma.client.maintenanceLog.findMany.mockResolvedValue([]);

      await service.getVehicleAnomalies(owner, NOW);

      // Current period: [2026-08-01, 2026-08-26) (today + 1 day, exclusive).
      const currentCall = prisma.client.expense.findMany.mock.calls[0][0].where.incurredAt;
      expect(currentCall.gte).toEqual(new Date('2026-08-01T00:00:00.000Z'));
      expect(currentCall.lt).toEqual(new Date('2026-08-26T00:00:00.000Z'));

      // Trailing period: [2026-05-01, 2026-08-01) - May, June, July.
      const trailingCall = prisma.client.expense.findMany.mock.calls[1][0].where.incurredAt;
      expect(trailingCall.gte).toEqual(new Date('2026-05-01T00:00:00.000Z'));
      expect(trailingCall.lt).toEqual(new Date('2026-08-01T00:00:00.000Z'));
    });

    it('returns an empty array, and skips the motorcycle lookup, when nothing has any activity', async () => {
      prisma.client.expense.findMany.mockResolvedValue([]);
      prisma.client.maintenanceLog.findMany.mockResolvedValue([]);
      const rows = await service.getVehicleAnomalies(owner, NOW);
      expect(rows).toEqual([]);
      expect(prisma.client.motorcycle.findMany).not.toHaveBeenCalled();
    });
  });
});
