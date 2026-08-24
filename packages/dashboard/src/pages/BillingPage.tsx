import { useCallback, useEffect, useState } from 'react';
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
function StatusBanner({ billing }: { billing: TenantBilling }) {
  if (billing.billingExempt) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
        This account is exempt from billing.
      </div>
    );
  }

  if (billing.status === 'PAST_DUE') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Payment past due.
      </div>
    );
  }

  if (billing.status === 'CANCELLED') {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
        Subscription cancelled.
      </div>
    );
  }

  if (billing.status === 'PENDING_VERIFICATION') {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Account not yet verified.
      </div>
    );
  }

  // ACTIVE from here down.
  if (billing.trialEndsAt) {
    const days = daysUntil(billing.trialEndsAt);
    if (days > 0) {
      return (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          Trial ends in {days} day{days === 1 ? '' : 's'} (
          {new Date(billing.trialEndsAt).toLocaleDateString()}).
        </div>
      );
    }
  }

  return (
    <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
      Active.
    </div>
  );
}

export function BillingPage() {
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
      setError(err instanceof ApiError ? err.message : 'Could not load billing.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Stage SUB1 - no platform-admin role exists in this codebase (UserRole is
  // OWNER/MANAGER/RIDER/MECHANIC only), so OWNER is the correct gate here,
  // same as the backend's GET /tenant/billing. Matches the honest read of
  // this page: it's the fleet owner's own subscription, not a support console.
  if (user && user.role !== 'OWNER') {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600 shadow-sm">
        Only the fleet owner can view billing.
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-gray-900">Billing</h1>

      {error && <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : billing === null ? null : (
        <div className="space-y-4">
          <StatusBanner billing={billing} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-gray-500">Active bikes</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{billing.activeBikeCount}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-gray-500">Price per bike / month</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">
                {formatTZS(billing.pricePerBikePerMonth)}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-gray-500">Estimated monthly total</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">
                {formatTZS(billing.estimatedMonthlyTotal)}
              </p>
            </div>
          </div>

          {/* Stage SUB1 - the whole reason this line exists: actual charge
              collection is still blocked on AzamPay (§8 step 4). Nothing on
              this page may imply a bill is coming while that's true - a real
              trust problem for an owner reading it - so this is not
              conditional on status/trialEndsAt; it always shows. */}
          <p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500">
            Payment collection isn't connected yet — nothing above is being charged automatically.
            This is an estimate for your own planning only.
          </p>
        </div>
      )}
    </div>
  );
}
