import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useAuth } from '../lib/auth-context';
import { apiFetch, ApiError } from '../lib/api';
import type { TenantBilling } from '../lib/types';
import { formatTZS } from '../lib/format';

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

// Stage SUB1 - the status banner. billingExempt overrides everything else
// (matches checkTenantLock's own precedence - see tenant-lock.util.ts: an
// exempt tenant is never locked or billed, whatever status/trialEndsAt say),
// then status/trialEndsAt in the same shape the backend's checkTenantLock
// reads them. Nothing here implies a charge is coming - see the fixed
// "payment collection isn't connected yet" line below the banner, which
// this page shows regardless of which banner state renders.
function StatusBanner({ billing, t }: { billing: TenantBilling; t: TFunction<'billing'> }) {
  if (billing.billingExempt) {
    return (
      <div className="rounded-lg bg-panel-2 px-4 py-3 text-sm text-txt-2">{t('exemptBanner')}</div>
    );
  }

  if (billing.status === 'PAST_DUE') {
    return (
      <div className="rounded-lg bg-crit-d px-4 py-3 text-sm text-crit">{t('pastDueBanner')}</div>
    );
  }

  if (billing.status === 'CANCELLED') {
    return (
      <div className="rounded-lg bg-panel-2 px-4 py-3 text-sm text-txt-2">
        {t('cancelledBanner')}
      </div>
    );
  }

  if (billing.status === 'PENDING_VERIFICATION') {
    return (
      <div className="rounded-lg bg-warn-d px-4 py-3 text-sm text-warn">
        {t('pendingVerificationBanner')}
      </div>
    );
  }

  // ACTIVE from here down.
  if (billing.trialEndsAt) {
    const days = daysUntil(billing.trialEndsAt);
    if (days > 0) {
      return (
        <div className="rounded-lg bg-c1-d px-4 py-3 text-sm text-c1">
          {t('trialEndsInDays', {
            count: days,
            date: new Date(billing.trialEndsAt).toLocaleDateString(),
          })}
        </div>
      );
    }
  }

  return (
    <div className="rounded-lg bg-good-d px-4 py-3 text-sm text-good">{t('activeBanner')}</div>
  );
}

export function BillingPage() {
  const { t } = useTranslation('billing');
  const { user } = useAuth();
  const [billing, setBilling] = useState<TenantBilling | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<TenantBilling>('/tenant/billing');
      setBilling(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Stage SUB1 - no platform-admin role exists in this codebase (UserRole is
  // OWNER/MANAGER/RIDER/MECHANIC only), so OWNER is the correct gate here,
  // same as the backend's GET /tenant/billing. Matches the honest read of
  // this page: it's the fleet owner's own subscription, not a support console.
  if (user && user.role !== 'OWNER') {
    return (
      <div className="rounded-lg border border-line bg-panel p-6 text-sm text-txt-2 shadow-sm">
        {t('ownerOnlyGate')}
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-txt">{t('title')}</h1>

      {error && <p className="mb-4 rounded bg-crit-d px-3 py-2 text-sm text-crit-x">{error}</p>}

      {loading ? (
        <p className="text-sm text-txt-2">{t('loading')}</p>
      ) : billing === null ? null : (
        <div className="space-y-4">
          <StatusBanner billing={billing} t={t} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-line bg-panel p-6 shadow-sm">
              <p className="text-sm font-medium text-txt-2">{t('kpiActiveBikes')}</p>
              <p className="mt-2 text-2xl font-semibold text-txt">{billing.activeBikeCount}</p>
            </div>
            <div className="rounded-lg border border-line bg-panel p-6 shadow-sm">
              <p className="text-sm font-medium text-txt-2">{t('kpiPricePerBikeMonth')}</p>
              <p className="mt-2 text-2xl font-semibold text-txt">
                {formatTZS(billing.pricePerBikePerMonth)}
              </p>
            </div>
            <div className="rounded-lg border border-line bg-panel p-6 shadow-sm">
              <p className="text-sm font-medium text-txt-2">{t('kpiEstimatedMonthlyTotal')}</p>
              <p className="mt-2 text-2xl font-semibold text-txt">
                {formatTZS(billing.estimatedMonthlyTotal)}
              </p>
            </div>
          </div>

          {/* Stage SUB1 - the whole reason this line exists: actual charge
              collection is still blocked on AzamPay (§8 step 4). Nothing on
              this page may imply a bill is coming while that's true - a real
              trust problem for an owner reading it - so this is not
              conditional on status/trialEndsAt; it always shows. */}
          <p className="rounded-lg border border-line bg-panel-2 px-4 py-3 text-xs text-txt-2">
            {t('disclaimer')}
          </p>
        </div>
      )}
    </div>
  );
}
