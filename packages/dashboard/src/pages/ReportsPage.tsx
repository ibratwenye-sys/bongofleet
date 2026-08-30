import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import type {
  AssignmentSummaryResponse,
  ExpenseCategory,
  MonthlyPnlPoint,
  MotorcyclePnl,
  OwnershipSummaryResponse,
  SegmentPnl,
  VehicleType,
} from '../lib/types';
import { formatTZS, startOfThisMonth, today } from '../lib/format';
import { PageChassis } from '../components/chassis/PageChassis';
import { ChassisGrid, ClosingRow } from '../components/chassis/ChassisGrid';
import { Card } from '../components/chassis/Card';
import type { KpiTile } from '../components/chassis/KpiRail';

const CATEGORY_OPTIONS: (VehicleType | 'ALL')[] = ['ALL', 'MOTORBIKE', 'BAJAJI', 'CAR', 'TRUCK'];
const CATEGORY_LABELS: Record<VehicleType | 'ALL', string> = {
  ALL: 'All vehicles',
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
const MONTHS_BACK = 6;

interface ReportData {
  segments: SegmentPnl[];
  ownership: OwnershipSummaryResponse;
  assignments: AssignmentSummaryResponse;
  breakdown: ExpenseCategory[];
  perMotorcycle: MotorcyclePnl[];
  monthlySeries: MonthlyPnlPoint[];
}

function kpisToTiles(data: ReportData): KpiTile[] {
  const total = data.segments.find((s) => s.vehicleType === 'TOTAL');
  const nonTotal = data.segments.filter((s) => s.vehicleType !== 'TOTAL');
  const bestMargin = nonTotal.reduce<SegmentPnl | null>(
    (best, s) => (best === null || s.marginPct > best.marginPct ? s : best),
    null,
  );
  const net = total ? parseFloat(total.netProfit) : 0;
  return [
    { label: 'Revenue', value: formatTZS(total?.revenue ?? '0'), accentColor: 'c1' },
    { label: 'Expenses', value: formatTZS(total?.expenses ?? '0'), accentColor: 'warn' },
    {
      label: 'Net profit',
      value: formatTZS(total?.netProfit ?? '0'),
      accentColor: net >= 0 ? 'good' : 'crit',
    },
    {
      label: 'Net profit per vehicle',
      value: formatTZS(total?.netProfitPerVehicle ?? '0'),
      accentColor: 'violet',
    },
    {
      label: 'Best margin',
      value: bestMargin ? `${bestMargin.marginPct}%` : '—',
      delta:
        bestMargin && bestMargin.vehicleType !== 'TOTAL'
          ? VEHICLE_TYPE_LABELS[bestMargin.vehicleType as VehicleType]
          : undefined,
      accentColor: 'good',
    },
    {
      label: 'Recoverable',
      value: formatTZS(data.ownership.kpis.moneyAtRisk),
      accentColor: data.ownership.kpis.moneyAtRisk !== '0.00' ? 'crit' : 'good',
    },
  ];
}

function SegmentTable({ segments }: { segments: SegmentPnl[] }) {
  const nonTotal = segments.filter((s) => s.vehicleType !== 'TOTAL');
  const total = segments.find((s) => s.vehicleType === 'TOTAL');
  const maxMargin = Math.max(...nonTotal.map((s) => Math.abs(s.marginPct)), 1);
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line-soft text-left text-xs text-txt-3">
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 text-right font-medium">Vehicles</th>
              <th className="px-4 py-2 text-right font-medium">Revenue</th>
              <th className="px-4 py-2 text-right font-medium">Expenses</th>
              <th className="px-4 py-2 text-right font-medium">Net</th>
              <th className="px-4 py-2 text-right font-medium">Margin</th>
              <th className="px-4 py-2 text-right font-medium">Net / vehicle</th>
            </tr>
          </thead>
          <tbody>
            {nonTotal.map((s) => (
              <tr key={s.vehicleType} className="border-b border-line-soft last:border-0">
                <td className="px-4 py-2 font-medium text-txt">
                  {VEHICLE_TYPE_LABELS[s.vehicleType as VehicleType]}
                </td>
                <td className="px-4 py-2 text-right text-txt-2">{s.vehicleCount}</td>
                <td className="px-4 py-2 text-right text-txt-2">{formatTZS(s.revenue)}</td>
                <td className="px-4 py-2 text-right text-txt-2">{formatTZS(s.expenses)}</td>
                <td
                  className={`px-4 py-2 text-right font-medium ${parseFloat(s.netProfit) >= 0 ? 'text-good' : 'text-crit'}`}
                >
                  {formatTZS(s.netProfit)}
                </td>
                <td className="px-4 py-2 text-right text-txt-2">{s.marginPct}%</td>
                <td className="px-4 py-2 text-right text-txt-2">
                  {formatTZS(s.netProfitPerVehicle)}
                </td>
              </tr>
            ))}
            {total && (
              <tr className="border-t border-line font-semibold">
                <td className="px-4 py-2 text-txt">Total</td>
                <td className="px-4 py-2 text-right text-txt">{total.vehicleCount}</td>
                <td className="px-4 py-2 text-right text-txt">{formatTZS(total.revenue)}</td>
                <td className="px-4 py-2 text-right text-txt">{formatTZS(total.expenses)}</td>
                <td
                  className={`px-4 py-2 text-right ${parseFloat(total.netProfit) >= 0 ? 'text-good' : 'text-crit'}`}
                >
                  {formatTZS(total.netProfit)}
                </td>
                <td className="px-4 py-2 text-right text-txt">{total.marginPct}%</td>
                <td className="px-4 py-2 text-right text-txt">
                  {formatTZS(total.netProfitPerVehicle)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="p-4">
        <p className="mb-2 text-xs font-medium text-txt-2">Margin by vehicle type</p>
        <div className="space-y-2">
          {nonTotal.map((s) => (
            <div key={s.vehicleType} className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-xs text-txt-3">
                {VEHICLE_TYPE_LABELS[s.vehicleType as VehicleType]}
              </span>
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-panel-2">
                <div
                  className={s.marginPct >= 0 ? 'h-full bg-good' : 'h-full bg-crit'}
                  style={{ width: `${(Math.abs(s.marginPct) / maxMargin) * 100}%` }}
                />
              </div>
              <span className="w-12 shrink-0 text-right text-xs text-txt-2">{s.marginPct}%</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function ReportsInsightsCard({ data }: { data: ReportData }) {
  const idleCount = data.assignments.kpis.inStockToday.count;
  const topIdle = data.assignments.unassignedNow[0];
  const topMissed = data.ownership.missedDaysTable[0];

  const insights: { title: string; description: string }[] = [];
  if (idleCount > 0) {
    insights.push({
      title: `${idleCount} vehicle${idleCount === 1 ? '' : 's'} sitting idle`,
      description: topIdle
        ? `${topIdle.registrationNumber} has gone longest without a driver - ${topIdle.daysUnassigned} days.`
        : 'No driver assigned today.',
    });
  }
  if (topMissed) {
    insights.push({
      title: `${formatTZS(topMissed.valueAtRisk)} recoverable from ${topMissed.driverName}`,
      description: `${topMissed.missedStreak} day${topMissed.missedStreak === 1 ? '' : 's'} missed in a row on ${topMissed.vehicleRegistration ?? 'their vehicle'}.`,
    });
  }

  return (
    <Card title="AI Insights">
      {insights.length === 0 ? (
        <p className="p-4 text-sm text-txt-2">Nothing to flag right now.</p>
      ) : (
        <div className="divide-y divide-line-soft">
          {insights.map((insight, i) => (
            <div key={i} className="px-4 py-3">
              <p className="text-sm font-medium text-txt">{insight.title}</p>
              <p className="mt-1 text-xs text-txt-2">{insight.description}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function WhatIsEatingProfitCard({ data }: { data: ReportData }) {
  const items: { label: string; displayAmount: string; amount: number }[] = [];
  for (const c of data.breakdown.slice(0, 2)) {
    items.push({
      label: c.category,
      displayAmount: formatTZS(c.amount),
      amount: parseFloat(c.amount),
    });
  }
  const worst = data.perMotorcycle[data.perMotorcycle.length - 1];
  if (worst) {
    items.push({
      label: `${worst.registrationNumber} (worst performer)`,
      displayAmount: formatTZS(worst.netProfit),
      amount: Math.abs(parseFloat(worst.netProfit)),
    });
  }
  const atRisk = parseFloat(data.ownership.kpis.moneyAtRisk);
  if (atRisk > 0) {
    items.push({
      label: 'Ownership arrears at risk',
      displayAmount: formatTZS(data.ownership.kpis.moneyAtRisk),
      amount: atRisk,
    });
  }
  items.sort((a, b) => b.amount - a.amount);

  return (
    <Card title="What is eating the profit">
      {items.length === 0 ? (
        <p className="p-4 text-sm text-txt-2">Nothing stands out this period.</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {items.map((item, i) => (
            <li key={i} className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="text-txt-2">{item.label}</span>
              <span className="font-medium text-txt">{item.displayAmount}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function marginOf(p: MonthlyPnlPoint): number {
  const revenue = parseFloat(p.revenue);
  return revenue > 0 ? (parseFloat(p.netProfit) / revenue) * 100 : 0;
}

function MarginTrendCard({ series }: { series: MonthlyPnlPoint[] }) {
  if (series.length === 0) {
    return (
      <Card title="Margin trend">
        <p className="p-4 text-sm text-txt-2">No data in this period.</p>
      </Card>
    );
  }
  const first = marginOf(series[0]);
  const last = marginOf(series[series.length - 1]);
  const direction = last >= first ? 'up' : 'down';
  return (
    <Card title="Margin trend" subtitle={`last ${series.length} months`}>
      <div className="flex h-28 items-end gap-2 px-4 pt-4">
        {series.map((p) => {
          const margin = marginOf(p);
          return (
            <div key={p.month} className="flex flex-1 flex-col items-center gap-1">
              <div
                className={margin >= 0 ? 'w-full rounded-t bg-c1' : 'w-full rounded-t bg-crit'}
                style={{ height: `${Math.max(2, Math.min(100, Math.abs(margin) * 2))}%` }}
              />
              <span className="text-[10px] text-txt-3">{p.month.slice(5)}</span>
            </div>
          );
        })}
      </div>
      <p className="px-4 pb-4 pt-2 text-xs text-txt-2">
        Margin moved {direction} from {first.toFixed(0)}% to {last.toFixed(0)}% over this period.
      </p>
    </Card>
  );
}

function BestWorstVehicleCard({ rows }: { rows: MotorcyclePnl[] }) {
  const best = rows[0];
  const worst = rows.length > 1 ? rows[rows.length - 1] : null;
  return (
    <Card title="Best and worst performing vehicle this period">
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
        <div>
          <p className="text-xs text-txt-2">Best</p>
          {best ? (
            <>
              <p className="mt-1 text-sm font-medium text-txt">{best.registrationNumber}</p>
              <p className="text-lg font-semibold text-good">{formatTZS(best.netProfit)}</p>
            </>
          ) : (
            <p className="mt-1 text-sm text-txt-2">No activity this period.</p>
          )}
        </div>
        <div>
          <p className="text-xs text-txt-2">Worst</p>
          {worst ? (
            <>
              <p className="mt-1 text-sm font-medium text-txt">{worst.registrationNumber}</p>
              <p
                className={`text-lg font-semibold ${parseFloat(worst.netProfit) >= 0 ? 'text-good' : 'text-crit'}`}
              >
                {formatTZS(worst.netProfit)}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-txt-2">Only one vehicle had activity this period.</p>
          )}
        </div>
      </div>
    </Card>
  );
}

export function ReportsPage() {
  const [from, setFrom] = useState<string>(startOfThisMonth());
  const [to, setTo] = useState<string>(today());
  const [category, setCategory] = useState<VehicleType | 'ALL'>('ALL');
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const qs = `?from=${from}&to=${to}${category !== 'ALL' ? `&vehicleType=${category}` : ''}`;
    try {
      const [segments, ownership, assignments, breakdown, perMotorcycle, monthlySeries] =
        await Promise.all([
          apiFetch<SegmentPnl[]>(`/analytics/pnl-by-segment${qs}`),
          apiFetch<OwnershipSummaryResponse>('/ownership-plans/summary'),
          apiFetch<AssignmentSummaryResponse>('/assignments/summary'),
          apiFetch<ExpenseCategory[]>(`/analytics/expense-breakdown${qs}`),
          apiFetch<MotorcyclePnl[]>(`/analytics/per-motorcycle${qs}`),
          apiFetch<MonthlyPnlPoint[]>(
            `/analytics/monthly-pnl-series?monthsBack=${MONTHS_BACK}${category !== 'ALL' ? `&vehicleType=${category}` : ''}`,
          ),
        ]);
      setData({ segments, ownership, assignments, breakdown, perMotorcycle, monthlySeries });
    } catch {
      setError('Could not load reports. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [from, to, category]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error && !data) {
    return <p className="text-sm text-crit">{error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-txt-2">Loading…</p>;
  }

  return (
    <PageChassis
      title="Reports"
      statusPill={{ mode: 'live', text: 'LIVE' }}
      kpis={kpisToTiles(data)}
    >
      {error && <p className="rounded bg-crit-d px-3 py-2 text-sm text-crit-x">{error}</p>}

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-panel px-4 py-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-txt-3">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as VehicleType | 'ALL')}
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
        <button
          onClick={() => void load()}
          disabled={loading}
          className="rounded bg-c1 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Apply'}
        </button>
      </div>

      <ChassisGrid
        main={
          <Card title="Profit and loss by segment">
            <SegmentTable segments={data.segments} />
          </Card>
        }
        rail={
          <>
            <ReportsInsightsCard data={data} />
            <WhatIsEatingProfitCard data={data} />
          </>
        }
      />

      <Card title="Revenue and profit by month" subtitle={`last ${MONTHS_BACK} months`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left text-xs text-txt-3">
                <th className="px-4 py-2 font-medium">Month</th>
                <th className="px-4 py-2 text-right font-medium">Revenue</th>
                <th className="px-4 py-2 text-right font-medium">Expenses</th>
                <th className="px-4 py-2 text-right font-medium">Net profit</th>
              </tr>
            </thead>
            <tbody>
              {data.monthlySeries.map((p) => (
                <tr key={p.month} className="border-b border-line-soft last:border-0">
                  <td className="px-4 py-2 font-medium text-txt">{p.month}</td>
                  <td className="px-4 py-2 text-right text-txt-2">{formatTZS(p.revenue)}</td>
                  <td className="px-4 py-2 text-right text-txt-2">{formatTZS(p.expenses)}</td>
                  <td
                    className={`px-4 py-2 text-right font-medium ${parseFloat(p.netProfit) >= 0 ? 'text-good' : 'text-crit'}`}
                  >
                    {formatTZS(p.netProfit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <ClosingRow
        left={<MarginTrendCard series={data.monthlySeries} />}
        right={<BestWorstVehicleCard rows={data.perMotorcycle} />}
      />
    </PageChassis>
  );
}
