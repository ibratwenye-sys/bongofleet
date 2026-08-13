/**
 * Stage G5 Part 3/4 - shared-lib's pure date-window/counting logic, tested
 * here per the dashboard-has-no-test-runner rule. Rebuild shared-lib's
 * dist/ before trusting a filtered run of just this file - stale dist has
 * silently masked source changes here three times already.
 */
import { countRecentExcusals, excusalWindowStart } from '@bongofleet/shared-lib';

function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

describe('excusalWindowStart', () => {
  it('is exactly windowDays calendar days before today, at UTC midnight', () => {
    const today = utc(2026, 8, 13);
    expect(excusalWindowStart(today, 90).toISOString()).toBe(
      new Date(Date.UTC(2026, 4, 15)).toISOString(), // 90 days before Aug 13 = May 15
    );
  });

  it('truncates a today with a time-of-day component to the calendar date first', () => {
    const today = new Date('2026-08-13T18:45:00.000Z');
    expect(excusalWindowStart(today, 90).toISOString()).toBe(
      new Date(Date.UTC(2026, 4, 15)).toISOString(),
    );
  });

  it('defaults to the 90-day window when windowDays is omitted', () => {
    const today = utc(2026, 8, 13);
    expect(excusalWindowStart(today).getTime()).toBe(excusalWindowStart(today, 90).getTime());
  });
});

describe('countRecentExcusals (Stage G5 Part 3)', () => {
  const today = utc(2026, 8, 13);

  it('counts nothing for an empty list', () => {
    expect(countRecentExcusals([], today, 90)).toBe(0);
  });

  it('counts a date exactly today as recent (inclusive upper bound)', () => {
    expect(countRecentExcusals([today], today, 90)).toBe(1);
  });

  it('counts a date exactly windowDays back as recent (inclusive lower bound)', () => {
    const exactlyNinetyDaysBack = utc(2026, 5, 15);
    expect(countRecentExcusals([exactlyNinetyDaysBack], today, 90)).toBe(1);
  });

  it('excludes a date one day beyond the window', () => {
    const ninetyOneDaysBack = utc(2026, 5, 14);
    expect(countRecentExcusals([ninetyOneDaysBack], today, 90)).toBe(0);
  });

  it('excludes a future date beyond today', () => {
    const tomorrow = utc(2026, 8, 14);
    expect(countRecentExcusals([tomorrow], today, 90)).toBe(0);
  });

  it('counts only the dates that fall inside the window, out of a mixed set', () => {
    const dates = [
      utc(2026, 8, 10), // inside
      utc(2026, 7, 1), // inside
      utc(2026, 1, 1), // outside (too old)
      utc(2026, 8, 20), // outside (future)
    ];
    expect(countRecentExcusals(dates, today, 90)).toBe(2);
  });

  it('respects a non-default windowDays', () => {
    const dates = [utc(2026, 8, 1), utc(2026, 7, 1)]; // 12 days back, 43 days back
    expect(countRecentExcusals(dates, today, 30)).toBe(1);
  });
});
