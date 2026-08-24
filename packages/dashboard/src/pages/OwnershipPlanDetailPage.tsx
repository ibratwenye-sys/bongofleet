import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch, apiFetchBlob, ApiError } from '../lib/api';
import { formatTZS } from '../lib/format';
import type {
  CreateDayExcusalPayload,
  DayExcusal,
  Document,
  OwnershipPlan,
  OwnershipPlanLedgerRow,
  PaymentAccount,
  UpdateOwnershipPlanPayload,
} from '../lib/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import { StatusBadge } from '../components/StatusBadge';

const DAY_EXCUSAL_STATUS_STYLES: Record<string, string> = {
  APPROVED: 'bg-green-100 text-green-800',
  REQUESTED: 'bg-amber-100 text-amber-800',
  DECLINED: 'bg-gray-100 text-gray-500',
};

const DAY_EXCUSAL_STATUS_LABELS: Record<string, string> = {
  APPROVED: 'Excused',
  REQUESTED: 'Pending approval',
  DECLINED: 'Declined',
};

function runningPositionClass(value: string): string {
  const n = Number(value);
  if (n < 0) return 'text-red-700 font-medium';
  if (n > 0) return 'text-green-700 font-medium';
  return 'text-gray-600';
}

function ContractSection({
  planId,
  hasContractEndDate,
}: {
  planId: string;
  hasContractEndDate: boolean;
}) {
  const [contracts, setContracts] = useState<Document[] | null>(null);
  const [activePaymentAccounts, setActivePaymentAccounts] = useState<PaymentAccount[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [confirmingNoPaymentAccount, setConfirmingNoPaymentAccount] = useState(false);
  // Stage G6 Part 5 - same guard, same reason, as the payment-account one
  // below: a legal document going to a driver with a blank term is worse
  // than one that's never printed. Checked first so both warnings never
  // stack in one dialog - onConfirm falls through to the next check.
  const [confirmingNoEndDate, setConfirmingNoEndDate] = useState(false);
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

  function proceedPastEndDateCheck() {
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

  function handleDownloadClick() {
    // Stage G6 Part 5 - same reasoning as the payment-account guard: the PDF
    // prints "Haijajazwa / Not on file" where the end date belongs when
    // contractEndDate is null, and that shouldn't reach a driver by accident.
    if (!hasContractEndDate) {
      setConfirmingNoEndDate(true);
      return;
    }
    proceedPastEndDateCheck();
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

        {!hasContractEndDate && (
          <p className="mb-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-700">
            No contract end date is set for this plan - the contract will print &quot;Haijajazwa /
            Not on file&quot; where the end date belongs.
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

      {confirmingNoEndDate && (
        <ConfirmDialog
          title="No contract end date"
          message='This plan has no agreed end date. The contract will print "Haijajazwa / Not on file" where the driver expects to see the term. Download anyway?'
          confirmLabel="Download anyway"
          danger
          onConfirm={() => {
            setConfirmingNoEndDate(false);
            proceedPastEndDateCheck();
          }}
          onCancel={() => setConfirmingNoEndDate(false)}
        />
      )}

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

// Stage G5 Part 1/2. Handles both "excuse a fresh date" (opened from the
// section header, date picker free - the driver often gives notice before
// the generator has created that day's ledger row at all) and "excuse this
// specific row" (opened from a row, date pre-filled).
function ExcuseDayDialog({
  planId,
  initialDate,
  onClose,
  onExcused,
}: {
  planId: string;
  initialDate: string | null;
  onClose: () => void;
  onExcused: () => void;
}) {
  const [excusedDate, setExcusedDate] = useState(initialDate ?? '');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = excusedDate !== '' && reason.trim() !== '' && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload: CreateDayExcusalPayload = { excusedDate, reason: reason.trim() };
      await apiFetch(`/ownership-plans/${planId}/excusals`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      onExcused();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not excuse this day.');
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Excuse a day" onClose={onClose}>
      <p className="mb-4 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
        Excusing a day does <strong>not</strong> change what the driver owes. He still owes that
        money and pays it later — this only stops the day from counting as a missed day on his
        record.
      </p>

      <label className="mb-3 block text-sm font-medium text-gray-700">
        Date
        <input
          type="date"
          value={excusedDate}
          onChange={(e) => setExcusedDate(e.target.value)}
          className="mt-1 block w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
        />
      </label>

      <label className="mb-4 block text-sm font-medium text-gray-700">
        Reason (required)
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="e.g. Msiba wa jamaa - alimjulisha msimamizi wake (family bereavement - told his supervisor)"
          className="mt-1 block w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
        />
      </label>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
          className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {submitting ? 'Excusing…' : 'Excuse day'}
        </button>
      </div>
    </Modal>
  );
}

interface MergedLedgerRow {
  date: string;
  ledger: OwnershipPlanLedgerRow | null;
  excusal: DayExcusal | null;
}

// The most recently decided/created excusal for a date stands for that date
// in the merged row - an APPROVED one wins over a stale DECLINED attempt
// from an earlier excuse-then-revoke, since it's the one actually in effect.
function primaryExcusalForDate(excusals: DayExcusal[], date: string): DayExcusal | null {
  const forDate = excusals.filter((e) => e.excusedDate.slice(0, 10) === date);
  if (forDate.length === 0) return null;
  const approved = forDate.find((e) => e.status === 'APPROVED');
  if (approved) return approved;
  return [...forDate].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

// Every ledger date, plus every excusal date the ledger doesn't have a row
// for yet (Stage G5 Part 1 - a future excusal predating the generator).
function buildMergedRows(
  ledgerRows: OwnershipPlanLedgerRow[],
  excusals: DayExcusal[],
): MergedLedgerRow[] {
  const dates = new Set<string>();
  for (const row of ledgerRows) dates.add(row.assignedDate.slice(0, 10));
  for (const excusal of excusals) dates.add(excusal.excusedDate.slice(0, 10));

  return [...dates].sort().map((date) => ({
    date,
    ledger: ledgerRows.find((row) => row.assignedDate.slice(0, 10) === date) ?? null,
    excusal: primaryExcusalForDate(excusals, date),
  }));
}

function LedgerSection({ planId }: { planId: string }) {
  const [ledgerRows, setLedgerRows] = useState<OwnershipPlanLedgerRow[] | null>(null);
  const [excusals, setExcusals] = useState<DayExcusal[] | null>(null);
  const [excuseDialogDate, setExcuseDialogDate] = useState<string | null | undefined>(undefined);
  const [revoking, setRevoking] = useState<DayExcusal | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function load() {
    try {
      const [ledgerData, excusalsData] = await Promise.all([
        apiFetch<OwnershipPlanLedgerRow[]>(`/ownership-plans/${planId}/ledger`),
        apiFetch<DayExcusal[]>(`/ownership-plans/${planId}/excusals`),
      ]);
      setLedgerRows(ledgerData);
      setExcusals(excusalsData);
    } catch {
      setLedgerRows([]);
      setExcusals([]);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  async function handleRevoke(excusal: DayExcusal) {
    setActionError(null);
    try {
      await apiFetch(`/ownership-plans/${planId}/excusals/${excusal.id}/decline`, {
        method: 'PATCH',
      });
      setRevoking(null);
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : 'Could not decline/revoke this excusal.',
      );
      setRevoking(null);
    }
  }

  const rows =
    ledgerRows !== null && excusals !== null ? buildMergedRows(ledgerRows, excusals) : null;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-medium text-gray-900">Instalment ledger</h2>
        <button
          type="button"
          onClick={() => setExcuseDialogDate(null)}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          Excuse a day
        </button>
      </div>

      {actionError && <p className="mb-3 text-sm text-red-600">{actionError}</p>}

      <div className="max-h-[32rem] overflow-y-auto overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="sticky top-0 bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Date</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Owed</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Paid</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Running position</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Excusal</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows === null ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  No instalments generated yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.date}
                  className={row.excusal?.status === 'APPROVED' ? 'bg-green-50' : ''}
                >
                  <td className="px-4 py-2 text-gray-600">{row.date}</td>
                  <td className="px-4 py-2 text-right text-gray-600">
                    {row.ledger ? formatTZS(row.ledger.owed) : '—'}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-600">
                    {row.ledger ? formatTZS(row.ledger.paid) : '—'}
                  </td>
                  <td
                    className={`px-4 py-2 text-right ${row.ledger ? runningPositionClass(row.ledger.runningPosition) : 'text-gray-400'}`}
                  >
                    {row.ledger ? formatTZS(row.ledger.runningPosition) : '—'}
                  </td>
                  <td className="px-4 py-2">
                    {row.excusal ? (
                      <div>
                        <StatusBadge
                          status={row.excusal.status}
                          styles={DAY_EXCUSAL_STATUS_STYLES}
                        />
                        <p className="mt-1 text-xs text-gray-500">
                          {DAY_EXCUSAL_STATUS_LABELS[row.excusal.status] ?? row.excusal.status}
                          {row.excusal.reason && ` — ${row.excusal.reason}`}
                        </p>
                        {row.excusal.status !== 'REQUESTED' && row.excusal.decidedByName && (
                          <p className="text-xs text-gray-400">
                            by {row.excusal.decidedByName}
                            {row.excusal.decidedAt && ` · ${row.excusal.decidedAt.slice(0, 10)}`}
                          </p>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {row.excusal && row.excusal.status !== 'DECLINED' ? (
                      <button
                        type="button"
                        onClick={() => setRevoking(row.excusal)}
                        className="text-xs font-medium text-red-600 hover:underline"
                      >
                        {row.excusal.status === 'APPROVED' ? 'Revoke' : 'Decline'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setExcuseDialogDate(row.date)}
                        className="text-xs font-medium text-gray-600 hover:underline"
                      >
                        Excuse
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {excuseDialogDate !== undefined && (
        <ExcuseDayDialog
          planId={planId}
          initialDate={excuseDialogDate}
          onClose={() => setExcuseDialogDate(undefined)}
          onExcused={() => {
            setExcuseDialogDate(undefined);
            void load();
          }}
        />
      )}

      {revoking && (
        <ConfirmDialog
          title={revoking.status === 'APPROVED' ? 'Revoke this excusal?' : 'Decline this request?'}
          message={
            revoking.status === 'APPROVED'
              ? `${revoking.excusedDate.slice(0, 10)} will go back to counting as a missed day if unpaid. This does not change any money owed.`
              : `The request for ${revoking.excusedDate.slice(0, 10)} will be declined.`
          }
          confirmLabel={revoking.status === 'APPROVED' ? 'Revoke' : 'Decline'}
          danger
          onConfirm={() => void handleRevoke(revoking)}
          onCancel={() => setRevoking(null)}
        />
      )}
    </section>
  );
}

/**
 * Stage G6 Part 4 - a plan created with no contract end date (JUMA BAKARI's,
 * and both seeded demo plans that predate this field) had no way to get one
 * short of cancelling and recreating the plan. This is the one place
 * UpdateOwnershipPlanDto.contractEndDate is reachable from the dashboard for
 * a plan that already exists.
 */
function ContractEndDateEditor({
  plan,
  onUpdated,
}: {
  plan: OwnershipPlan;
  onUpdated: (plan: OwnershipPlan) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(plan.contractEndDate?.slice(0, 10) ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    setValue(plan.contractEndDate?.slice(0, 10) ?? '');
    setError(null);
    setEditing(true);
  }

  async function handleSave() {
    if (!value) return;
    setSaving(true);
    setError(null);
    try {
      const payload: UpdateOwnershipPlanPayload = { contractEndDate: value };
      const updated = await apiFetch<OwnershipPlan>(`/ownership-plans/${plan.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      onUpdated(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the end date.');
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <span>
        {plan.contractEndDate ? (
          `ends ${plan.contractEndDate.slice(0, 10)}`
        ) : (
          <span className="text-amber-700">
            no end date set - system estimate {plan.derivedEndDate}
          </span>
        )}{' '}
        <button
          type="button"
          onClick={startEditing}
          className="text-gray-600 underline hover:text-gray-900"
        >
          {plan.contractEndDate ? 'edit' : 'set end date'}
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <input
        type="date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="rounded border border-gray-300 px-2 py-1 text-sm"
      />
      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={saving || !value}
        className="rounded bg-gray-900 px-2 py-1 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="text-xs text-gray-500 hover:underline"
      >
        Cancel
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

/**
 * Stage G10 - registrationCardHandedOverAt/spareKeyHandedOverAt/
 * nameTransferConfirmedAt had sat on the schema unused since Stage F2 -
 * this is the first UI (and the first API path, on UpdateOwnershipPlanDto)
 * either has ever reached. depositReturned is a fourth item, shown only for
 * a HELD_REFUNDABLE plan - there is nothing to return on an APPLIED one,
 * and the service 400s an attempt to set it there.
 *
 * Each item is a genuine two-way toggle, not a one-shot "mark done" button:
 * checking sends true (stamps *At to now), unchecking sends false (clears
 * it back to null) - a mis-click is recoverable without reaching for
 * Prisma Studio.
 */
function CompletionChecklistSection({
  plan,
  onUpdated,
}: {
  plan: OwnershipPlan;
  onUpdated: (plan: OwnershipPlan) => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(field: keyof UpdateOwnershipPlanPayload, checked: boolean) {
    setSaving(field);
    setError(null);
    try {
      const payload: UpdateOwnershipPlanPayload = { [field]: checked };
      const updated = await apiFetch<OwnershipPlan>(`/ownership-plans/${plan.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the checklist.');
    } finally {
      setSaving(null);
    }
  }

  const items: Array<{ key: keyof UpdateOwnershipPlanPayload; label: string; at: string | null }> =
    [
      {
        key: 'registrationCardHandedOver',
        label: 'Registration card handed over',
        at: plan.registrationCardHandedOverAt,
      },
      {
        key: 'spareKeyHandedOver',
        label: 'Spare key handed over',
        at: plan.spareKeyHandedOverAt,
      },
      {
        key: 'nameTransferConfirmed',
        label: 'Name transfer confirmed',
        at: plan.nameTransferConfirmedAt,
      },
    ];
  if (plan.depositHandling === 'HELD_REFUNDABLE') {
    items.push({ key: 'depositReturned', label: 'Deposit returned', at: plan.depositReturnedAt });
  }

  return (
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-semibold text-gray-700">Completion checklist</h2>
      <div className="space-y-2 rounded border border-gray-200 bg-white p-4">
        {items.map((item) => (
          <label key={item.key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={item.at !== null}
              disabled={saving === item.key}
              onChange={(e) => void toggle(item.key, e.target.checked)}
            />
            <span className="text-gray-900">{item.label}</span>
            {item.at && <span className="text-xs text-gray-500">— {item.at.slice(0, 10)}</span>}
          </label>
        ))}
        {error && <p className="text-xs text-red-600">{error}</p>}
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
        {formatTZS(plan.dailyAmount)}/day for {plan.instalmentCount} days · declared value{' '}
        {formatTZS(plan.totalPrice)} · {formatTZS(plan.downPayment)} down · started{' '}
        {plan.startDate.slice(0, 10)} · <ContractEndDateEditor plan={plan} onUpdated={setPlan} />
      </p>
      {/* Stage G10 - a THIRD signal, separate from the behind/ahead figures
          below and the breach threshold OwnershipPage's severity colouring
          watches - a date condition, not a payment-streak condition. */}
      {plan.pastDeadlineStillOwing && (
        <p className="mb-4 text-sm font-medium text-purple-700">
          Past the contract's end date, still owing {formatTZS(plan.remainingToOwn)}.
        </p>
      )}

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
          <p className="text-lg font-semibold text-gray-900">{plan.daysLeft}</p>
        </div>
        <div className="rounded border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">Projected completion</p>
          <p className="text-lg font-semibold text-gray-900">{plan.projectedCompletion}</p>
        </div>
      </div>

      <ContractSection planId={planId} hasContractEndDate={plan.contractEndDate !== null} />
      <CompletionChecklistSection plan={plan} onUpdated={setPlan} />
      <LedgerSection planId={planId} />
    </div>
  );
}
