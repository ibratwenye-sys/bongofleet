/**
 * Stage H0f - the self-service reset code.
 *
 * A short numeric code the user types, not a link. That is a delivery
 * decision with a structural consequence: a code reads the same out of an
 * email as it does out of an SMS, so adding SMS later is a new sender and
 * nothing else. A link would have bound the flow to a channel that can carry
 * one.
 */

/** Six digits. Long enough that guessing it inside the attempt budget is
 *  hopeless (5 tries against 1,000,000 values), short enough to read off a
 *  screen and type on a phone with one hand. */
export const RESET_CODE_LENGTH = 6;

/** Thirty minutes. Long enough for mail to arrive and be acted on, short
 *  enough that a code sitting in an unattended inbox stops being a key. */
export const RESET_CODE_TTL_SECONDS = 30 * 60;

/** Wrong attempts before the code is destroyed outright. Five, not "lock the
 *  account": the code dies, the account does not, so an attacker guessing at
 *  a rider's code can waste that code but cannot lock him out of the reset
 *  he is legitimately waiting for - he requests another one. */
export const RESET_CODE_MAX_ATTEMPTS = 5;

/** Redis key for a user's outstanding code. Keyed by user id, not by email:
 *  email is unique per tenant, not globally (schema.prisma's
 *  @@unique([tenantId, email])), so two users in different tenants can share
 *  an address and must not share a code slot. */
export function passwordResetKey(userId: string): string {
  return `pwreset:${userId}`;
}

/** Prefix of every refresh-token key belonging to one user. Refresh keys are
 *  `refresh:{userId}:{jti}` - one per live session - so revoking a user's
 *  sessions means sweeping this prefix, not deleting a single key. */
export function userRefreshKeyPrefix(userId: string): string {
  return `refresh:${userId}:`;
}
