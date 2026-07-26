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
  contractEndDate: Date | null;
  activeWeekdays: number[];
}

export interface DerivedPlanFigures {
  amountDue: string;
  amountPaid: string;
  netPosition: string;
  daysBehind: number;
  daysAhead: number;
  remainingToOwn: string;
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

/**
 * How much more the driver still has to pay in total, based on what has
 * actually been paid - never on how many instalments have been billed. The
 * nightly generator (ownership-plan-generator.service.ts) reuses this exact
 * function for its own completion check and final-instalment clamp, so there
 * is only ever one way this number gets computed.
 */
export function computeRemainingToOwn(
  totalPrice: Prisma.Decimal,
  downPayment: Prisma.Decimal,
  amountPaid: Prisma.Decimal,
): Prisma.Decimal {
  return totalPrice.minus(downPayment).minus(amountPaid);
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
    netPosition: netPosition.toFixed(2),
    daysBehind,
    daysAhead,
    remainingToOwn: remainingToOwn.toFixed(2),
    daysLeft,
    projectedCompletion: isoDate(projectedCompletion),
  };
}
