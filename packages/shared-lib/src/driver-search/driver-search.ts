/**
 * Stage G6 Part 2 - the searchable driver picker's few genuinely shared
 * numbers/rules, kept in one place so the dashboard's debounce timer and the
 * backend's default result cap can't drift apart from each other. The actual
 * matching (name/phone/plate, tenant-scoped) runs entirely in the backend's
 * Prisma query - it needs the database and can't live here - so this file is
 * deliberately small.
 */

/** How long the dashboard picker waits after the last keystroke before
 *  issuing a search request. The rate limiter counts 100 requests/minute per
 *  user - at 300ms, a sustained burst of typing tops out around 3.3
 *  requests/second, and a normal four-to-eight letter name produces exactly
 *  one request, not one per keystroke. */
export const DRIVER_SEARCH_DEBOUNCE_MS = 300;

/** Default number of results the search endpoint returns per request, and
 *  what the dashboard should assume if it ever needs to reason about the cap
 *  itself (normally it just reads the `hasMore` flag the endpoint returns). */
export const DRIVER_SEARCH_RESULT_LIMIT = 10;

/** Trims surrounding whitespace and collapses internal runs of whitespace to
 *  a single space, so "  Juma   Bakari  " and "Juma Bakari" behave
 *  identically whether typed by hand or pasted. Both the dashboard (before
 *  sending) and the backend (defensively, on the raw query param) apply this
 *  - neither should trust the other to have done it. */
export function normalizeSearchQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}
