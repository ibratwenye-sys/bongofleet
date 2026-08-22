/**
 * Stage S1 - signup's own verification code. Same core as password reset's
 * (see verification-code.service.ts), but its own numbers: these are free to
 * move independently of RESET_CODE_LENGTH/TTL/ATTEMPTS in
 * password-reset.constants.ts, which answer an unrelated question for an
 * unrelated flow that happens to share a shape today.
 */

/** Six digits - same reasoning as RESET_CODE_LENGTH: hopeless to guess
 *  inside the attempt budget, easy to read off a screen and type. */
export const SIGNUP_CODE_LENGTH = 6;

/** Thirty minutes. A resend endpoint exists (POST /auth/signup/resend-code)
 *  for when this isn't enough, so this stays short rather than growing to
 *  cover every possible delay in checking mail. */
export const SIGNUP_CODE_TTL_SECONDS = 30 * 60;

/** Wrong attempts before the code is destroyed outright. The code dies, not
 *  the tenant - it stays PENDING_VERIFICATION and the owner can request
 *  another one via resend-code. */
export const SIGNUP_CODE_MAX_ATTEMPTS = 5;

/** Redis key for a tenant's outstanding signup-verification code. Keyed by
 *  tenantId, not userId: the thing being verified is the TENANT's transition
 *  out of PENDING_VERIFICATION, not any one user's credential. */
export function signupVerificationKey(tenantId: string): string {
  return `signupverify:${tenantId}`;
}
