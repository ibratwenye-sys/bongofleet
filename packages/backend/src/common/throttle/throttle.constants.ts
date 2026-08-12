/**
 * Stage H0 - every rate limit in the app, in one place, so the numbers can
 * be read (and changed) without hunting through app.module.ts. See that
 * file's ThrottlerModule.forRootAsync for how each is wired to its tracker.
 */

/** The global ceiling every request is checked against - per user once a
 *  JWT verifies, else per IP. A generous backstop against runaway/abusive
 *  API usage in general, not a brute-force guard - those are the more
 *  specific limits below. */
export const GLOBAL_THROTTLE = { limit: 100, ttl: 60_000 };

/** Login attempts against ONE identifier (email), from ONE IP. Five wrong
 *  passwords a minute is generous for a human mistyping, tight enough to
 *  make online brute-forcing a single account impractical. */
export const LOGIN_IDENTIFIER_THROTTLE = { limit: 5, ttl: 60_000 };

/** Login attempts from ONE IP, across ANY identifiers - the backstop for a
 *  host spraying many different accounts rather than guessing one. Loose on
 *  purpose: ten colleagues behind one office/carrier-NAT connection, each
 *  trying a login a few times during a shift-start rush, is ~30 requests
 *  without any of them being an attacker. */
export const LOGIN_IP_THROTTLE = { limit: 30, ttl: 60_000 };

/** Refresh calls for ONE user. A machine renewing its own session on a
 *  timer, not a human - the realistic ceiling is "how many devices/tabs
 *  could one person plausibly have open and racing at once", not
 *  brute-force math. 20/minute comfortably covers several concurrent
 *  sessions each refreshing/retrying occasionally. */
export const REFRESH_THROTTLE = { limit: 20, ttl: 60_000 };

/** Signup attempts against ONE identifier, from ONE IP. Tighter than login:
 *  creating a tenant+owner account is a heavier, rarer operation, and the
 *  failure mode of a flood (tenant-spam) is worse than a flood of failed
 *  logins - but still loose enough for someone to retry after fixing a
 *  validation typo a couple of times. */
export const SIGNUP_IDENTIFIER_THROTTLE = { limit: 3, ttl: 60_000 };
