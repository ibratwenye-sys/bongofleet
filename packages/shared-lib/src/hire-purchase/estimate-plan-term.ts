/**
 * Stage G Part 1 - the one place that estimates how long a hire-purchase
 * plan will take, shared between the backend (validating/quoting a plan)
 * and the dashboard's create-plan form (showing the owner a live preview as
 * they type). Money is passed as plain numbers, not Prisma.Decimal - this
 * runs in the browser as well as Node, and Prisma.Decimal isn't available
 * there. Amounts are converted to integer cents internally so the division
 * below is exact, matching the backend's Prisma.Decimal arithmetic bit for
 * bit rather than drifting on floating-point division.
 *
 * Three different quantities, three different names - never conflate them:
 *
 *   - paymentDayCount: ceil(totalOwed / dailyAmount), the number of days the
 *     driver actually makes a payment on (every full day, plus the smaller
 *     final day if totalOwed isn't an exact multiple of dailyAmount).
 *   - calendarEndDate: the calendar date the paymentDayCount'th payment day
 *     falls on, counting only activeWeekdays and starting from startDate
 *     itself (startDate counts as day 1 if it is an active weekday - this
 *     matches OwnershipPlanGeneratorService's own naturalStart, which bills
 *     a fresh plan starting on startDate, never startDate + 1).
 *   - finalInstalment: the remainder when totalOwed does not divide evenly
 *     by dailyAmount - i.e. what the Stage E daily-charge generator actually
 *     bills on the last payment day. Zero when it divides exactly.
 *
 * A plan that skips a weekday takes MORE calendar days than payment days -
 * "1,800,000 at 12,000/day" is 150 payment days, not "≈175 riding days"; a
 * design doc that phrases it that way is conflating paymentDayCount with
 * calendarEndDate's span. Never reproduce that.
 */

export interface EstimatePlanTermInput {
  totalPrice: number;
  downPayment: number;
  dailyAmount: number;
  /** ISO date (YYYY-MM-DD, or any Date-parseable string) the plan starts on. */
  startDate: string;
  /** 0=Sun..6=Sat, matching OwnershipPlan.activeWeekdays. */
  activeWeekdays: number[];
}

export interface PlanTermEstimate {
  paymentDayCount: number;
  /** ISO date (YYYY-MM-DD), safe to send straight back as contractEndDate. */
  calendarEndDate: string;
  finalInstalment: number;
}

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
 *  create-plan form, where no DTO validates activeWeekdays before it gets
 *  here, so both failure modes below are guarded inside the function rather
 *  than assumed away by a caller precondition:
 *
 *  - an empty activeWeekdays would otherwise loop forever (unchecking every
 *    weekday mid-edit is ordinary user behaviour, not a validation gap the
 *    form is expected to prevent before this runs);
 *  - a day-by-day walk is O(n) in the payment day count - a dailyAmount of 1
 *    against a six-figure total is >1,000,000 synchronous iterations, easily
 *    landing between two keystrokes.
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

export function estimatePlanTerm(input: EstimatePlanTermInput): PlanTermEstimate {
  const startDate = dateOnlyUTC(new Date(input.startDate));

  const totalOwedCents = toCents(input.totalPrice) - toCents(input.downPayment);
  if (totalOwedCents <= 0) {
    return { paymentDayCount: 0, calendarEndDate: toIsoDate(startDate), finalInstalment: 0 };
  }

  const dailyAmountCents = toCents(input.dailyAmount);
  const fullDays = Math.floor(totalOwedCents / dailyAmountCents);
  const remainderCents = totalOwedCents - fullDays * dailyAmountCents;

  const paymentDayCount = remainderCents > 0 ? fullDays + 1 : fullDays;
  const finalInstalment = remainderCents / 100;

  const calendarEndDate = nthActiveWeekdayFrom(startDate, paymentDayCount, input.activeWeekdays);

  return { paymentDayCount, calendarEndDate: toIsoDate(calendarEndDate), finalInstalment };
}
