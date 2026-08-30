import { ForbiddenException } from '@nestjs/common';
import { OwnershipPlanStatus, UserRole } from '@prisma/client';
import { OwnershipSummaryService } from './ownership-summary.service';
import { OwnershipPlanService } from './ownership-plan.service';
import { AuthenticatedUser } from '../auth/auth.types';

type PlanRow = Awaited<ReturnType<OwnershipPlanService['list']>>[number];

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

interface PlanFixture {
  id: string;
  driverFirstName: string;
  status?: OwnershipPlanStatus;
  dailyAmount?: number;
  instalmentCount?: number;
  contractEndDate?: Date | null;
  graceDays?: number;
  breachAfterConsecutiveMissedDays?: number;
  daysBehind?: number;
  daysAhead?: number;
  consecutiveMissedDays?: number;
  recentExcusalCount?: number;
  amountPaid?: string;
  remainingToOwn?: string;
  remainingToBill?: string;
  derivedEndDate?: string;
}

function plan(overrides: PlanFixture): PlanRow {
  const { id, driverFirstName, ...rest } = overrides;
  return {
    id,
    status: OwnershipPlanStatus.ACTIVE,
    dailyAmount: 10000,
    instalmentCount: 100,
    contractEndDate: null,
    graceDays: 2,
    breachAfterConsecutiveMissedDays: 5,
    daysBehind: 0,
    daysAhead: 0,
    consecutiveMissedDays: 0,
    recentExcusalCount: 0,
    amountPaid: '0.00',
    remainingToOwn: '1000000.00',
    remainingToBill: '1000000.00',
    derivedEndDate: '2027-01-01',
    driver: { user: { firstName: driverFirstName, lastName: 'D' } },
    motorcycle: { registrationNumber: `REG-${id}` },
    ...rest,
  } as unknown as PlanRow;
}

