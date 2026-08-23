// Extracted from HomeScreen.tsx unchanged - shared by Leo and Lipa now that
// the balance display and the payment list live in separate screens.

export function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatTZS(value: number | string): string {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return `TZS ${Math.round(Number.isFinite(n) ? n : 0).toLocaleString()}`;
}

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

// Stage G2 - the hire-purchase card's dates (DESIGN_HIRE_PURCHASE.md §8:
// "Started 3 Mar 2026 · ends 12 Feb 2027", "nothing due until 24 July").
// Every other screen in this app shows raw ISO dates (date.slice(0, 10)) -
// this card is the one place that spells the month out, per the design's
// own example copy. Always includes the year, even where the design's
// "nothing due until 24 July" example omits it - a driver far enough ahead
// for that date to land next year must not read it as this year.
export function formatDateHuman(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  return `${d.getUTCDate()} ${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
