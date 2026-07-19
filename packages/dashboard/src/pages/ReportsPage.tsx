import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { ExpenseCategory, MotorcyclePnl, PnlSummary, RiderRevenue } from '../lib/types';
import { formatTZS, startOfThisMonth, today } from '../lib/format';

// A small, dependency-free categorical palette for the breakdown bar. Chosen to
// stay legible on the white cards used across the dashboard.
const BAR_COLORS = [
  '#2563eb',
  '#16a34a',
  '#d97706',
  '#dc2626',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#65a30d',
];

interface ReportData {
  pnl: PnlSummary;
  perMotorcycle: MotorcyclePnl[];
  perRider: RiderRevenue[];
  breakdown: ExpenseCategory[];
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'profit' | 'loss';
}) {
  const valueColor =
    tone === 'profit' ? 'text-green-700' : tone === 'loss' ? 'text-red-600' : 'text-gray-900';
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${valueColor}`}>{value}</p>
    </div>
  );
}

function ExpenseBreakdown({ rows }: { rows: ExpenseCategory[] }) {
  const total = rows.reduce((sum, r) => sum + parseFloat(r.amount), 0);

  if (rows.length === 0) {
    return <p className="text-sm text-gray-500">No expenses recorded in this period.</p>;
  }

  return (
    <div>
      {/* Single stacked bar showing each category's share of total expenses. */}
      <div className="mb-4 flex h-4 w-full overflow-hidden rounded-full bg-gray-100">
        {rows.map((row, i) => {
          const pct = total > 0 ? (parseFloat(row.amount) / total) * 100 : 0;
          return (
            <div
              key={row.category}
              style={{ width: `${pct}%`, backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }}
              title={`${row.category}: ${formatTZS(row.amount)}`}
            />
          );
        })}
      </div>
      <ul className="space-y-2">
        {rows.map((row, i) => {
          const pct = total > 0 ? (parseFloat(row.amount) / total) * 100 : 0;
          return (
            <li key={row.category} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-gray-700">
                <span
                  className="inline-block h-3 w-3 rounded-sm"
                  style={{ backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }}
                />
                {row.category}
                <span className="text-gray-400">({row.count})</span>
              </span>
              <span className="text-gray-600">
                {formatTZS(row.amount)} <span className="text-gray-400">· {pct.toFixed(0)}%</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ReportsPage() {
  const [from, setFrom] = useState<string>(startOfThisMonth());
  const [to, setTo] = useState<string>(today());
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const qs = `?from=${from}&to=${to}`;
    try {
      const [pnl, perMotorcycle, perRider, breakdown] = await Promise.all([
        apiFetch<PnlSummary>(`/analytics/pnl${qs}`),
        apiFetch<MotorcyclePnl[]>(`/analytics/per-motorcycle${qs}`),
        apiFetch<RiderRevenue[]>(`/analytics/per-rider${qs}`),
        apiFetch<ExpenseCategory[]>(`/analytics/expense-breakdown${qs}`),
      ]);
      setData({ pnl, perMotorcycle, perRider, breakdown });
    } catch {
      setError('Could not load reports. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const netTone = data && parseFloat(data.pnl.netProfit) < 0 ? 'loss' : 'profit';

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold text-gray-900">Reports</h1>
        <div className="flex items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">From</label>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">To</label>
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm"
            />
          </div>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Apply'}
          </button>
        </div>
      </div>

      {error && <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      {data === null ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Revenue" value={formatTZS(data.pnl.revenue)} />
            <StatCard label="Expenses" value={formatTZS(data.pnl.expenses)} />
            <StatCard label="Net profit" value={formatTZS(data.pnl.netProfit)} tone={netTone} />
          </div>
          <p className="-mt-2 text-xs text-gray-400">
            {data.pnl.paymentCount} payment(s) · {data.pnl.expenseCount} expense record(s) in this
            period. Revenue counts reconciled payments dated by the assignment day.
          </p>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-gray-900">Profit per motorcycle</h2>
              <ProfitTable
                rows={data.perMotorcycle.map((m) => ({
                  key: m.motorcycleId,
                  label: m.registrationNumber,
                  revenue: m.revenue,
                  expenses: m.expenses,
                  netProfit: m.netProfit,
                }))}
                emptyText="No motorcycle activity in this period."
              />
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-gray-900">Revenue per rider</h2>
              {data.perRider.length === 0 ? (
                <p className="text-sm text-gray-500">No rider revenue in this period.</p>
              ) : (
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500">
                      <th className="py-1 font-medium">Rider</th>
                      <th className="py-1 text-right font-medium">Payments</th>
                      <th className="py-1 text-right font-medium">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.perRider.map((r) => (
                      <tr key={r.riderId}>
                        <td className="py-1.5 text-gray-900">{r.riderName}</td>
                        <td className="py-1.5 text-right text-gray-500">{r.paymentCount}</td>
                        <td className="py-1.5 text-right text-gray-700">{formatTZS(r.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Expense breakdown</h2>
            <ExpenseBreakdown rows={data.breakdown} />
          </div>
        </div>
      )}
    </div>
  );
}

function ProfitTable({
  rows,
  emptyText,
}: {
  rows: Array<{ key: string; label: string; revenue: string; expenses: string; netProfit: string }>;
  emptyText: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-gray-500">{emptyText}</p>;
  }
  return (
    <table className="min-w-full text-sm">
      <thead>
        <tr className="text-left text-gray-500">
          <th className="py-1 font-medium">Bike</th>
          <th className="py-1 text-right font-medium">Revenue</th>
          <th className="py-1 text-right font-medium">Expenses</th>
          <th className="py-1 text-right font-medium">Net</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {rows.map((row) => {
          const net = parseFloat(row.netProfit);
          return (
            <tr key={row.key}>
              <td className="py-1.5 text-gray-900">{row.label}</td>
              <td className="py-1.5 text-right text-gray-700">{formatTZS(row.revenue)}</td>
              <td className="py-1.5 text-right text-gray-500">{formatTZS(row.expenses)}</td>
              <td
                className={`py-1.5 text-right font-medium ${net < 0 ? 'text-red-600' : 'text-green-700'}`}
              >
                {formatTZS(row.netProfit)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
