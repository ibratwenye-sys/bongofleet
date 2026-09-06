import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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

// Stage L4 - the only label mapping for this enum anywhere in the app; see
// StatusBadge/PaymentsPage's PAYMENT_STATUS_LABEL_KEY (L3) for the same
// pattern. VEHICLE_TYPE_LABEL_KEY covers the four real types; the filter's
// extra 'ALL' option has its own key since VehicleType itself has no ALL
// member.
const VEHICLE_TYPE_LABEL_KEY: Record<VehicleType, string> = {
  MOTORBIKE: 'vehicleTypeMotorbike',
  BAJAJI: 'vehicleTypeBajaji',
  CAR: 'vehicleTypeCar',
  TRUCK: 'vehicleTypeTruck',
};

// Stage L4 - deliberately NOT translated (DESIGN_SWAHILI_UI.md's enum-vs-
// free-text boundary): the category field itself is free text an owner can
// type anything into, so real stored data may already exist in either
// language from actual usage. Translating only this suggestion list would
// be cosmetic - it wouldn't change what's actually saved or shown
// elsewhere - and would desync the suggestions from the data they're
// meant to shortcut. Left as literal English, unlike the fixed
// VEHICLE_TYPE_LABEL_KEY enum above.
const CATEGORY_SUGGESTIONS = [
  'Fuel',
  'Repairs',
  'Spare parts',
  'Insurance',
  'Office rent',
  'Other',
];
const APPROVALS_QUEUE_LIMIT = 5;

