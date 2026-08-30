import { useEffect, useMemo, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import { formatTZS, formatAge, today, toDateInput } from '../lib/format';
import type {
  Assignment,
  DailyCollectionPoint,
  Driver,
  MethodBreakdownRow,
  Motorcycle,
  OldestPendingRow,
  Payment,
  PaymentStatus,
  PaymentSummaryResponse,
  UpdatePaymentPayload,
} from '../lib/types';
import { PAYMENT_STATUS_STYLES, StatusBadge } from '../components/StatusBadge';
import { PaymentFormModal } from '../components/PaymentFormModal';
import { PageChassis } from '../components/chassis/PageChassis';
import { ChassisGrid, ClosingRow } from '../components/chassis/ChassisGrid';
import { Card } from '../components/chassis/Card';
import type { KpiTile } from '../components/chassis/KpiRail';

const STATUS_OPTIONS: PaymentStatus[] = ['PENDING', 'COMPLETED', 'FAILED'];
const COLLECTION_SERIES_DAYS = 14;
const NEEDS_RECONCILING_LIMIT = 8;

function monthStart(): string {
  const d = new Date();
  return toDateInput(new Date(d.getFullYear(), d.getMonth(), 1));
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toDateInput(d);
}

function kpisToTiles(data: PaymentSummaryResponse): KpiTile[] {
  const k = data.kpis;
  return [
    { label: 'Due today', value: formatTZS(k.dueToday), accentColor: 'c1' },
    { label: 'Received today', value: formatTZS(k.receivedToday), accentColor: 'good' },
    {
      label: 'Still outstanding',
      value: String(k.stillOutstanding.count),
      delta: formatTZS(k.stillOutstanding.amount),
      accentColor: k.stillOutstanding.count > 0 ? 'crit' : 'good',
    },
    { label: 'Due this month', value: formatTZS(k.dueThisMonth), accentColor: 'c1' },
    { label: 'Received this month', value: formatTZS(k.receivedThisMonth), accentColor: 'good' },
  ];
}

/** A pair of horizontal bars (due vs received) scaled to their own max -
 *  reused for both the "today" and "this month" rows below. */
function DueVsReceivedRow({
  label,
  due,
  received,
}: {
  label: string;
  due: string;
  received: string;
}) {
  const dueN = parseFloat(due);
  const receivedN = parseFloat(received);
  const max = Math.max(dueN, receivedN, 1);
  return (
    <div>
      <p className="text-xs font-medium text-txt-2">{label}</p>
      <div className="mt-1.5 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-xs text-txt-3">Due</span>
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-panel-2">
            <div className="h-full bg-c1" style={{ width: `${(dueN / max) * 100}%` }} />
          </div>
          <span className="w-24 shrink-0 text-right text-xs text-txt-2">{formatTZS(due)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-xs text-txt-3">Received</span>
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-panel-2">
            <div className="h-full bg-good" style={{ width: `${(receivedN / max) * 100}%` }} />
          </div>
          <span className="w-24 shrink-0 text-right text-xs text-txt-2">{formatTZS(received)}</span>
        </div>
      </div>
    </div>
  );
}

function MethodBreakdownTable({ rows }: { rows: MethodBreakdownRow[] }) {
  if (rows.length === 0) {
    return <p className="p-4 text-sm text-txt-2">No payments in this period.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line-soft text-left text-xs text-txt-3">
            <th className="px-4 py-2 font-medium">Method</th>
            <th className="px-4 py-2 text-right font-medium">Count</th>
            <th className="px-4 py-2 text-right font-medium">Amount</th>
            <th className="px-4 py-2 text-right font-medium">Pending</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.method} className="border-b border-line-soft last:border-0">
              <td className="px-4 py-2 font-medium text-txt">{r.method}</td>
              <td className="px-4 py-2 text-right text-txt-2">{r.count}</td>
              <td className="px-4 py-2 text-right text-txt-2">{formatTZS(r.amount)}</td>
              <td className="px-4 py-2 text-right">
                {r.pendingCount > 0 ? (
                  <span className="text-warn">
                    {r.pendingCount} · {formatTZS(r.pendingAmount)}
                  </span>
                ) : (
                  <span className="text-txt-3">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [motorcycles, setMotorcycles] = useState<Motorcycle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [summary, setSummary] = useState<PaymentSummaryResponse | null>(null);
  const [monthMethodBreakdown, setMonthMethodBreakdown] = useState<MethodBreakdownRow[]>([]);
  const [needsReconciling, setNeedsReconciling] = useState<OldestPendingRow[]>([]);
  const [collectionSeries, setCollectionSeries] = useState<DailyCollectionPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | 'ALL'>('ALL');
  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // Closing row's own period selector for "Reconciliation by method" -
  // independent of the rail's fixed current-month view, same from/to
  // pattern Reports' own filter uses.
  const [periodFrom, setPeriodFrom] = useState(monthStart());
  const [periodTo, setPeriodTo] = useState(today());
  const [periodMethodBreakdown, setPeriodMethodBreakdown] = useState<MethodBreakdownRow[]>([]);

  async function load() {
    try {
      const [
        paymentsData,
        assignmentsData,
        motorcyclesData,
        driversData,
        summaryData,
        monthBreakdown,
        pendingData,
        seriesData,
      ] = await Promise.all([
        apiFetch<Payment[]>('/payments'),
        apiFetch<Assignment[]>('/assignments'),
        apiFetch<Motorcycle[]>('/motorcycles'),
        apiFetch<Driver[]>('/drivers'),
        apiFetch<PaymentSummaryResponse>('/payments/summary'),
        apiFetch<MethodBreakdownRow[]>(
          `/payments/method-breakdown?from=${monthStart()}&to=${today()}`,
        ),
        apiFetch<OldestPendingRow[]>(
          `/payments/needs-reconciling?limit=${NEEDS_RECONCILING_LIMIT}`,
        ),
        apiFetch<DailyCollectionPoint[]>(
          `/analytics/collection-series?from=${daysAgo(COLLECTION_SERIES_DAYS - 1)}&to=${today()}`,
        ),
      ]);
      setPayments(paymentsData);
      setAssignments(assignmentsData);
      setMotorcycles(motorcyclesData);
      setDrivers(driversData);
      setSummary(summaryData);
      setMonthMethodBreakdown(monthBreakdown);
      setNeedsReconciling(pendingData);
      setCollectionSeries(seriesData);
      setError(null);
    } catch {
      setError('Could not load payments. Please try again.');
    }
  }

  async function loadPeriodBreakdown(from: string, to: string) {
    try {
      const rows = await apiFetch<MethodBreakdownRow[]>(
        `/payments/method-breakdown?from=${from}&to=${to}`,
      );
      setPeriodMethodBreakdown(rows);
    } catch {
      // Non-fatal - the closing card just stays on its previous data.
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    void loadPeriodBreakdown(periodFrom, periodTo);
  }, [periodFrom, periodTo]);

  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  const driverById = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);

  const filtered = useMemo(() => {
    if (!payments) return [];
    if (statusFilter === 'ALL') return payments;
    return payments.filter((p) => p.status === statusFilter);
  }, [payments, statusFilter]);

  function handleSaved(message: string) {
    setShowRecordPayment(false);
    setSuccessMessage(message);
    void load();
  }

  async function handleUpdateStatus(payment: Payment, status: PaymentStatus) {
    setUpdatingId(payment.id);
    try {
      const payload: UpdatePaymentPayload = { status };
      await apiFetch(`/payments/${payment.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      setSuccessMessage(status === 'COMPLETED' ? 'Payment reconciled.' : 'Payment marked failed.');
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update payment.');
    } finally {
      setUpdatingId(null);
    }
  }

  if (error && !summary) {
    return <p className="text-sm text-crit">{error}</p>;
  }
  if (!summary || !payments) {
    return <p className="text-sm text-txt-2">Loading…</p>;
  }

  // Real, computed from real numbers already fetched: whichever method
  // currently carries the largest pendingAmount this month - never a claim
  // that any method reconciles itself (see payment-summary.service.ts's
  // own comment on why nothing here can say that).
  const biggestPending = monthMethodBreakdown
    .filter((r) => parseFloat(r.pendingAmount) > 0)
    .sort((a, b) => parseFloat(b.pendingAmount) - parseFloat(a.pendingAmount))[0];

  return (
    <PageChassis
      title="Payments"
      statusPill={{ mode: 'live', text: 'LIVE' }}
      primaryAction={{ label: 'Record payment', onClick: () => setShowRecordPayment(true) }}
      kpis={kpisToTiles(summary)}
    >
      {successMessage && (
        <p className="rounded bg-good-d px-3 py-2 text-sm text-good-x">{successMessage}</p>
      )}
      {error && <p className="rounded bg-crit-d px-3 py-2 text-sm text-crit-x">{error}</p>}

      <ChassisGrid
        main={
          <Card title="Due vs received">
            <div className="space-y-4 p-4">
              <DueVsReceivedRow
                label="Today"
                due={summary.kpis.dueToday}
                received={summary.kpis.receivedToday}
              />
              <DueVsReceivedRow
                label="This month"
                due={summary.kpis.dueThisMonth}
                received={summary.kpis.receivedThisMonth}
              />
            </div>
          </Card>
        }
        rail={
          <>
            <Card title="Reconciliation status" subtitle="this month">
              <MethodBreakdownTable rows={monthMethodBreakdown} />
              <p className="border-t border-line-soft px-4 py-3 text-xs text-txt-2">
                {biggestPending
                  ? `${biggestPending.method} currently accounts for the most pending reconciliation (${formatTZS(biggestPending.pendingAmount)}).`
                  : 'Nothing is currently pending reconciliation.'}
              </p>
            </Card>
            <Card
              title="Needs reconciling"
              subtitle={needsReconciling.length > 0 ? String(needsReconciling.length) : undefined}
            >
              {needsReconciling.length === 0 ? (
                <p className="p-4 text-sm text-txt-2">Nothing waiting on reconciliation.</p>
              ) : (
                <div className="divide-y divide-line-soft">
                  {needsReconciling.map((r) => (
                    <div key={r.paymentId} className="flex items-center justify-between px-4 py-2">
                      <div>
                        <p className="text-sm font-medium text-txt">{r.driverName}</p>
                        <p className="text-xs text-txt-2">
                          {r.method} · {formatAge(r.createdAt)}
                        </p>
                      </div>
                      <span className="text-sm text-txt">{formatTZS(r.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        }
      />

      <Card title="All payments" subtitle={`${filtered.length} shown`}>
        <div className="flex items-center gap-3 border-b border-line-soft px-4 py-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as PaymentStatus | 'ALL')}
            className="rounded border border-line bg-panel px-3 py-1.5 text-sm text-txt"
          >
            <option value="ALL">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left text-xs text-txt-3">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Driver</th>
                <th className="px-4 py-2 font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Method</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-txt-2">
                    No payments found.
                  </td>
                </tr>
              ) : (
                filtered.map((p) => {
                  const driver = driverById.get(p.driverId);
                  return (
                    <tr key={p.id} className="border-b border-line-soft last:border-0">
                      <td className="px-4 py-2 text-txt-2">{p.createdAt.slice(0, 10)}</td>
                      <td className="px-4 py-2 text-txt">
                        {driver
                          ? `${driver.user.firstName} ${driver.user.lastName}`
                          : 'Unknown driver'}
                      </td>
                      <td className="px-4 py-2 text-txt-2">{formatTZS(p.amount)}</td>
                      <td className="px-4 py-2 text-txt-2">{p.paymentMethod ?? '—'}</td>
                      <td className="px-4 py-2">
                        <StatusBadge status={p.status} styles={PAYMENT_STATUS_STYLES} />
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        {p.status === 'PENDING' && (
                          <>
                            <button
                              disabled={updatingId === p.id}
                              onClick={() => void handleUpdateStatus(p, 'COMPLETED')}
                              className="mr-3 text-sm font-medium text-txt hover:underline disabled:opacity-50"
                            >
                              Reconcile
                            </button>
                            <button
                              disabled={updatingId === p.id}
                              onClick={() => void handleUpdateStatus(p, 'FAILED')}
                              className="text-sm font-medium text-crit hover:underline disabled:opacity-50"
                            >
                              Mark failed
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <ClosingRow
        left={
          <Card
            title="Reconciliation by method"
            subtitle={
              <span className="flex items-center gap-1.5 text-xs">
                <input
                  type="date"
                  value={periodFrom}
                  onChange={(e) => setPeriodFrom(e.target.value)}
                  className="rounded border border-line bg-panel px-1.5 py-0.5 text-txt"
                />
                <span className="text-txt-3">to</span>
                <input
                  type="date"
                  value={periodTo}
                  onChange={(e) => setPeriodTo(e.target.value)}
                  className="rounded border border-line bg-panel px-1.5 py-0.5 text-txt"
                />
              </span>
            }
          >
            <MethodBreakdownTable rows={periodMethodBreakdown} />
          </Card>
        }
        right={
          <Card title="Collection rate" subtitle={`last ${COLLECTION_SERIES_DAYS} days`}>
            <div className="flex h-32 items-end gap-1 px-4 pb-4">
              {collectionSeries.map((point) => {
                const max = Math.max(...collectionSeries.map((p) => parseFloat(p.amount)), 1);
                const heightPct = Math.max(2, (parseFloat(point.amount) / max) * 100);
                return (
                  <div key={point.date} className="flex flex-1 flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t bg-c1"
                      style={{ height: `${heightPct}%` }}
                      title={`${point.date}: ${formatTZS(point.amount)}`}
                    />
                    <span className="text-[10px] text-txt-3">{point.date.slice(8, 10)}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        }
      />

      {showRecordPayment && (
        <PaymentFormModal
          assignments={assignments}
          drivers={drivers}
          motorcycles={motorcycles}
          onClose={() => setShowRecordPayment(false)}
          onSaved={handleSaved}
        />
      )}
    </PageChassis>
  );
}
