import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch, apiFetchBlob, ApiError } from '../lib/api';
import { formatTZS } from '../lib/format';
import type { Document, OwnershipPlan, OwnershipPlanLedgerRow, PaymentAccount } from '../lib/types';
import { ConfirmDialog } from '../components/ConfirmDialog';

function runningPositionClass(value: string): string {
  const n = Number(value);
  if (n < 0) return 'text-red-700 font-medium';
  if (n > 0) return 'text-green-700 font-medium';
  return 'text-gray-600';
}

function ContractSection({ planId }: { planId: string }) {
  const [contracts, setContracts] = useState<Document[] | null>(null);
  const [activePaymentAccounts, setActivePaymentAccounts] = useState<PaymentAccount[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [confirmingNoPaymentAccount, setConfirmingNoPaymentAccount] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [contractsData, paymentAccountsData] = await Promise.all([
        apiFetch<Document[]>(`/ownership-plans/${planId}/contracts`),
        apiFetch<PaymentAccount[]>('/payment-accounts?activeOnly=true'),
      ]);
      setContracts(contractsData);
      setActivePaymentAccounts(paymentAccountsData);
    } catch {
      setContracts([]);
      setActivePaymentAccounts([]);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      await apiFetch(`/ownership-plans/${planId}/contract`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not generate the contract.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleDownload() {
    setError(null);
    setDownloading(true);
    try {
      const blob = await apiFetchBlob(`/ownership-plans/${planId}/contract`);
      window.open(URL.createObjectURL(blob), '_blank');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open the contract.');
    } finally {
      setDownloading(false);
    }
  }

  function handleDownloadClick() {
    // Carry-in from the contract work: that PDF prints "Hakuna akaunti ya
    // malipo iliyowekwa" (no payment account configured) when the tenant has
    // none active - a document that reads that way should never reach a
    // driver by accident.
    if (activePaymentAccounts !== null && activePaymentAccounts.length === 0) {
      setConfirmingNoPaymentAccount(true);
      return;
    }
    void handleDownload();
  }

  const latest = contracts?.[0] ?? null;

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-medium text-gray-900">Contract</h2>
      <div className="rounded border border-gray-200 bg-white p-4">
        {contracts === null ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : latest === null ? (
          <p className="mb-3 text-sm text-gray-500">No contract generated yet.</p>
        ) : (
          <p className="mb-3 text-sm text-gray-600">
            Latest: {latest.fileName} — generated {latest.uploadedAt.slice(0, 10)}
            {contracts.length > 1 && ` (${contracts.length} versions on file)`}
          </p>
        )}

        {activePaymentAccounts !== null && activePaymentAccounts.length === 0 && (
          <p className="mb-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-700">
            No active payment account is configured for this tenant - the contract will print
            &quot;Hakuna akaunti ya malipo iliyowekwa&quot; (no payment account configured).
          </p>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => void handleGenerate()}
            disabled={generating}
            className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {generating ? 'Generating…' : latest ? 'Regenerate contract' : 'Generate contract'}
          </button>
          {latest && (
            <button
              onClick={handleDownloadClick}
              disabled={downloading}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              {downloading ? 'Opening…' : 'Download latest'}
            </button>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      {confirmingNoPaymentAccount && (
        <ConfirmDialog
          title="No payment account configured"
          message='This tenant has no active payment account. The contract will print "Hakuna akaunti ya malipo iliyowekwa" (no payment account configured) where the driver expects to see where to pay. Download anyway?'
          confirmLabel="Download anyway"
          danger
          onConfirm={() => {
            setConfirmingNoPaymentAccount(false);
            void handleDownload();
          }}
          onCancel={() => setConfirmingNoPaymentAccount(false)}
        />
      )}
    </section>
  );
}

function LedgerSection({ planId }: { planId: string }) {
  const [rows, setRows] = useState<OwnershipPlanLedgerRow[] | null>(null);

  useEffect(() => {
    apiFetch<OwnershipPlanLedgerRow[]>(`/ownership-plans/${planId}/ledger`)
      .then(setRows)
      .catch(() => setRows([]));
  }, [planId]);

  return (
    <section>
      <h2 className="mb-3 text-lg font-medium text-gray-900">Instalment ledger</h2>
      <div className="max-h-[32rem] overflow-y-auto overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="sticky top-0 bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Date</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Owed</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Paid</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Running position</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows === null ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                  No instalments generated yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.assignedDate}>
                  <td className="px-4 py-2 text-gray-600">{row.assignedDate}</td>
                  <td className="px-4 py-2 text-right text-gray-600">{formatTZS(row.owed)}</td>
                  <td className="px-4 py-2 text-right text-gray-600">{formatTZS(row.paid)}</td>
                  <td
                    className={`px-4 py-2 text-right ${runningPositionClass(row.runningPosition)}`}
                  >
                    {formatTZS(row.runningPosition)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function OwnershipPlanDetailPage() {
  const { planId } = useParams<{ planId: string }>();
  const [plan, setPlan] = useState<OwnershipPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!planId) return;
    apiFetch<OwnershipPlan>(`/ownership-plans/${planId}`)
      .then(setPlan)
      .catch(() => setError('Could not load this ownership plan.'));
  }, [planId]);

  if (!planId) return null;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!plan) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div>
      <Link to="/ownership" className="mb-4 inline-block text-sm text-gray-600 hover:underline">
        ← Back to ownership plans
      </Link>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">
        {plan.driver ? `${plan.driver.user.firstName} ${plan.driver.user.lastName}` : 'Driver'}
        {' — '}
        {plan.motorcycle?.registrationNumber ?? 'Vehicle'}
      </h1>
      <p className="mb-4 text-sm text-gray-600">
        {formatTZS(plan.dailyAmount)}/day · {formatTZS(plan.totalPrice)} total ·{' '}
        {formatTZS(plan.downPayment)} down · started {plan.startDate.slice(0, 10)}
        {plan.contractEndDate && ` · ends ${plan.contractEndDate.slice(0, 10)}`}
      </p>

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">Paid to date</p>
          <p className="text-lg font-semibold text-gray-900">{formatTZS(plan.amountPaid)}</p>
        </div>
        <div className="rounded border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">Remaining</p>
          <p className="text-lg font-semibold text-gray-900">{formatTZS(plan.remainingToOwn)}</p>
        </div>
        <div className="rounded border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">Days left</p>
          <p className="text-lg font-semibold text-gray-900">{plan.daysLeft ?? '—'}</p>
        </div>
        <div className="rounded border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">Projected completion</p>
          <p className="text-lg font-semibold text-gray-900">{plan.projectedCompletion}</p>
        </div>
      </div>

      <ContractSection planId={planId} />
      <LedgerSection planId={planId} />
    </div>
  );
}
