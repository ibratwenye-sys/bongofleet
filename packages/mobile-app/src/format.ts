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
