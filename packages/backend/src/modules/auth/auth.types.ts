import { TenantStatus, UserRole } from '@prisma/client';

export interface JwtAccessPayload {
  sub: string;
  tenant_id: string;
  role: UserRole;
  jti: string;
}

export type JwtRefreshPayload = JwtAccessPayload;

export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  role: UserRole;
  email: string;
  firstName: string;
  lastName: string;
  jti: string;
}

/**
 * Stage S1 - what AuthService.validateToken actually constructs and returns
 * on every request (it already loads the user; this adds the tenant's lock
 * fields to that same lookup rather than a second round trip). Deliberately
 * NOT folded into the base AuthenticatedUser: that type is used as a plain
 * test fixture shape across a dozen unrelated *.service.spec.ts files that
 * have nothing to do with tenant lock, and widening it would force all of
 * them to grow three fields they never use. Only the two handlers that
 * actually need this (JwtAuthGuard's own check, and AuthController.me so a
 * locked client can learn why) are typed with it.
 */
export interface AuthenticatedUserWithTenantLock extends AuthenticatedUser {
  tenantStatus: TenantStatus;
  trialEndsAt: Date | null;
  billingExemptAt: Date | null;
}
