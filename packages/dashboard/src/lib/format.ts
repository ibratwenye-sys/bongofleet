import i18n from './i18n';

// Stage L1 - formatDateTime/formatAge read i18next's current language
// directly rather than taking it as a parameter: both have ~9 call sites
// across 7 page files, none of which otherwise touch i18n, so threading a
// language argument through all of them would be pure churn for a value
// already available as a singleton. i18n.language is 'en'/'sw' (lowercase,
// per lib/i18n.ts's resource keys), distinct from the account's own
// uppercase Language enum.
function isSwahili(): boolean {
  return i18n.language === 'sw';
}

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

/** Stage H3 - date + time, for a "submitted at" column where the whole
 *  point is knowing exactly when something landed in a queue (not just
 *  which calendar day, which every other timestamp on this dashboard shows
 *  via a plain .slice(0, 10)). */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(isSwahili() ? 'sw-TZ' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** Stage UI3 - a worklist's "how long has this waited" column (e.g.
 *  Payments' "Needs reconciling" queue), coarse on purpose: a queue is
 *  triaged by rough age, not exact minutes. */
export function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  const swahili = isSwahili();
  if (minutes < 60) {
    const m = Math.max(0, minutes);
    return swahili ? `dakika ${m} zilizopita` : `${m}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return swahili ? `saa ${hours} zilizopita` : `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return swahili ? `siku ${days} zilizopita` : `${days}d ago`;
}
