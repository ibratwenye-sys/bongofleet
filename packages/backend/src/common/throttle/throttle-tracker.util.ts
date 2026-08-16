import { JwtService } from '@nestjs/jwt';

/**
 * Stage H0. Small, pure(ish) building blocks the throttler configuration in
 * throttler-options.factory.ts composes into each named throttler's
 * getTracker. Kept here, not inline there, so they're unit-testable without
 * booting the whole app.
 *
 * `req` is typed as loosely as @nestjs/throttler itself types it
 * (Record<string, any>, the actual Express request at runtime) - every
 * property read below is defensive at runtime instead of leaning on a
 * narrower parameter type guards can't actually enforce here.
 */
type ThrottleRequest = Record<string, any>;

/** trim + lowercase so "Driver@Acme.test" and " driver@acme.test " don't
 *  each get their own throttle budget (Stage H0 Part 2). Never logged -
 *  callers must only ever use the return value to build a Redis key. */
export function normalizeIdentifier(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** The Bearer token from an Authorization header, or null - never throws on
 *  a missing/malformed header, since this runs on every request including
 *  anonymous ones. */
export function bearerToken(req: ThrottleRequest): string | null {
  const header = req.headers?.['authorization'];
  if (typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}

interface MinimalJwtPayload {
  sub: string;
  tenant_id?: string;
}

/**
 * Verifies (not merely decodes) a JWT against `secret`, returning its
 * payload or null on any failure - expired, malformed, wrong secret, wrong
 * signature. Signature verification matters here specifically because the
 * result feeds a throttle-tracking KEY: decoding an unverified token would
 * let a client claim any `sub` it likes in a token with a garbage signature,
 * handing itself a fresh throttle budget on demand and defeating the IP
 * fallback entirely.
 */
export function verifyJwtPayload(
  jwt: JwtService,
  token: string | null,
  secret: string,
): MinimalJwtPayload | null {
  if (!token) return null;
  try {
    return jwt.verify<MinimalJwtPayload>(token, { secret });
  } catch {
    return null;
  }
}

/** Stage H0 Part 1 - the global ceiling's tracker: the caller's user id (and
 *  tenant) when the request carries a JWT that verifies, else their IP. Once
 *  a request is known to belong to someone, their IP adds nothing but
 *  collateral damage against colleagues sharing a connection. */
export function trackByUserOrIp(
  req: ThrottleRequest,
  jwt: JwtService,
  accessSecret: string,
): string {
  const payload = verifyJwtPayload(jwt, bearerToken(req), accessSecret);
  return payload ? `user:${payload.sub}:${payload.tenant_id}` : `ip:${req.ip}`;
}

/** Stage H0 Part 2 - login/signup's shared identifier-based tracker: IP +
 *  the normalized identifier from the body. Many identifiers behind one IP
 *  (a shared office connection) each get their own budget; capping many
 *  attempts against one identifier regardless of which IP they come from is
 *  NOT the goal here - see trackByIp for that half of the story. */
export function trackByIpAndIdentifier(req: ThrottleRequest): string {
  return `ip:${req.ip}:id:${normalizeIdentifier(req.body?.email)}`;
}

/** Stage H0 Part 2 - the pure-IP backstop: deliberately blind to identifier,
 *  so it only ever fires on a genuine spray across many different accounts
 *  from one host. */
export function trackByIp(req: ThrottleRequest): string {
  return `ip:${req.ip}`;
}

/** Stage H0 Part 3 - refresh is keyed on the token's own user, not the
 *  caller's IP at all: a refresh call is a machine renewing its session, not
 *  a human guessing a password, so there is no brute-force case to protect
 *  against by IP. Falls back to IP only when the token doesn't verify (a
 *  garbage/expired refresh call), so that failure mode still has *some*
 *  ceiling rather than none. */
export function trackRefreshByUser(
  req: ThrottleRequest,
  jwt: JwtService,
  refreshSecret: string,
): string {
  const token = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : null;
  const payload = verifyJwtPayload(jwt, token, refreshSecret);
  return payload ? `user:${payload.sub}` : `ip:${req.ip}`;
}

/** Stage H0f - identifier only, deliberately blind to IP. Login's trackers
 *  pair the identifier WITH the IP so colleagues behind one office
 *  connection don't share a budget; password reset needs the opposite,
 *  because the abuse it guards against (mailing one rider over and over) is
 *  just as effective from a thousand hosts as from one. */
export function trackByIdentifier(req: ThrottleRequest): string {
  return `id:${normalizeIdentifier(req.body?.email)}`;
}
