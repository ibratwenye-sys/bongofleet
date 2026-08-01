/**
 * Tanzanian shilling notation - "1,800,000/=", or "1,800,000.50/=" when there
 * are non-zero cents. Distinct from the dashboard's own `formatTZS` (Intl
 * currency-style, always zero decimals, no "/=" suffix) - that formatter
 * serves the dashboard's UI display convention and is a different thing on
 * purpose, not a duplicate of this one. This is the "/=" convention used on
 * printed documents (the hire-purchase contract; anything else that needs
 * it later, per the docstring on this file's origin).
 */
export function formatShillings(amount: number | string): string {
  const value = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (!Number.isFinite(value)) {
    return '0/=';
  }

  const rounded = Math.round(value * 100) / 100;
  const hasCents = Math.abs(rounded - Math.trunc(rounded)) > 1e-9;

  const formatted = rounded.toLocaleString('en-US', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  });

  return `${formatted}/=`;
}