function vehicleTypeFilterLabel(category: VehicleType | 'ALL', t: TFunction<'expenses'>): string {
  return category === 'ALL' ? t('categoryAllTypes') : t(VEHICLE_TYPE_LABEL_KEY[category]);
}

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
  const { t } = useTranslation('expenses');
  const { t: tCommon } = useTranslation('common');
  const isEdit = expense != null;
  const [form, setForm] = useState<FormState>(() => toFormState(expense));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.category.trim()) {
      setError(t('errorCategoryRequired'));
      return;
    }
    const amount = Number(form.amount);
    if (!form.amount || Number.isNaN(amount) || amount <= 0) {
      setError(t('errorAmountPositive'));
      return;
    }
    if (!form.incurredAt) {
      setError(t('errorDateRequired'));
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
        onSaved(t('expenseUpdated'));
      } else {
        const payload: CreateExpensePayload = {
          category: form.category.trim(),
          amount,
          incurredAt: form.incurredAt,
          motorcycleId: form.motorcycleId || undefined,
          description: form.description.trim() || undefined,
        };
        await apiFetch('/expenses', { method: 'POST', body: JSON.stringify(payload) });
        onSaved(t('expenseRecorded'));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('genericError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={isEdit ? t('editExpense') : t('recordExpense')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-txt">{t('fieldCategory')}</label>
          <input
            list="expense-categories"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="w-full rounded border border-line px-3 py-2 text-sm"
            placeholder={t('categoryPlaceholder')}
          />
          <datalist id="expense-categories">
            {CATEGORY_SUGGESTIONS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">{t('fieldAmount')}</label>
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
            <label className="mb-1 block text-sm font-medium text-txt">{t('fieldDate')}</label>
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
            {t('fieldVehicle')} <span className="text-txt-2">{t('optional')}</span>
          </label>
          <select
            value={form.motorcycleId}
            onChange={(e) => setForm({ ...form, motorcycleId: e.target.value })}
            className="w-full rounded border border-line px-3 py-2 text-sm"
          >
            <option value="">{t('fleetWideOption')}</option>
            {motorcycles.map((m) => (
              <option key={m.id} value={m.id}>
                {m.registrationNumber}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-txt">
            {t('fieldDescription')} <span className="text-txt-2">{t('optional')}</span>
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
            {tCommon('cancel')}
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {submitting ? tCommon('saving') : tCommon('save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function kpisToTiles(data: ExpenseSummaryResponse, t: TFunction<'expenses'>): KpiTile[] {
  const k = data.kpis;
  return [
    { label: t('kpiSpentThisMonth'), value: formatTZS(k.spentThisMonth), accentColor: 'c1' },
    { label: t('kpiFuel'), value: formatTZS(k.fuelThisMonth), accentColor: 'warn' },
    { label: t('kpiRepairs'), value: formatTZS(k.repairsThisMonth), accentColor: 'warn' },
    {
      label: t('kpiRecurringOffenders'),
      value: String(k.recurringOffendersCount),
      accentColor: k.recurringOffendersCount > 0 ? 'crit' : 'good',
    },
    {
      label: t('kpiClaimsAwaitingApproval'),
      value: String(k.claimsAwaitingApproval),
      accentColor: k.claimsAwaitingApproval > 0 ? 'warn' : 'good',
    },
    { label: t('kpiCostPerVehicle'), value: formatTZS(k.costPerVehicle), accentColor: 'violet' },
  ];
}

function CostPerVehicleTypeCard({ rows }: { rows: CostPerVehicleTypeRow[] }) {
  const { t } = useTranslation('expenses');
  return (
    <Card title={t('costPerVehicleTypeTitle')}>
      <div className="divide-y divide-line-soft">
        {rows.map((r) => (
          <div key={r.vehicleType} className="flex items-center justify-between px-4 py-2">
            <span className="text-sm text-txt-2">{t(VEHICLE_TYPE_LABEL_KEY[r.vehicleType])}</span>
            <span className="text-sm font-medium text-txt">{formatTZS(r.costPerVehicle)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function AnomalyInsightsCard({ anomalies }: { anomalies: VehicleAnomalyRow[] }) {
  const { t } = useTranslation('expenses');
  const top = anomalies.slice(0, 2);
  return (
    <Card title={t('aiInsightsTitle')}>
      {top.length === 0 ? (
        <p className="p-4 text-sm text-txt-2">{t('noAnomalies')}</p>
      ) : (
        <div className="divide-y divide-line-soft">
          {top.map((a) => (
            <div key={a.motorcycleId} className="px-4 py-3">
              <p className="text-sm font-medium text-txt">{a.registrationNumber}</p>
              <p className="mt-1 text-xs text-txt-2">
                {t('anomalyComparison', {
                  current: formatTZS(a.currentPeriodCost),
                  avg: formatTZS(a.trailing3MoAvg),
                  sign: a.changePct >= 0 ? '+' : '',
                  pct: a.changePct,
                })}
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ClaimsAwaitingApprovalCard({ pending }: { pending: Expense[] }) {
  const { t } = useTranslation('expenses');
  return (
    <Card
      title={t('kpiClaimsAwaitingApproval')}
      subtitle={pending.length > 0 ? String(pending.length) : undefined}
    >
      {pending.length === 0 ? (
        <p className="p-4 text-sm text-txt-2">{t('noClaimsPending')}</p>
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
  const { t } = useTranslation('expenses');
  return (
    <Card
      title={t('vehicleAnomaliesTitle')}
      subtitle={rows.length > 0 ? String(rows.length) : undefined}
    >
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-txt-2">{t('noAnomalies')}</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line-soft text-left text-xs text-txt-3">
                  <th className="px-4 py-2 font-medium">{t('tableVehicle')}</th>
                  <th className="px-4 py-2 font-medium">{t('tableType')}</th>
                  <th className="px-4 py-2 text-right font-medium">{t('tableCurrentCost')}</th>
                  <th className="px-4 py-2 text-right font-medium">{t('tableAvg3Month')}</th>
                  <th className="px-4 py-2 text-right font-medium">{t('tableChange')}</th>
                  <th className="px-4 py-2 font-medium">{t('tableTopCategory')}</th>
                  <th className="px-4 py-2 font-medium">{t('tableVerdict')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.motorcycleId} className="border-b border-line-soft last:border-0">
                    <td className="px-4 py-2 font-medium text-txt">{r.registrationNumber}</td>
                    <td className="px-4 py-2 text-txt-2">
                      {t(VEHICLE_TYPE_LABEL_KEY[r.vehicleType])}
                    </td>
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
                        {t('flagged')}
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
                    {r.registrationNumber} · {t(VEHICLE_TYPE_LABEL_KEY[r.vehicleType])}
                  </span>
                  <span className="rounded bg-warn-d px-1.5 py-0.5 text-xs font-medium text-warn">
                    {t('flagged')}
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
  const { t } = useTranslation('expenses');
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
      setError(t('loadError'));
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
      setSuccessMessage(t('expenseDeleted'));
      setDeleting(null);
      void load();
      void loadFixedPeriodData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('deleteError'));
      setDeleting(null);
    }
  }

  if (error && !summary) {
    return <p className="text-sm text-crit">{error}</p>;
  }
  if (!summary) {
    return <p className="text-sm text-txt-2">{t('loading')}</p>;
  }

  return (
    <PageChassis
      title={t('title')}
      statusPill={{ mode: 'live', text: t('statusLive') }}
      primaryAction={{ label: t('recordExpense'), onClick: () => setFormTarget('new') }}
      kpis={kpisToTiles(summary, t)}
    >
      {successMessage && (
        <p className="rounded bg-good-d px-3 py-2 text-sm text-good-x">{successMessage}</p>
      )}
      {error && <p className="rounded bg-crit-d px-3 py-2 text-sm text-crit-x">{error}</p>}

      <ChassisGrid
        main={
          <Card title={t('byCategoryTitle')} subtitle={t('periodRange', { from, to })}>
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

      <Card
        title={t('allExpensesTitle')}
        subtitle={t('shownTotal', { count: expenses?.length ?? 0, total: formatTZS(total) })}
      >
        <div className="flex flex-wrap items-end gap-3 border-b border-line-soft px-4 py-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-txt-3">{t('filterFrom')}</label>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded border border-line bg-panel px-3 py-1.5 text-sm text-txt"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-txt-3">{t('filterTo')}</label>
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              className="rounded border border-line bg-panel px-3 py-1.5 text-sm text-txt"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-txt-3">
              {t('filterVehicleType')}
            </label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as VehicleType | 'ALL')}
              className="rounded border border-line bg-panel px-3 py-1.5 text-sm text-txt"
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {vehicleTypeFilterLabel(c, t)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-txt-3">
              {t('filterVehicle')}
            </label>
            <select
              value={motorcycleFilter}
              onChange={(e) => setMotorcycleFilter(e.target.value)}
              className="rounded border border-line bg-panel px-3 py-1.5 text-sm text-txt"
            >
              <option value="ALL">{t('allVehicles')}</option>
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
                <th className="px-4 py-2 font-medium">{t('tableDate')}</th>
                <th className="px-4 py-2 font-medium">{t('tableCategory')}</th>
                <th className="px-4 py-2 font-medium">{t('tableVehicle')}</th>
                <th className="px-4 py-2 font-medium">{t('tableDescription')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('tableAmount')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('tableActions')}</th>
              </tr>
            </thead>
            <tbody>
              {expenses === null ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-txt-2">
                    {t('loading')}
                  </td>
                </tr>
              ) : expenses.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-txt-2">
                    {t('noExpensesInPeriod')}
                  </td>
                </tr>
              ) : (
                expenses.map((e) => (
                  <tr key={e.id} className="border-b border-line-soft last:border-0">
                    <td className="px-4 py-2 text-txt-2">{e.incurredAt.slice(0, 10)}</td>
                    <td className="px-4 py-2 font-medium text-txt">{e.category}</td>
                    <td className="px-4 py-2 text-txt-2">
                      {e.motorcycleId ? (regById.get(e.motorcycleId) ?? '—') : t('fleetWide')}
                    </td>
                    <td className="px-4 py-2 text-txt-2">{e.description ?? '—'}</td>
                    <td className="px-4 py-2 text-right text-txt-2">{formatTZS(e.amount)}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => setFormTarget(e)}
                        className="mr-3 text-sm font-medium text-txt hover:underline"
                      >
                        {t('edit')}
                      </button>
                      <button
                        onClick={() => setDeleting(e)}
                        className="text-sm font-medium text-crit hover:underline"
                      >
                        {t('delete')}
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
            <p className="p-4 text-center text-sm text-txt-2">{t('loading')}</p>
          ) : expenses.length === 0 ? (
            <p className="p-4 text-center text-sm text-txt-2">{t('noExpensesInPeriod')}</p>
          ) : (
            expenses.map((e) => (
              <div key={e.id} className="border-b border-line-soft px-4 py-3 last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-txt">{e.category}</span>
                  <span className="text-xs text-txt-2">{e.incurredAt.slice(0, 10)}</span>
                </div>
                <p className="mt-1 text-xs text-txt-2">
                  {e.motorcycleId ? (regById.get(e.motorcycleId) ?? '—') : t('fleetWide')}
                  {e.description ? ` · ${e.description}` : ''}
                </p>
                <p className="mt-1 text-sm text-txt-2">{formatTZS(e.amount)}</p>
                <div className="mt-2 flex min-h-11 items-center justify-end gap-4">
                  <button
                    onClick={() => setFormTarget(e)}
                    className="text-sm font-medium text-txt hover:underline"
                  >
                    {t('edit')}
                  </button>
                  <button
                    onClick={() => setDeleting(e)}
                    className="text-sm font-medium text-crit hover:underline"
                  >
                    {t('delete')}
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
          <Card title={t('fuelLargestLineTitle')} subtitle={t('periodRange', { from, to })}>
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
          title={t('deleteExpenseTitle')}
          message={t('deleteExpenseMessage', {
            category: deleting.category,
            amount: formatTZS(deleting.amount),
          })}
          confirmLabel={t('delete')}
          danger
          onConfirm={() => void handleDelete()}
          onCancel={() => setDeleting(null)}
        />
      )}
    </PageChassis>
  );
}
