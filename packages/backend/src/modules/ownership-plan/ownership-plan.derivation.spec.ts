import { Prisma } from '@prisma/client';
import {
  AssignmentPaidRow,
  computeConsecutiveMissedDays,
  computeRemainingToOwn,
  computeRemainingUnreserved,
  derivePlanFigures,
  PlanPosition,
} from './ownership-plan.derivation';

// Stage G3 Part 2: computeConsecutiveMissedDays interprets `today` in
// Africa/Dar_es_Salaam (UTC+3). 00:00Z is 03:00 local, still well inside
// 2026-08-01 local - so TODAY reads as the same calendar day in both, and
// offsets below need no extra adjustment for that.
const TODAY = new Date('2026-08-01T00:00:00.000Z'); // a Saturday

function basePosition(overrides: Partial<PlanPosition> = {}): PlanPosition {
  return {
    dailyAmount: new Prisma.Decimal(12000),
    instalmentCount: 150, // totalOwed = 12,000 x 150 = 1,800,000
    amountDue: new Prisma.Decimal(0),
    amountPaid: new Prisma.Decimal(0),
    amountBilled: new Prisma.Decimal(0),
    contractEndDate: null,
    startDate: day(-60),
    activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
    assignmentPayments: [],
    excusedDates: [],
    ...overrides,
  };
}

function day(offsetFromToday: number): Date {
  return new Date(TODAY.getTime() + offsetFromToday * 24 * 60 * 60 * 1000);
}

