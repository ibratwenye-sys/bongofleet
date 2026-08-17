export const ACCESS_TOKEN_EXPIRES_IN = '15m';
export const REFRESH_TOKEN_EXPIRES_IN = '7d';
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Stage H0g - the most user.email candidates login() will bcrypt-compare
 * against for one request. email is unique per tenant, not globally
 * (@@unique([tenantId, email])), so the same address can legitimately belong
 * to a user in each of several tenants; login now resolves which one by
 * trying the supplied password against every candidate.
 *
 * Five, not "however many match": at bcrypt cost 12 (~430ms/compare on
 * CI-class hardware - measured in Stage H0f), an uncapped list turns a
 * single login into a trivial denial-of-service against a specific address.
 * signup() creates a brand-new tenant on every call and puts no limit on how
 * many tenants can share an owner's email, so an attacker can inflate the
 * candidate count for a target address just by signing up repeatedly - 5
 * caps that at ~2.15s of bcrypt work regardless of how many they create.
 *
 * Real, legitimate collisions (two unrelated fleet owners independently
 * onboarding the same rider) are expected to be rare and small - 2, maybe
 * 3. Five is deliberately more headroom than that, not a number chosen to
 * exactly fit the legitimate case.
 *
 * The trade this accepts: if an attacker (or, implausibly, organic reuse)
 * ever pushes the real count above 5, the genuine account might not be
 * among the candidates fetched and its owner would see "Invalid
 * credentials" despite using the right password - a denial of service
 * against that one address, not a compromise of any account. Candidates are
 * fetched oldest-first (orderBy createdAt asc) so a long-standing real
 * account is preferred over newly created ones in exactly that scenario,
 * without pretending to solve it outright.
 */
export const LOGIN_EMAIL_CANDIDATE_LIMIT = 5;

export function refreshKey(userId: string, jti: string): string {
  return `refresh:${userId}:${jti}`;
}
