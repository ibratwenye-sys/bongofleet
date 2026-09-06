import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { apiFetch, ApiError } from '../lib/api';
import { formatTZS, startOfThisMonth, today } from '../lib/format';
import type {
  CreateMaintenancePayload,
  MaintenanceLog,
  MaintenanceSummaryResponse,
  Motorcycle,
  UpdateMaintenancePayload,
  VehicleType,
} from '../lib/types';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PageChassis } from '../components/chassis/PageChassis';
import { ChassisGrid, ClosingRow } from '../components/chassis/ChassisGrid';
import { Card } from '../components/chassis/Card';
import type { KpiTile } from '../components/chassis/KpiRail';

// Stage L8 - deliberate near-duplicate of FleetPage.tsx's own
// VEHICLE_TYPE_LABEL_KEY/vehicleTypeLabel (L7), which are private to that
// file (not exported). Both now point at the same centralized common.json
// keys, so there is exactly one English/Swahili string per vehicle type -
// only the small Record + helper wrapper is duplicated, not a whole
// namespace. Worth exporting from a shared module next time a third page
// needs this exact wrapper.
const VEHICLE_TYPE_LABEL_KEY: Record<VehicleType, string> = {
  MOTORBIKE: 'vehicleTypeMotorbike',
  BAJAJI: 'vehicleTypeBajaji',
  CAR: 'vehicleTypeCar',
  TRUCK: 'vehicleTypeTruck',
};

function vehicleTypeLabel(vehicleType: string, tCommon: TFunction<'common'>): string {
  return vehicleType in VEHICLE_TYPE_LABEL_KEY
    ? tCommon(VEHICLE_TYPE_LABEL_KEY[vehicleType as VehicleType])
    : vehicleType;
}

// Stage L8 - bug fix: pipelineLabels used to hardcode the same four
// strings as the KPI tiles below as a second literal map. Now points at
// the identical KPI translation keys, so there's one English string and
// one Swahili string per concept, not two that could drift apart.
const PIPELINE_LABEL_KEY: Record<string, string> = {
  OVERDUE: 'kpiOverdue',
  DUE_7: 'kpiDueWithin7Days',
  DUE_30: 'kpiDueWithin30Days',
  NOTHING_DUE: 'kpiNothingDue',
};

function kpisToTiles(data: MaintenanceSummaryResponse, t: TFunction<'maintenance'>): KpiTile[] {
  const k = data.kpis;
  return [
    {
      label: t('kpiOverdue'),
      value: String(k.overdue.count),
      accentColor: k.overdue.count > 0 ? 'crit' : 'good',
    },
    {
      label: t('kpiDueWithin7Days'),
      value: String(k.dueWithin7Days.count),
      accentColor: k.dueWithin7Days.count > 0 ? 'warn' : 'good',
    },
    {
      label: t('kpiDueWithin30Days'),
      value: String(k.dueWithin30Days.count),
      accentColor: 'c1',
    },
    {
      label: t('kpiNothingDue'),
      value: String(k.nothingDue.count),
      delta: t('kpiNothingDueDelta', { percent: k.nothingDue.percentOfFleet }),
      accentColor: 'good',
    },
    {
      label: t('kpiCompletedThisMonth'),
      value: String(k.completedThisMonth.count),
      delta: formatTZS(k.completedThisMonth.cost),
      accentColor: 'violet',
    },
    {
      label: t('kpiRepeatVisits'),
      value: String(k.repeatVisits.count),
      accentColor: k.repeatVisits.count > 0 ? 'crit' : 'good',
    },
  ];
}

