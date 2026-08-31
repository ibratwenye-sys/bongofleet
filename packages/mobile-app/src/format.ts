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

const SWAHILI_MONTHS = [
  'Januari',
  'Februari',
  'Machi',
  'Aprili',
  'Mei',
  'Juni',
  'Julai',
  'Agosti',
  'Septemba',
  'Oktoba',
  'Novemba',
  'Desemba',
];

// Stage DM10 - Matumizi's "Madai yako" claim dates (mockup: "24 Julai", day
// + full Swahili month, no year - unlike formatDateHuman's "24 Jul 2026").
// Left as its own function rather than folded into formatDateHuman since
// that one's English-month/year shape is still correct where it's already
// used (Mkataba wangu). Turned out NOT to be what Stage DM11 needed for
// Mimi's document-expiry dates either - that stage's own task spec calls
// for formatDateHuman there instead; see formatMonthYearSwahili below for
// what DM11 actually added.
export function formatDateSwahiliShort(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  return `${d.getUTCDate()} ${SWAHILI_MONTHS[d.getUTCMonth()]}`;
}

// Stage DM11 - Mimi's tenure line ("Dereva · Rider · tangu Julai 2026").
// Same SWAHILI_MONTHS as formatDateSwahiliShort above, just day-less.
export function formatMonthYearSwahili(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  return `${SWAHILI_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Stage I1 - "last sent HH:MM" for the GPS consent row (StatusBanners).
 *  Manual computation, not toLocaleTimeString - same reasoning
 *  formatDateHuman already follows (consistent across web/native without
 *  depending on locale/ICU data being present). Local device time, not
 *  UTC - the rider reads this against their own phone's clock. */
export function formatTimeHuman(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}
