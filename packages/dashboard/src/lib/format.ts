/** Format a TZS amount (accepts a number or a Prisma-Decimal string). */
export function formatTZS(amount: number | string): string {
  const value = typeof amount === 'string' ? parseFloat(amount) : amount;
  return (Number.isFinite(value) ? value : 0).toLocaleString(undefined, {
    style: 'currency',
    currency: 'TZS',
    maximumFractionDigits: 0,
  });
}

/** YYYY-MM-DD for a Date, in local time. */
export function toDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** First day of the current month as YYYY-MM-DD (local time). */
export function startOfThisMonth(): string {
  const now = new Date();
  return toDateInput(new Date(now.getFullYear(), now.getMonth(), 1));
}

/** Today as YYYY-MM-DD (local time). */
export function today(): string {
  return toDateInput(new Date());
}
