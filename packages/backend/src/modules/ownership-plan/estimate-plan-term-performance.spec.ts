/**
 * Stage G2 Part 2, carried forward by Stage G7 - nthActiveWeekdayFrom (inside
 * estimatePlanTerm, shared-lib) used to walk one calendar day at a time,
 * unguarded against an empty activeWeekdays. Both were real hazards
 * specifically because this function runs in the browser on every keystroke
 * of the create-plan form, where no DTO validates activeWeekdays first - not
 * because either input can occur server-side. These tests exercise exactly
 * those two hazards, plus a property check that the O(1) arithmetic
 * replacement agrees with the old O(n) walk everywhere the walk itself was
 * correct.
 *
 * Stage G7 replaced the totalPrice/downPayment-derived day count with a
 * day count given directly (the "days" input) - the day-by-day walk itself,
 * and therefore its performance characteristics, are unchanged.
 */
import { estimatePlanTerm } from '@bongofleet/shared-lib';

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

describe('estimatePlanTerm / nthActiveWeekdayFrom (Stage G2 Part 2)', () => {
  it('Part 2a: throws immediately on an empty activeWeekdays, rather than hanging', () => {
    expect(() =>
      estimatePlanTerm({
        dailyAmount: 12_000,
        days: 150,
        startDate: '2026-08-03',
        activeWeekdays: [],
      }),
    ).toThrow();
  });

  it('Part 2b: a large day count returns promptly, not just correctly', () => {
    const startedAt = Date.now();
    const estimate = estimatePlanTerm({
      dailyAmount: 1,
      days: 1_800_000,
      startDate: '2026-08-03',
      activeWeekdays: [1, 2, 3, 4, 5, 6],
    });
    const elapsedMs = Date.now() - startedAt;

    // The old day-by-day walk took ~1.8 million synchronous iterations here -
    // easily hundreds of ms, and on the browser's single thread, one dropped
    // keystroke. The arithmetic replacement should be indistinguishable from
    // instant.
    expect(elapsedMs).toBeLessThan(100);
    expect(estimate.exact).toBe(true);
    if (!estimate.exact) return;
    expect(estimate.days).toBe(1_800_000);
  });

  it('Part 2c: the arithmetic replacement agrees with the old O(n) walk across a range of day counts, weekday sets and start dates', () => {
    const weekdaySets: number[][] = [
      [0, 1, 2, 3, 4, 5, 6],
      [1, 2, 3, 4, 5, 6],
      [1, 3, 5],
      [0, 6],
      [2],
    ];
    const dayCounts = [1, 5, 133, 150, 430, 1800];
    const startDates = ['2026-08-03', '2026-01-01', '2026-12-31'];

    let comparisons = 0;
    for (const activeWeekdays of weekdaySets) {
      for (const days of dayCounts) {
        for (const startDate of startDates) {
          const start = utcDateOnly(startDate);
          const expected = toIsoDate(oldNthActiveWeekdayFromWalk(start, days, activeWeekdays));

          const estimate = estimatePlanTerm({
            dailyAmount: 12_000,
            days,
            startDate,
            activeWeekdays,
          });

          expect(estimate.exact).toBe(true);
          if (!estimate.exact) continue;
          expect(estimate.calendarEndDate).toBe(expected);
          comparisons += 1;
        }
      }
    }
    // Guards against the loop bounds above silently shrinking to nothing.
    expect(comparisons).toBeGreaterThan(60);
  });
});
