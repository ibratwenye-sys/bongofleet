import { Prisma } from '@prisma/client';

/**
 * Raw inputs the derivation needs. amountDue/amountPaid are sums the caller
 * has already queried (see ownership-plan.service.ts) - this file does no
 * Prisma calls itself, so the arithmetic is unit-testable without a database.
 */
export interface AssignmentPaidRow {
  assignedDate: Date;
  /** COMPLETED-only, matching amountPaid's own convention throughout this
   *  file - a PENDING payment does not clear a day for breach purposes any
   *  more than it moves the driver closer to owning the vehicle. */
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
  remainingToOwn: string;
  remainingToBill: string;
  daysLeft: number | null;
  projectedCompletion: string;
}

function dateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
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
 * Stage G2 Part 1. The run of consecutive ASSIGNED days, ending at today
 * (inclusive) and walking backwards, where paidAmount is zero - stopping at
 * the first day that has any COMPLETED payment at all, however small. A
 * shortfall day (paid something, just not enough) breaks the run the same
 * way "kutofanya malipo" (failing to pay) in the contract means paying
 * nothing, not paying less - this mirrors the codebase's own existing
 * NO_PAYMENT/SHORTFALL split (see missed-payment-notification.service.ts),
 * not a new distinction invented here.
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
 */
export function computeConsecutiveMissedDays(rows: AssignmentPaidRow[], today: Date): number {
  const todayOnly = dateOnly(today);
  const relevant = rows
    .filter((row) => dateOnly(row.assignedDate).getTime() <= todayOnly.getTime())
    .sort((a, b) => b.assignedDate.getTime() - a.assignedDate.getTime());

  let count = 0;
  for (const row of relevant) {
    if (!row.paidAmount.isZero()) {
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

  const consecutiveMissedDays = computeConsecutiveMissedDays(input.assignmentPayments, todayOnly);

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
    remainingToOwn: remainingToOwn.toFixed(2),
    remainingToBill: remainingToBill.toFixed(2),
    daysLeft,
    projectedCompletion: isoDate(projectedCompletion),
  };
}
