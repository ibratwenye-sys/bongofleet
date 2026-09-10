import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Marker } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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
import { markerStatus, vehicleDivIcon, STATUS_COLOR, statusLabel } from '../lib/gps-status';
import { VEHICLE_TYPE_LABEL_KEY, vehicleTypeLabel } from '../lib/vehicle-type';

const DEFAULT_CENTER: [number, number] = [-6.8, 39.28];
const REFRESH_MS = 30_000;

const STATUS_OPTIONS: MotorcycleStatus[] = ['ACTIVE', 'MAINTENANCE', 'RETIRED'];
const VEHICLE_TYPE_OPTIONS: VehicleType[] = ['MOTORBIKE', 'BAJAJI', 'CAR', 'TRUCK'];

// Stage L7 - the first page needing a label map for this enum (unlike
// VehicleType above), so no centralization question yet - same as L5's
// STATUS_LABEL_KEY for TransportJobStatus.
const MOTORCYCLE_STATUS_LABEL_KEY: Record<MotorcycleStatus, string> = {
  ACTIVE: 'motorcycleStatusActive',
  MAINTENANCE: 'motorcycleStatusMaintenance',
  RETIRED: 'motorcycleStatusRetired',
};

// Stage L7 - FleetVehicleRow/IdleVehicleRow type status as plain `string`
// (not the narrower enum), so this guards against a value the label map
// above doesn't recognize by falling back to the raw string, matching the
// `?? t.status` fallback the pre-L7 code already used (vehicleTypeLabel's
// own equivalent guard now lives in lib/vehicle-type.ts).
function motorcycleStatusLabel(status: string, t: TFunction<'fleet'>): string {
  return status in MOTORCYCLE_STATUS_LABEL_KEY
    ? t(MOTORCYCLE_STATUS_LABEL_KEY[status as MotorcycleStatus])
    : status;
}

