/**
 * Stage G2 Part 2 - nthActiveWeekdayFrom (inside estimatePlanTerm, shared-lib)
 * used to walk one calendar day at a time, unguarded against an empty
 * activeWeekdays. Both were real hazards specifically because this function
 * runs in the browser on every keystroke of the create-plan form, where no
 * DTO validates activeWeekdays first - not because either input can occur
 * server-side. These tests exercise exactly those two hazards, plus a
 * property check that the O(1) arithmetic replacement agrees with the old
 * O(n) walk everywhere the walk itself was correct.
 */
import { estimatePlanTerm } from '@bongofleet/shared-lib';

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

function utcDateOnly(iso: string): Date {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDaysUTC(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// The pre-Stage-G2 implementation of nthActiveWeekdayFrom, kept here only as
// the property test's reference oracle - exactly what shared-lib used to do
// before the O(1) arithmetic replaced the day-by-day walk.
function oldNthActiveWeekdayFromWalk(start: Date, n: number, activeWeekdays: number[]): Date {
  if (n <= 0) return start;
  let cursor = start;
  let counted = 0;
  for (;;) {
    if (activeWeekdays.includes(cursor.getUTCDay())) {
      counted += 1;
      if (counted === n) return cursor;
    }
    cursor = addDaysUTC(cursor, 1);
  }
}

// Mirrors estimatePlanTerm's own (unchanged) paymentDayCount arithmetic, so
// the property test can hand the old walk the same n estimatePlanTerm used
// internally.
function paymentDayCountFor(totalPrice: number, downPayment: number, dailyAmount: number): number {
  const totalOwedCents = toCents(totalPrice) - toCents(downPayment);
  if (totalOwedCents <= 0) return 0;
  const dailyAmountCents = toCents(dailyAmount);
  const fullDays = Math.floor(totalOwedCents / dailyAmountCents);
  const remainderCents = totalOwedCents - fullDays * dailyAmountCents;
  return remainderCents > 0 ? fullDays + 1 : fullDays;
}

describe('estimatePlanTerm / nthActiveWeekdayFrom (Stage G2 Part 2)', () => {
  it('Part 2a: throws immediately on an empty activeWeekdays, rather than hanging', () => {
    expect(() =>
      estimatePlanTerm({
        totalPrice: 1_800_000,
        downPayment: 0,
        dailyAmount: 12_000,
        startDate: '2026-08-03',
        activeWeekdays: [],
      }),
    ).toThrow();
  });

  it('Part 2b: a dailyAmount of 1 against a large total returns promptly, not just correctly', () => {
    const startedAt = Date.now();
    const estimate = estimatePlanTerm({
      totalPrice: 1_800_000,
      downPayment: 0,
      dailyAmount: 1,
      startDate: '2026-08-03',
      activeWeekdays: [1, 2, 3, 4, 5, 6],
    });
    const elapsedMs = Date.now() - startedAt;

    // The old day-by-day walk took ~1.8 million synchronous iterations here -
    // easily hundreds of ms, and on the browser's single thread, one dropped
    // keystroke. The arithmetic replacement should be indistinguishable from
    // instant.
    expect(elapsedMs).toBeLessThan(100);
    expect(estimate.paymentDayCount).toBe(1_800_000);
  });

  it('Part 2c: the arithmetic replacement agrees with the old O(n) walk across a range of totals, daily amounts, weekday sets and start dates', () => {
    const weekdaySets: number[][] = [
      [0, 1, 2, 3, 4, 5, 6],
      [1, 2, 3, 4, 5, 6],
      [1, 3, 5],
      [0, 6],
      [2],
    ];
    const totals: Array<[number, number]> = [
      [1_800_000, 0],
      [1_800_000, 200_000],
      [37_500, 12_300],
      [12_000, 0],
    ];
    const dailyAmounts = [12_000, 5_500, 1_000, 999];
    const startDates = ['2026-08-03', '2026-01-01', '2026-12-31'];

    let comparisons = 0;
    for (const activeWeekdays of weekdaySets) {
      for (const [totalPrice, downPayment] of totals) {
        for (const dailyAmount of dailyAmounts) {
          for (const startDate of startDates) {
            const n = paymentDayCountFor(totalPrice, downPayment, dailyAmount);
            if (n === 0) continue;

            const start = utcDateOnly(startDate);
            const expected = toIsoDate(oldNthActiveWeekdayFromWalk(start, n, activeWeekdays));

            const estimate = estimatePlanTerm({
              totalPrice,
              downPayment,
              dailyAmount,
              startDate,
              activeWeekdays,
            });

            expect(estimate.calendarEndDate).toBe(expected);
            comparisons += 1;
          }
        }
      }
    }
    // Guards against the loop bounds above silently shrinking to nothing.
    expect(comparisons).toBeGreaterThan(200);
  });
});
