/**
 * Stage G5 Part 3 - "a driver excused twelve days this quarter" is a pattern
 * invisible one day at a time, so the Ownership list surfaces a count of a
 * driver's APPROVED excusals over a recent window. This file is the pure
 * date-window/counting half of that; the backend (ownership-plan.service.ts)
 * supplies the actual excusal dates from a query it already runs for
 * computeConsecutiveMissedDays - no query of its own.
 *
 * There is deliberately no cap or threshold anywhere in here - counting is
 * the whole feature. A limit would turn a conversation the owner should be
 * having into a rule that blocks a driver from being excused a thirteenth
 * time, which is exactly backwards.
 */

/** The default window this count looks back over, in days. */
export const RECENT_EXCUSAL_WINDOW_DAYS = 90;

/**
 * The earliest date (inclusive) that counts as "recent" as of `today`, `n`
 * days back. Both dates are truncated to UTC midnight first - callers pass
 * whole calendar dates (DayExcusal.excusedDate is a bare @db.Date, no time
 * component), so the window boundary should be one too, not shifted by
 * whatever time of day `today` happens to carry.
 */
export function excusalWindowStart(
  today: Date,
  windowDays: number = RECENT_EXCUSAL_WINDOW_DAYS,
): Date {
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - windowDays);
  return start;
}

/**
 * How many of `excusedDates` fall within the last `windowDays` days of
 * `today`, inclusive on both ends - a date of exactly `today` counts (an
 * excusal for today is still "recent"), and one exactly `windowDays` days
 * back still counts too (a 90-day window means the 90th day back is inside
 * it, not the 91st). Callers are expected to have already filtered to
 * APPROVED-only dates, same convention as excusedDates elsewhere in this
 * codebase (ownership-plan.derivation.ts) - this function has no notion of
 * DayExcusal.status at all.
 */
export function countRecentExcusals(
  excusedDates: Date[],
  today: Date,
  windowDays: number = RECENT_EXCUSAL_WINDOW_DAYS,
): number {
  const start = excusalWindowStart(today, windowDays);
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  return excusedDates.filter((date) => {
    const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    return day.getTime() >= start.getTime() && day.getTime() <= end.getTime();
  }).length;
}