function kpisToTiles(data: FleetSummaryResponse, t: TFunction<'fleet'>): KpiTile[] {
  const k = data.kpis;
  return [
    {
      // Stage L7 - k.totalVehicles.byType is backend-computed
      // (fleet-summary.service.ts builds it server-side, e.g. "3 motorbike
      // · 2 car") and stays untouched, same boundary as ApiError.message.
      label: t('kpiTotalVehicles'),
      value: String(k.totalVehicles.count),
      delta: k.totalVehicles.byType,
      accentColor: 'c1',
    },
    {
      label: t('kpiOnTheRoad'),
      value: String(k.onRoadToday.count),
      delta: t('kpiOnTheRoadDelta', { percent: k.onRoadToday.percentOfFleet }),
      accentColor: 'good',
    },
    {
      label: t('kpiIdleNoDriver'),
      value: String(k.idleToday.count),
      delta: t('kpiIdleNoDriverDelta', { amount: formatTZS(k.idleToday.targetLost) }),
      accentColor: k.idleToday.count > 0 ? 'warn' : 'good',
    },
    {
      label: t('kpiInWorkshop'),
      value: String(k.inWorkshop.count),
      accentColor: k.inWorkshop.count > 0 ? 'warn' : 'good',
    },
    { label: t('kpiCollectedToday'), value: formatTZS(k.collectedToday.amount), accentColor: 'c1' },
    {
      label: t('kpiNetPerVehicle'),
      value: formatTZS(k.netPerVehicleThisMonth.amount),
      delta: t('kpiNetPerVehicleDelta'),
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
  const { t } = useTranslation('fleet');
  const { t: tCommon } = useTranslation('common');
  const isEdit = motorcycle != null;
  const [form, setForm] = useState<FormState>(() => toFormState(motorcycle));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.registrationNumber.trim()) {
      setError(t('errorRegistrationRequired'));
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
        onSaved(t('vehicleUpdated'));
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
        onSaved(t('vehicleAdded'));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('genericError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={isEdit ? t('editVehicleTitle') : t('addVehicle')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-txt">
            {t('fieldRegistrationNumber')}
          </label>
          <input
            value={form.registrationNumber}
            onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })}
            className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-txt">{t('fieldVehicleType')}</label>
          <select
            value={form.vehicleType}
            onChange={(e) => setForm({ ...form, vehicleType: e.target.value as VehicleType })}
            className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
          >
            {VEHICLE_TYPE_OPTIONS.map((vt) => (
              <option key={vt} value={vt}>
                {tCommon(VEHICLE_TYPE_LABEL_KEY[vt])}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">{t('fieldMake')}</label>
            <input
              value={form.make}
              onChange={(e) => setForm({ ...form, make: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">{t('fieldModel')}</label>
            <input
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">{t('fieldYear')}</label>
            <input
              type="number"
              value={form.year}
              onChange={(e) => setForm({ ...form, year: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">
              {t('fieldGpsDeviceId')}
            </label>
            <input
              value={form.gpsDeviceId}
              onChange={(e) => setForm({ ...form, gpsDeviceId: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-txt">
            {t('fieldOperatingArea')}{' '}
            <span className="text-txt-2">{t('operatingAreaOptional')}</span>
          </label>
          <input
            value={form.operatingArea}
            onChange={(e) => setForm({ ...form, operatingArea: e.target.value })}
            placeholder={t('operatingAreaPlaceholder')}
            className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-gray-500">{t('operatingAreaHelp')}</p>
        </div>
        {isEdit && (
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">{t('fieldStatus')}</label>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as MotorcycleStatus })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {t(MOTORCYCLE_STATUS_LABEL_KEY[s])}
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

function TypeStack({ breakdown }: { breakdown: FleetSummaryResponse['typeBreakdown'] }) {
  const { t } = useTranslation('common');
  const colors: Record<string, string> = {
    MOTORBIKE: 'var(--c1)',
    BAJAJI: 'var(--c2)',
    CAR: 'var(--c4)',
    TRUCK: 'var(--c3)',
  };
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-panel-2">
        {breakdown.map((row) => (
          <div
            key={row.vehicleType}
            style={{ width: `${row.share}%`, backgroundColor: colors[row.vehicleType] }}
          />
        ))}
      </div>
      <div className="mt-3 space-y-1.5 text-sm">
        {breakdown.map((row) => (
          <div key={row.vehicleType} className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-txt-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: colors[row.vehicleType] }}
              />
              {vehicleTypeLabel(row.vehicleType, t)}
            </span>
            <span className="text-txt">
              {row.count} <span className="text-txt-3">{row.share}%</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FleetPage() {
  const { t } = useTranslation('fleet');
  const { t: tCommon } = useTranslation('common');
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
      setError(err instanceof ApiError ? err.message : t('loadError'));
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
      setError(err instanceof ApiError ? err.message : t('loadVehicleError'));
    }
  }

  async function handleDeactivate() {
    if (!deactivating) return;
    try {
      await apiFetch(`/motorcycles/${deactivating.id}`, { method: 'DELETE' });
      setSuccessMessage(t('vehicleDeactivated'));
      setDeactivating(null);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('deactivateError'));
      setDeactivating(null);
    }
  }

  async function handleReactivate() {
    if (!reactivating) return;
    try {
      await apiFetch(`/motorcycles/${reactivating.id}/reactivate`, { method: 'PATCH' });
      setSuccessMessage(t('vehicleReactivated'));
      setReactivating(null);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('reactivateError'));
      setReactivating(null);
    }
  }

  if (error && !data) {
    return <p className="text-sm text-crit">{error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-txt-2">{t('loading')}</p>;
  }

  const live = (positions ?? []).filter((p) => !p.offline);

  return (
    <PageChassis
      title={t('title')}
      statusPill={{ mode: 'live', text: t('statusLive', { count: live.length }) }}
      primaryAction={{ label: t('addVehicle'), onClick: () => setFormTarget('new') }}
      kpis={kpisToTiles(data, t)}
    >
      {successMessage && (
        <p className="rounded bg-good-d px-3 py-2 text-sm text-good-x">{successMessage}</p>
      )}
      {error && <p className="rounded bg-crit-d px-3 py-2 text-sm text-crit-x">{error}</p>}

      <ChassisGrid
        main={
          <>
            <Card
              title={t('liveFleetTitle')}
              subtitle={t('reportingCount', { count: live.length })}
            >
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
                    {statusLabel(status)}
                  </span>
                ))}
              </div>
            </Card>

            <Card
              title={t('fleetByTypeTitle')}
              subtitle={t('fleetByTypeSubtitle', { count: data.kpis.totalVehicles.count })}
            >
              <TypeStack breakdown={data.typeBreakdown} />
            </Card>
          </>
        }
        rail={
          <>
            {data.worstPerformerThisMonth ? (
              <Card title={t('needsAttentionTitle')} subtitle={t('needsAttentionSubtitle')}>
                <div className="p-4">
                  <p className="text-sm font-medium text-txt">
                    {data.worstPerformerThisMonth.registrationNumber}
                  </p>
                  <p className="mt-1 text-xs text-txt-2">
                    {t('needsAttentionRevenueExpenses', {
                      revenue: formatTZS(data.worstPerformerThisMonth.revenue),
                      expenses: formatTZS(data.worstPerformerThisMonth.expenses),
                    })}
                  </p>
                  <p className="mt-2 text-lg font-semibold text-crit">
                    {formatTZS(data.worstPerformerThisMonth.netProfit)}
                  </p>
                </div>
              </Card>
            ) : (
              <Card
                title={t('alertsTitle')}
                subtitle={data.alerts.length > 0 ? t('alertsSubtitle') : undefined}
              >
                {data.alerts.length === 0 ? (
                  <p className="p-4 text-sm text-txt-2">{t('alertsEmpty')}</p>
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

            <Card title={t('whereAreTheyTitle')} subtitle={t('whereAreTheySubtitle')}>
              <div className="divide-y divide-line-soft">
                {data.areaGroups.map((g) => (
                  <div key={g.vehicleType} className="px-4 py-2.5">
                    <p className="text-sm font-medium text-txt">
                      {vehicleTypeLabel(g.vehicleType, tCommon)}
                    </p>
                    <p className="mt-0.5 text-xs text-txt-2">
                      {g.areas.length === 0 && g.unset === 0
                        ? t('none')
                        : [
                            ...g.areas.map((a) => `${a.count} ${a.area}`),
                            g.unset > 0 ? t('areaNotSet', { count: g.unset }) : null,
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
        title={t('allVehiclesTitle')}
        subtitle={t('allVehiclesSubtitle', { count: data.vehicles.length })}
      >
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left text-xs text-txt-3">
                <th className="px-4 py-2 font-medium">{t('tableRegistration')}</th>
                <th className="px-4 py-2 font-medium">{t('tableType')}</th>
                <th className="px-4 py-2 font-medium">{t('tableDriver')}</th>
                <th className="px-4 py-2 font-medium">{t('tableArea')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('tableTarget')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('tablePaid')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('tableNet')}</th>
                <th className="px-4 py-2 font-medium">{t('tableStatus')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('tableActions')}</th>
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
                    {vehicleTypeLabel(v.vehicleType, tCommon)}
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
                  <td className="px-4 py-2 text-txt-2">{motorcycleStatusLabel(v.status, t)}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button
                      onClick={() => void openEdit(v.motorcycleId)}
                      className="mr-3 text-sm font-medium text-c1 hover:underline"
                    >
                      {t('edit')}
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
                      {t('deactivate')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="md:hidden">
          {data.vehicles.map((v) => (
            <div
              key={v.motorcycleId}
              className={`border-b border-line-soft px-4 py-3 last:border-0 ${
                v.needsAttention ? 'border-l-[3px] border-l-crit' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <Link
                  to={`/fleet/${v.motorcycleId}`}
                  className="text-sm font-medium text-txt hover:underline"
                >
                  {v.registrationNumber}
                </Link>
                <span className="text-sm text-txt-2">{motorcycleStatusLabel(v.status, t)}</span>
              </div>
              <p className="mt-1 text-xs text-txt-2">
                {vehicleTypeLabel(v.vehicleType, tCommon)} · {v.currentDriver ?? '—'} ·{' '}
                {v.operatingArea ?? '—'}
              </p>
              <div className="mt-1 flex items-center justify-between text-sm">
                <span className="text-txt-2">
                  {t('mobileTargetPaid', {
                    target: formatTZS(v.targetThisMonth),
                    paid: formatTZS(v.paidThisMonth),
                  })}
                </span>
                <span
                  className={`font-medium ${parseFloat(v.netThisMonth) >= 0 ? 'text-good' : 'text-crit'}`}
                >
                  {formatTZS(v.netThisMonth)}
                </span>
              </div>
              <div className="mt-2 flex min-h-11 items-center justify-end gap-4">
                <button
                  onClick={() => void openEdit(v.motorcycleId)}
                  className="text-sm font-medium text-c1 hover:underline"
                >
                  {t('edit')}
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
                  {t('deactivate')}
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <ClosingRow
        left={
          <Card
            title={t('idleVehiclesTitle')}
            subtitle={t('idleVehiclesSubtitle', { count: data.idleVehicles.length })}
          >
            {data.idleVehicles.length === 0 ? (
              <p className="p-4 text-sm text-txt-2">{t('allActiveHaveDriver')}</p>
            ) : (
              <div className="divide-y divide-line-soft px-4">
                {data.idleVehicles.slice(0, 6).map((v) => (
                  <div key={v.motorcycleId} className="py-2.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-txt">{v.registrationNumber}</span>
                      <span className="text-txt-2">
                        {vehicleTypeLabel(v.vehicleType, tCommon)} · {v.daysUnassigned}d
                      </span>
                      <span className="font-medium text-crit">
                        {v.lostSoFar ? formatTZS(v.lostSoFar) : '—'}
                      </span>
                    </div>
                    {/* Stage L7 - v.reason ("No driver since {date}" / "Never
                        assigned a driver") is backend-generated in
                        idle-vehicles.util.ts and stays untouched, same
                        boundary as ApiError.message. */}
                    <p className="mt-0.5 text-xs text-txt-2">{v.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        }
        right={
          <Card title={t('netPerVehicleTitle')} subtitle={t('netPerVehicleSubtitle')}>
            {data.netPerVehicleByType.length === 0 ? (
              <p className="p-4 text-sm text-txt-2">{t('noRevenueExpenses')}</p>
            ) : (
              <div className="divide-y divide-line-soft px-4">
                {data.netPerVehicleByType.map((row) => (
                  <div
                    key={row.vehicleType}
                    className="flex items-center justify-between py-2.5 text-sm"
                  >
                    <span className="text-txt">{vehicleTypeLabel(row.vehicleType, tCommon)}</span>
                    <span className="text-txt-2">{t('vehicleCount', { count: row.count })}</span>
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
          title={t('deactivatedVehiclesTitle')}
          subtitle={t('deactivatedVehiclesSubtitle', { count: deactivatedVehicles.length })}
        >
          <div className="divide-y divide-line-soft px-4">
            {deactivatedVehicles.map((v) => (
              <div key={v.id} className="flex items-center justify-between py-2.5 text-sm">
                <span className="text-txt-2">
                  {v.registrationNumber} · {vehicleTypeLabel(v.vehicleType, tCommon)}
                </span>
                <button
                  onClick={() =>
                    setReactivating({ id: v.id, registrationNumber: v.registrationNumber })
                  }
                  className="text-sm font-medium text-c1 hover:underline"
                >
                  {t('reactivate')}
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
          title={t('deactivateVehicleTitle')}
          message={t('deactivateVehicleMessage', {
            registration: deactivating.registrationNumber,
          })}
          confirmLabel={t('deactivate')}
          danger
          onConfirm={handleDeactivate}
          onCancel={() => setDeactivating(null)}
        />
      )}

      {reactivating && (
        <ConfirmDialog
          title={t('reactivateVehicleTitle')}
          message={t('reactivateVehicleMessage', {
            registration: reactivating.registrationNumber,
          })}
          confirmLabel={t('reactivate')}
          onConfirm={handleReactivate}
          onCancel={() => setReactivating(null)}
        />
      )}
    </PageChassis>
  );
}
