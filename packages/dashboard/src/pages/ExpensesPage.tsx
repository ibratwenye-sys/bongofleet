import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';
import type {
  CostPerVehicleTypeRow,
  CreateExpensePayload,
  Expense,
  ExpenseCategory,
  ExpenseSummaryResponse,
  Motorcycle,
  UpdateExpensePayload,
  VehicleAnomalyRow,
  VehicleType,
} from '../lib/types';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ExpenseBreakdown } from '../components/ExpenseBreakdown';
import { formatTZS, startOfThisMonth, today } from '../lib/format';
import { PageChassis } from '../components/chassis/PageChassis';
import { ChassisGrid, ClosingRow } from '../components/chassis/ChassisGrid';
import { Card } from '../components/chassis/Card';
import type { KpiTile } from '../components/chassis/KpiRail';

const CATEGORY_OPTIONS: (VehicleType | 'ALL')[] = ['ALL', 'MOTORBIKE', 'BAJAJI', 'CAR', 'TRUCK'];
const CATEGORY_LABELS: Record<VehicleType | 'ALL', string> = {
  ALL: 'All types',
  MOTORBIKE: 'Motorbike',
  BAJAJI: 'Bajaji',
  CAR: 'Car',
  TRUCK: 'Truck',
};
const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  MOTORBIKE: 'Motorbike',
  BAJAJI: 'Bajaji',
  CAR: 'Car',
  TRUCK: 'Truck',
};

// Common categories offered as quick suggestions; the field is still free text
// so an owner can type anything (backend accepts any non-empty category).
const CATEGORY_SUGGESTIONS = [
  'Fuel',
  'Repairs',
  'Spare parts',
  'Insurance',
  'Office rent',
  'Other',
];
const APPROVALS_QUEUE_LIMIT = 5;

interface FormState {
  category: string;
  amount: string;
  incurredAt: string;
  motorcycleId: string;
  description: string;
}

function toFormState(expense: Expense | null): FormState {
  return {
    category: expense?.category ?? '',
    amount: expense?.amount != null ? String(parseFloat(expense.amount)) : '',
    incurredAt: expense?.incurredAt ? expense.incurredAt.slice(0, 10) : today(),
    motorcycleId: expense?.motorcycleId ?? '',
    description: expense?.description ?? '',
  };
}

