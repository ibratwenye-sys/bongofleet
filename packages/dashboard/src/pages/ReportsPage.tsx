import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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
import { vehicleTypeLabel } from '../lib/vehicle-type';

const CATEGORY_OPTIONS: (VehicleType | 'ALL')[] = ['ALL', 'MOTORBIKE', 'BAJAJI', 'CAR', 'TRUCK'];

// Same "one extra ALL option" problem ExpensesPage.tsx's own
// vehicleTypeFilterLabel() solved at L4 - 'ALL' isn't a real VehicleType,
// so it gets its own reports.json key instead of a fifth VEHICLE_TYPE_LABEL_KEY entry.
function categoryOptionLabel(
  category: VehicleType | 'ALL',
  t: TFunction<'reports'>,
  tCommon: TFunction<'common'>,
): string {
  return category === 'ALL' ? t('allVehicles') : vehicleTypeLabel(category, tCommon);
}

const MONTHS_BACK = 6;

interface ReportData {
  segments: SegmentPnl[];
  ownership: OwnershipSummaryResponse;
  assignments: AssignmentSummaryResponse;
  breakdown: ExpenseCategory[];
  perMotorcycle: MotorcyclePnl[];
  monthlySeries: MonthlyPnlPoint[];
}

function kpisToTiles(
  data: ReportData,
  t: TFunction<'reports'>,
  tCommon: TFunction<'common'>,
): KpiTile[] {
  const total = data.segments.find((s) => s.vehicleType === 'TOTAL');
  const nonTotal = data.segments.filter((s) => s.vehicleType !== 'TOTAL');
  const bestMargin = nonTotal.reduce<SegmentPnl | null>(
    (best, s) => (best === null || s.marginPct > best.marginPct ? s : best),
    null,
  );
  const net = total ? parseFloat(total.netProfit) : 0;
  return [
    { label: t('kpiRevenue'), value: formatTZS(total?.revenue ?? '0'), accentColor: 'c1' },
    { label: t('kpiExpenses'), value: formatTZS(total?.expenses ?? '0'), accentColor: 'warn' },
    {
      label: t('kpiNetProfit'),
      value: formatTZS(total?.netProfit ?? '0'),
      accentColor: net >= 0 ? 'good' : 'crit',
    },
    {
      label: t('kpiNetProfitPerVehicle'),
      value: formatTZS(total?.netProfitPerVehicle ?? '0'),
      accentColor: 'violet',
    },
    {
      label: t('kpiBestMargin'),
      value: bestMargin ? `${bestMargin.marginPct}%` : '—',
      delta:
        bestMargin && bestMargin.vehicleType !== 'TOTAL'
          ? vehicleTypeLabel(bestMargin.vehicleType as VehicleType, tCommon)
          : undefined,
      accentColor: 'good',
    },
    {
      label: t('kpiRecoverable'),
      value: formatTZS(data.ownership.kpis.moneyAtRisk),
      accentColor: data.ownership.kpis.moneyAtRisk !== '0.00' ? 'crit' : 'good',
    },
  ];
}

