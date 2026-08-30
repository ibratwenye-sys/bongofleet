import { useEffect, useMemo, useState } from 'react';
import { apiFetch, apiFetchBlob, ApiError } from '../lib/api';
import type { Driver, Expense, Motorcycle } from '../lib/types';
import { Modal } from '../components/Modal';
import { formatDateTime, formatTZS } from '../lib/format';
import { PageChassis } from '../components/chassis/PageChassis';
import { Card } from '../components/chassis/Card';
import type { KpiTile } from '../components/chassis/KpiRail';

/**
 * Stage H3 - the receipt column. An image gets an actual thumbnail (fetched
 * eagerly, since there's no unauthenticated URL an <img src> could just
 * point at - same reason DocumentSlot.tsx fetches a blob rather than
 * linking directly); a PDF gets a plain "View receipt" link, fetched lazily
 * on click, same pattern as DocumentSlot's handleView. Either way, clicking
 * opens the full file in a new tab. No receipt at all renders a plain "—".
 */
function ReceiptCell({ expense }: { expense: Expense }) {
  const isImage = expense.receiptMimeType?.startsWith('image/') ?? false;
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!isImage || !expense.receiptStorageKey) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    apiFetchBlob(`/expenses/${expense.id}/receipt`)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setThumbUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isImage, expense.id, expense.receiptStorageKey]);

  if (!expense.receiptStorageKey) {
    return <span className="text-txt-3">—</span>;
  }

  async function openFull() {
    if (thumbUrl) {
      window.open(thumbUrl, '_blank');
      return;
    }
    setOpening(true);
    try {
      const blob = await apiFetchBlob(`/expenses/${expense.id}/receipt`);
      window.open(URL.createObjectURL(blob), '_blank');
    } catch {
      setFailed(true);
    } finally {
      setOpening(false);
    }
  }

  if (isImage) {
    return (
      <button type="button" onClick={() => void openFull()} className="block">
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt="Receipt thumbnail"
            className="h-10 w-10 rounded border border-line object-cover"
          />
        ) : failed ? (
          <span className="text-xs text-red-500">Failed to load</span>
        ) : (
          <span className="text-xs text-txt-3">Loading…</span>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void openFull()}
      disabled={opening}
      className="text-sm font-medium text-txt hover:underline disabled:opacity-50"
    >
      {opening ? 'Opening…' : failed ? 'Could not open' : 'View receipt'}
    </button>
  );
}