function NeedsBookingTable({ rows }: { rows: MaintenanceSummaryResponse['needsBooking'] }) {
  const { t } = useTranslation('maintenance');
  if (rows.length === 0) {
    return <p className="p-4 text-sm text-txt-2">{t('needsBookingEmpty')}</p>;
  }
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line-soft text-left text-xs text-txt-3">
              <th className="px-4 py-2 font-medium">{t('tableVehicle')}</th>
              <th className="px-4 py-2 font-medium">{t('tableDriver')}</th>
              <th className="px-4 py-2 font-medium">{t('tableWhy')}</th>
              <th className="px-4 py-2 text-right font-medium">{t('tableOdometer')}</th>
              <th className="px-4 py-2 font-medium">{t('tableStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.motorcycleId}
                className={`border-b border-line-soft last:border-0 ${r.status === 'OVERDUE' ? 'bg-crit-d/40' : ''}`}
              >
                <td className="px-4 py-2 font-medium text-txt">{r.registrationNumber}</td>
                <td className="px-4 py-2 text-txt-2">{r.currentDriver ?? '—'}</td>
                <td className="px-4 py-2 text-txt-2">{r.reasons.join('; ')}</td>
                <td className="px-4 py-2 text-right text-txt-2">
                  {r.odometer.toLocaleString()} km
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${r.status === 'OVERDUE' ? 'bg-crit-d text-crit-x' : 'bg-warn-d text-warn-x'}`}
                  >
                    {r.status === 'OVERDUE' ? t('kpiOverdue') : t('statusDueSoon')}
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
            className={`border-b border-line-soft px-4 py-3 last:border-0 ${
              r.status === 'OVERDUE' ? 'border-l-[3px] border-l-crit' : ''
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-txt">{r.registrationNumber}</span>
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${r.status === 'OVERDUE' ? 'bg-crit-d text-crit-x' : 'bg-warn-d text-warn-x'}`}
              >
                {r.status === 'OVERDUE' ? t('kpiOverdue') : t('statusDueSoon')}
              </span>
            </div>
            <p className="mt-1 text-xs text-txt-2">
              {r.currentDriver ?? '—'} · {r.odometer.toLocaleString()} km
            </p>
            <p className="mt-1 text-xs text-txt-2">{r.reasons.join('; ')}</p>
          </div>
        ))}
      </div>
    </>
  );
}

// ---- Log / edit service modal (unchanged CRUD) ----

interface FormState {
  motorcycleId: string;
  description: string;
  cost: string;
  performedAt: string;
  mileageAtService: string;
  nextServiceDate: string;
  nextServiceMileage: string;
}

function toFormState(log: MaintenanceLog | null, defaultMotorcycleId: string): FormState {
  return {
    motorcycleId: log?.motorcycleId ?? defaultMotorcycleId,
    description: log?.description ?? '',
    cost: log?.cost != null ? String(parseFloat(log.cost)) : '',
    performedAt: log?.performedAt ? log.performedAt.slice(0, 10) : today(),
    mileageAtService: log?.mileageAtService != null ? String(log.mileageAtService) : '',
    nextServiceDate: log?.nextServiceDate ? log.nextServiceDate.slice(0, 10) : '',
    nextServiceMileage: log?.nextServiceMileage != null ? String(log.nextServiceMileage) : '',
  };
}

function MaintenanceFormModal({
  log,
  motorcycles,
  defaultMotorcycleId,
  onClose,
  onSaved,
}: {
  log: MaintenanceLog | null;
  motorcycles: Motorcycle[];
  defaultMotorcycleId: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t } = useTranslation('maintenance');
  const { t: tCommon } = useTranslation('common');
  const isEdit = log != null;
  const [form, setForm] = useState<FormState>(() => toFormState(log, defaultMotorcycleId));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isEdit && !form.motorcycleId) {
      setError(t('errorChooseVehicle'));
      return;
    }
    if (!form.description.trim()) {
      setError(t('errorDescriptionRequired'));
      return;
    }
    const cost = Number(form.cost);
    if (!form.cost || Number.isNaN(cost) || cost <= 0) {
      setError(t('errorCostPositive'));
      return;
    }
    if (!form.performedAt) {
      setError(t('errorServiceDateRequired'));
      return;
    }

    const optionalNumbers = {
      mileageAtService: form.mileageAtService ? Number(form.mileageAtService) : undefined,
      nextServiceMileage: form.nextServiceMileage ? Number(form.nextServiceMileage) : undefined,
    };

    setSubmitting(true);
    try {
      if (isEdit) {
        const payload: UpdateMaintenancePayload = {
          description: form.description.trim(),
          cost,
          performedAt: form.performedAt,
          mileageAtService: optionalNumbers.mileageAtService,
          nextServiceDate: form.nextServiceDate || undefined,
          nextServiceMileage: optionalNumbers.nextServiceMileage,
        };
        await apiFetch(`/maintenance/${log.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        onSaved(t('serviceUpdated'));
      } else {
        const payload: CreateMaintenancePayload = {
          motorcycleId: form.motorcycleId,
          description: form.description.trim(),
          cost,
          performedAt: form.performedAt,
          mileageAtService: optionalNumbers.mileageAtService,
          nextServiceDate: form.nextServiceDate || undefined,
          nextServiceMileage: optionalNumbers.nextServiceMileage,
        };
        await apiFetch('/maintenance', { method: 'POST', body: JSON.stringify(payload) });
        onSaved(t('serviceLogged'));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('genericError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={isEdit ? t('editServiceTitle') : t('logService')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {!isEdit && (
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">{t('tableVehicle')}</label>
            <select
              value={form.motorcycleId}
              onChange={(e) => setForm({ ...form, motorcycleId: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            >
              <option value="">{t('chooseVehiclePlaceholder')}</option>
              {motorcycles.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.registrationNumber}{' '}
                  {t('vehicleMileageSuffix', { mileage: m.currentMileage.toLocaleString() })}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="mb-1 block text-sm font-medium text-txt">{t('fieldDescription')}</label>
          <input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            placeholder={t('descriptionPlaceholder')}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">{t('fieldCost')}</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.cost}
              onChange={(e) => setForm({ ...form, cost: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">
              {t('fieldServiceDate')}
            </label>
            <input
              type="date"
              value={form.performedAt}
              onChange={(e) => setForm({ ...form, performedAt: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-txt">
            {t('fieldOdometerAtService')} <span className="text-txt-2">{t('optional')}</span>
          </label>
          <input
            type="number"
            min="0"
            value={form.mileageAtService}
            onChange={(e) => setForm({ ...form, mileageAtService: e.target.value })}
            className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            placeholder={t('odometerPlaceholder')}
          />
        </div>
        <div className="rounded border border-line bg-panel-2 p-3">
          <p className="mb-2 text-xs font-medium text-txt-2">{t('nextServiceReminderNote')}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-txt">
                {t('fieldNextDueDate')}
              </label>
              <input
                type="date"
                value={form.nextServiceDate}
                onChange={(e) => setForm({ ...form, nextServiceDate: e.target.value })}
                className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-txt">
                {t('fieldNextDueMileage')}
              </label>
              <input
                type="number"
                min="0"
                value={form.nextServiceMileage}
                onChange={(e) => setForm({ ...form, nextServiceMileage: e.target.value })}
                className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
              />
            </div>
          </div>
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

export function MaintenancePage() {
  const { t } = useTranslation('maintenance');
  const { t: tCommon } = useTranslation('common');
  const [data, setData] = useState<MaintenanceSummaryResponse | null>(null);
  const [motorcycles, setMotorcycles] = useState<Motorcycle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [formTarget, setFormTarget] = useState<'new' | MaintenanceLog | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; description: string } | null>(null);

  // Manage-records fallback: "Completed this month" (full-width table)
  // only covers this month. Older records still need an Edit/Delete path.
  const [manageFrom, setManageFrom] = useState<string>(startOfThisMonth());
  const [manageTo, setManageTo] = useState<string>(today());
  const [manageVehicle, setManageVehicle] = useState<string>('ALL');
  const [manageLogs, setManageLogs] = useState<MaintenanceLog[] | null>(null);

  async function load() {
    try {
      const [summary, motorcycleList] = await Promise.all([
        apiFetch<MaintenanceSummaryResponse>('/maintenance/summary'),
        apiFetch<Motorcycle[]>('/motorcycles'),
      ]);
      setData(summary);
      setMotorcycles(motorcycleList);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('loadError'));
    }
  }

  async function loadManageLogs() {
    const params = new URLSearchParams({ from: manageFrom, to: manageTo });
    if (manageVehicle !== 'ALL') params.set('motorcycleId', manageVehicle);
    try {
      setManageLogs(await apiFetch<MaintenanceLog[]>(`/maintenance?${params.toString()}`));
    } catch {
      setManageLogs([]);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    void loadManageLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manageFrom, manageTo, manageVehicle]);

  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  const regById = useMemo(
    () => new Map(motorcycles.map((m) => [m.id, m.registrationNumber])),
    [motorcycles],
  );

  function handleSaved(message: string) {
    setFormTarget(null);
    setSuccessMessage(message);
    void load();
    void loadManageLogs();
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await apiFetch(`/maintenance/${deleting.id}`, { method: 'DELETE' });
      setSuccessMessage(t('serviceDeleted'));
      setDeleting(null);
      void load();
      void loadManageLogs();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('deleteError'));
      setDeleting(null);
    }
  }

  if (error && !data) {
    return <p className="text-sm text-crit">{error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-txt-2">{t('loading')}</p>;
  }

  const somethingDueCount =
    data.kpis.overdue.count + data.kpis.dueWithin7Days.count + data.kpis.dueWithin30Days.count;
  const pipelineColors: Record<string, string> = {
    OVERDUE: 'var(--crit)',
    DUE_7: 'var(--warn)',
    DUE_30: 'var(--c1)',
    NOTHING_DUE: 'var(--good)',
  };

  return (
    <PageChassis
      title={t('title')}
      statusPill={{ mode: 'reporting', text: t('statusPill', { count: somethingDueCount }) }}
      primaryAction={{ label: t('logService'), onClick: () => setFormTarget('new') }}
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
              title={t('needsBookingTitle')}
              subtitle={t('needsBookingSubtitle', { count: data.needsBooking.length })}
            >
              <NeedsBookingTable rows={data.needsBooking} />
            </Card>
            <Card title={t('servicePipelineTitle')} subtitle={t('servicePipelineSubtitle')}>
              <div className="px-4 pb-4">
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-panel-2">
                  {data.servicePipeline.map((b) => (
                    <div
                      key={b.bucket}
                      style={{ width: `${b.share}%`, backgroundColor: pipelineColors[b.bucket] }}
                    />
                  ))}
                </div>
                <div className="mt-3 space-y-1.5 text-sm text-txt-2">
                  {data.servicePipeline.map((b) => (
                    <div key={b.bucket} className="flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: pipelineColors[b.bucket] }}
                        />
                        {t(PIPELINE_LABEL_KEY[b.bucket])}
                      </span>
                      <span className="text-txt">
                        {b.count} <span className="text-txt-3">{b.share}%</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </>
        }
        rail={
          <>
            <Card
              title={t('aiInsightsTitle')}
              subtitle={data.insights.length > 0 ? String(data.insights.length) : undefined}
            >
              {data.insights.length === 0 ? (
                <p className="p-4 text-sm text-txt-2">{t('nothingToFlag')}</p>
              ) : (
                <div className="divide-y divide-line-soft">
                  {data.insights.map((ins, i) => (
                    <div key={i} className="px-4 py-3">
                      <p className="text-sm font-medium text-txt">{ins.title}</p>
                      <p className="mt-1 text-xs text-txt-2">{ins.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card
              title={t('atRiskTitle')}
              subtitle={t('atRiskSubtitle', { count: data.atRisk.length })}
            >
              {data.atRisk.length === 0 ? (
                <p className="p-4 text-sm text-txt-2">{t('atRiskEmpty')}</p>
              ) : (
                <div className="divide-y divide-line-soft">
                  {data.atRisk.slice(0, 6).map((r) => (
                    <div
                      key={r.motorcycleId}
                      className={`border-l-[3px] px-3 py-2 ${r.status === 'OVERDUE' ? 'border-l-crit' : 'border-l-warn'}`}
                    >
                      <p className="text-sm font-medium text-txt">{r.registrationNumber}</p>
                      <p className="text-xs text-txt-2">{r.reasons.join('; ')}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        }
      />

      <Card
        title={t('completedTitle')}
        subtitle={t('completedSubtitle', {
          count: data.completedThisMonth.length,
          cost: formatTZS(data.kpis.completedThisMonth.cost),
        })}
      >
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left text-xs text-txt-3">
                <th className="px-4 py-2 font-medium">{t('tableDate')}</th>
                <th className="px-4 py-2 font-medium">{t('tableVehicle')}</th>
                <th className="px-4 py-2 font-medium">{t('tableWork')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('tableOdometer')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('tableCost')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('tableActions')}</th>
              </tr>
            </thead>
            <tbody>
              {data.completedThisMonth.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-txt-2">
                    {t('noServicesCompleted')}
                  </td>
                </tr>
              ) : (
                data.completedThisMonth.map((c) => (
                  <tr key={c.id} className="border-b border-line-soft last:border-0">
                    <td className="px-4 py-2 text-txt-2">{c.performedAt}</td>
                    <td className="px-4 py-2 font-medium text-txt">{c.registrationNumber}</td>
                    <td className="px-4 py-2 text-txt-2">{c.description}</td>
                    <td className="px-4 py-2 text-right text-txt-2">
                      {c.mileageAtService != null
                        ? `${c.mileageAtService.toLocaleString()} km`
                        : '—'}
                    </td>
                    <td className="px-4 py-2 text-right text-txt-2">{formatTZS(c.cost)}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button
                        onClick={() =>
                          setFormTarget({
                            id: c.id,
                            motorcycleId: c.motorcycleId,
                            mechanicId: null,
                            description: c.description,
                            cost: c.cost,
                            performedAt: c.performedAt,
                            mileageAtService: c.mileageAtService,
                            nextServiceDate: c.nextServiceDate,
                            nextServiceMileage: c.nextServiceMileage,
                            createdAt: c.performedAt,
                          })
                        }
                        className="mr-3 text-sm font-medium text-c1 hover:underline"
                      >
                        {tCommon('edit')}
                      </button>
                      <button
                        onClick={() => setDeleting({ id: c.id, description: c.description })}
                        className="text-sm font-medium text-crit hover:underline"
                      >
                        {tCommon('delete')}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="md:hidden">
          {data.completedThisMonth.length === 0 ? (
            <p className="p-4 text-center text-sm text-txt-2">{t('noServicesCompleted')}</p>
          ) : (
            data.completedThisMonth.map((c) => (
              <div key={c.id} className="border-b border-line-soft px-4 py-3 last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-txt">{c.registrationNumber}</span>
                  <span className="text-xs text-txt-2">{c.performedAt}</span>
                </div>
                <p className="mt-1 text-xs text-txt-2">{c.description}</p>
                <div className="mt-1 flex items-center justify-between text-sm">
                  <span className="text-txt-2">
                    {c.mileageAtService != null ? `${c.mileageAtService.toLocaleString()} km` : '—'}
                  </span>
                  <span className="font-medium text-txt">{formatTZS(c.cost)}</span>
                </div>
                <div className="mt-2 flex min-h-11 items-center justify-end gap-4">
                  <button
                    onClick={() =>
                      setFormTarget({
                        id: c.id,
                        motorcycleId: c.motorcycleId,
                        mechanicId: null,
                        description: c.description,
                        cost: c.cost,
                        performedAt: c.performedAt,
                        mileageAtService: c.mileageAtService,
                        nextServiceDate: c.nextServiceDate,
                        nextServiceMileage: c.nextServiceMileage,
                        createdAt: c.performedAt,
                      })
                    }
                    className="text-sm font-medium text-c1 hover:underline"
                  >
                    {tCommon('edit')}
                  </button>
                  <button
                    onClick={() => setDeleting({ id: c.id, description: c.description })}
                    className="text-sm font-medium text-crit hover:underline"
                  >
                    {tCommon('delete')}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      <ClosingRow
        left={
          <Card title={t('spendTitle')} subtitle={t('spendSubtitle')}>
            {data.spendByVehicleType.length === 0 ? (
              <p className="p-4 text-sm text-txt-2">{t('noSpendRecorded')}</p>
            ) : (
              <div className="divide-y divide-line-soft px-4">
                {data.spendByVehicleType.map((row) => (
                  <div
                    key={row.vehicleType}
                    className="flex items-center justify-between py-2.5 text-sm"
                  >
                    <span className="text-txt">{vehicleTypeLabel(row.vehicleType, tCommon)}</span>
                    <span className="font-medium text-txt">{formatTZS(row.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        }
        right={
          <Card
            title={t('repeatVisitTitle')}
            subtitle={t('repeatVisitSubtitle', { count: data.repeatVisitVehicles.length })}
          >
            {data.repeatVisitVehicles.length === 0 ? (
              <p className="p-4 text-sm text-txt-2">{t('noRepeatVisits')}</p>
            ) : (
              <div className="divide-y divide-line-soft px-4">
                {data.repeatVisitVehicles.map((v) => (
                  <div
                    key={v.motorcycleId}
                    className="flex items-center justify-between py-2.5 text-sm"
                  >
                    <span className="text-txt">
                      {v.registrationNumber} · {t('visitCount', { count: v.visitCount })}
                    </span>
                    <span className="font-medium text-crit">{formatTZS(v.totalSpend)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        }
      />

      <Card title={t('manageTitle')} subtitle={t('manageSubtitle')}>
        <div className="flex flex-wrap items-end gap-3 border-b border-line-soft px-4 py-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-txt-3">{t('filterFrom')}</label>
            <input
              type="date"
              value={manageFrom}
              max={manageTo}
              onChange={(e) => setManageFrom(e.target.value)}
              className="rounded border border-line bg-panel px-3 py-1.5 text-sm text-txt"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-txt-3">{t('filterTo')}</label>
            <input
              type="date"
              value={manageTo}
              min={manageFrom}
              onChange={(e) => setManageTo(e.target.value)}
              className="rounded border border-line bg-panel px-3 py-1.5 text-sm text-txt"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-txt-3">
              {t('filterVehicle')}
            </label>
            <select
              value={manageVehicle}
              onChange={(e) => setManageVehicle(e.target.value)}
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
                <th className="px-4 py-2 font-medium">{t('tableVehicle')}</th>
                <th className="px-4 py-2 font-medium">{t('tableDescription')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('tableCost')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('tableActions')}</th>
              </tr>
            </thead>
            <tbody>
              {manageLogs === null ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-txt-2">
                    {t('loading')}
                  </td>
                </tr>
              ) : manageLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-txt-2">
                    {t('noMaintenanceInPeriod')}
                  </td>
                </tr>
              ) : (
                manageLogs.map((m) => (
                  <tr key={m.id} className="border-b border-line-soft last:border-0">
                    <td className="px-4 py-2 text-txt-2">{m.performedAt.slice(0, 10)}</td>
                    <td className="px-4 py-2 font-medium text-txt">
                      {regById.get(m.motorcycleId) ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-txt-2">{m.description}</td>
                    <td className="px-4 py-2 text-right text-txt-2">{formatTZS(m.cost)}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => setFormTarget(m)}
                        className="mr-3 text-sm font-medium text-c1 hover:underline"
                      >
                        {tCommon('edit')}
                      </button>
                      <button
                        onClick={() => setDeleting({ id: m.id, description: m.description })}
                        className="text-sm font-medium text-crit hover:underline"
                      >
                        {tCommon('delete')}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="md:hidden">
          {manageLogs === null ? (
            <p className="p-4 text-center text-sm text-txt-2">{t('loading')}</p>
          ) : manageLogs.length === 0 ? (
            <p className="p-4 text-center text-sm text-txt-2">{t('noMaintenanceInPeriod')}</p>
          ) : (
            manageLogs.map((m) => (
              <div key={m.id} className="border-b border-line-soft px-4 py-3 last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-txt">{regById.get(m.motorcycleId) ?? '—'}</span>
                  <span className="text-xs text-txt-2">{m.performedAt.slice(0, 10)}</span>
                </div>
                <p className="mt-1 text-xs text-txt-2">{m.description}</p>
                <p className="mt-1 text-sm text-txt-2">{formatTZS(m.cost)}</p>
                <div className="mt-2 flex min-h-11 items-center justify-end gap-4">
                  <button
                    onClick={() => setFormTarget(m)}
                    className="text-sm font-medium text-c1 hover:underline"
                  >
                    {tCommon('edit')}
                  </button>
                  <button
                    onClick={() => setDeleting({ id: m.id, description: m.description })}
                    className="text-sm font-medium text-crit hover:underline"
                  >
                    {tCommon('delete')}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      {formTarget !== null && (
        <MaintenanceFormModal
          log={formTarget === 'new' ? null : formTarget}
          motorcycles={motorcycles}
          defaultMotorcycleId={manageVehicle !== 'ALL' ? manageVehicle : ''}
          onClose={() => setFormTarget(null)}
          onSaved={handleSaved}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t('deleteServiceTitle')}
          message={t('deleteServiceMessage', { description: deleting.description })}
          confirmLabel={tCommon('delete')}
          danger
          onConfirm={() => void handleDelete()}
          onCancel={() => setDeleting(null)}
        />
      )}
    </PageChassis>
  );
}