function SegmentTable({ segments }: { segments: SegmentPnl[] }) {
  const { t } = useTranslation('reports');
  const { t: tCommon } = useTranslation('common');
  const nonTotal = segments.filter((s) => s.vehicleType !== 'TOTAL');
  const total = segments.find((s) => s.vehicleType === 'TOTAL');
  const maxMargin = Math.max(...nonTotal.map((s) => Math.abs(s.marginPct)), 1);
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line-soft text-left text-xs text-txt-3">
              <th className="px-4 py-2 font-medium">{t('tableType')}</th>
              <th className="px-4 py-2 text-right font-medium">{t('tableVehicles')}</th>
              <th className="px-4 py-2 text-right font-medium">{t('tableRevenue')}</th>
              <th className="px-4 py-2 text-right font-medium">{t('tableExpenses')}</th>
              <th className="px-4 py-2 text-right font-medium">{t('tableNet')}</th>
              <th className="px-4 py-2 text-right font-medium">{t('tableMargin')}</th>
              <th className="px-4 py-2 text-right font-medium">{t('tableNetPerVehicle')}</th>
            </tr>
          </thead>
          <tbody>
            {nonTotal.map((s) => (
              <tr key={s.vehicleType} className="border-b border-line-soft last:border-0">
                <td className="px-4 py-2 font-medium text-txt">
                  {vehicleTypeLabel(s.vehicleType as VehicleType, tCommon)}
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
                <td className="px-4 py-2 text-txt">{t('total')}</td>
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
        <p className="mb-2 text-xs font-medium text-txt-2">{t('marginByTypeLabel')}</p>
        <div className="space-y-2">
          {nonTotal.map((s) => (
            <div key={s.vehicleType} className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-xs text-txt-3">
                {vehicleTypeLabel(s.vehicleType as VehicleType, tCommon)}
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

// Stage L12 - unlike every other page's AI Insights card, there is no
// backend insight object here: this card builds `insights` entirely
// client-side, string-templating title/description straight from
// data.assignments/data.ownership numbers. That makes this content
// dashboard-authored (the same category as any other page's KPI/detail-
// line templates), not the usual backend-content exemption - it needs
// real translation keys.
function ReportsInsightsCard({ data }: { data: ReportData }) {
  const { t } = useTranslation('reports');
  const idleCount = data.assignments.kpis.inStockToday.count;
  const topIdle = data.assignments.unassignedNow[0];
  const topMissed = data.ownership.missedDaysTable[0];

  const insights: { title: string; description: string }[] = [];
  if (idleCount > 0) {
    insights.push({
      title: t('idleVehiclesTitle', { count: idleCount }),
      description: topIdle
        ? t('idleVehicleDescription', {
            registration: topIdle.registrationNumber,
            count: topIdle.daysUnassigned,
          })
        : t('noDriverAssignedToday'),
    });
  }
  if (topMissed) {
    insights.push({
      title: t('missedPaymentTitle', {
        amount: formatTZS(topMissed.valueAtRisk),
        driverName: topMissed.driverName,
      }),
      description: t('missedPaymentDescription', {
        count: topMissed.missedStreak,
        vehicle: topMissed.vehicleRegistration ?? t('theirVehicleFallback'),
      }),
    });
  }

  return (
    <Card title={t('aiInsightsTitle')}>
      {insights.length === 0 ? (
        <p className="p-4 text-sm text-txt-2">{t('nothingToFlag')}</p>
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

// Stage L12 - c.category (the expense-breakdown item's own category text)
// stays untranslated: it's the same free-text fleet-expense category field
// ExpensesPage.tsx already established as deliberately-English at L4 (its
// CATEGORY_SUGGESTIONS datalist), not a fixed enum - real stored data here
// too, not UI chrome.
function WhatIsEatingProfitCard({ data }: { data: ReportData }) {
  const { t } = useTranslation('reports');
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
      label: t('worstPerformerSuffix', { registration: worst.registrationNumber }),
      displayAmount: formatTZS(worst.netProfit),
      amount: Math.abs(parseFloat(worst.netProfit)),
    });
  }
  const atRisk = parseFloat(data.ownership.kpis.moneyAtRisk);
  if (atRisk > 0) {
    items.push({
      label: t('ownershipArrearsAtRisk'),
      displayAmount: formatTZS(data.ownership.kpis.moneyAtRisk),
      amount: atRisk,
    });
  }
  items.sort((a, b) => b.amount - a.amount);

  return (
    <Card title={t('eatingProfitTitle')}>
      {items.length === 0 ? (
        <p className="p-4 text-sm text-txt-2">{t('nothingStandsOut')}</p>
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
  const { t } = useTranslation('reports');
  if (series.length === 0) {
    return (
      <Card title={t('marginTrendTitle')}>
        <p className="p-4 text-sm text-txt-2">{t('noDataInPeriod')}</p>
      </Card>
    );
  }
  const first = marginOf(series[0]);
  const last = marginOf(series[series.length - 1]);
  // Stage L12 - direction is chosen in code (two full template keys) rather
  // than interpolating a translated word into one shared sentence: Swahili
  // word order for "moved up/down" doesn't necessarily match English's
  // adverb-after-verb placement, so a single interpolated-direction
  // template would be fragile.
  const trendKey = last >= first ? 'marginTrendUp' : 'marginTrendDown';
  return (
    <Card
      title={t('marginTrendTitle')}
      subtitle={t('lastMonthsSubtitle', { count: series.length })}
    >
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
        {t(trendKey, { first: first.toFixed(0), last: last.toFixed(0) })}
      </p>
    </Card>
  );
}

function BestWorstVehicleCard({ rows }: { rows: MotorcyclePnl[] }) {
  const { t } = useTranslation('reports');
  const best = rows[0];
  const worst = rows.length > 1 ? rows[rows.length - 1] : null;
  return (
    <Card title={t('bestWorstTitle')}>
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
        <div>
          <p className="text-xs text-txt-2">{t('best')}</p>
          {best ? (
            <>
              <p className="mt-1 text-sm font-medium text-txt">{best.registrationNumber}</p>
              <p className="text-lg font-semibold text-good">{formatTZS(best.netProfit)}</p>
            </>
          ) : (
            <p className="mt-1 text-sm text-txt-2">{t('noActivityThisPeriod')}</p>
          )}
        </div>
        <div>
          <p className="text-xs text-txt-2">{t('worst')}</p>
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
            <p className="mt-1 text-sm text-txt-2">{t('onlyOneVehicleActivity')}</p>
          )}
        </div>
      </div>
    </Card>
  );
}

export function ReportsPage() {
  const { t } = useTranslation('reports');
  const { t: tCommon } = useTranslation('common');
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
      setError(t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [from, to, category, t]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error && !data) {
    return <p className="text-sm text-crit">{error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-txt-2">{t('loading')}</p>;
  }

  return (
    <PageChassis
      title={t('title')}
      statusPill={{ mode: 'live', text: tCommon('statusLive') }}
      kpis={kpisToTiles(data, t, tCommon)}
    >
      {error && <p className="rounded bg-crit-d px-3 py-2 text-sm text-crit-x">{error}</p>}

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-panel px-4 py-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-txt-3">{t('filterCategory')}</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as VehicleType | 'ALL')}
            className="rounded border border-line bg-panel px-3 py-1.5 text-sm text-txt"
          >
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {categoryOptionLabel(c, t, tCommon)}
              </option>
            ))}
          </select>
        </div>
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
        <button
          onClick={() => void load()}
          disabled={loading}
          className="rounded bg-c1 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {loading ? t('loading') : t('apply')}
        </button>
      </div>

      <ChassisGrid
        main={
          <Card title={t('segmentTitle')}>
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

      <Card title={t('monthlyTitle')} subtitle={t('lastMonthsSubtitle', { count: MONTHS_BACK })}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left text-xs text-txt-3">
                <th className="px-4 py-2 font-medium">{t('tableMonth')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('kpiRevenue')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('kpiExpenses')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('kpiNetProfit')}</th>
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
