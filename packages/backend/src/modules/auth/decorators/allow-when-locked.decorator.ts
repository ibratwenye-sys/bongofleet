import { SetMetadata } from '@nestjs/common';

/**
 * Stage S1. Marks a route as reachable regardless of tenant-lock state
 * (PENDING_VERIFICATION, an expired trial, PAST_DUE, or CANCELLED) - see
 * JwtAuthGuard.canActivate, the sole enforcement point.
 *
 * A locked owner still needs a way OUT of being locked: to see why
 * (/auth/me), to leave (/auth/logout), and to fix a pending-verification
 * lock himself (signup/verify, signup/resend-code). Without this, blocking
 * /auth/me specifically traps him in a loop the dashboard cannot break out
 * of - login succeeds, then every subsequent request 403s including the one
 * that would tell him why.
 */
export const ALLOW_WHEN_LOCKED_KEY = 'allowWhenLocked';
export const AllowWhenLocked = () => SetMetadata(ALLOW_WHEN_LOCKED_KEY, true);