function ExpenseFormModal({
  expense,
  motorcycles,
  onClose,
  onSaved,
}: {
  expense: Expense | null;
  motorcycles: Motorcycle[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isEdit = expense != null;
  const [form, setForm] = useState<FormState>(() => toFormState(expense));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.category.trim()) {
      setError('Category is required.');
      return;
    }
    const amount = Number(form.amount);
    if (!form.amount || Number.isNaN(amount) || amount <= 0) {
      setError('Amount must be a positive number.');
      return;
    }
    if (!form.incurredAt) {
      setError('Date is required.');
      return;
    }

    setSubmitting(true);
    try {
      if (isEdit) {
        const payload: UpdateExpensePayload = {
          category: form.category.trim(),
          amount,
          incurredAt: form.incurredAt,
          motorcycleId: form.motorcycleId || undefined,
          description: form.description.trim() || undefined,
        };
        await apiFetch(`/expenses/${expense.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        onSaved('Expense updated.');
      } else {
        const payload: CreateExpensePayload = {
          category: form.category.trim(),
          amount,
          incurredAt: form.incurredAt,
          motorcycleId: form.motorcycleId || undefined,
          description: form.description.trim() || undefined,
        };
        await apiFetch('/expenses', { method: 'POST', body: JSON.stringify(payload) });
        onSaved('Expense recorded.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={isEdit ? 'Edit expense' : 'Record expense'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-txt">Category</label>
          <input
            list="expense-categories"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="w-full rounded border border-line px-3 py-2 text-sm"
            placeholder="e.g. Fuel"
          />
          <datalist id="expense-categories">
            {CATEGORY_SUGGESTIONS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">Amount (TZS)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              className="w-full rounded border border-line px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">Date</label>
            <input
              type="date"
              value={form.incurredAt}
              onChange={(e) => setForm({ ...form, incurredAt: e.target.value })}
              className="w-full rounded border border-line px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-txt">
            Vehicle <span className="text-txt-2">(optional)</span>
          </label>
          <select
            value={form.motorcycleId}
            onChange={(e) => setForm({ ...form, motorcycleId: e.target.value })}
            className="w-full rounded border border-line px-3 py-2 text-sm"
          >
            <option value="">Fleet-wide (not vehicle-specific)</option>
            {motorcycles.map((m) => (
              <option key={m.id} value={m.id}>
                {m.registrationNumber}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-txt">
            Description <span className="text-txt-2">(optional)</span>
          </label>
          <input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full rounded border border-line px-3 py-2 text-sm"
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
            className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function kpisToTiles(data: ExpenseSummaryResponse): KpiTile[] {
  const k = data.kpis;
  return [
    { label: 'Spent this month', value: formatTZS(k.spentThisMonth), accentColor: 'c1' },
    { label: 'Fuel', value: formatTZS(k.fuelThisMonth), accentColor: 'warn' },
    { label: 'Repairs', value: formatTZS(k.repairsThisMonth), accentColor: 'warn' },
    {
      label: 'Recurring offenders',
      value: String(k.recurringOffendersCount),
      accentColor: k.recurringOffendersCount > 0 ? 'crit' : 'good',
    },
    {
      label: 'Claims awaiting approval',
      value: String(k.claimsAwaitingApproval),
      accentColor: k.claimsAwaitingApproval > 0 ? 'warn' : 'good',
    },
    { label: 'Cost per vehicle', value: formatTZS(k.costPerVehicle), accentColor: 'violet' },
  ];
}

function CostPerVehicleTypeCard({ rows }: { rows: CostPerVehicleTypeRow[] }) {
  return (
    <Card title="Cost per vehicle, by type">
      <div className="divide-y divide-line-soft">
        {rows.map((r) => (
          <div key={r.vehicleType} className="flex items-center justify-between px-4 py-2">
            <span className="text-sm text-txt-2">{VEHICLE_TYPE_LABELS[r.vehicleType]}</span>
            <span className="text-sm font-medium text-txt">{formatTZS(r.costPerVehicle)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function AnomalyInsightsCard({ anomalies }: { anomalies: VehicleAnomalyRow[] }) {
  const top = anomalies.slice(0, 2);
  return (
    <Card title="AI Insights">
      {top.length === 0 ? (
        <p className="p-4 text-sm text-txt-2">No vehicle is costing more than usual right now.</p>
      ) : (
        <div className="divide-y divide-line-soft">
          {top.map((a) => (
            <div key={a.motorcycleId} className="px-4 py-3">
              <p className="text-sm font-medium text-txt">{a.registrationNumber}</p>
              <p className="mt-1 text-xs text-txt-2">
                {formatTZS(a.currentPeriodCost)} this period vs {formatTZS(a.trailing3MoAvg)} own
                3-month average ({a.changePct >= 0 ? '+' : ''}
                {a.changePct}%)
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ClaimsAwaitingApprovalCard({ pending }: { pending: Expense[] }) {
  return (
    <Card
      title="Claims awaiting approval"
      subtitle={pending.length > 0 ? String(pending.length) : undefined}
    >
      {pending.length === 0 ? (
        <p className="p-4 text-sm text-txt-2">Nothing waiting on approval.</p>
      ) : (
        <div className="divide-y divide-line-soft">
          {pending.slice(0, APPROVALS_QUEUE_LIMIT).map((e) => (
            <Link key={e.id} to="/approvals" className="block px-4 py-2 hover:bg-panel-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-txt">{e.category}</span>
                <span className="text-sm text-txt-2">{formatTZS(e.amount)}</span>
              </div>
              <p className="text-xs text-txt-3">{e.incurredAt.slice(0, 10)}</p>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

function VehicleAnomaliesTable({ rows }: { rows: VehicleAnomalyRow[] }) {
  return (
    <Card
      title="Vehicles costing more than they should"
      subtitle={rows.length > 0 ? String(rows.length) : undefined}
    >
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-txt-2">No vehicle is costing more than usual right now.</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line-soft text-left text-xs text-txt-3">
                  <th className="px-4 py-2 font-medium">Vehicle</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 text-right font-medium">Current cost</th>
                  <th className="px-4 py-2 text-right font-medium">3-month average</th>
                  <th className="px-4 py-2 text-right font-medium">Change</th>
                  <th className="px-4 py-2 font-medium">Top category</th>
                  <th className="px-4 py-2 font-medium">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.motorcycleId} className="border-b border-line-soft last:border-0">
                    <td className="px-4 py-2 font-medium text-txt">{r.registrationNumber}</td>
                    <td className="px-4 py-2 text-txt-2">{VEHICLE_TYPE_LABELS[r.vehicleType]}</td>
                    <td className="px-4 py-2 text-right text-txt-2">
                      {formatTZS(r.currentPeriodCost)}
                    </td>
                    <td className="px-4 py-2 text-right text-txt-2">
                      {formatTZS(r.trailing3MoAvg)}
                    </td>
                    <td className="px-4 py-2 text-right text-crit">+{r.changePct}%</td>
                    <td className="px-4 py-2 text-txt-2">{r.pattern}</td>
                    <td className="px-4 py-2">
                      <span className="rounded bg-warn-d px-1.5 py-0.5 text-xs font-medium text-warn">
                        Flagged
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden">
            {rows.map((r) => (
              <div
                key={r.motorcycleId}
                className="border-b border-line-soft px-4 py-3 last:border-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-txt">
                    {r.registrationNumber} · {VEHICLE_TYPE_LABELS[r.vehicleType]}
                  </span>
                  <span className="rounded bg-warn-d px-1.5 py-0.5 text-xs font-medium text-warn">
                    Flagged
                  </span>
                </div>
                <p className="mt-1 text-xs text-txt-2">
                  {formatTZS(r.currentPeriodCost)} vs {formatTZS(r.trailing3MoAvg)} avg ·{' '}
                  <span className="text-crit">+{r.changePct}%</span>
                </p>
                <p className="mt-1 text-xs text-txt-2">{r.pattern}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

export function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [motorcycles, setMotorcycles] = useState<Motorcycle[]>([]);
  const [summary, setSummary] = useState<ExpenseSummaryResponse | null>(null);
  const [breakdown, setBreakdown] = useState<ExpenseCategory[]>([]);
  const [costPerVehicleType, setCostPerVehicleType] = useState<CostPerVehicleTypeRow[]>([]);
  const [anomalies, setAnomalies] = useState<VehicleAnomalyRow[]>([]);
  const [pendingClaims, setPendingClaims] = useState<Expense[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [from, setFrom] = useState<string>(startOfThisMonth());
  const [to, setTo] = useState<string>(today());
  const [motorcycleFilter, setMotorcycleFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<VehicleType | 'ALL'>('ALL');
  const [formTarget, setFormTarget] = useState<'new' | Expense | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);

  async function load() {
    setError(null);
    // Stage H3 - this ledger is meant to be settled: PENDING/REJECTED rows
    // belong on the Approvals queue, not here. Without this filter every
    // pending submission since H2 shipped silently showed up here too and
    // got summed into "Total shown."
    const params = new URLSearchParams({ from, to, status: 'APPROVED' });
    if (motorcycleFilter !== 'ALL') {
      params.set('motorcycleId', motorcycleFilter);
    }
    if (categoryFilter !== 'ALL') {
      params.set('vehicleType', categoryFilter);
    }
    const breakdownParams = new URLSearchParams({ from, to });
    if (categoryFilter !== 'ALL') {
      breakdownParams.set('vehicleType', categoryFilter);
    }
    try {
      const [expensesData, breakdownData, costPerTypeData] = await Promise.all([
        apiFetch<Expense[]>(`/expenses?${params.toString()}`),
        apiFetch<ExpenseCategory[]>(`/analytics/expense-breakdown?${breakdownParams.toString()}`),
        apiFetch<CostPerVehicleTypeRow[]>(
          `/expenses/cost-per-vehicle-type?${breakdownParams.toString()}`,
        ),
      ]);
      setExpenses(expensesData);
      setBreakdown(breakdownData);
      setCostPerVehicleType(costPerTypeData);
    } catch {
      setError('Could not load expenses. Please try again.');
    }
  }

  async function loadFixedPeriodData() {
    try {
      const [summaryData, anomaliesData, pendingData] = await Promise.all([
        apiFetch<ExpenseSummaryResponse>('/expenses/summary'),
        apiFetch<VehicleAnomalyRow[]>('/expenses/anomalies'),
        apiFetch<Expense[]>('/expenses?status=PENDING'),
      ]);
      setSummary(summaryData);
      setAnomalies(anomaliesData);
      setPendingClaims(pendingData);
    } catch {
      // Non-fatal for the KPI rail/rail cards - the filterable table below
      // still loads independently.
    }
  }

  useEffect(() => {
    apiFetch<Motorcycle[]>('/motorcycles')
      .then(setMotorcycles)
      .catch(() => setMotorcycles([]));
    void loadFixedPeriodData();
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, motorcycleFilter, categoryFilter]);

  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  const regById = useMemo(
    () => new Map(motorcycles.map((m) => [m.id, m.registrationNumber])),
    [motorcycles],
  );

  const total = useMemo(
    () => (expenses ?? []).reduce((sum, e) => sum + parseFloat(e.amount), 0),
    [expenses],
  );

  function handleSaved(message: string) {
    setFormTarget(null);
    setSuccessMessage(message);
    void load();
    void loadFixedPeriodData();
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await apiFetch(`/expenses/${deleting.id}`, { method: 'DELETE' });
      setSuccessMessage('Expense deleted.');
      setDeleting(null);
      void load();
      void loadFixedPeriodData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete expense.');
      setDeleting(null);
    }
  }

  if (error && !summary) {
    return <p className="text-sm text-crit">{error}</p>;
  }
  if (!summary) {
    return <p className="text-sm text-txt-2">Loading…</p>;
  }

  return (
    <PageChassis
      title="Expenses"
      statusPill={{ mode: 'live', text: 'LIVE' }}
      primaryAction={{ label: 'Record expense', onClick: () => setFormTarget('new') }}
      kpis={kpisToTiles(summary)}
    >
      {successMessage && (
        <p className="rounded bg-good-d px-3 py-2 text-sm text-good-x">{successMessage}</p>
      )}
      {error && <p className="rounded bg-crit-d px-3 py-2 text-sm text-crit-x">{error}</p>}

      <ChassisGrid
        main={
          <Card title="By category" subtitle={`${from} to ${to}`}>
            <ExpenseBreakdown rows={breakdown} />
          </Card>
        }
        rail={
          <>
            <CostPerVehicleTypeCard rows={costPerVehicleType} />
            <AnomalyInsightsCard anomalies={anomalies} />
            <ClaimsAwaitingApprovalCard pending={pendingClaims} />
          </>
        }
      />

      <Card title="All expenses" subtitle={`${expenses?.length ?? 0} shown · ${formatTZS(total)}`}>
        <div className="flex flex-wrap items-end gap-3 border-b border-line-soft px-4 py-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-txt-3">From</label>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded border border-line bg-panel px-3 py-1.5 text-sm text-txt"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-txt-3">To</label>
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              className="rounded border border-line bg-panel px-3 py-1.5 text-sm text-txt"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-txt-3">Vehicle type</label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as VehicleType | 'ALL')}
              className="rounded border border-line bg-panel px-3 py-1.5 text-sm text-txt"
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-txt-3">Vehicle</label>
            <select
              value={motorcycleFilter}
              onChange={(e) => setMotorcycleFilter(e.target.value)}
              className="rounded border border-line bg-panel px-3 py-1.5 text-sm text-txt"
            >
              <option value="ALL">All</option>
              {motorcycles.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.registrationNumber}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left text-xs text-txt-3">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium">Vehicle</th>
                <th className="px-4 py-2 font-medium">Description</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {expenses === null ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-txt-2">
                    Loading…
                  </td>
                </tr>
              ) : expenses.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-txt-2">
                    No expenses in this period.
                  </td>
                </tr>
              ) : (
                expenses.map((e) => (
                  <tr key={e.id} className="border-b border-line-soft last:border-0">
                    <td className="px-4 py-2 text-txt-2">{e.incurredAt.slice(0, 10)}</td>
                    <td className="px-4 py-2 font-medium text-txt">{e.category}</td>
                    <td className="px-4 py-2 text-txt-2">
                      {e.motorcycleId ? (regById.get(e.motorcycleId) ?? '—') : 'Fleet-wide'}
                    </td>
                    <td className="px-4 py-2 text-txt-2">{e.description ?? '—'}</td>
                    <td className="px-4 py-2 text-right text-txt-2">{formatTZS(e.amount)}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => setFormTarget(e)}
                        className="mr-3 text-sm font-medium text-txt hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleting(e)}
                        className="text-sm font-medium text-crit hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="md:hidden">
          {expenses === null ? (
            <p className="p-4 text-center text-sm text-txt-2">Loading…</p>
          ) : expenses.length === 0 ? (
            <p className="p-4 text-center text-sm text-txt-2">No expenses in this period.</p>
          ) : (
            expenses.map((e) => (
              <div key={e.id} className="border-b border-line-soft px-4 py-3 last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-txt">{e.category}</span>
                  <span className="text-xs text-txt-2">{e.incurredAt.slice(0, 10)}</span>
                </div>
                <p className="mt-1 text-xs text-txt-2">
                  {e.motorcycleId ? (regById.get(e.motorcycleId) ?? '—') : 'Fleet-wide'}
                  {e.description ? ` · ${e.description}` : ''}
                </p>
                <p className="mt-1 text-sm text-txt-2">{formatTZS(e.amount)}</p>
                <div className="mt-2 flex min-h-11 items-center justify-end gap-4">
                  <button
                    onClick={() => setFormTarget(e)}
                    className="text-sm font-medium text-txt hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setDeleting(e)}
                    className="text-sm font-medium text-crit hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      <ClosingRow
        left={<VehicleAnomaliesTable rows={anomalies} />}
        right={
          <Card title="Fuel, the largest single line" subtitle={`${from} to ${to}`}>
            <ExpenseBreakdown rows={breakdown} highlightCategory="Fuel" />
          </Card>
        }
      />

      {formTarget !== null && (
        <ExpenseFormModal
          expense={formTarget === 'new' ? null : formTarget}
          motorcycles={motorcycles}
          onClose={() => setFormTarget(null)}
          onSaved={handleSaved}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete expense"
          message={`Delete the ${deleting.category} expense of ${formatTZS(deleting.amount)}? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => void handleDelete()}
          onCancel={() => setDeleting(null)}
        />
      )}
    </PageChassis>
  );
}
