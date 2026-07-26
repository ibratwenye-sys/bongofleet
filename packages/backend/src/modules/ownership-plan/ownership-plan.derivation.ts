import { Prisma } from '@prisma/client';

/**
 * Raw inputs the derivation needs. amountDue/amountPaid are sums the caller
 * has already queried (see ownership-plan.service.ts) - this file does no
 * Prisma calls itself, so the arithmetic is unit-testable without a database.
 */
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
}

export interface DerivedPlanFigures {
  amountDue: string;
  amountPaid: string;
  amountBilled: string;
  netPosition: string;
  daysBehind: number;
  daysAhead: number;
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

function totalOwed(totalPrice: Prisma.Decimal, downPayment: Prisma.Decimal): Prisma.Decimal {
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
 * and reused everywhere (ownership-plan.service.ts, the nightly generator,
 * payment.service.ts's overpayment guard) rather than re-derived.
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
    remainingToOwn: remainingToOwn.toFixed(2),
    remainingToBill: remainingToBill.toFixed(2),
    daysLeft,
    projectedCompletion: isoDate(projectedCompletion),
  };
}