function paidRow(
  offsetFromToday: number,
  paidAmount: number,
  targetAmount = 12000,
): AssignmentPaidRow {
  return {
    assignedDate: day(offsetFromToday),
    targetAmount: new Prisma.Decimal(targetAmount),
    paidAmount: new Prisma.Decimal(paidAmount),
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

  it('3 days ahead (36,000 surplus at 12,000/day) -> nextDueDate is 3 active weekdays from today', () => {
    // TODAY is Saturday 2026-08-01; all 7 weekdays active here, so 3 active
    // weekdays out is a flat +3 calendar days -> Tuesday 2026-08-04.
    const result = derivePlanFigures(
      basePosition({ amountDue: new Prisma.Decimal(0), amountPaid: new Prisma.Decimal(36000) }),
      TODAY,
    );
    expect(result.daysAhead).toBe(3);
    expect(result.nextDueDate).toBe('2026-08-04');
  });

  it('daysAhead 0 (square or behind) -> nextDueDate is null, not a stale/zero date', () => {
    const square = derivePlanFigures(
      basePosition({ amountDue: new Prisma.Decimal(24000), amountPaid: new Prisma.Decimal(24000) }),
      TODAY,
    );
    expect(square.daysAhead).toBe(0);
    expect(square.nextDueDate).toBeNull();

    const behind = derivePlanFigures(
      basePosition({ amountDue: new Prisma.Decimal(12000), amountPaid: new Prisma.Decimal(0) }),
      TODAY,
    );
    expect(behind.daysAhead).toBe(0);
    expect(behind.nextDueDate).toBeNull();
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
        instalmentCount: 7, // totalOwed = 12,000 x 7 = 84,000
        amountPaid: new Prisma.Decimal(0),
        dailyAmount: new Prisma.Decimal(12000),
        activeWeekdays: [1, 2, 3, 4, 5, 6],
      }),
      TODAY,
    );
    expect(result.remainingToOwn).toBe('84000.00');
    expect(result.projectedCompletion).toBe('2026-08-10');
  });

  describe('derivedEndDate and daysLeft when contractEndDate is not typed in (Stage H1)', () => {
    it('derivedEndDate is the instalmentCount-th active weekday from startDate, and daysLeft counts down against it', () => {
      const result = derivePlanFigures(
        basePosition({
          contractEndDate: null,
          startDate: new Date('2026-08-01T00:00:00.000Z'), // TODAY itself
          instalmentCount: 10,
          activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
        }),
        TODAY,
      );
      // 10th active day from 2026-08-01 inclusive (all weekdays active) =
      // start + 9 days = 2026-08-10.
      expect(result.derivedEndDate).toBe('2026-08-10');
      // Active days strictly after TODAY up to and including 2026-08-10:
      // Aug 2..10 = 9 - never null, and never counts startDate's own day.
      expect(result.daysLeft).toBe(9);
    });

    it('daysLeft is 0, not negative, once the derived end date has already passed', () => {
      const result = derivePlanFigures(
        basePosition({
          contractEndDate: null,
          startDate: new Date('2026-07-01T00:00:00.000Z'),
          instalmentCount: 30,
          activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
        }),
        TODAY, // 2026-08-01 - one day after the derived end date below
      );
      expect(result.derivedEndDate).toBe('2026-07-30');
      expect(result.daysLeft).toBe(0);
    });

    it('an agreed contractEndDate still wins over the derived one when both are present', () => {
      const result = derivePlanFigures(
        basePosition({
          contractEndDate: new Date('2026-09-01T00:00:00.000Z'), // renegotiated later than the plan's own math
          startDate: new Date('2026-08-01T00:00:00.000Z'),
          instalmentCount: 10, // derivedEndDate would be 2026-08-10
          activeWeekdays: [0, 1, 2, 3, 4, 5, 6],
        }),
        TODAY,
      );
      expect(result.derivedEndDate).toBe('2026-08-10');
      // daysLeft counts against the agreed 2026-09-01, not the derived date.
      expect(result.daysLeft).toBe(31);
    });
  });

  it('remainingToOwn and projectedCompletion are unaffected by daysBehind/daysAhead', () => {
    // A plan can be behind on daily deposits while still having plenty of
    // total balance left to pay off - the two figures are independent reads.
    const result = derivePlanFigures(
      basePosition({
        instalmentCount: 134, // totalOwed = 12,000 x 134 = 1,608,000
        amountDue: new Prisma.Decimal(36000),
        amountPaid: new Prisma.Decimal(0),
        dailyAmount: new Prisma.Decimal(12000),
      }),
      TODAY,
    );
    expect(result.remainingToOwn).toBe('1608000.00');
    expect(result.daysBehind).toBe(3);
  });

  describe('Part 1: remainingToOwn vs remainingToBill', () => {
    it('a fully current plan (amountPaid === amountBilled) has remainingToOwn === remainingToBill', () => {
      const result = derivePlanFigures(
        basePosition({
          instalmentCount: 150, // totalOwed = 12,000 x 150 = 1,800,000
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
      // 4,000 remaining (one instalment of a 4,000/day plan), only 4,000
      // ever billed (the generator capped it there), nothing paid -
      // remainingToOwn reflects the debt, remainingToBill is exhausted (the
      // generator must not create more).
      const result = derivePlanFigures(
        basePosition({
          dailyAmount: new Prisma.Decimal(4000),
          instalmentCount: 1,
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
      const dailyAmount = new Prisma.Decimal(20000);
      const instalmentCount = 1; // totalOwed = 20,000
      const amountPaidCompleted = new Prisma.Decimal(0); // the PENDING payment never completed
      const amountReserved = new Prisma.Decimal(15000); // PENDING + COMPLETED

      const remainingToOwn = computeRemainingToOwn(
        dailyAmount,
        instalmentCount,
        amountPaidCompleted,
      );
      const remainingUnreserved = computeRemainingUnreserved(
        dailyAmount,
        instalmentCount,
        amountReserved,
      );

      expect(remainingToOwn.toFixed(2)).toBe('20000.00');
      expect(remainingUnreserved.toFixed(2)).toBe('5000.00');
    });
  });

  describe('computeConsecutiveMissedDays (Stage G3)', () => {
    it('empty rows -> 0', () => {
      expect(computeConsecutiveMissedDays([], TODAY)).toBe(0);
    });

    it('Part 1: a 500 payment against a 12,000 day does NOT break the streak', () => {
      const rows = [paidRow(-1, 500)];
      expect(computeConsecutiveMissedDays(rows, TODAY)).toBe(1);
    });

    it('Part 1: an exactly-full payment DOES break it', () => {
      const rows = [paidRow(-1, 12000)];
      expect(computeConsecutiveMissedDays(rows, TODAY)).toBe(0);
    });

    it('Part 1: an overpayment breaks it', () => {
      const rows = [paidRow(-1, 15000)];
      expect(computeConsecutiveMissedDays(rows, TODAY)).toBe(0);
    });

    it('Part 1: the final partial instalment, paid in full, counts as paid and does not show as a missed day', () => {
      // A plan's last day can legitimately be billed less than dailyAmount -
      // compared against dailyAmount (12,000) this would look like a huge
      // shortfall; compared against its own targetAmount (500) it is paid.
      const rows = [paidRow(-1, 500, 500)];
      expect(computeConsecutiveMissedDays(rows, TODAY)).toBe(0);
    });

    it("Part 2: today's unpaid assignment is excluded from the streak", () => {
      const rows = [paidRow(0, 0)];
      expect(computeConsecutiveMissedDays(rows, TODAY)).toBe(0);
    });

    it("Part 2: yesterday's unpaid assignment is included", () => {
      const rows = [paidRow(-1, 0)];
      expect(computeConsecutiveMissedDays(rows, TODAY)).toBe(1);
    });

    it('Part 2: an unpaid today alongside an unpaid yesterday only counts yesterday', () => {
      const rows = [paidRow(-1, 0), paidRow(0, 0), paidRow(1, 0)];
      expect(computeConsecutiveMissedDays(rows, TODAY)).toBe(1);
    });

    it('a driver who paid five days ahead has a streak of zero, not five', () => {
      // Every day from yesterday through five days from now is paid in full -
      // the oldest-first cascade guarantees the past is covered before any
      // surplus buys future days ahead. Only the elapsed days (< today) are
      // even examined; yesterday being paid in full stops the walk at 0.
      const rows = [-1, 0, 1, 2, 3, 4, 5].map((offset) => paidRow(offset, 12000));
      expect(computeConsecutiveMissedDays(rows, TODAY)).toBe(0);
    });

    it('a day the driver does not ride (no assignment row) neither breaks nor extends the streak - pin it', () => {
      // day -2 has no row (an inactive weekday, or not yet backfilled) - the
      // run walks straight past it to day -3 without breaking.
      const rows = [paidRow(-3, 0), paidRow(-1, 0)];
      expect(computeConsecutiveMissedDays(rows, TODAY)).toBe(2);
    });

    it('row order does not matter', () => {
      const rows = [paidRow(-1, 0), paidRow(-3, 0), paidRow(-2, 0)];
      expect(computeConsecutiveMissedDays(rows, TODAY)).toBe(3);
    });
  });

  describe('daysBehind vs consecutiveMissedDays, streak fix and full-payment rule together (Stage G2 + G3)', () => {
    it('missing one day a week for five weeks: daysBehind is 5, but never missing two in a row keeps consecutiveMissedDays at 1', () => {
      // 35 elapsed days ending yesterday (offsets -35..-1), every 7th one
      // (relative to yesterday) unpaid, everything else paid in full.
      const rows: AssignmentPaidRow[] = [];
      for (let offset = -35; offset <= -1; offset += 1) {
        const isMissedWeek = (offset + 1) % 7 === 0;
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
      // Days -8..-6 paid double (24,000 against a 12,000 target - 3 days
      // ahead); days -5..-1 (5 elapsed days, ending yesterday) unpaid.
      const rows: AssignmentPaidRow[] = [
        paidRow(-8, 24000),
        paidRow(-7, 24000),
        paidRow(-6, 24000),
        paidRow(-5, 0),
        paidRow(-4, 0),
        paidRow(-3, 0),
        paidRow(-2, 0),
        paidRow(-1, 0),
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

    it('two days ahead, then five elapsed days of token 500 payments: daysBehind under-signals at 3 while the true 5-day miss streak - invisible under the old any-nonzero-breaks rule - is caught', () => {
      // Days -7..-6 paid double (2 days ahead). Days -5..-1 (5 elapsed days)
      // each get a 500 payment against a 12,000 target: under the Stage G2
      // rule (any nonzero payment breaks the run) every one of these would
      // have reset the streak to 0 and this run would never have been seen;
      // under Stage G3's full-payment rule none of them count as paid, so
      // the streak correctly reaches 5 - the real repossession trigger -
      // while daysBehind (3) alone would still have under-stated it.
      const rows: AssignmentPaidRow[] = [
        paidRow(-7, 24000),
        paidRow(-6, 24000),
        paidRow(-5, 500),
        paidRow(-4, 500),
        paidRow(-3, 500),
        paidRow(-2, 500),
        paidRow(-1, 500),
      ];
      const amountDue = new Prisma.Decimal(7 * 12000); // 84,000
      const amountPaid = new Prisma.Decimal(24000 + 24000 + 500 * 5); // 50,500

      const result = derivePlanFigures(
        basePosition({ amountDue, amountPaid, assignmentPayments: rows }),
        TODAY,
      );

      expect(result.netPosition).toBe('-33500.00');
      expect(result.daysBehind).toBe(3);
      expect(result.consecutiveMissedDays).toBe(5);
    });
  });

  describe('computeConsecutiveMissedDays with excusedDates (Stage G4)', () => {
    it('unexcused / excused / unexcused reads as a run of two, not one', () => {
      // day -2 (the middle, excused) is transparent: the unexcused miss
      // before it (-3) and the unexcused miss after it (-1) still chain
      // through as a single run of two, not reset to one by the excusal.
      const rows = [paidRow(-3, 0), paidRow(-2, 0), paidRow(-1, 0)];
      expect(computeConsecutiveMissedDays(rows, TODAY, [day(-2)])).toBe(2);
    });

    it('a REQUESTED (or DECLINED/revoked) excusal does not reduce the streak; only an APPROVED one does', () => {
      // computeConsecutiveMissedDays has no notion of status - the caller
      // (ownership-plan.service.ts) is contracted to only ever pass APPROVED
      // dates. A REQUESTED, DECLINED, or revoked excusal is therefore simply
      // ABSENT from excusedDates - represented here as the empty-array call -
      // and the day counts as an ordinary miss exactly as if no excusal
      // record existed at all.
      const rows = [paidRow(-1, 0)];
      expect(computeConsecutiveMissedDays(rows, TODAY, [])).toBe(1); // REQUESTED/DECLINED/revoked
      expect(computeConsecutiveMissedDays(rows, TODAY, [day(-1)])).toBe(0); // APPROVED
    });

    it('an excusal on a non-riding day (no assignment row) changes nothing', () => {
      const rows = [paidRow(-3, 0), paidRow(-1, 0)]; // day -2 has no row
      const withoutExcusal = computeConsecutiveMissedDays(rows, TODAY, []);
      const withExcusalOnAGap = computeConsecutiveMissedDays(rows, TODAY, [day(-2)]);
      expect(withExcusalOnAGap).toBe(withoutExcusal);
      expect(withExcusalOnAGap).toBe(2);
    });

    it('an excusal for a future date, before its assignment row exists, is accepted and applies once the generator creates that day', () => {
      const futureDate = day(3);
      // Before the row exists: harmless, same as an excusal on any other gap.
      expect(computeConsecutiveMissedDays([], TODAY, [futureDate])).toBe(0);

      // The generator later creates that day's row (still unpaid, and now
      // elapsed) - the same excusedDates entry, unchanged, now makes it
      // transparent instead of a miss.
      const rows = [paidRow(-1, 0), paidRow(0, 0)]; // day 0 stands in for "that day" once elapsed
      expect(computeConsecutiveMissedDays(rows, TODAY, [day(0)])).toBe(1); // only day -1 counts
      expect(computeConsecutiveMissedDays(rows, TODAY, [])).toBe(1); // day 0 excluded anyway (Part 2, today)
    });

    it('every money figure is identical before and after approving an excusal - only consecutiveMissedDays moves', () => {
      const rows = [paidRow(-1, 0)];
      const position = basePosition({
        amountDue: new Prisma.Decimal(12000),
        amountPaid: new Prisma.Decimal(0),
        amountBilled: new Prisma.Decimal(12000),
        assignmentPayments: rows,
      });

      const before = derivePlanFigures({ ...position, excusedDates: [] }, TODAY);
      const after = derivePlanFigures({ ...position, excusedDates: [day(-1)] }, TODAY);

      expect(before.consecutiveMissedDays).toBe(1);
      expect(after.consecutiveMissedDays).toBe(0);

      expect(after.amountDue).toBe(before.amountDue);
      expect(after.amountPaid).toBe(before.amountPaid);
      expect(after.amountBilled).toBe(before.amountBilled);
      expect(after.netPosition).toBe(before.netPosition);
      expect(after.daysBehind).toBe(before.daysBehind);
      expect(after.daysAhead).toBe(before.daysAhead);
      expect(after.remainingToOwn).toBe(before.remainingToOwn);
      expect(after.remainingToBill).toBe(before.remainingToBill);
      expect(after.daysLeft).toBe(before.daysLeft);
      expect(after.projectedCompletion).toBe(before.projectedCompletion);
    });
  });

  describe('recentExcusalCount (Stage G5 Part 3)', () => {
    it('is 0 with no excusals', () => {
      const result = derivePlanFigures(basePosition({ excusedDates: [] }), TODAY);
      expect(result.recentExcusalCount).toBe(0);
    });

    it('counts APPROVED excusal dates within the last 90 days, inclusive of today', () => {
      const result = derivePlanFigures(
        basePosition({ excusedDates: [day(-10), day(-89), day(0)] }),
        TODAY,
      );
      expect(result.recentExcusalCount).toBe(3);
    });

    it('excludes an excusal older than 90 days', () => {
      const result = derivePlanFigures(basePosition({ excusedDates: [day(-91)] }), TODAY);
      expect(result.recentExcusalCount).toBe(0);
    });

    it('is independent of consecutiveMissedDays and daysBehind - a fully current, paid-up plan can still have a high recent count', () => {
      const result = derivePlanFigures(
        basePosition({
          amountDue: new Prisma.Decimal(12000),
          amountPaid: new Prisma.Decimal(12000),
          excusedDates: [day(-1), day(-2), day(-3), day(-4), day(-5)],
        }),
        TODAY,
      );
      expect(result.daysBehind).toBe(0);
      expect(result.consecutiveMissedDays).toBe(0);
      expect(result.recentExcusalCount).toBe(5);
    });
  });

  describe('pastDeadlineStillOwing (Stage G10)', () => {
    it('is false when contractEndDate was never typed in (null), however much is still owed', () => {
      const result = derivePlanFigures(
        basePosition({
          contractEndDate: null,
          amountDue: new Prisma.Decimal(1_800_000),
          amountPaid: new Prisma.Decimal(0),
        }),
        TODAY,
      );
      expect(result.pastDeadlineStillOwing).toBe(false);
    });

    it('is true once contractEndDate has passed and remainingToOwn is still positive', () => {
      const result = derivePlanFigures(
        basePosition({
          contractEndDate: day(-1),
          amountDue: new Prisma.Decimal(1_800_000),
          amountPaid: new Prisma.Decimal(0),
        }),
        TODAY,
      );
      expect(result.pastDeadlineStillOwing).toBe(true);
    });

    it('is false once contractEndDate has passed but the plan is fully paid (remainingToOwn <= 0)', () => {
      const result = derivePlanFigures(
        basePosition({
          contractEndDate: day(-1),
          amountDue: new Prisma.Decimal(1_800_000),
          amountPaid: new Prisma.Decimal(1_800_000),
        }),
        TODAY,
      );
      expect(result.pastDeadlineStillOwing).toBe(false);
    });

    it('is false while contractEndDate is still in the future, however far behind the driver is', () => {
      const result = derivePlanFigures(
        basePosition({
          contractEndDate: day(1),
          amountDue: new Prisma.Decimal(1_800_000),
          amountPaid: new Prisma.Decimal(0),
        }),
        TODAY,
      );
      expect(result.pastDeadlineStillOwing).toBe(false);
    });

    it('is independent of consecutiveMissedDays - true even for a driver with no current missed streak', () => {
      const result = derivePlanFigures(
        basePosition({
          contractEndDate: day(-30),
          amountDue: new Prisma.Decimal(1_800_000),
          amountPaid: new Prisma.Decimal(0),
          assignmentPayments: [paidRow(-1, 12000), paidRow(-2, 12000)], // paid in full, no streak
        }),
        TODAY,
      );
      expect(result.consecutiveMissedDays).toBe(0);
      expect(result.pastDeadlineStillOwing).toBe(true);
    });
  });
});
