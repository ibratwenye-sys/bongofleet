import { Prisma } from '@prisma/client';
import {
  AssignmentPaidRow,
  computeConsecutiveMissedDays,
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
    assignmentPayments: [],
    ...overrides,
  };
}

function day(offsetFromToday: number): Date {
  return new Date(TODAY.getTime() + offsetFromToday * 24 * 60 * 60 * 1000);
}

function paidRow(offsetFromToday: number, paidAmount: number): AssignmentPaidRow {
  return { assignedDate: day(offsetFromToday), paidAmount: new Prisma.Decimal(paidAmount) };
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

  describe('computeConsecutiveMissedDays (Stage G2 Part 1)', () => {
    it('empty rows -> 0', () => {
      expect(computeConsecutiveMissedDays([], TODAY)).toBe(0);
    });

    it('a single unpaid day ending at today -> 1', () => {
      const rows = [paidRow(0, 0)];
      expect(computeConsecutiveMissedDays(rows, TODAY)).toBe(1);
    });

    it('stops at the first day (walking backward from today) with any COMPLETED payment, however small', () => {
      const rows = [paidRow(-2, 0), paidRow(-1, 1), paidRow(0, 0)];
      expect(computeConsecutiveMissedDays(rows, TODAY)).toBe(1);
    });

    it('a shortfall day (paid something, just not enough) still breaks the run', () => {
      const rows = [paidRow(-3, 0), paidRow(-2, 6000), paidRow(-1, 0), paidRow(0, 0)];
      expect(computeConsecutiveMissedDays(rows, TODAY)).toBe(2);
    });

    it('a day with no assignment row at all is silently skipped, not a break', () => {
      // day -2 has no row (an inactive weekday, or not yet backfilled) - the
      // run walks straight past it to day -3 without breaking.
      const rows = [paidRow(-3, 0), paidRow(-1, 0), paidRow(0, 0)];
      expect(computeConsecutiveMissedDays(rows, TODAY)).toBe(3);
    });

    it('rows after today are ignored', () => {
      const rows = [paidRow(0, 0), paidRow(1, 0), paidRow(2, 0)];
      expect(computeConsecutiveMissedDays(rows, TODAY)).toBe(1);
    });

    it('row order does not matter', () => {
      const rows = [paidRow(0, 0), paidRow(-2, 0), paidRow(-1, 0)];
      expect(computeConsecutiveMissedDays(rows, TODAY)).toBe(3);
    });
  });

  describe('daysBehind vs consecutiveMissedDays (Stage G2 Part 1)', () => {
    it('missing one day a week for five weeks: daysBehind is 5, but never missing two in a row keeps consecutiveMissedDays at 1', () => {
      // 35 consecutive assigned days, every 7th one (offsets -28,-21,-14,-7,0)
      // unpaid, everything else paid in full. Today (offset 0) is itself one
      // of the missed days, so the backward run is length 1 - day -1 was paid.
      const rows: AssignmentPaidRow[] = [];
      for (let offset = -34; offset <= 0; offset += 1) {
        const isMissedWeek = offset % 7 === 0;
        rows.push(paidRow(offset, isMissedWeek ? 0 : 12000));
      }
      const amountDue = new Prisma.Decimal(35 * 12000);
      const amountPaid = new Prisma.Decimal(30 * 12000);

      const result = derivePlanFigures(
        basePosition({ amountDue, amountPaid, assignmentPayments: rows }),
        TODAY,
      );

      expect(result.daysBehind).toBe(5);
      expect(result.consecutiveMissedDays).toBe(1);
    });

    it('three days ahead then five consecutive missed days: daysBehind reads only 2, but consecutiveMissedDays (the actual repossession condition) is 5', () => {
      // Days -7..-5 paid double (24,000 against a 12,000 target - 3 days
      // ahead); days -4..0 (5 days) unpaid.
      const rows: AssignmentPaidRow[] = [
        paidRow(-7, 24000),
        paidRow(-6, 24000),
        paidRow(-5, 24000),
        paidRow(-4, 0),
        paidRow(-3, 0),
        paidRow(-2, 0),
        paidRow(-1, 0),
        paidRow(0, 0),
      ];
      const amountDue = new Prisma.Decimal(8 * 12000); // 96,000
      const amountPaid = new Prisma.Decimal(3 * 24000); // 72,000

      const result = derivePlanFigures(
        basePosition({ amountDue, amountPaid, assignmentPayments: rows }),
        TODAY,
      );

      expect(result.netPosition).toBe('-24000.00');
      expect(result.daysBehind).toBe(2); // the buggy old reading
      expect(result.consecutiveMissedDays).toBe(5); // the real repossession condition
    });
  });
});
