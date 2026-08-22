import { TenantStatus } from '@prisma/client';
import { checkTenantLock } from './tenant-lock.util';

const NOW = new Date('2026-08-17T12:00:00.000Z');

function hoursFromNow(hours: number): Date {
  return new Date(NOW.getTime() + hours * 60 * 60 * 1000);
}

describe('checkTenantLock', () => {
  it('locks a PENDING_VERIFICATION tenant', () => {
    const result = checkTenantLock(
      { status: TenantStatus.PENDING_VERIFICATION, trialEndsAt: null, billingExemptAt: null },
      NOW,
    );
    expect(result).toEqual({ locked: true, reason: 'PENDING_VERIFICATION' });
  });

  it('locks a CANCELLED tenant', () => {
    const result = checkTenantLock(
      { status: TenantStatus.CANCELLED, trialEndsAt: null, billingExemptAt: null },
      NOW,
    );
    expect(result).toEqual({ locked: true, reason: 'CANCELLED' });
  });

  it('locks a PAST_DUE tenant', () => {
    const result = checkTenantLock(
      { status: TenantStatus.PAST_DUE, trialEndsAt: null, billingExemptAt: null },
      NOW,
    );
    expect(result).toEqual({ locked: true, reason: 'PAST_DUE' });
  });

  describe('ACTIVE, trialEndsAt semantics', () => {
    // CHECK 1: a null trialEndsAt must NEVER read as "expired" - this is
    // what the Stage S1 migration leaves every pre-existing tenant with
    // (grandfathered ACTIVE, trialEndsAt left null - see that migration's
    // data-fix comment), and getting this backwards locks out every tenant
    // that existed before this stage on the very first deploy, Ibrahim's
    // own fleet included, even before billingExemptAt is considered. This
    // case is pinned down directly, independent of billingExemptAt, which
    // is asserted separately below.
    it('does NOT lock an ACTIVE tenant with a null trialEndsAt (grandfathered, no trial clock)', () => {
      const result = checkTenantLock(
        { status: TenantStatus.ACTIVE, trialEndsAt: null, billingExemptAt: null },
        NOW,
      );
      expect(result).toEqual({ locked: false, reason: null });
    });

    it('does not lock an ACTIVE tenant whose trial has not yet ended', () => {
      const result = checkTenantLock(
        { status: TenantStatus.ACTIVE, trialEndsAt: hoursFromNow(1), billingExemptAt: null },
        NOW,
      );
      expect(result).toEqual({ locked: false, reason: null });
    });

    it('locks an ACTIVE tenant exactly at its trialEndsAt instant', () => {
      const result = checkTenantLock(
        { status: TenantStatus.ACTIVE, trialEndsAt: NOW, billingExemptAt: null },
        NOW,
      );
      expect(result).toEqual({ locked: true, reason: 'TRIAL_EXPIRED' });
    });

    it('locks an ACTIVE tenant whose trial has passed', () => {
      const result = checkTenantLock(
        { status: TenantStatus.ACTIVE, trialEndsAt: hoursFromNow(-1), billingExemptAt: null },
        NOW,
      );
      expect(result).toEqual({ locked: true, reason: 'TRIAL_EXPIRED' });
    });
  });

  describe('billingExemptAt overrides everything', () => {
    it('never locks an exempt tenant, whatever its status or dates say', () => {
      const cases: Array<{ status: TenantStatus; trialEndsAt: Date | null }> = [
        { status: TenantStatus.PENDING_VERIFICATION, trialEndsAt: null },
        { status: TenantStatus.CANCELLED, trialEndsAt: null },
        { status: TenantStatus.PAST_DUE, trialEndsAt: null },
        { status: TenantStatus.ACTIVE, trialEndsAt: hoursFromNow(-100) },
      ];

      for (const testCase of cases) {
        const result = checkTenantLock(
          { ...testCase, billingExemptAt: new Date('2020-01-01T00:00:00.000Z') },
          NOW,
        );
        expect(result).toEqual({ locked: false, reason: null });
      }
    });
  });
});
