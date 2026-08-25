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

/** Stage H0b Part 2 - signup attempts from ONE IP, across ANY identifiers.
 *  Without this, varying the email sidesteps signup-identifier entirely and
 *  leaves account creation bounded only by the global 100/min - more
 *  permissive than login, which is backwards. Set to half of login-ip (15,
 *  not 30): signup is the heavier, rarer operation (see
 *  SIGNUP_IDENTIFIER_THROTTLE), so its backstop should be at least as
 *  strict, and proportionally tighter is consistent with that same
 *  reasoning rather than just matching login's number by coincidence. */
export const SIGNUP_IP_THROTTLE = { limit: 15, ttl: 60_000 };

/** Password-reset requests for ONE identifier, from ANY IP. Deliberately
 *  IP-blind, unlike login's identifier tracker: the thing being prevented is
 *  mail-bombing one rider, and an attacker spreading that across hosts would
 *  walk straight through an IP-scoped budget. Three an hour is well clear of
 *  a rider retrying because the first code went to a stale address, and far
 *  below "his inbox is unusable".
 *
 *  The trade this accepts: someone who knows a rider's address can burn that
 *  rider's reset budget for the hour. That is a nuisance and recoverable -
 *  the owner can still reset him from the dashboard - whereas the mail-bomb
 *  it prevents is not. */
export const PASSWORD_RESET_IDENTIFIER_THROTTLE = { limit: 3, ttl: 60 * 60_000 };

/** Password-reset requests from ONE IP, across ANY identifiers - the
 *  enumeration backstop. The request endpoint answers identically whether or
 *  not an account exists, so a sweep learns nothing from any single reply;
 *  this caps how fast one host can try to learn something from timing or
 *  volume across many. */
export const PASSWORD_RESET_IP_THROTTLE = { limit: 15, ttl: 60 * 60_000 };

/** Code submissions from ONE IP. The per-code attempt counter in Redis is
 *  the real guard (a code dies after a few wrong tries); this only stops one
 *  host from grinding attempts against many different accounts' codes at
 *  once. */
export const PASSWORD_RESET_CONFIRM_IP_THROTTLE = { limit: 30, ttl: 60 * 60_000 };

/** Public tracking-link views, from ONE IP, across any token. Loose enough
 *  for an owner or customer genuinely refreshing a delivery in progress
 *  every few seconds; the token itself (32+ bytes CSPRNG) makes guessing
 *  infeasible regardless - this is abuse hygiene, not the actual security
 *  boundary. */
export const PUBLIC_TRACK_IP_THROTTLE = { limit: 30, ttl: 60_000 };
