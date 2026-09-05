import { useEffect, useMemo, useState } from 'react';
import { apiFetch, apiFetchBlob, ApiError } from '../lib/api';
import type { Driver, Expense, ExpenseCategoryCap, Motorcycle } from '../lib/types';
import { Modal } from '../components/Modal';
import { formatDateTime, formatTZS } from '../lib/format';
import { PageChassis } from '../components/chassis/PageChassis';
import { Card } from '../components/chassis/Card';
import type { KpiTile } from '../components/chassis/KpiRail';
import { useAuth } from '../lib/auth-context';

/** DESIGN_RIDER_EXPENSES.md step 5 - both advisory-only signals get the
 *  same amber-pill treatment (StatusBadge.tsx's own PENDING/EXPIRING_SOON
 *  convention), not a new visual language: neither is more or less severe
 *  than the other, just two independent "worth a second look" flags. */
function OverCapBadge() {
  return (
    <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-amber-800">
      Over cap
    </span>
  );
}

function PossibleDuplicateBadge() {
  return (
    <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-amber-800">
      Possible duplicate
    </span>
  );
}

/**
 * Stage (DESIGN_RIDER_EXPENSES.md step 5) - one row per rider category,
 * always all 7 (the caps prop already comes from GET in that fixed
 * shape). OWNER gets an editable number input per category (blank = no
 * cap) and a single Save button that PUTs the whole set; MANAGER sees the
 * same 7 rows read-only, same "OWNER edits, MANAGER views" split as the
 * rest of this stage's role gating.
 */
function CategoryCapsCard({
  caps,
  isOwner,
  onSaved,
}: {
  caps: ExpenseCategoryCap[];
  isOwner: boolean;
  onSaved: (caps: ExpenseCategoryCap[], message: string) => void;
}) {
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Re-syncs both on first load and after a successful save (the parent
  // passes the PUT response's own fresh caps back down as this same prop).
  useEffect(() => {
    setInputs(Object.fromEntries(caps.map((c) => [c.category, c.dailyCapAmount ?? ''])));
  }, [caps]);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const body = {
        caps: caps.map((c) => {
          const raw = (inputs[c.category] ?? '').trim();
          return { category: c.category, dailyCapAmount: raw === '' ? null : Number(raw) };
        }),
      };
      const saved = await apiFetch<ExpenseCategoryCap[]>('/expense-category-caps', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      onSaved(saved, 'Category caps saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save category caps.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Category caps" subtitle="Daily, per rider">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {caps.map((c) => (
          <div key={c.category}>
            <label className="mb-1 block text-xs font-medium text-txt-2">{c.category}</label>
            {isOwner ? (
              <input
                type="number"
                min="0"
                value={inputs[c.category] ?? ''}
                onChange={(e) => setInputs({ ...inputs, [c.category]: e.target.value })}
                placeholder="No cap"
                className="w-full rounded border border-line px-2 py-1.5 text-sm"
              />
            ) : (
              <p className="text-sm text-txt">
                {c.dailyCapAmount ? formatTZS(c.dailyCapAmount) : 'No cap'}
              </p>
            )}
          </div>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-crit">{error}</p>}
      {isOwner && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </Card>
  );
}

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
  const { user } = useAuth();
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [motorcycles, setMotorcycles] = useState<Motorcycle[]>([]);
  const [caps, setCaps] = useState<ExpenseCategoryCap[] | null>(null);
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

  function handleCapsSaved(saved: ExpenseCategoryCap[], message: string) {
    setCaps(saved);
    setSuccessMessage(message);
  }

  useEffect(() => {
    void load();
    apiFetch<Driver[]>('/drivers')
      .then(setDrivers)
      .catch(() => setDrivers([]));
    apiFetch<Motorcycle[]>('/motorcycles')
      .then(setMotorcycles)
      .catch(() => setMotorcycles([]));
    apiFetch<ExpenseCategoryCap[]>('/expense-category-caps')
      .then(setCaps)
      .catch(() => setCaps([]));
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

      {caps && (
        <CategoryCapsCard caps={caps} isOwner={user?.role === 'OWNER'} onSaved={handleCapsSaved} />
      )}

      <Card
        title="Pending expense claims"
        subtitle={expenses ? String(expenses.length) : undefined}
      >
        <div className="hidden overflow-x-auto md:block">
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
                      <td className="px-4 py-2 text-txt">
                        <div className="flex flex-wrap items-center gap-2">
                          <span>{e.category}</span>
                          {e.overCapFlag && <OverCapBadge />}
                          {e.possibleDuplicateFlag && <PossibleDuplicateBadge />}
                        </div>
                      </td>
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

        <div className="md:hidden">
          {expenses === null ? (
            <p className="p-4 text-center text-sm text-txt-2">Loading…</p>
          ) : expenses.length === 0 ? (
            <p className="p-4 text-center text-sm text-txt-2">No pending expenses.</p>
          ) : (
            expenses.map((e) => {
              const driver = e.submittedByRiderId
                ? driverById.get(e.submittedByRiderId)
                : undefined;
              return (
                <div key={e.id} className="border-b border-line-soft px-4 py-3 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-txt">
                      {driver
                        ? `${driver.user.firstName} ${driver.user.lastName}`
                        : 'Unknown rider'}
                    </span>
                    <span className="text-xs text-txt-2">{e.category}</span>
                  </div>
                  {(e.overCapFlag || e.possibleDuplicateFlag) && (
                    <div className="mt-1 flex flex-wrap gap-2">
                      {e.overCapFlag && <OverCapBadge />}
                      {e.possibleDuplicateFlag && <PossibleDuplicateBadge />}
                    </div>
                  )}
                  <p className="mt-1 text-xs text-txt-2">
                    {e.motorcycleId ? (regById.get(e.motorcycleId) ?? '—') : '—'} ·{' '}
                    {formatTZS(e.amount)}
                  </p>
                  <p className="mt-1 text-xs text-txt-2">
                    Incurred {e.incurredAt.slice(0, 10)} · Submitted {formatDateTime(e.createdAt)}
                  </p>
                  <div className="mt-2">
                    <ReceiptCell expense={e} />
                  </div>
                  <div className="mt-2 flex min-h-11 items-center justify-end gap-4">
                    <button
                      onClick={() => void handleApprove(e)}
                      disabled={approvingId === e.id}
                      className="text-sm font-medium text-good hover:underline disabled:opacity-50"
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
                  </div>
                </div>
              );
            })
          )}
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
