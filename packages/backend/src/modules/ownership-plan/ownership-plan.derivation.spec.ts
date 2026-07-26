import { Prisma } from '@prisma/client';
import {
  computeRemainingToOwn,
  computeRemainingUnreserved,
  derivePlanFigures,
  PlanPosition,
} from './ownership-plan.derivation';

const TODAY = new Date('2026-08-01T00:00:00.000Z'); // a Saturday

function basePosition(overrides: Partial<PlanPosition> = {}): PlanPosition {
  return {
    dailyAmount: new Prisma.Decimal(12000),
    totalPrice: new Prisma.Decimal(1_800_000),
    downPayment: new Prisma.Decimal(0),
    amountDue: new Prisma.Decimal(0),
    amountPaid: new Prisma.Decimal(0),
    amountBilled: new Prisma.Decimal(0),
    contractEndDate: null,
    activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
    ...overrides,
  };
}

describe('derivePlanFigures', () => {
  it('netPosition exactly zero -> daysBehind 0 AND daysAhead 0, neither message shows', () => {
    const result = derivePlanFigures(
      basePosition({ amountDue: new Prisma.Decimal(24000), amountPaid: new Prisma.Decimal(24000) }),
      TODAY,
    );
    expect(result.netPosition).toBe('0.00');
    expect(result.daysBehind).toBe(0);
    expect(result.daysAhead).toBe(0);
  });

  it('partial day: 6,000 paid against a 12,000 day -> 1 day behind (ceil), not 0', () => {
    const result = derivePlanFigures(
      basePosition({ amountDue: new Prisma.Decimal(12000), amountPaid: new Prisma.Decimal(6000) }),
      TODAY,
    );
    expect(result.netPosition).toBe('-6000.00');
    expect(result.daysBehind).toBe(1);
    expect(result.daysAhead).toBe(0);
  });

  it('partial surplus: 18,000 paid against a 12,000 day -> 0 days ahead (floor), not 1', () => {
    const result = derivePlanFigures(
      basePosition({ amountDue: new Prisma.Decimal(12000), amountPaid: new Prisma.Decimal(18000) }),
      TODAY,
    );
    expect(result.netPosition).toBe('6000.00');
    expect(result.daysAhead).toBe(0);
    expect(result.daysBehind).toBe(0);
  });

  it('three unpaid days at 12,000 -> netPosition -36,000, daysBehind 3', () => {
    const result = derivePlanFigures(
      basePosition({ amountDue: new Prisma.Decimal(36000), amountPaid: new Prisma.Decimal(0) }),
      TODAY,
    );
    expect(result.netPosition).toBe('-36000.00');
    expect(result.daysBehind).toBe(3);
    expect(result.daysAhead).toBe(0);
  });

  it('activeWeekdays excluding Sunday: daysLeft skips Sundays (6, not a flat 7)', () => {
    // 2026-08-01 is a Saturday; 2026-08-08 (also a Saturday) is 7 calendar
    // days later but only 6 of those are Mon-Sat (2026-08-02 is a Sunday).
    const result = derivePlanFigures(
      basePosition({
        contractEndDate: new Date('2026-08-08T00:00:00.000Z'),
        activeWeekdays: [1, 2, 3, 4, 5, 6], // Mon-Sat, Sunday excluded
      }),
      TODAY,
    );
    expect(result.daysLeft).toBe(6);
  });

  it('activeWeekdays excluding Sunday: projectedCompletion skips Sundays too', () => {
    // 7 active-weekday days from Saturday 2026-08-01, skipping Sunday
    // 2026-08-02 and Sunday 2026-08-09, lands on Monday 2026-08-10 - not
    // Saturday 2026-08-08, which is what a flat 7-calendar-day count would give.
    const result = derivePlanFigures(
      basePosition({
        totalPrice: new Prisma.Decimal(84000),
        downPayment: new Prisma.Decimal(0),
        amountPaid: new Prisma.Decimal(0),
        dailyAmount: new Prisma.Decimal(12000),
        activeWeekdays: [1, 2, 3, 4, 5, 6],
      }),
      TODAY,
    );
    expect(result.remainingToOwn).toBe('84000.00');
    expect(result.projectedCompletion).toBe('2026-08-10');
  });

  it('daysLeft is null when the plan has no contractEndDate', () => {
    const result = derivePlanFigures(basePosition({ contractEndDate: null }), TODAY);
    expect(result.daysLeft).toBeNull();
  });

  it('remainingToOwn and projectedCompletion are unaffected by daysBehind/daysAhead', () => {
    // A plan can be behind on daily deposits while still having plenty of
    // total balance left to pay off - the two figures are independent reads.
    const result = derivePlanFigures(
      basePosition({
        totalPrice: new Prisma.Decimal(1_800_000),
        downPayment: new Prisma.Decimal(200_000),
        amountDue: new Prisma.Decimal(36000),
        amountPaid: new Prisma.Decimal(0),
        dailyAmount: new Prisma.Decimal(12000),
      }),
      TODAY,
    );
    expect(result.remainingToOwn).toBe('1600000.00');
    expect(result.daysBehind).toBe(3);
  });

  describe('Part 1: remainingToOwn vs remainingToBill', () => {
    it('a fully current plan (amountPaid === amountBilled) has remainingToOwn === remainingToBill', () => {
      const result = derivePlanFigures(
        basePosition({
          totalPrice: new Prisma.Decimal(1_800_000),
          downPayment: new Prisma.Decimal(0),
          amountDue: new Prisma.Decimal(12000),
          amountPaid: new Prisma.Decimal(12000),
          amountBilled: new Prisma.Decimal(12000),
        }),
        TODAY,
      );
      expect(result.remainingToOwn).toBe(result.remainingToBill);
      expect(result.remainingToOwn).toBe('1788000.00');
    });

    it('a non-paying driver: remainingToOwn stays at the arrears while remainingToBill tracks what has been billed', () => {
      // 4,000 remaining, only 4,000 ever billed (the generator capped it there),
      // nothing paid - remainingToOwn reflects the debt, remainingToBill is
      // exhausted (the generator must not create more).
      const result = derivePlanFigures(
        basePosition({
          totalPrice: new Prisma.Decimal(4000),
          downPayment: new Prisma.Decimal(0),
          amountDue: new Prisma.Decimal(4000),
          amountPaid: new Prisma.Decimal(0),
          amountBilled: new Prisma.Decimal(4000),
        }),
        TODAY,
      );
      expect(result.remainingToOwn).toBe('4000.00');
      expect(result.remainingToBill).toBe('0.00');
    });
  });

  describe('computeRemainingUnreserved (Stage F: PENDING/COMPLETED asymmetry)', () => {
    it('remainingToOwn is unaffected by a PENDING payment; remainingUnreserved is', () => {
      const totalPrice = new Prisma.Decimal(20000);
      const downPayment = new Prisma.Decimal(0);
      const amountPaidCompleted = new Prisma.Decimal(0); // the PENDING payment never completed
      const amountReserved = new Prisma.Decimal(15000); // PENDING + COMPLETED

      const remainingToOwn = computeRemainingToOwn(totalPrice, downPayment, amountPaidCompleted);
      const remainingUnreserved = computeRemainingUnreserved(
        totalPrice,
        downPayment,
        amountReserved,
      );

      expect(remainingToOwn.toFixed(2)).toBe('20000.00');
      expect(remainingUnreserved.toFixed(2)).toBe('5000.00');
    });
  });
});
