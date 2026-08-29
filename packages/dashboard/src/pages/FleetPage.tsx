import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Marker } from 'react-leaflet';
import { apiFetch, ApiError } from '../lib/api';
import { formatTZS } from '../lib/format';
import type {
  CreateMotorcyclePayload,
  FleetSummaryResponse,
  FleetVehiclePosition,
  Motorcycle,
  MotorcycleStatus,
  UpdateMotorcyclePayload,
  VehicleType,
} from '../lib/types';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PageChassis } from '../components/chassis/PageChassis';
import { ChassisGrid, ClosingRow } from '../components/chassis/ChassisGrid';
import { Card } from '../components/chassis/Card';
import type { KpiTile } from '../components/chassis/KpiRail';
import { VehicleMap } from '../components/VehicleMap';
import { markerStatus, vehicleDivIcon, STATUS_COLOR, STATUS_LABEL } from '../lib/gps-status';

const DEFAULT_CENTER: [number, number] = [-6.8, 39.28];
const REFRESH_MS = 30_000;

const STATUS_OPTIONS: MotorcycleStatus[] = ['ACTIVE', 'MAINTENANCE', 'RETIRED'];
const VEHICLE_TYPE_OPTIONS: VehicleType[] = ['MOTORBIKE', 'BAJAJI', 'CAR', 'TRUCK'];
const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  MOTORBIKE: 'Motorbike',
  BAJAJI: 'Bajaji',
  CAR: 'Car',
  TRUCK: 'Truck',
};

function kpisToTiles(data: FleetSummaryResponse): KpiTile[] {
  const k = data.kpis;
  return [
    {
      label: 'Total vehicles',
      value: String(k.totalVehicles.count),
      delta: k.totalVehicles.byType,
      accentColor: 'c1',
    },
    {
      label: 'On the road',
      value: String(k.onRoadToday.count),
      delta: `${k.onRoadToday.percentOfFleet}% of the fleet`,
      accentColor: 'good',
    },
    {
      label: 'Idle, no driver',
      value: String(k.idleToday.count),
      delta: `${formatTZS(k.idleToday.targetLost)} a day lost`,
      accentColor: k.idleToday.count > 0 ? 'warn' : 'good',
    },
    {
      label: 'In workshop',
      value: String(k.inWorkshop.count),
      accentColor: k.inWorkshop.count > 0 ? 'warn' : 'good',
    },
    { label: 'Collected today', value: formatTZS(k.collectedToday.amount), accentColor: 'c1' },
    {
      label: 'Net per vehicle',
      value: formatTZS(k.netPerVehicleThisMonth.amount),
      delta: 'this month',
      accentColor: 'violet',
    },
  ];
}

// ---- Create / edit vehicle modal (unchanged CRUD, now with operatingArea) ----

interface FormState {
  registrationNumber: string;
  vehicleType: VehicleType;
  make: string;
  model: string;
  year: string;
  gpsDeviceId: string;
  operatingArea: string;
  status: MotorcycleStatus;
}

function toFormState(motorcycle: Motorcycle | null): FormState {
  return {
    registrationNumber: motorcycle?.registrationNumber ?? '',
    vehicleType: motorcycle?.vehicleType ?? 'MOTORBIKE',
    make: motorcycle?.make ?? '',
    model: motorcycle?.model ?? '',
    year: motorcycle?.year != null ? String(motorcycle.year) : '',
    gpsDeviceId: motorcycle?.gpsDeviceId ?? '',
    operatingArea: motorcycle?.operatingArea ?? '',
    status: motorcycle?.status ?? 'ACTIVE',
  };
}