function RejectExpenseModal({
  expense,
  onClose,
  onRejected,
}: {
  expense: Expense;
  onClose: () => void;
  onRejected: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // The backend already 400s on a blank reason - this just stops the
    // dialog from even trying, per the task's own instruction.
    if (!reason.trim()) {
      setError('A reason is required.');
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch(`/expenses/${expense.id}/reject`, {
        method: 'PATCH',
        body: JSON.stringify({ rejectionReason: reason.trim() }),
      });
      onRejected();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reject the expense.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Reject expense" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-sm text-txt-2">
          {expense.category} · {formatTZS(expense.amount)}
        </p>
        <div>
          <label className="mb-1 block text-sm font-medium text-txt">Reason</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="w-full rounded border border-line px-3 py-2 text-sm"
            placeholder="Why is this being rejected?"
            autoFocus
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {submitting ? 'Rejecting…' : 'Reject'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Stage UI3 - a light chassis pass: this page is a worklist, not a KPI
 *  dashboard (§ no rail/closing row - forcing that content would mean
 *  inventing filler). All three tiles are computed from the same
 *  already-fetched pending-expenses list, not a separate backend call. */
function pendingKpis(expenses: Expense[]): KpiTile[] {
  const count = expenses.length;
  const totalValue = expenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);
  const oldest =
    expenses.length > 0
      ? expenses.reduce((o, e) => (new Date(e.createdAt) < new Date(o.createdAt) ? e : o))
      : null;
  const oldestDays = oldest
    ? Math.max(0, Math.floor((Date.now() - new Date(oldest.createdAt).getTime()) / 86_400_000))
    : 0;
  return [
    { label: 'Pending', value: String(count), accentColor: count > 0 ? 'warn' : 'good' },
    { label: 'Total value pending', value: formatTZS(totalValue), accentColor: 'c1' },
    {
      label: 'Oldest pending',
      value: oldest ? `${oldestDays} day${oldestDays === 1 ? '' : 's'}` : '—',
      accentColor: oldestDays > 3 ? 'crit' : 'good',
    },
  ];
}

export function ApprovalsPage() {
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [motorcycles, setMotorcycles] = useState<Motorcycle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Expense | null>(null);

  async function load() {
    setError(null);
    try {
      const data = await apiFetch<Expense[]>('/expenses?status=PENDING');
      setExpenses(data);
    } catch {
      setError('Could not load pending expenses. Please try again.');
    }
  }

  useEffect(() => {
    void load();
    apiFetch<Driver[]>('/drivers')
      .then(setDrivers)
      .catch(() => setDrivers([]));
    apiFetch<Motorcycle[]>('/motorcycles')
      .then(setMotorcycles)
      .catch(() => setMotorcycles([]));
  }, []);

  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  // Same lookup-map pattern ExpensesPage.tsx already uses for vehicle names
  // - no driver relation on the Expense API response, and none is being
  // added for this; fetch once, map by id.
  const driverById = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);
  const regById = useMemo(
    () => new Map(motorcycles.map((m) => [m.id, m.registrationNumber])),
    [motorcycles],
  );

  async function handleApprove(expense: Expense) {
    setApprovingId(expense.id);
    setError(null);
    try {
      await apiFetch(`/expenses/${expense.id}/approve`, { method: 'PATCH' });
      setExpenses((prev) => (prev ? prev.filter((e) => e.id !== expense.id) : prev));
      setSuccessMessage('Expense approved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not approve the expense.');
    } finally {
      setApprovingId(null);
    }
  }

  function handleRejected() {
    if (!rejecting) return;
    setExpenses((prev) => (prev ? prev.filter((e) => e.id !== rejecting.id) : prev));
    setSuccessMessage('Expense rejected.');
    setRejecting(null);
  }

  return (
    <PageChassis
      title="Approvals"
      statusPill={{ mode: 'live', text: 'LIVE' }}
      kpis={pendingKpis(expenses ?? [])}
    >
      {successMessage && (
        <p className="rounded bg-good-d px-3 py-2 text-sm text-good-x">{successMessage}</p>
      )}
      {error && <p className="rounded bg-crit-d px-3 py-2 text-sm text-crit-x">{error}</p>}

      <Card
        title="Pending expense claims"
        subtitle={expenses ? String(expenses.length) : undefined}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left text-xs text-txt-3">
                <th className="px-4 py-2 font-medium">Rider</th>
                <th className="px-4 py-2 font-medium">Vehicle</th>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Incurred</th>
                <th className="px-4 py-2 font-medium">Submitted</th>
                <th className="px-4 py-2 font-medium">Receipt</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {expenses === null ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-txt-2">
                    Loading…
                  </td>
                </tr>
              ) : expenses.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-txt-2">
                    No pending expenses.
                  </td>
                </tr>
              ) : (
                expenses.map((e) => {
                  const driver = e.submittedByRiderId
                    ? driverById.get(e.submittedByRiderId)
                    : undefined;
                  return (
                    <tr key={e.id} className="border-b border-line-soft last:border-0">
                      <td className="px-4 py-2 font-medium text-txt">
                        {driver
                          ? `${driver.user.firstName} ${driver.user.lastName}`
                          : 'Unknown rider'}
                      </td>
                      <td className="px-4 py-2 text-txt-2">
                        {e.motorcycleId ? (regById.get(e.motorcycleId) ?? '—') : '—'}
                      </td>
                      <td className="px-4 py-2 text-txt">{e.category}</td>
                      <td className="px-4 py-2 text-right text-txt-2">{formatTZS(e.amount)}</td>
                      <td className="px-4 py-2 text-txt-2">{e.incurredAt.slice(0, 10)}</td>
                      <td className="px-4 py-2 text-txt-2">{formatDateTime(e.createdAt)}</td>
                      <td className="px-4 py-2">
                        <ReceiptCell expense={e} />
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        <button
                          onClick={() => void handleApprove(e)}
                          disabled={approvingId === e.id}
                          className="mr-3 text-sm font-medium text-good hover:underline disabled:opacity-50"
                        >
                          {approvingId === e.id ? 'Approving…' : 'Approve'}
                        </button>
                        <button
                          onClick={() => setRejecting(e)}
                          disabled={approvingId === e.id}
                          className="text-sm font-medium text-crit hover:underline disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {rejecting && (
        <RejectExpenseModal
          expense={rejecting}
          onClose={() => setRejecting(null)}
          onRejected={handleRejected}
        />
      )}
    </PageChassis>
  );
}
