import { useEffect, useState } from 'react';
import { Marker } from 'react-leaflet';
import { useNavigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';
import { formatTZS, formatDateTime } from '../lib/format';
import type { FleetVehiclePosition, OperationsCenterResponse } from '../lib/types';
import { PageChassis } from '../components/chassis/PageChassis';
import { ChassisGrid, ClosingRow } from '../components/chassis/ChassisGrid';
import { Card } from '../components/chassis/Card';
import type { KpiTile } from '../components/chassis/KpiRail';
import { VehicleMap } from '../components/VehicleMap';
import { markerStatus, vehicleDivIcon, STATUS_COLOR, STATUS_LABEL } from '../lib/gps-status';

const DEFAULT_CENTER: [number, number] = [-6.8, 39.28];
const REFRESH_MS = 30_000;

function kpisToTiles(data: OperationsCenterResponse): KpiTile[] {
  const k = data.kpis;
  const netProfit = parseFloat(k.netProfitToday.amount);
  return [
    {
      label: 'On the road',
      value: String(k.onTheRoad.count),
      valueSuffix: `/ ${k.onTheRoad.fleetSize}`,
      delta:
        k.onTheRoad.deltaVsYesterday === 0
          ? 'same as yesterday'
          : `${k.onTheRoad.deltaVsYesterday > 0 ? '▲' : '▼'} ${Math.abs(k.onTheRoad.deltaVsYesterday)} vs yesterday`,
      accentColor: 'good',
    },
    {
      label: 'Collected today',
      value: formatTZS(k.collectedToday.amount),
      delta: `${k.collectedToday.percentOfTarget}% of ${formatTZS(k.collectedToday.targetAmount)} target`,
      accentColor: 'c1',
    },
    {
      label: 'Not deposited',
      value: String(k.outstandingToday.count),
      delta: `${formatTZS(k.outstandingToday.amount)} outstanding`,
      accentColor: 'crit',
    },
    {
      label: 'Ownership plans',
      value: String(k.activeOwnershipPlans.count),
      delta: 'active',
      accentColor: 'violet',
    },
    {
      label: 'Service due',
      value: String(k.serviceDue.count),
      delta:
        k.serviceDue.overdueCount > 0 ? `${k.serviceDue.overdueCount} overdue` : 'none overdue',
      accentColor: 'warn',
    },
    {
      label: 'Profit today',
      value: formatTZS(k.netProfitToday.amount),
      delta: netProfit >= 0 ? 'in the black' : 'in the red',
      accentColor: netProfit >= 0 ? 'good' : 'crit',
    },
  ];
}

function CollectionChart({ series }: { series: OperationsCenterResponse['collectionSeries'] }) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const max = Math.max(1, ...series.map((p) => parseFloat(p.amount)));
  return (
    <div>
      <div className="flex h-32 items-end gap-1">
        {series.map((p) => {
          const isToday = p.date === todayIso;
          const heightPct = Math.max(2, (parseFloat(p.amount) / max) * 100);
          return (
            <div
              key={p.date}
              className="flex flex-1 flex-col items-center gap-1"
              title={formatTZS(p.amount)}
            >
              <div
                className={`w-full rounded-t ${isToday ? 'bg-good' : 'bg-c1'}`}
                style={{ height: `${heightPct}%` }}
              />
              <span className="text-[10px] text-txt-3">{p.date.slice(8, 10)}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-txt-2">
        <span className="mr-1 inline-block h-2 w-2 rounded-full bg-good align-middle" /> Today
      </p>
    </div>
  );
}

function AlertRow({ alert }: { alert: OperationsCenterResponse['alerts'][number] }) {
  return (
    <div
      className={`border-l-[3px] px-3 py-2 ${alert.severity === 'crit' ? 'border-l-crit' : 'border-l-warn'}`}
    >
      <p className="text-sm font-medium text-txt">{alert.title}</p>
      <p className="text-xs text-txt-2">{alert.description}</p>
      {alert.when && <p className="text-xs text-txt-3">{formatDateTime(alert.when)}</p>}
    </div>
  );
}

function MotorcyclePnlRow({
  row,
}: {
  row: OperationsCenterResponse['topPerformersToday'][number];
}) {
  const netProfit = parseFloat(row.netProfit);
  return (
    <div className="flex items-center justify-between border-b border-line-soft py-2 last:border-0">
      <span className="text-sm text-txt">{row.registrationNumber}</span>
      <span className={`text-sm font-medium ${netProfit >= 0 ? 'text-good' : 'text-crit'}`}>
        {formatTZS(row.netProfit)}
      </span>
    </div>
  );
}

export function OperationsCenterPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<OperationsCenterResponse | null>(null);
  const [positions, setPositions] = useState<FleetVehiclePosition[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [ops, fleet] = await Promise.all([
          apiFetch<OperationsCenterResponse>('/dashboard/operations-center'),
          apiFetch<FleetVehiclePosition[]>('/gps/fleet-positions'),
        ]);
        setData(ops);
        setPositions(fleet);
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load the operations center.');
      }
    }
    void load();
    const interval = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return <p className="text-sm text-crit">{error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-txt-2">Loading…</p>;
  }

  const live = (positions ?? []).filter((p) => !p.offline);
  const statusCounts = { live: 0, stale: 0, offline: 0 };
  for (const p of positions ?? []) {
    statusCounts[markerStatus(p)] += 1;
  }

  return (
    <PageChassis
      title="Operations Center"
      statusPill={{ mode: 'live', text: `LIVE · ${live.length} reporting` }}
      primaryAction={{ label: 'Record payment', onClick: () => navigate('/payments') }}
      kpis={kpisToTiles(data)}
    >
      <ChassisGrid
        main={
          <>
            <Card title="Live fleet" subtitle={`${live.length} reporting`}>
              <VehicleMap
                center={DEFAULT_CENTER}
                fitBoundsTo={live.map((p) => [p.latitude, p.longitude])}
                heightClassName="h-[320px]"
                borderClassName="border-line"
              >
                {live.map((p) => (
                  <Marker
                    key={p.motorcycleId}
                    position={[p.latitude, p.longitude]}
                    icon={vehicleDivIcon(markerStatus(p), p.source)}
                    title={p.registrationNumber}
                  />
                ))}
              </VehicleMap>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-txt-2">
                {(['live', 'stale', 'offline'] as const).map((status) => (
                  <span key={status} className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: STATUS_COLOR[status] }}
                    />
                    {STATUS_LABEL[status]} — {statusCounts[status]}
                  </span>
                ))}
              </div>
            </Card>

            <Card title="Collection — last 14 days" subtitle="TZS">
              <CollectionChart series={data.collectionSeries} />
            </Card>

            <Card
              title="Today's outstanding assignments"
              subtitle={`${data.outstandingAssignmentRows.length} short`}
            >
              {data.outstandingAssignmentRows.length === 0 ? (
                <p className="p-4 text-sm text-txt-2">
                  Every assignment due today has been paid in full.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line-soft text-left text-xs text-txt-3">
                        <th className="px-4 py-2 font-medium">Vehicle</th>
                        <th className="px-4 py-2 text-right font-medium">Target</th>
                        <th className="px-4 py-2 text-right font-medium">Paid</th>
                        <th className="px-4 py-2 text-right font-medium">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.outstandingAssignmentRows.map((row) => (
                        <tr
                          key={row.registrationNumber}
                          className="border-b border-line-soft last:border-0"
                        >
                          <td className="px-4 py-2 text-txt">{row.registrationNumber}</td>
                          <td className="px-4 py-2 text-right text-txt-2">
                            {formatTZS(row.targetAmount)}
                          </td>
                          <td className="px-4 py-2 text-right text-txt-2">
                            {formatTZS(row.paidAmount)}
                          </td>
                          <td className="px-4 py-2 text-right font-medium text-crit">
                            {formatTZS(row.balance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        }
        rail={
          <>
            {/* Stage UI1 (§ no-fabrication rule) - the rail's first slot is a
                real, cheap, honestly-derived observation (today's worst
                performer by profit, reused from AnalyticsService.
                getPerMotorcycle), never invented pattern-detection
                commentary. Omitted entirely - not padded with a fake
                placeholder - when nothing moved money today at all. */}
            {data.worstPerformerToday && (
              <Card title="Needs attention" subtitle="Lowest profit today">
                <div className="p-4">
                  <p className="text-sm font-medium text-txt">
                    {data.worstPerformerToday.registrationNumber}
                  </p>
                  <p className="mt-1 text-xs text-txt-2">
                    Revenue {formatTZS(data.worstPerformerToday.revenue)}, expenses{' '}
                    {formatTZS(data.worstPerformerToday.expenses)} today.
                  </p>
                  <p
                    className={`mt-2 text-lg font-semibold ${
                      parseFloat(data.worstPerformerToday.netProfit) >= 0
                        ? 'text-good'
                        : 'text-crit'
                    }`}
                  >
                    {formatTZS(data.worstPerformerToday.netProfit)}
                  </p>
                </div>
              </Card>
            )}

            <Card title="Alerts" subtitle={data.alerts.length > 0 ? 'Needs action' : undefined}>
              {data.alerts.length === 0 ? (
                <p className="p-4 text-sm text-txt-2">Nothing needs attention right now.</p>
              ) : (
                <div className="divide-y divide-line-soft">
                  {data.alerts.map((alert, i) => (
                    <AlertRow key={i} alert={alert} />
                  ))}
                </div>
              )}
            </Card>
          </>
        }
      />

      <ClosingRow
        left={
          <Card title="Today's top performers" subtitle="By profit">
            {data.topPerformersToday.length === 0 ? (
              <p className="p-4 text-sm text-txt-2">No revenue or expenses recorded yet today.</p>
            ) : (
              <div className="px-4 pb-2">
                {data.topPerformersToday.map((row) => (
                  <MotorcyclePnlRow key={row.motorcycleId} row={row} />
                ))}
              </div>
            )}
          </Card>
        }
        right={
          <Card title="Today's profit & loss" subtitle={new Date().toLocaleDateString()}>
            <div className="px-4 pb-3 text-sm">
              <div className="flex justify-between border-b border-line-soft py-2">
                <span className="text-txt-2">Rental deposits</span>
                <span className="text-good">+{formatTZS(data.todaysPnl.rentalRevenue)}</span>
              </div>
              <div className="flex justify-between border-b border-line-soft py-2">
                <span className="text-txt-2">Transport jobs</span>
                <span className="text-good">+{formatTZS(data.todaysPnl.transportRevenue)}</span>
              </div>
              <div className="flex justify-between border-b border-line-soft py-2">
                <span className="text-txt-2">Expenses</span>
                <span className="text-crit">-{formatTZS(data.todaysPnl.expenses)}</span>
              </div>
              <div className="flex justify-between pt-2 font-semibold">
                <span className="text-txt">Net today</span>
                <span
                  className={parseFloat(data.todaysPnl.netProfit) >= 0 ? 'text-good' : 'text-crit'}
                >
                  {formatTZS(data.todaysPnl.netProfit)}
                </span>
              </div>
            </div>
          </Card>
        }
      />
    </PageChassis>
  );
}
