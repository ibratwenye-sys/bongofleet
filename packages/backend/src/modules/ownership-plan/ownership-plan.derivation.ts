import { Prisma } from '@prisma/client';
import { countRecentExcusals } from '@bongofleet/shared-lib';

/**
 * Raw inputs the derivation needs. amountDue/amountPaid are sums the caller
 * has already queried (see ownership-plan.service.ts) - this file does no
 * Prisma calls itself, so the arithmetic is unit-testable without a database.
 */
export interface AssignmentPaidRow {
  assignedDate: Date;
  /** Stage G3 Part 1 - this assignment's own charge, NOT the plan's flat
   *  dailyAmount. The final instalment of a plan is deliberately smaller
   *  than dailyAmount (whatever remains of totalOwed), so comparing against
   *  dailyAmount would mark every driver's last day as missed. */
  targetAmount: Prisma.Decimal;
  /** COMPLETED-only, matching amountPaid's own convention throughout this
   *  file - a PENDING payment does not clear a day for breach purposes any
   *  more than it moves the driver closer to owning the vehicle. Reflects
   *  Stage F's oldest-first allocation cascade (payment.service.ts §7), so a
   *  driver who paid several days ahead has those future rows already
   *  carrying their own allocated amount - this file never re-derives that
   *  allocation, only reads it. */
  paidAmount: Prisma.Decimal;
}

export interface PlanPosition {
  dailyAmount: Prisma.Decimal;
  totalPrice: Prisma.Decimal;
  downPayment: Prisma.Decimal;
  amountDue: Prisma.Decimal;
  amountPaid: Prisma.Decimal;
  /** Sum of targetAmount over ALL of the plan's assignments, not just up to
   * today - what has been committed, not what has come due. See
   * computeRemainingToBill. */
  amountBilled: Prisma.Decimal;
  contractEndDate: Date | null;
  activeWeekdays: number[];
  /** Every assignment's date + what was actually paid against it - used only
   *  to derive consecutiveMissedDays (see computeConsecutiveMissedDays).
   *  Order and date range don't matter; rows after `today` are ignored. */
  assignmentPayments: AssignmentPaidRow[];
  /** Stage G4 - dates with an APPROVED DayExcusal, already filtered to that
   *  status by the caller (this file makes no Prisma calls and knows nothing
   *  of DayExcusal.status - see ownership-plan.service.ts). Order doesn't
   *  matter, and a date need not have a matching assignmentPayments row yet -
   *  see computeConsecutiveMissedDays. Read only by that function; every
   *  money figure in DerivedPlanFigures is computed without looking at this
   *  at all. */
  excusedDates: Date[];
}

export interface DerivedPlanFigures {
  amountDue: string;
  amountPaid: string;
  amountBilled: string;
  netPosition: string;
  daysBehind: number;
  daysAhead: number;
  /** Stage G2 Part 1 - the length of the unbroken run of assigned-but-unpaid
   *  days ending at today. A DIFFERENT quantity from daysBehind: daysBehind
   *  is a cumulative money position (how many days' worth of deposits the
   *  driver is short, in total, ever), while this is how many days IN A ROW
   *  the driver has paid nothing, right now. A driver who misses one day a
   *  week for five weeks can have daysBehind 5 while consecutiveMissedDays
   *  is 1 (each miss was followed by a paid day, resetting the run); a
   *  driver who was days ahead and then missed five days straight can have
   *  daysBehind 0 (still net-positive) while consecutiveMissedDays is 5.
   *  This is the figure that belongs against breachAfterConsecutiveMissedDays
   *  - see computeConsecutiveMissedDays. */
  consecutiveMissedDays: number;
  /** Stage G5 Part 3 - count of APPROVED excusals in the last 90 days
   *  (excusalWindowStart/countRecentExcusals, shared-lib). A judgement
   *  signal, same family as consecutiveMissedDays, not a limit: there is no
   *  cap this number feeds into anywhere. The point is only to make "twelve
   *  days excused this quarter" visible instead of invisible one day at a
   *  time. */
  recentExcusalCount: number;
  remainingToOwn: string;
  remainingToBill: string;
  daysLeft: number | null;
  projectedCompletion: string;
}

function dateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// East Africa Time is a fixed UTC+3 with no DST, matching the cron jobs'
// own timezone (Africa/Dar_es_Salaam).
const DAR_ES_SALAAM_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * Stage G3 Part 2 - the calendar date `instant` falls on in Africa/Dar_es_Salaam,
 * not UTC. assignedDate columns are plain dates (no time component, already
 * the correct calendar day - see AssignmentPaidRow), but `instant` ("now") is
 * a real timestamp, and UTC is 3 hours behind Dar es Salaam: for the first
 * three hours of every local day, a naive UTC dateOnly() would still report
 * yesterday's date. Only ever apply this to an instant, never to an
 * assignedDate that is already a bare calendar date.
 */
function dateOnlyInDarEsSalaam(instant: Date): Date {
  return dateOnly(new Date(instant.getTime() + DAR_ES_SALAAM_UTC_OFFSET_MS));
}

