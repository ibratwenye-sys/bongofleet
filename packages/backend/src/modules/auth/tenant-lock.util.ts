import { TenantStatus } from '@prisma/client';

/**
 * Stage S1. The one place that decides whether a tenant's own status/dates
 * lock it out - checked by JwtAuthGuard (see its canActivate) on every
 * authenticated route in the app, dashboard and rider app alike, since both
 * go through this exact guard and there is no second auth path.
 */
export interface TenantLockSubject {
  status: TenantStatus;
  trialEndsAt: Date | null;
  billingExemptAt: Date | null;
}

export type TenantLockReason = 'PENDING_VERIFICATION' | 'TRIAL_EXPIRED' | 'PAST_DUE' | 'CANCELLED';

export type TenantLockResult =
  { locked: true; reason: TenantLockReason } | { locked: false; reason: null };

const LOCK_MESSAGES: Record<TenantLockReason, string> = {
  PENDING_VERIFICATION: 'Please verify your email to activate your BongoFleet account.',
  TRIAL_EXPIRED: 'Your free trial has ended. Contact BongoFleet to keep using your account.',
  PAST_DUE: 'This account is past due. Contact BongoFleet to restore access.',
  CANCELLED: 'This account has been cancelled.',
};

export function tenantLockMessage(reason: TenantLockReason): string {
  return LOCK_MESSAGES[reason];
}

export function checkTenantLock(
  tenant: TenantLockSubject,
  now: Date = new Date(),
): TenantLockResult {
  // Overrides every other field, unconditionally - see the Stage S1
  // migration, which sets this on Ibrahim's own tenant. His own product
  // must never lock him out of it or bill him, whatever status or dates say.
  if (tenant.billingExemptAt) {
    return { locked: false, reason: null };
  }

  if (tenant.status === TenantStatus.PENDING_VERIFICATION) {
    return { locked: true, reason: 'PENDING_VERIFICATION' };
  }
  if (tenant.status === TenantStatus.CANCELLED) {
    return { locked: true, reason: 'CANCELLED' };
  }
  if (tenant.status === TenantStatus.PAST_DUE) {
    return { locked: true, reason: 'PAST_DUE' };
  }

  // ACTIVE. trialEndsAt is a clock on this status, not a status of its own -
  // see TenantStatus's doc comment in schema.prisma.
  //
  // NULL MEANS NO TRIAL DEADLINE, NEVER "EXPIRED". A null trialEndsAt is
  // either a tenant grandfathered ACTIVE by the Stage S1 migration (it
  // predates trials entirely - see that migration's data fix) or one a
  // future billing integration has taken off the trial clock entirely.
  // Read `null` as "expired" instead and the very first deploy locks out
  // every tenant that existed before this stage, Ibrahim's own fleet
  // included even before billingExemptAt is considered - see
  // tenant-lock.util.spec.ts's "grandfathered, null trialEndsAt" case,
  // which pins this down directly rather than trusting billingExemptAt
  // alone to save it.
  if (tenant.trialEndsAt === null) {
    return { locked: false, reason: null };
  }
  if (tenant.trialEndsAt.getTime() <= now.getTime()) {
    return { locked: true, reason: 'TRIAL_EXPIRED' };
  }

  return { locked: false, reason: null };
}