describe('OwnershipSummaryService', () => {
  let service: OwnershipSummaryService;
  let ownershipPlanService: { list: jest.Mock };

  beforeEach(() => {
    ownershipPlanService = { list: jest.fn() };
    service = new OwnershipSummaryService(ownershipPlanService as unknown as OwnershipPlanService);
  });

  it('rejects a driver', async () => {
    ownershipPlanService.list.mockResolvedValue([]);
    await expect(service.getSummary(driver)).rejects.toBeInstanceOf(ForbiddenException);
  });

  describe('plan-health partition and KPIs', () => {
    // Two red (breach), one amber (behind past grace), one finishing early
    // (ok + daysAhead>0), one on schedule (ok + daysAhead 0) - every ACTIVE
    // plan lands in exactly one bucket.
    const redWorse = plan({
      id: 'red-worse',
      driverFirstName: 'Zainabu',
      dailyAmount: 5000,
      daysBehind: 8,
      consecutiveMissedDays: 8, // >= breach(5) -> red
      recentExcusalCount: 0,
    });
    const redLesser = plan({
      id: 'red-lesser',
      driverFirstName: 'Ali',
      dailyAmount: 10000,
      daysBehind: 6,
      consecutiveMissedDays: 6, // >= breach(5) -> red, but shorter streak than redWorse
      recentExcusalCount: 1,
    });
    const amber = plan({
      id: 'amber-1',
      driverFirstName: 'Bea',
      dailyAmount: 8000,
      daysBehind: 3, // > grace(2) -> amber
      consecutiveMissedDays: 2, // < breach(5)
    });
    const finishingEarly = plan({
      id: 'early-1',
      driverFirstName: 'Chiku',
      daysAhead: 4,
    });
    const onSchedule = plan({ id: 'on-1', driverFirstName: 'Dan' });

    beforeEach(() => {
      ownershipPlanService.list.mockResolvedValue([
        redWorse,
        redLesser,
        amber,
        finishingEarly,
        onSchedule,
      ]);
    });

    it('partitions every ACTIVE plan into exactly one bucket, matching plan.health counts', async () => {
      const result = await service.getSummary(owner);

      expect(result.kpis).toMatchObject({
        activePlanCount: 5,
        onScheduleCount: 1,
        slippingCount: 1,
        toTerminateCount: 2,
        finishingEarlyCount: 1,
      });
      expect(result.planHealth).toEqual({
        onSchedule: 1,
        slipping: 1,
        toTerminate: 2,
        finishingEarly: 1,
      });
    });

    it('missedDaysTotal sums consecutiveMissedDays across flagged (non-ok) plans only', async () => {
      const result = await service.getSummary(owner);
      // 8 (redWorse) + 6 (redLesser) + 2 (amber) = 16; onSchedule/finishingEarly excluded.
      expect(result.kpis.missedDaysTotal).toBe(16);
    });

    it('moneyAtRisk sums daysBehind * dailyAmount across flagged plans - NOT consecutiveMissedDays', async () => {
      const result = await service.getSummary(owner);
      // redWorse: 8*5000=40000; redLesser: 6*10000=60000; amber: 3*8000=24000. Total 124000.
      expect(result.kpis.moneyAtRisk).toBe('124000.00');
    });

    it('the termination-review insight names the plan with the LONGEST missed streak among toTerminate plans, not the largest daysBehind', async () => {
      const result = await service.getSummary(owner);
      const terminationInsight = result.insights.find((i) => i.title.includes('missed in a row'));
      expect(terminationInsight).toBeDefined();
      expect(terminationInsight!.title).toBe('8 days missed in a row');
      expect(terminationInsight!.description).toContain('Zainabu');
      expect(terminationInsight!.planIds).toEqual(['red-worse']);
    });

    it('the early-finish insight names the plan with the largest daysAhead among finishingEarly plans', async () => {
      const result = await service.getSummary(owner);
      const earlyInsight = result.insights.find((i) => i.title.includes('ahead of schedule'));
      expect(earlyInsight).toBeDefined();
      expect(earlyInsight!.title).toBe('4 days ahead of schedule');
      expect(earlyInsight!.description).toContain('Chiku');
    });

    it('the missed-days table includes red AND amber plans (severity != ok), sorted by missed streak desc, with a severity-matched verdict', async () => {
      const result = await service.getSummary(owner);
      expect(result.missedDaysTable.map((r) => r.planId)).toEqual([
        'red-worse', // 8
        'red-lesser', // 6
        'amber-1', // 2
      ]);
      expect(result.missedDaysTable[0]).toMatchObject({
        driverName: 'Zainabu D',
        verdict: 'Terminate',
        severity: 'red',
        valueAtRisk: '40000.00', // consecutiveMissedDays(8) * dailyAmount(5000) - NOT daysBehind
      });
      expect(result.missedDaysTable[2]).toMatchObject({ verdict: 'Watch', severity: 'amber' });
    });

    it('onSchedule/finishingEarly plans never appear on the missed-days table', async () => {
      const result = await service.getSummary(owner);
      const ids = result.missedDaysTable.map((r) => r.planId);
      expect(ids).not.toContain('early-1');
      expect(ids).not.toContain('on-1');
    });
  });

  describe('expectedCompletions', () => {
    it('buckets ACTIVE plans into an 18-month histogram keyed by contractEndDate ?? derivedEndDate, zero-filled', async () => {
      const now = new Date('2026-08-15T00:00:00.000Z');

      const withContractDate = plan({
        id: 'p1',
        driverFirstName: 'A',
        contractEndDate: new Date('2026-10-05T00:00:00.000Z'), // month 2026-10
      });
      const withDerivedOnly = plan({
        id: 'p2',
        driverFirstName: 'B',
        contractEndDate: null,
        derivedEndDate: '2026-08-20', // month 2026-08, this month
      });
      ownershipPlanService.list.mockResolvedValue([withContractDate, withDerivedOnly]);

      const result = await service.getSummary(owner, now);

      expect(result.expectedCompletions).toHaveLength(18);
      expect(result.expectedCompletions[0]).toEqual({ month: '2026-08', count: 1 }); // p2
      const octoberPoint = result.expectedCompletions.find((p) => p.month === '2026-10');
      expect(octoberPoint).toEqual({ month: '2026-10', count: 1 }); // p1, via contractEndDate
    });
  });

  describe('contractValueTotals', () => {
    it('sums totalOwed and collectedToDate across ALL plans regardless of status, with atRisk from ACTIVE plans only', async () => {
      const activeFlagged = plan({
        id: 'active-flagged',
        driverFirstName: 'A',
        dailyAmount: 10000,
        instalmentCount: 100, // totalOwed = 1,000,000
        daysBehind: 5,
        consecutiveMissedDays: 5, // red -> counts toward moneyAtRisk
        amountPaid: '200000.00',
      });
      const completedPlan = plan({
        id: 'completed',
        driverFirstName: 'B',
        status: OwnershipPlanStatus.COMPLETED,
        dailyAmount: 8000,
        instalmentCount: 50, // totalOwed = 400,000
        amountPaid: '400000.00', // fully paid
      });
      ownershipPlanService.list.mockResolvedValue([activeFlagged, completedPlan]);

      const result = await service.getSummary(owner);

      // totalOwed: 1,000,000 + 400,000 = 1,400,000
      // collectedToDate: 200,000 + 400,000 = 600,000
      // atRisk (ACTIVE only, red): daysBehind(5) * dailyAmount(10000) = 50,000
      // stillToCome: 1,400,000 - 600,000 - 50,000 = 750,000
      expect(result.contractValueTotals).toEqual({
        totalOwed: '1400000.00',
        collectedToDate: '600000.00',
        paidIn: '600000.00',
        atRisk: '50000.00',
        stillToCome: '750000.00',
      });
    });

    it('floors stillToCome at 0 rather than going negative', async () => {
      const overCommitted = plan({
        id: 'p1',
        driverFirstName: 'A',
        dailyAmount: 1000,
        instalmentCount: 10, // totalOwed = 10,000
        daysBehind: 50,
        consecutiveMissedDays: 50, // red, moneyAtRisk = 50*1000 = 50,000 (exceeds totalOwed)
        amountPaid: '5000.00',
      });
      ownershipPlanService.list.mockResolvedValue([overCommitted]);

      const result = await service.getSummary(owner);
      expect(result.contractValueTotals.stillToCome).toBe('0.00');
    });
  });

  describe('twoBalances', () => {
    it('sums remainingToOwn and remainingToBill across ACTIVE plans, and computes arrears as billed-not-yet-paid', async () => {
      const p1 = plan({
        id: 'p1',
        driverFirstName: 'A',
        amountPaid: '100000.00',
        remainingToOwn: '900000.00',
        remainingToBill: '150000.00',
      });
      const p2 = plan({
        id: 'p2',
        driverFirstName: 'B',
        amountPaid: '50000.00',
        remainingToOwn: '450000.00',
        remainingToBill: '80000.00',
      });
      const completedPlan = plan({
        id: 'completed',
        driverFirstName: 'C',
        status: OwnershipPlanStatus.COMPLETED,
        amountPaid: '999999.00',
        remainingToOwn: '0.00',
        remainingToBill: '0.00',
      });
      ownershipPlanService.list.mockResolvedValue([p1, p2, completedPlan]);

      const result = await service.getSummary(owner);

      // remainingToOwn: 900000 + 450000 = 1,350,000 (COMPLETED plan excluded)
      // remainingToBill: 150000 + 80000 = 230,000
      // amountPaid (ACTIVE only): 100000 + 50000 = 150,000
      // arrears = 230,000 - 150,000 = 80,000
      expect(result.twoBalances).toEqual({
        remainingToOwn: '1350000.00',
        remainingToBill: '230000.00',
        arrears: '80000.00',
      });
    });

    it('floors arrears at 0 when the plans are paid ahead of what has been billed', async () => {
      const aheadOfBilling = plan({
        id: 'p1',
        driverFirstName: 'A',
        amountPaid: '500000.00',
        remainingToOwn: '500000.00',
        remainingToBill: '100000.00', // billed less than paid
      });
      ownershipPlanService.list.mockResolvedValue([aheadOfBilling]);

      const result = await service.getSummary(owner);
      expect(result.twoBalances.arrears).toBe('0.00');
    });
  });

  it('returns an all-zero shape when there are no plans at all', async () => {
    ownershipPlanService.list.mockResolvedValue([]);
    const result = await service.getSummary(owner);

    expect(result.kpis).toEqual({
      activePlanCount: 0,
      onScheduleCount: 0,
      slippingCount: 0,
      toTerminateCount: 0,
      finishingEarlyCount: 0,
      missedDaysTotal: 0,
      moneyAtRisk: '0.00',
    });
    expect(result.insights).toEqual([]);
    expect(result.missedDaysTable).toEqual([]);
    expect(result.expectedCompletions).toHaveLength(18);
    expect(result.expectedCompletions.every((p) => p.count === 0)).toBe(true);
  });
});