function isActiveWeekday(date: Date, activeWeekdays: number[]): boolean {
  return activeWeekdays.includes(date.getUTCDay());
}

/**
 * Active-weekday dates strictly after `from`, up to and including `to`.
 * 0 if `to` is not after `from`. Excluding non-active weekdays (e.g. Sunday)
 * is the whole point - a flat calendar-day count overstates every driver's
 * arrears by the Sundays in the range.
 */
function countActiveWeekdaysAfter(from: Date, to: Date, activeWeekdays: number[]): number {
  const end = dateOnly(to);
  const cursor = dateOnly(from);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  let count = 0;
  while (cursor.getTime() <= end.getTime()) {
    if (isActiveWeekday(cursor, activeWeekdays)) {
      count += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

/** The date reached after advancing `count` active-weekday days from `from`. */
function advanceActiveWeekdays(from: Date, count: number, activeWeekdays: number[]): Date {
  const cursor = dateOnly(from);
  let remaining = count;
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (isActiveWeekday(cursor, activeWeekdays)) {
      remaining -= 1;
    }
  }
  return cursor;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Exported for tests only, as the plain building block the three
 * computeRemaining* functions below share - not itself part of
 * DerivedPlanFigures. */
export function totalOwed(totalPrice: Prisma.Decimal, downPayment: Prisma.Decimal): Prisma.Decimal {
  return totalPrice.minus(downPayment);
}

/**
 * How much more the driver still has to PAY in total - based on what has
 * actually been paid, never on how many instalments have been billed. Reads:
 * the progress bar, daysLeft, projectedCompletion, and the generator's
 * COMPLETION check (mark COMPLETED only when this hits zero - the driver has
 * actually paid for the vehicle).
 *
 * This is a genuinely different quantity from computeRemainingToBill, not a
 * second implementation of the same one: a driver who stops paying keeps
 * remainingToOwn frozen at their arrears forever, while remainingToBill is
 * what caps the generator from billing past the price of the vehicle. Both
 * are computed exactly once, here and in computeRemainingToBill respectively,
 * and reused everywhere (ownership-plan.service.ts, the nightly generator)
 * rather than re-derived. See computeRemainingUnreserved for the (stricter)
 * quantity payment.service.ts's overpayment guard actually tests against.
 */
export function computeRemainingToOwn(
  totalPrice: Prisma.Decimal,
  downPayment: Prisma.Decimal,
  amountPaid: Prisma.Decimal,
): Prisma.Decimal {
  return totalOwed(totalPrice, downPayment).minus(amountPaid);
}

/**
 * How much more the generator may still create OBLIGATIONS for - based on
 * what has already been billed (all assignments ever created for the plan),
 * never on what has been paid. This is the cap that stops a non-paying
 * driver's arrears from billing past the price of the vehicle: once
 * amountBilled reaches totalOwed, this hits zero and the generator stops,
 * even though the plan stays ACTIVE (remainingToOwn is still positive - the
 * debt just stops growing).
 */
export function computeRemainingToBill(
  totalPrice: Prisma.Decimal,
  downPayment: Prisma.Decimal,
  amountBilled: Prisma.Decimal,
): Prisma.Decimal {
  return totalOwed(totalPrice, downPayment).minus(amountBilled);
}

/**
 * The overpayment guard's actual ceiling. remainingToOwn is COMPLETED-only,
 * so two payments that are each individually within it can both pass and
 * jointly overpay the plan while both sit PENDING - rare today (payments
 * complete immediately), but ordinary once mobile-money reconciliation makes
 * PENDING common. This counts PENDING + COMPLETED (everything but FAILED): a
 * PENDING payment reserves its space until it actually fails. Always <=
 * remainingToOwn, since amountReserved >= amountPaid.
 */
export function computeRemainingUnreserved(
  totalPrice: Prisma.Decimal,
  downPayment: Prisma.Decimal,
  amountReserved: Prisma.Decimal,
): Prisma.Decimal {
  return totalOwed(totalPrice, downPayment).minus(amountReserved);
}

/**
 * The run of consecutive ASSIGNED days, ending at yesterday (Stage G3 Part 2
 * - today is excluded; see below) and walking backwards, where paidAmount
 * falls short of that day's own targetAmount - stopping at the first day
 * paid in full or better.
 *
 * Stage G3 Part 1 - "paid" means paidAmount >= targetAmount, not merely
 * nonzero. A driver owing 12,000 who pays 500 has not paid that day; letting
 * any nonzero payment reset the streak would let a driver dribble a token
 * amount indefinitely and never trip the breach flag. >= rather than ==
 * because an overpayment on a day still counts as paid. Compared against
 * that ROW's own targetAmount, never the plan's flat dailyAmount - a plan's
 * final instalment is deliberately smaller than dailyAmount, and comparing
 * against dailyAmount would mark every driver's last day as missed.
 *
 * Stage G3 Part 2 - today does not count as missed until it has fully
 * elapsed. The old `<=` boundary counted today's charge as missed from the
 * moment it was created at local midnight, before the driver had all day to
 * pay it; a threshold of 5 could turn red hours before the 5th day was even
 * over. `today` here is the current instant (not yet truncated), so the
 * elapsed/not-elapsed boundary is computed in Africa/Dar_es_Salaam - the
 * cron jobs' own timezone - via dateOnlyInDarEsSalaam, not UTC.
 *
 * Only rows that actually exist count - a day with no assignment at all
 * (an inactive weekday, or one the generator hasn't backfilled yet) is not
 * part of the obligation sequence and is silently skipped, never treated as
 * either a miss or a break. This is why the walk is over `rows`, not over
 * calendar days: the assignment rows themselves already encode which days
 * were active.
 *
 * Deliberately independent of daysBehind (see DerivedPlanFigures) - do not
 * derive one from the other, or the "one miss a week" vs "five in a row"
 * distinction this function exists for collapses back into the same number.
 *
 * Stage G4 - an excused date (an APPROVED DayExcusal - see excusedDates on
 * PlanPosition) is transparent to the run: `continue`, not `break` and not
 * skip-the-count. It neither extends the streak (like a paid day would stop
 * it) nor breaks it (an unexcused miss right before an excused day still
 * chains through to one right after) - it behaves exactly like a day with no
 * assignment row, which is the whole point: unexcused Monday, excused
 * Tuesday, unexcused Wednesday is a run of two, not one, not zero. A
 * REQUESTED or DECLINED excusal must never reach this function at all - the
 * caller filters to APPROVED before building excusedDates - so there is
 * nothing here to gate on status.
 */
export function computeConsecutiveMissedDays(
  rows: AssignmentPaidRow[],
  today: Date,
  excusedDates: Date[] = [],
): number {
  const elapsedBefore = dateOnlyInDarEsSalaam(today);
  const excused = new Set(excusedDates.map((d) => dateOnly(d).getTime()));
  const relevant = rows
    .filter((row) => dateOnly(row.assignedDate).getTime() < elapsedBefore.getTime())
    .sort((a, b) => b.assignedDate.getTime() - a.assignedDate.getTime());

  let count = 0;
  for (const row of relevant) {
    if (excused.has(dateOnly(row.assignedDate).getTime())) {
      continue;
    }
    if (row.paidAmount.greaterThanOrEqualTo(row.targetAmount)) {
      break;
    }
    count += 1;
  }
  return count;
}

/**
 * netPosition = amountPaid - amountDue is the single signed number everything
 * else reads from. daysBehind and daysAhead are two directions of the same
 * read - never compute them independently, or a driver ends up "2 days
 * behind" on one screen and "1 day ahead" on another.
 */
export function derivePlanFigures(
  input: PlanPosition,
  today: Date = new Date(),
): DerivedPlanFigures {
  const netPosition = input.amountPaid.minus(input.amountDue);

  const daysBehind = netPosition.isNegative()
    ? netPosition.negated().dividedBy(input.dailyAmount).ceil().toNumber()
    : 0;
  const daysAhead = netPosition.isPositive()
    ? netPosition.dividedBy(input.dailyAmount).floor().toNumber()
    : 0;

  const remainingToOwn = computeRemainingToOwn(
    input.totalPrice,
    input.downPayment,
    input.amountPaid,
  );
  const remainingToBill = computeRemainingToBill(
    input.totalPrice,
    input.downPayment,
    input.amountBilled,
  );

  const todayOnly = dateOnly(today);

  // Not todayOnly - computeConsecutiveMissedDays needs the actual instant to
  // compute its own Africa/Dar_es_Salaam day boundary (Stage G3 Part 2); a
  // UTC-truncated value has already lost the information that distinguishes
  // them for the first three hours of every local day.
  const consecutiveMissedDays = computeConsecutiveMissedDays(
    input.assignmentPayments,
    today,
    input.excusedDates,
  );

  // Stage G5 Part 3 - same excusedDates already fetched for
  // consecutiveMissedDays above, no separate query. today (not todayOnly) is
  // fine here - countRecentExcusals truncates to UTC midnight itself.
  const recentExcusalCount = countRecentExcusals(input.excusedDates, today);

  const daysLeft = input.contractEndDate
    ? countActiveWeekdaysAfter(todayOnly, input.contractEndDate, input.activeWeekdays)
    : null;

  const daysToCompletion = Prisma.Decimal.max(remainingToOwn, 0)
    .dividedBy(input.dailyAmount)
    .ceil()
    .toNumber();
  const projectedCompletion = advanceActiveWeekdays(
    todayOnly,
    daysToCompletion,
    input.activeWeekdays,
  );

  return {
    amountDue: input.amountDue.toFixed(2),
    amountPaid: input.amountPaid.toFixed(2),
    amountBilled: input.amountBilled.toFixed(2),
    netPosition: netPosition.toFixed(2),
    daysBehind,
    daysAhead,
    consecutiveMissedDays,
    recentExcusalCount,
    remainingToOwn: remainingToOwn.toFixed(2),
    remainingToBill: remainingToBill.toFixed(2),
    daysLeft,
    projectedCompletion: isoDate(projectedCompletion),
  };
}