function MotorcycleFormModal({
  motorcycle,
  onClose,
  onSaved,
}: {
  motorcycle: Motorcycle | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isEdit = motorcycle != null;
  const [form, setForm] = useState<FormState>(() => toFormState(motorcycle));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.registrationNumber.trim()) {
      setError('Registration number is required.');
      return;
    }

    setSubmitting(true);
    try {
      if (isEdit) {
        const payload: UpdateMotorcyclePayload = {
          registrationNumber: form.registrationNumber.trim(),
          vehicleType: form.vehicleType,
          make: form.make.trim() || undefined,
          model: form.model.trim() || undefined,
          year: form.year ? Number(form.year) : undefined,
          gpsDeviceId: form.gpsDeviceId.trim() || undefined,
          operatingArea: form.operatingArea.trim() || undefined,
          status: form.status,
        };
        await apiFetch(`/motorcycles/${motorcycle.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        onSaved('Vehicle updated.');
      } else {
        const payload: CreateMotorcyclePayload = {
          registrationNumber: form.registrationNumber.trim(),
          vehicleType: form.vehicleType,
          make: form.make.trim() || undefined,
          model: form.model.trim() || undefined,
          year: form.year ? Number(form.year) : undefined,
          gpsDeviceId: form.gpsDeviceId.trim() || undefined,
          operatingArea: form.operatingArea.trim() || undefined,
        };
        await apiFetch('/motorcycles', { method: 'POST', body: JSON.stringify(payload) });
        onSaved('Vehicle added.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={isEdit ? 'Edit vehicle' : 'Add vehicle'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-txt">Registration number</label>
          <input
            value={form.registrationNumber}
            onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })}
            className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-txt">Vehicle type</label>
          <select
            value={form.vehicleType}
            onChange={(e) => setForm({ ...form, vehicleType: e.target.value as VehicleType })}
            className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
          >
            {VEHICLE_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {VEHICLE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">Make</label>
            <input
              value={form.make}
              onChange={(e) => setForm({ ...form, make: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">Model</label>
            <input
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">Year</label>
            <input
              type="number"
              value={form.year}
              onChange={(e) => setForm({ ...form, year: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">GPS device id</label>
            <input
              value={form.gpsDeviceId}
              onChange={(e) => setForm({ ...form, gpsDeviceId: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-txt">
            Operating area <span className="text-txt-2">(optional, you set this by hand)</span>
          </label>
          <input
            value={form.operatingArea}
            onChange={(e) => setForm({ ...form, operatingArea: e.target.value })}
            placeholder="e.g. Kariakoo"
            className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-gray-500">
            Free text - there's no zone detection. The Fleet page groups vehicles by whatever you
            type here.
          </p>
        </div>
        {isEdit && (
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">Status</label>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as MotorcycleStatus })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        )}

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

function TypeStack({ breakdown }: { breakdown: FleetSummaryResponse['typeBreakdown'] }) {
  const colors: Record<string, string> = {
    MOTORBIKE: 'var(--c1)',
    BAJAJI: 'var(--c2)',
    CAR: 'var(--c4)',
    TRUCK: 'var(--c3)',
  };
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-panel-2">
        {breakdown.map((t) => (
          <div
            key={t.vehicleType}
            style={{ width: `${t.share}%`, backgroundColor: colors[t.vehicleType] }}
          />
        ))}
      </div>
      <div className="mt-3 space-y-1.5 text-sm">
        {breakdown.map((t) => (
          <div key={t.vehicleType} className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-txt-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: colors[t.vehicleType] }}
              />
              {VEHICLE_TYPE_LABELS[t.vehicleType as VehicleType] ?? t.vehicleType}
            </span>
            <span className="text-txt">
              {t.count} <span className="text-txt-3">{t.share}%</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FleetPage() {
  const [data, setData] = useState<FleetSummaryResponse | null>(null);
  const [positions, setPositions] = useState<FleetVehiclePosition[] | null>(null);
  // Stage UI2 - fleet-summary's "All vehicles" table only lists active
  // vehicles (same as the KPI rail's own counts). Deactivated vehicles
  // have no row there to reactivate from, so they get this one small
  // fallback card instead of losing the reactivate flow entirely - see
  // the same pattern on DriversPage/AssignmentsPage for entities their
  // own new tables don't list either.
  const [deactivatedVehicles, setDeactivatedVehicles] = useState<Motorcycle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [formTarget, setFormTarget] = useState<'new' | Motorcycle | null>(null);
  const [editing, setEditing] = useState<Motorcycle | null>(null);
  const [deactivating, setDeactivating] = useState<{
    id: string;
    registrationNumber: string;
  } | null>(null);
  const [reactivating, setReactivating] = useState<{
    id: string;
    registrationNumber: string;
  } | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function load() {
    try {
      const [summary, fleet, allVehicles] = await Promise.all([
        apiFetch<FleetSummaryResponse>('/motorcycles/fleet-summary'),
        apiFetch<FleetVehiclePosition[]>('/gps/fleet-positions'),
        apiFetch<Motorcycle[]>('/motorcycles?includeInactive=true'),
      ]);
      setData(summary);
      setPositions(fleet);
      setDeactivatedVehicles(allVehicles.filter((v) => !v.isActive));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the fleet summary.');
    }
  }

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  function handleSaved(message: string) {
    setFormTarget(null);
    setEditing(null);
    setSuccessMessage(message);
    void load();
  }

  // Editing needs the full Motorcycle record (the summary row is a
  // narrower projection) - fetched on demand rather than widened into
  // every fleet-summary row for a rarely-used action.
  async function openEdit(motorcycleId: string) {
    try {
      const full = await apiFetch<Motorcycle>(`/motorcycles/${motorcycleId}`);
      setEditing(full);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the vehicle.');
    }
  }

  async function handleDeactivate() {
    if (!deactivating) return;
    try {
      await apiFetch(`/motorcycles/${deactivating.id}`, { method: 'DELETE' });
      setSuccessMessage('Vehicle deactivated.');
      setDeactivating(null);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not deactivate vehicle.');
      setDeactivating(null);
    }
  }

  async function handleReactivate() {
    if (!reactivating) return;
    try {
      await apiFetch(`/motorcycles/${reactivating.id}/reactivate`, { method: 'PATCH' });
      setSuccessMessage('Vehicle reactivated.');
      setReactivating(null);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reactivate vehicle.');
      setReactivating(null);
    }
  }

  if (error && !data) {
    return <p className="text-sm text-crit">{error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-txt-2">Loading…</p>;
  }

  const live = (positions ?? []).filter((p) => !p.offline);

  return (
    <PageChassis
      title="Fleet"
      statusPill={{ mode: 'live', text: `LIVE · ${live.length} reporting` }}
      primaryAction={{ label: 'Add vehicle', onClick: () => setFormTarget('new') }}
      kpis={kpisToTiles(data)}
    >
      {successMessage && (
        <p className="rounded bg-good-d px-3 py-2 text-sm text-good-x">{successMessage}</p>
      )}
      {error && <p className="rounded bg-crit-d px-3 py-2 text-sm text-crit-x">{error}</p>}

      <ChassisGrid
        main={
          <>
            <Card title="Live fleet" subtitle={`${live.length} reporting`}>
              <VehicleMap
                center={DEFAULT_CENTER}
                fitBoundsTo={live.map((p) => [p.latitude, p.longitude])}
                heightClassName="h-[280px]"
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
                    {STATUS_LABEL[status]}
                  </span>
                ))}
              </div>
            </Card>

            <Card title="Fleet by type" subtitle={`${data.kpis.totalVehicles.count} vehicles`}>
              <TypeStack breakdown={data.typeBreakdown} />
            </Card>
          </>
        }
        rail={
          <>
            {data.worstPerformerThisMonth ? (
              <Card title="Needs attention" subtitle="Losing money this month">
                <div className="p-4">
                  <p className="text-sm font-medium text-txt">
                    {data.worstPerformerThisMonth.registrationNumber}
                  </p>
                  <p className="mt-1 text-xs text-txt-2">
                    Revenue {formatTZS(data.worstPerformerThisMonth.revenue)}, expenses{' '}
                    {formatTZS(data.worstPerformerThisMonth.expenses)}.
                  </p>
                  <p className="mt-2 text-lg font-semibold text-crit">
                    {formatTZS(data.worstPerformerThisMonth.netProfit)}
                  </p>
                </div>
              </Card>
            ) : (
              <Card title="Alerts" subtitle={data.alerts.length > 0 ? 'Needs action' : undefined}>
                {data.alerts.length === 0 ? (
                  <p className="p-4 text-sm text-txt-2">Nothing needs attention right now.</p>
                ) : (
                  <div className="divide-y divide-line-soft">
                    {data.alerts.map((alert, i) => (
                      <div
                        key={i}
                        className={`border-l-[3px] px-3 py-2 ${alert.severity === 'crit' ? 'border-l-crit' : 'border-l-warn'}`}
                      >
                        <p className="text-sm font-medium text-txt">{alert.title}</p>
                        <p className="text-xs text-txt-2">{alert.description}</p>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}

            <Card title="Where they are, in words" subtitle="owner-set, not tracked">
              <div className="divide-y divide-line-soft">
                {data.areaGroups.map((g) => (
                  <div key={g.vehicleType} className="px-4 py-2.5">
                    <p className="text-sm font-medium text-txt">
                      {VEHICLE_TYPE_LABELS[g.vehicleType as VehicleType] ?? g.vehicleType}
                    </p>
                    <p className="mt-0.5 text-xs text-txt-2">
                      {g.areas.length === 0 && g.unset === 0
                        ? 'None'
                        : [
                            ...g.areas.map((a) => `${a.count} ${a.area}`),
                            g.unset > 0 ? `${g.unset} area not set` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          </>
        }
      />

      <Card
        title="All vehicles"
        subtitle={`${data.vehicles.length} rows · sorted by what needs attention`}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left text-xs text-txt-3">
                <th className="px-4 py-2 font-medium">Registration</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Driver</th>
                <th className="px-4 py-2 font-medium">Area</th>
                <th className="px-4 py-2 text-right font-medium">Target</th>
                <th className="px-4 py-2 text-right font-medium">Paid</th>
                <th className="px-4 py-2 text-right font-medium">Net</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.vehicles.map((v) => (
                <tr
                  key={v.motorcycleId}
                  className={`border-b border-line-soft last:border-0 ${v.needsAttention ? 'bg-crit-d/40' : ''}`}
                >
                  <td className="px-4 py-2 font-medium text-txt">
                    <Link to={`/fleet/${v.motorcycleId}`} className="hover:underline">
                      {v.registrationNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-txt-2">
                    {VEHICLE_TYPE_LABELS[v.vehicleType as VehicleType] ?? v.vehicleType}
                  </td>
                  <td className="px-4 py-2 text-txt-2">{v.currentDriver ?? '—'}</td>
                  <td className="px-4 py-2 text-txt-2">{v.operatingArea ?? '—'}</td>
                  <td className="px-4 py-2 text-right text-txt-2">
                    {formatTZS(v.targetThisMonth)}
                  </td>
                  <td className="px-4 py-2 text-right text-txt-2">{formatTZS(v.paidThisMonth)}</td>
                  <td
                    className={`px-4 py-2 text-right font-medium ${parseFloat(v.netThisMonth) >= 0 ? 'text-good' : 'text-crit'}`}
                  >
                    {formatTZS(v.netThisMonth)}
                  </td>
                  <td className="px-4 py-2 text-txt-2">{v.status}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button
                      onClick={() => void openEdit(v.motorcycleId)}
                      className="mr-3 text-sm font-medium text-c1 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() =>
                        setDeactivating({
                          id: v.motorcycleId,
                          registrationNumber: v.registrationNumber,
                        })
                      }
                      className="text-sm font-medium text-crit hover:underline"
                    >
                      Deactivate
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <ClosingRow
        left={
          <Card
            title="Idle vehicles"
            subtitle={`${data.idleVehicles.length} · each one is a decision`}
          >
            {data.idleVehicles.length === 0 ? (
              <p className="p-4 text-sm text-txt-2">Every active vehicle has a driver today.</p>
            ) : (
              <div className="divide-y divide-line-soft px-4">
                {data.idleVehicles.slice(0, 6).map((v) => (
                  <div key={v.motorcycleId} className="py-2.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-txt">{v.registrationNumber}</span>
                      <span className="text-txt-2">
                        {v.vehicleType.toLowerCase()} · {v.daysUnassigned}d
                      </span>
                      <span className="font-medium text-crit">
                        {v.lostSoFar ? formatTZS(v.lostSoFar) : '—'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-txt-2">{v.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        }
        right={
          <Card title="Net per vehicle by type" subtitle="this month, TZS">
            {data.netPerVehicleByType.length === 0 ? (
              <p className="p-4 text-sm text-txt-2">
                No revenue or expenses recorded yet this month.
              </p>
            ) : (
              <div className="divide-y divide-line-soft px-4">
                {data.netPerVehicleByType.map((row) => (
                  <div
                    key={row.vehicleType}
                    className="flex items-center justify-between py-2.5 text-sm"
                  >
                    <span className="text-txt">
                      {VEHICLE_TYPE_LABELS[row.vehicleType as VehicleType] ?? row.vehicleType}
                    </span>
                    <span className="text-txt-2">
                      {row.count} vehicle{row.count === 1 ? '' : 's'}
                    </span>
                    <span
                      className={`font-medium ${parseFloat(row.amount) >= 0 ? 'text-good' : 'text-crit'}`}
                    >
                      {formatTZS(row.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        }
      />

      {deactivatedVehicles.length > 0 && (
        <Card
          title="Deactivated vehicles"
          subtitle={`${deactivatedVehicles.length} hidden from the fleet`}
        >
          <div className="divide-y divide-line-soft px-4">
            {deactivatedVehicles.map((v) => (
              <div key={v.id} className="flex items-center justify-between py-2.5 text-sm">
                <span className="text-txt-2">
                  {v.registrationNumber} · {VEHICLE_TYPE_LABELS[v.vehicleType]}
                </span>
                <button
                  onClick={() =>
                    setReactivating({ id: v.id, registrationNumber: v.registrationNumber })
                  }
                  className="text-sm font-medium text-c1 hover:underline"
                >
                  Reactivate
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {formTarget && (
        <MotorcycleFormModal
          motorcycle={formTarget === 'new' ? null : formTarget}
          onClose={() => setFormTarget(null)}
          onSaved={handleSaved}
        />
      )}

      {editing && (
        <MotorcycleFormModal
          motorcycle={editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}

      {deactivating && (
        <ConfirmDialog
          title="Deactivate vehicle"
          message={`Deactivate ${deactivating.registrationNumber}? It will be hidden from the fleet, but its history is kept.`}
          confirmLabel="Deactivate"
          danger
          onConfirm={handleDeactivate}
          onCancel={() => setDeactivating(null)}
        />
      )}

      {reactivating && (
        <ConfirmDialog
          title="Reactivate vehicle"
          message={`Reactivate ${reactivating.registrationNumber}?`}
          confirmLabel="Reactivate"
          onConfirm={handleReactivate}
          onCancel={() => setReactivating(null)}
        />
      )}
    </PageChassis>
  );
}
