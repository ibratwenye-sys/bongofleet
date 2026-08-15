/**
 * Stage G7 - the daily amount and the number of payment days are what the
 * owner and driver actually negotiate; the total is their product, exactly,
 * always. This function works in both directions, matching how the
 * conversation actually goes: Ibrahim enters the daily amount, then either
 * the number of days or the total, and the other is computed.
 *
 *   - days given: total = dailyAmount * days. Exact, no rounding, ever - this
 *     direction can never fail to divide evenly, because there is no
 *     division in it.
 *   - total given: days = total / dailyAmount. When that does not divide
 *     evenly, this does NOT round or truncate silently - it returns both
 *     neighbouring whole-day options (their exact totals included) so the
 *     owner and rider can settle the real number face to face, rather than
 *     discovering a rounded figure for the first time on a printed contract.
 *
 * Replaces the previous totalPrice/downPayment-based estimatePlanTerm, which
 * derived totalOwed as totalPrice - downPayment and always divided it by
 * dailyAmount, producing a finalInstalment remainder whenever it didn't
 * divide evenly. That remainder - and every partial-final-day concept it fed
 * - no longer exists: totalOwed is now dailyAmount * instalmentCount by
 * construction, so a remainder can only arise here, upfront, while the term
 * is still being negotiated, never after the fact on a contract.
 *
 * Amounts are converted to integer cents internally so the arithmetic is
 * exact, matching the backend's Prisma.Decimal arithmetic bit for bit rather
 * than drifting on floating-point division. Runs in the browser (the
 * dashboard's create-plan form) as well as Node, so money is plain numbers,
 * not Prisma.Decimal.
 */

export interface EstimatePlanTermByDaysInput {
  dailyAmount: number;
  days: number;
  /** ISO date (YYYY-MM-DD, or any Date-parseable string) the plan starts on. */
  startDate: string;
  /** 0=Sun..6=Sat, matching OwnershipPlan.activeWeekdays. */
  activeWeekdays: number[];
}

export interface EstimatePlanTermByTotalInput {
  dailyAmount: number;
  total: number;
  /** ISO date (YYYY-MM-DD, or any Date-parseable string) the plan starts on. */
  startDate: string;
  /** 0=Sun..6=Sat, matching OwnershipPlan.activeWeekdays. */
  activeWeekdays: number[];
}

export type EstimatePlanTermInput = EstimatePlanTermByDaysInput | EstimatePlanTermByTotalInput;

/** One resolved term: an exact day count, its exact total, and the calendar
 *  date the last payment day falls on. */
export interface PlanTermOption {
  days: number;
  total: number;
  /** ISO date (YYYY-MM-DD), safe to send straight back as contractEndDate. */
  calendarEndDate: string;
}

export type EstimatePlanTermResult =
  | ({ exact: true } & PlanTermOption)
  | {
      exact: false;
      /** The two whole-day options neighbouring the requested total - the
       *  smaller day count (undershoots the requested total) first, the
       *  larger (overshoots it) second. Never a rounded or truncated middle
       *  value. */
      options: [PlanTermOption, PlanTermOption];
    };

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

function dateOnlyUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDaysUTC(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The calendar date of the Nth active weekday counting inclusively from
 *  `start` (start itself is day 1 if it is active) - matches how a fresh
 *  plan's first payment day is startDate itself, not startDate + 1.
 *
 *  Stage G2 Part 2 - this runs in the browser on every keystroke of the
 *  create-plan form, where no DTO validates activeWeekdays first - not
 *  because either input can occur server-side. Guarded inside the function
 *  rather than assumed away by a caller precondition:
 *
 *  - an empty activeWeekdays would otherwise loop forever (unchecking every
 *    weekday mid-edit is ordinary user behaviour, not a validation gap the
 *    form is expected to prevent before this runs);
 *  - a day-by-day walk is O(n) in the day count - a dailyAmount of 1 against
 *    a six-figure total is >1,000,000 synchronous iterations, easily landing
 *    between two keystrokes.
 *
 *  Every block of 7 consecutive calendar days contains each weekday exactly
 *  once, so activeWeekdays.length active days fall in every such block
 *  regardless of where it starts. That turns most of the walk into one
 *  arithmetic step (whole weeks skipped via addDaysUTC, not iteration) and
 *  leaves at most a 7-day remainder walk - O(1) instead of O(n). */
function nthActiveWeekdayFrom(start: Date, n: number, activeWeekdays: number[]): Date {
  if (n <= 0) return start;
  if (activeWeekdays.length === 0) {
    throw new Error('nthActiveWeekdayFrom: activeWeekdays must not be empty');
  }

  const activeCount = activeWeekdays.length;
  const fullWeeks = Math.floor((n - 1) / activeCount);
  const remainder = ((n - 1) % activeCount) + 1;

  let cursor = addDaysUTC(start, fullWeeks * 7);
  let counted = 0;
  for (;;) {
    if (activeWeekdays.includes(cursor.getUTCDay())) {
      counted += 1;
      if (counted === remainder) return cursor;
    }
    cursor = addDaysUTC(cursor, 1);
  }
}

function optionFor(
  startDate: Date,
  days: number,
  activeWeekdays: number[],
  dailyAmountCents: number,
): PlanTermOption {
  return {
    days,
    total: (dailyAmountCents * days) / 100,
    calendarEndDate: toIsoDate(nthActiveWeekdayFrom(startDate, days, activeWeekdays)),
  };
}

export function estimatePlanTerm(input: EstimatePlanTermInput): EstimatePlanTermResult {
  const startDate = dateOnlyUTC(new Date(input.startDate));
  const dailyAmountCents = toCents(input.dailyAmount);

  if ('days' in input) {
    const days = Math.max(0, input.days);
    return { exact: true, ...optionFor(startDate, days, input.activeWeekdays, dailyAmountCents) };
  }

  const totalCents = toCents(input.total);
  if (totalCents <= 0) {
    return { exact: true, ...optionFor(startDate, 0, input.activeWeekdays, dailyAmountCents) };
  }

  const lowerDays = Math.floor(totalCents / dailyAmountCents);
  const remainderCents = totalCents - lowerDays * dailyAmountCents;

  if (remainderCents === 0) {
    return {
      exact: true,
      ...optionFor(startDate, lowerDays, input.activeWeekdays, dailyAmountCents),
    };
  }

  return {
    exact: false,
    options: [
      optionFor(startDate, lowerDays, input.activeWeekdays, dailyAmountCents),
      optionFor(startDate, lowerDays + 1, input.activeWeekdays, dailyAmountCents),
    ],
  };
}
