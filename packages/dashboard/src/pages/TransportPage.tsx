import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { transportPaymentStatus, type TransportPaymentStatus } from '@bongofleet/shared-lib';
import { apiFetch, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { formatTZS, formatDateTime } from '../lib/format';
import type {
  CreateTransportJobPayload,
  Motorcycle,
  TransportJob,
  TransportJobStatus,
  TransportOperationsResponse,
  UpdateTransportJobPayload,
} from '../lib/types';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { TransportReconciliationModal } from '../components/TransportReconciliationModal';
import { TRANSPORT_PAYMENT_STATUS_STYLES } from '../components/StatusBadge';
import { PageChassis } from '../components/chassis/PageChassis';
import { ChassisGrid, ClosingRow } from '../components/chassis/ChassisGrid';
import { Card } from '../components/chassis/Card';
import type { KpiTile } from '../components/chassis/KpiRail';
import { vehicleTypeLabel } from '../lib/vehicle-type';

const STATUS_OPTIONS: TransportJobStatus[] = ['SCHEDULED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'];

// Stage L5 - the only label mapping for this enum anywhere in the app,
// same pattern as L3/L4's PAYMENT_STATUS_LABEL_KEY/VEHICLE_TYPE_LABEL_KEY.
const STATUS_LABEL_KEY: Record<TransportJobStatus, string> = {
  SCHEDULED: 'transportJobStatusScheduled',
  IN_TRANSIT: 'transportJobStatusInTransit',
  DELIVERED: 'transportJobStatusDelivered',
  CANCELLED: 'transportJobStatusCancelled',
};

interface DriverOption {
  id: string;
  user: { firstName: string; lastName: string };
}

function kpisToTiles(data: TransportOperationsResponse, t: TFunction<'transport'>): KpiTile[] {
  const k = data.kpis;
  const net = parseFloat(k.netThisMonth.amount);
  return [
    {
      label: t('kpiTrucksAndCars'),
      value: String(k.fleetCount.count),
      delta: t('kpiTrucksAndCarsDelta', { trucks: k.fleetCount.trucks, cars: k.fleetCount.cars }),
      accentColor: 'c1',
    },
    {
      label: t('kpiTripsThisMonth'),
      value: String(k.tripsThisMonth.count),
      delta: t('kpiTripsThisMonthDelta', { count: k.tripsThisMonth.inTransitNow }),
      accentColor: 'c1',
    },
    {
      label: t('kpiRevenue'),
      value: formatTZS(k.revenueThisMonth.amount),
      delta: t('kpiRevenueDelta', { percent: k.revenueThisMonth.percentOfAllRevenue }),
      accentColor: 'good',
    },
    {
      label: t('kpiCosts'),
      value: formatTZS(k.costsThisMonth.amount),
      delta: t('kpiCostsDelta', { percent: k.costsThisMonth.percentFuel }),
      accentColor: 'warn',
    },
    {
      label: t('kpiNet'),
      value: formatTZS(k.netThisMonth.amount),
      delta: t('kpiNetDelta', { amount: formatTZS(k.netThisMonth.perVehicleAverage) }),
      accentColor: 'violet',
    },
    {
      label: t('kpiMargin'),
      value: `${k.marginThisMonth.percent}%`,
      delta:
        k.marginThisMonth.vsMotorbikeMarginPercent === null
          ? undefined
          : t('kpiMarginDelta', { percent: k.marginThisMonth.vsMotorbikeMarginPercent }),
      accentColor: net >= 0 ? 'good' : 'crit',
    },
  ];
}

function InTransitCard({ job }: { job: TransportOperationsResponse['inTransitJob'] }) {
  const { t } = useTranslation('transport');
  if (!job) {
    return (
      <Card title={t('inTransitTitle')}>
        <p className="p-4 text-sm text-txt-2">{t('noJobInTransit')}</p>
      </Card>
    );
  }
  const hoursElapsed = (job.progress.elapsedMs / 3_600_000).toFixed(1);
  return (
    <Card title={t('inTransitTitle')} subtitle={job.reference ?? undefined}>
      <div className="px-4 pb-4">
        <p className="text-base font-semibold text-txt">
          {job.origin} → {job.destination}
        </p>
        <p className="text-xs text-txt-2">
          {job.registrationNumber} · {job.driverName ?? t('ownerDriven')}
          {job.cargo ? ` · ${job.cargo}` : ''}
        </p>
        {job.progress.kind === 'progress' ? (
          <>
            <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-panel-2">
              <div
                className="h-full bg-c1"
                style={{
                  width: `${Math.min(100, (job.progress.kmCovered / job.progress.expectedDistanceKm) * 100)}%`,
                }}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs text-txt-2">
              <span>
                <b className="text-txt">{job.progress.kmCovered.toFixed(0)} km</b> {t('kmCovered')}
              </span>
              <span>
                <b className="text-txt">{job.progress.kmRemaining.toFixed(0)} km</b> {t('kmToGo')}
              </span>
            </div>
          </>
        ) : (
          <p className="mt-3 text-xs text-txt-2">{t('noExpectedDistance')}</p>
        )}
        <p className="mt-2 text-xs text-txt-2">
          {t('hoursSincePickup', { hours: hoursElapsed })}
          {job.progress.lastPosition
            ? t('lastPositionKnown', {
                time: formatDateTime(job.progress.lastPosition.recordedAt),
              })
            : t('lastPositionUnknown')}
        </p>
      </div>
    </Card>
  );
}

// Stage L5 - TransportPaymentStatus (UNPAID/PARTIALLY_PAID/PAID) is its own
// enum, distinct from PaymentsPage.tsx's PaymentStatus (PENDING/COMPLETED/
// FAILED) - a transport job's collection status vs. a rental payment's own
// status, different value sets entirely - so this gets its own key map in
// the `transport` namespace rather than reusing L3's `payments` one.
const PAYMENT_STATUS_LABEL_KEY: Record<TransportPaymentStatus, string> = {
  UNPAID: 'transportPaymentStatusUnpaid',
  PARTIALLY_PAID: 'transportPaymentStatusPartiallyPaid',
  PAID: 'transportPaymentStatusPaid',
};

// TRANSPORT_DESIGN.md §6 - purely additive collection-status indicator next
// to the existing revenue/expense/profit figures, which it never changes.
// Only rendered once the full TransportJob (with amountReceived) has loaded
// via jobsById - the lighter tripsThisMonth summary row doesn't carry it.
function CollectionStatusPill({ job }: { job: TransportJob }) {
  const { t } = useTranslation('transport');
  const revenue = parseFloat(job.revenue);
  const amountReceived = parseFloat(job.amountReceived);
  const status = transportPaymentStatus(revenue, amountReceived);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TRANSPORT_PAYMENT_STATUS_STYLES[status]}`}
      >
        {t(PAYMENT_STATUS_LABEL_KEY[status])}
      </span>
      {status === 'PARTIALLY_PAID' && (
        <span className="text-xs whitespace-nowrap text-txt-2">
          {t('collectedOfRevenue', {
            amount: formatTZS(amountReceived),
            revenue: formatTZS(revenue),
          })}
        </span>
      )}
    </span>
  );
}

// ---- Create / edit job modal (unchanged CRUD, now with expectedDistanceKm) ----

interface JobFormState {
  motorcycleId: string;
  ownerDriven: boolean;
  driverId: string;
  origin: string;
  destination: string;
  cargo: string;
  customerName: string;
  customerContactPhone: string;
  revenue: string;
  driverFee: string;
  scheduledDate: string;
  expectedDistanceKm: string;
}

function toJobForm(job: TransportJob | null, vehicles: Motorcycle[]): JobFormState {
  const firstTransport =
    vehicles.find((v) => v.vehicleType === 'CAR' || v.vehicleType === 'TRUCK') ?? vehicles[0];
  return {
    motorcycleId: job?.motorcycleId ?? firstTransport?.id ?? '',
    ownerDriven: job?.ownerDriven ?? false,
    driverId: job?.driverId ?? '',
    origin: job?.origin ?? '',
    destination: job?.destination ?? '',
    cargo: job?.cargo ?? '',
    customerName: job?.customerName ?? '',
    customerContactPhone: job?.customerContactPhone ?? '',
    revenue: job?.revenue ?? '',
    driverFee: job?.driverFee ?? '',
    scheduledDate: job?.scheduledDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    expectedDistanceKm: job?.expectedDistanceKm ?? '',
  };
}

function JobFormModal({
  job,
  vehicles,
  drivers,
  onClose,
  onSaved,
}: {
  job: TransportJob | null;
  vehicles: Motorcycle[];
  drivers: DriverOption[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t } = useTranslation('transport');
  const { t: tCommon } = useTranslation('common');
  const isEdit = job != null;
  const [form, setForm] = useState<JobFormState>(() => toJobForm(job, vehicles));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.motorcycleId) return setError(t('errorPickVehicle'));
    if (!form.origin.trim() || !form.destination.trim())
      return setError(t('errorOriginDestinationRequired'));
    const revenue = Number(form.revenue);
    if (!form.revenue || Number.isNaN(revenue) || revenue <= 0)
      return setError(t('errorPositiveRevenue'));
    const driverFee = form.driverFee ? Number(form.driverFee) : undefined;
    if (form.driverFee && (Number.isNaN(driverFee) || (driverFee ?? 0) <= 0)) {
      return setError(t('errorDriverFeePositive'));
    }
    const expectedDistanceKm = form.expectedDistanceKm ? Number(form.expectedDistanceKm) : null;
    if (
      form.expectedDistanceKm &&
      (Number.isNaN(expectedDistanceKm) || (expectedDistanceKm ?? 0) <= 0)
    ) {
      return setError(t('errorExpectedDistancePositive'));
    }

    setSubmitting(true);
    try {
      if (isEdit) {
        const payload: UpdateTransportJobPayload = {
          ownerDriven: form.ownerDriven,
          driverId: form.ownerDriven ? undefined : form.driverId || undefined,
          origin: form.origin.trim(),
          destination: form.destination.trim(),
          cargo: form.cargo.trim() || undefined,
          customerName: form.customerName.trim() || undefined,
          customerContactPhone: form.customerContactPhone.trim() || undefined,
          revenue,
          driverFee,
          scheduledDate: form.scheduledDate,
          expectedDistanceKm,
        };
        await apiFetch(`/transport-jobs/${job.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        onSaved(t('jobUpdated'));
      } else {
        const payload: CreateTransportJobPayload = {
          motorcycleId: form.motorcycleId,
          ownerDriven: form.ownerDriven,
          driverId: form.ownerDriven ? undefined : form.driverId || undefined,
          origin: form.origin.trim(),
          destination: form.destination.trim(),
          cargo: form.cargo.trim() || undefined,
          customerName: form.customerName.trim() || undefined,
          customerContactPhone: form.customerContactPhone.trim() || undefined,
          revenue,
          driverFee,
          scheduledDate: form.scheduledDate,
          expectedDistanceKm,
        };
        await apiFetch('/transport-jobs', { method: 'POST', body: JSON.stringify(payload) });
        onSaved(t('jobCreated'));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('genericError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={isEdit ? t('editJobTitle') : t('newJobTitle')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {!isEdit && (
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">{t('tableVehicle')}</label>
            <select
              value={form.motorcycleId}
              onChange={(e) => setForm({ ...form, motorcycleId: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            >
              <option value="">{t('selectVehiclePlaceholder')}</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.registrationNumber} ({vehicleTypeLabel(v.vehicleType, tCommon)})
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">{t('fieldOrigin')}</label>
            <input
              value={form.origin}
              onChange={(e) => setForm({ ...form, origin: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">
              {t('fieldDestination')}
            </label>
            <input
              value={form.destination}
              onChange={(e) => setForm({ ...form, destination: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-txt">{t('fieldCargo')}</label>
          <input
            value={form.cargo}
            onChange={(e) => setForm({ ...form, cargo: e.target.value })}
            placeholder={t('cargoPlaceholder')}
            className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">
              {t('fieldCustomerName')} <span className="text-txt-2">{t('optional')}</span>
            </label>
            <input
              value={form.customerName}
              onChange={(e) => setForm({ ...form, customerName: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">
              {t('fieldCustomerPhone')} <span className="text-txt-2">{t('optional')}</span>
            </label>
            <input
              value={form.customerContactPhone}
              onChange={(e) => setForm({ ...form, customerContactPhone: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">{t('fieldRevenue')}</label>
            <input
              type="number"
              value={form.revenue}
              onChange={(e) => setForm({ ...form, revenue: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">
              {t('fieldScheduledDate')}
            </label>
            <input
              type="date"
              value={form.scheduledDate}
              onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-txt">
            {t('fieldDriverFee')} <span className="text-txt-2">{t('optional')}</span>
          </label>
          <input
            type="number"
            value={form.driverFee}
            onChange={(e) => setForm({ ...form, driverFee: e.target.value })}
            className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-txt">
            {t('fieldExpectedDistance')} <span className="text-txt-2">{t('optional')}</span>
          </label>
          <input
            type="number"
            min="0"
            step="0.1"
            value={form.expectedDistanceKm}
            onChange={(e) => setForm({ ...form, expectedDistanceKm: e.target.value })}
            className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-gray-500">{t('expectedDistanceHelp')}</p>
        </div>
        <div>
          <label className="mb-1 flex items-center gap-2 text-sm font-medium text-txt">
            <input
              type="checkbox"
              checked={form.ownerDriven}
              onChange={(e) => setForm({ ...form, ownerDriven: e.target.checked })}
            />
            {t('ownerDrivenCheckbox')}
          </label>
          {!form.ownerDriven && (
            <select
              value={form.driverId}
              onChange={(e) => setForm({ ...form, driverId: e.target.value })}
              className="mt-1 w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            >
              <option value="">{t('driverOptionalPlaceholder')}</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.user.firstName} {d.user.lastName}
                </option>
              ))}
            </select>
          )}
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

function LogExpenseModal({
  job,
  onClose,
  onSaved,
}: {
  job: TransportJob;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t } = useTranslation('transport');
  const { t: tCommon } = useTranslation('common');
  // Stage L4-style boundary - this initial value is real free-text data
  // pre-filling the field (matching ExpensesPage's own CATEGORY_SUGGESTIONS
  // reasoning), not UI chrome, so it stays a literal.
  const [category, setCategory] = useState('Fuel');
  const [amount, setAmount] = useState('');
  const [incurredAt, setIncurredAt] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const value = Number(amount);
    if (!amount || Number.isNaN(value) || value <= 0) return setError(t('errorPositiveAmount'));
    setSubmitting(true);
    try {
      await apiFetch('/expenses', {
        method: 'POST',
        body: JSON.stringify({
          transportJobId: job.id,
          category: category.trim() || 'Other',
          amount: value,
          incurredAt,
          description: description.trim() || undefined,
        }),
      });
      onSaved(t('expenseLogged'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('logExpenseError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={t('logExpenseTitle', { origin: job.origin, destination: job.destination })}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">{t('fieldCategory')}</label>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder={t('categoryPlaceholder')}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">{t('fieldAmount')}</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-txt">{t('fieldDate')}</label>
          <input
            type="date"
            value={incurredAt}
            onChange={(e) => setIncurredAt(e.target.value)}
            className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-txt">
            {t('fieldDescriptionOptional')}
          </label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
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
            {submitting ? tCommon('saving') : t('logExpenseButton')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function TransportPage() {
  const { t } = useTranslation('transport');
  const { user } = useAuth();
  const [data, setData] = useState<TransportOperationsResponse | null>(null);
  const [vehicles, setVehicles] = useState<Motorcycle[]>([]);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [jobsById, setJobsById] = useState<Map<string, TransportJob>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [formTarget, setFormTarget] = useState<'new' | TransportJob | null>(null);
  const [expenseTarget, setExpenseTarget] = useState<TransportJob | null>(null);
  const [deleting, setDeleting] = useState<TransportJob | null>(null);
  const [reconciling, setReconciling] = useState(false);
  // TRANSPORT_DESIGN.md §6 - same role gate as the backend's
  // /transport-reconciliation endpoints (OWNER or MANAGER, not bulk-import's
  // OWNER-only - this touches at most a handful of jobs per upload).
  const canReconcile = user?.role === 'OWNER' || user?.role === 'MANAGER';

  async function load() {
    try {
      const [summary, vehicleList, driverList, jobList] = await Promise.all([
        apiFetch<TransportOperationsResponse>('/transport-jobs/operations-summary'),
        apiFetch<Motorcycle[]>('/motorcycles'),
        apiFetch<DriverOption[]>('/drivers'),
        apiFetch<TransportJob[]>('/transport-jobs'),
      ]);
      setData(summary);
      setVehicles(vehicleList);
      setDrivers(driverList);
      setJobsById(new Map(jobList.map((j) => [j.id, j])));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('loadError'));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(null), 4000);
    return () => clearTimeout(timer);
  }, [success]);

  function handleSaved(message: string) {
    setFormTarget(null);
    setExpenseTarget(null);
    setSuccess(message);
    void load();
  }

  async function changeStatus(job: TransportJob, status: TransportJobStatus) {
    try {
      await apiFetch(`/transport-jobs/${job.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setSuccess(t('statusUpdated'));
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('updateStatusError'));
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await apiFetch(`/transport-jobs/${deleting.id}`, { method: 'DELETE' });
      setSuccess(t('jobDeleted'));
      setDeleting(null);
      void load();
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

  return (
    <PageChassis
      title={t('title')}
      statusPill={{
        mode: 'live',
        text: t('inTransitStatus', { count: data.inTransitJob ? 1 : 0 }),
      }}
      primaryAction={{ label: t('newJob'), onClick: () => setFormTarget('new') }}
      kpis={kpisToTiles(data, t)}
    >
      {success && <p className="rounded bg-good-d px-3 py-2 text-sm text-good-x">{success}</p>}
      {error && <p className="rounded bg-crit-d px-3 py-2 text-sm text-crit-x">{error}</p>}

      {canReconcile && (
        <div className="flex justify-end">
          <button
            onClick={() => setReconciling(true)}
            className="rounded border border-line px-3 py-1.5 text-sm font-medium text-txt-2 hover:bg-panel-2"
          >
            {t('reconcilePayments')}
          </button>
        </div>
      )}

      <ChassisGrid
        main={
          <>
            <Card title={t('perVehicleTitle')} subtitle={t('perVehicleSubtitle')}>
              {data.perVehicleThisMonth.length === 0 ? (
                <p className="p-4 text-sm text-txt-2">{t('noTransportJobsThisMonth')}</p>
              ) : (
                <>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-line-soft text-left text-xs text-txt-3">
                          <th className="px-4 py-2 font-medium">{t('tableVehicle')}</th>
                          <th className="px-4 py-2 text-right font-medium">{t('tableTrips')}</th>
                          <th className="px-4 py-2 text-right font-medium">{t('tableRevenue')}</th>
                          <th className="px-4 py-2 text-right font-medium">{t('tableExpenses')}</th>
                          <th className="px-4 py-2 text-right font-medium">{t('tableNet')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.perVehicleThisMonth.map((v) => (
                          <tr
                            key={v.motorcycleId}
                            className="border-b border-line-soft last:border-0"
                          >
                            <td className="px-4 py-2 font-medium text-txt">
                              {v.registrationNumber}
                            </td>
                            <td className="px-4 py-2 text-right text-txt-2">{v.jobCount}</td>
                            <td className="px-4 py-2 text-right text-txt-2">
                              {formatTZS(v.revenue)}
                            </td>
                            <td className="px-4 py-2 text-right text-txt-2">
                              {formatTZS(v.expenses)}
                            </td>
                            <td
                              className={`px-4 py-2 text-right font-medium ${parseFloat(v.netProfit) >= 0 ? 'text-good' : 'text-crit'}`}
                            >
                              {formatTZS(v.netProfit)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="md:hidden">
                    {data.perVehicleThisMonth.map((v) => (
                      <div
                        key={v.motorcycleId}
                        className="border-b border-line-soft px-4 py-3 last:border-0"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium text-txt">{v.registrationNumber}</span>
                          <span className="text-txt-2">
                            {t('mobileTripCount', { count: v.jobCount })}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-sm">
                          <span className="text-txt-2">
                            {t('mobileRevenueExpenses', {
                              revenue: formatTZS(v.revenue),
                              expenses: formatTZS(v.expenses),
                            })}
                          </span>
                          <span
                            className={`font-medium ${parseFloat(v.netProfit) >= 0 ? 'text-good' : 'text-crit'}`}
                          >
                            {formatTZS(v.netProfit)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>

            <InTransitCard job={data.inTransitJob} />
          </>
        }
        rail={
          <>
            <Card title={t('aiInsightTitle')}>
              {data.marginDeclineFlag ? (
                <div className="p-4">
                  <p className="text-sm font-medium text-txt">
                    {t('marginDeclineSentence', {
                      registration: data.marginDeclineFlag.registrationNumber,
                      percent: data.marginDeclineFlag.currentMarginPercent,
                    })}
                  </p>
                  <p className="mt-1 text-xs text-txt-2">
                    {t('marginDeclineAverage', {
                      avg: data.marginDeclineFlag.priorAverageMarginPercent,
                      count: data.marginDeclineFlag.priorMonthCount,
                    })}
                  </p>
                </div>
              ) : data.alerts.length > 0 ? (
                <div className="divide-y divide-line-soft">
                  {data.alerts.slice(0, 2).map((a, i) => (
                    <div
                      key={i}
                      className={`border-l-[3px] px-3 py-2 ${a.severity === 'crit' ? 'border-l-crit' : 'border-l-warn'}`}
                    >
                      <p className="text-sm font-medium text-txt">{a.title}</p>
                      <p className="text-xs text-txt-2">{a.description}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="p-4 text-sm text-txt-2">{t('nothingToFlag')}</p>
              )}
            </Card>
            <Card
              title={t('transportAlertsTitle')}
              subtitle={data.alerts.length > 0 ? String(data.alerts.length) : undefined}
            >
              {data.alerts.length === 0 ? (
                <p className="p-4 text-sm text-txt-2">{t('nothingNeedsAttention')}</p>
              ) : (
                <div className="divide-y divide-line-soft">
                  {data.alerts.map((a, i) => (
                    <div
                      key={i}
                      className={`border-l-[3px] px-3 py-2 ${a.severity === 'crit' ? 'border-l-crit' : 'border-l-warn'}`}
                    >
                      <p className="text-sm font-medium text-txt">{a.title}</p>
                      <p className="text-xs text-txt-2">{a.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        }
      />

      <Card
        title={t('kpiTripsThisMonth')}
        subtitle={t('tripsThisMonthSubtitle', { count: data.tripsThisMonth.length })}
      >
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left text-xs text-txt-3">
                <th className="px-4 py-2 font-medium">{t('tableReference')}</th>
                <th className="px-4 py-2 font-medium">{t('tableRoute')}</th>
                <th className="px-4 py-2 font-medium">{t('tableVehicle')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('tableRevenue')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('tableCost')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('tableProfit')}</th>
                <th className="px-4 py-2 font-medium">{t('tableCollection')}</th>
                <th className="px-4 py-2 font-medium">{t('tableStatus')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('tableActions')}</th>
              </tr>
            </thead>
            <tbody>
              {data.tripsThisMonth.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-txt-2">
                    {t('noTripsYet')}
                  </td>
                </tr>
              ) : (
                data.tripsThisMonth.map((trip) => {
                  const job = jobsById.get(trip.id);
                  const net = parseFloat(trip.netProfit);
                  return (
                    <tr key={trip.id} className="border-b border-line-soft last:border-0">
                      <td className="px-4 py-2 text-txt-2">{trip.reference ?? '—'}</td>
                      <td className="px-4 py-2 text-txt">
                        {trip.origin} → {trip.destination}
                      </td>
                      <td className="px-4 py-2 text-txt-2">{trip.registrationNumber}</td>
                      <td className="px-4 py-2 text-right text-txt-2">{formatTZS(trip.revenue)}</td>
                      <td className="px-4 py-2 text-right text-txt-2">
                        {formatTZS(trip.expensesTotal)}
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-medium ${net >= 0 ? 'text-good' : 'text-crit'}`}
                      >
                        {formatTZS(trip.netProfit)}
                      </td>
                      <td className="px-4 py-2">
                        {job ? <CollectionStatusPill job={job} /> : '—'}
                      </td>
                      <td className="px-4 py-2">
                        {job ? (
                          <select
                            value={job.status}
                            onChange={(e) =>
                              void changeStatus(job, e.target.value as TransportJobStatus)
                            }
                            className="rounded border border-line bg-panel px-2 py-1 text-xs text-txt"
                          >
                            {STATUS_OPTIONS.map((s) => (
                              <option key={s} value={s}>
                                {t(STATUS_LABEL_KEY[s])}
                              </option>
                            ))}
                          </select>
                        ) : (
                          trip.status
                        )}
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        {job && (
                          <>
                            <button
                              onClick={() => setExpenseTarget(job)}
                              className="mr-3 text-sm font-medium text-c1 hover:underline"
                            >
                              {t('addExpenseAction')}
                            </button>
                            <button
                              onClick={() => setFormTarget(job)}
                              className="mr-3 text-sm font-medium text-c1 hover:underline"
                            >
                              {t('edit')}
                            </button>
                            <button
                              onClick={() => setDeleting(job)}
                              className="text-sm font-medium text-crit hover:underline"
                            >
                              {t('delete')}
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

        <div className="md:hidden">
          {data.tripsThisMonth.length === 0 ? (
            <p className="p-4 text-center text-sm text-txt-2">{t('noTripsYet')}</p>
          ) : (
            data.tripsThisMonth.map((trip) => {
              const job = jobsById.get(trip.id);
              const net = parseFloat(trip.netProfit);
              return (
                <div key={trip.id} className="border-b border-line-soft px-4 py-3 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-txt">{trip.reference ?? '—'}</span>
                    <span className="text-xs text-txt-2">{trip.registrationNumber}</span>
                  </div>
                  <p className="mt-1 text-xs text-txt-2">
                    {trip.origin} → {trip.destination}
                  </p>
                  <div className="mt-1 flex items-center justify-between text-sm">
                    <span className="text-txt-2">
                      {t('mobileRevenueCost', {
                        revenue: formatTZS(trip.revenue),
                        cost: formatTZS(trip.expensesTotal),
                      })}
                    </span>
                    <span className={`font-medium ${net >= 0 ? 'text-good' : 'text-crit'}`}>
                      {formatTZS(trip.netProfit)}
                    </span>
                  </div>
                  {job && (
                    <div className="mt-1.5">
                      <CollectionStatusPill job={job} />
                    </div>
                  )}
                  <div className="mt-2">
                    {job ? (
                      <select
                        value={job.status}
                        onChange={(e) =>
                          void changeStatus(job, e.target.value as TransportJobStatus)
                        }
                        className="w-full rounded border border-line bg-panel px-2 py-1.5 text-sm text-txt"
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {t(STATUS_LABEL_KEY[s])}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-sm text-txt-2">{trip.status}</span>
                    )}
                  </div>
                  {job && (
                    <div className="mt-2 flex min-h-11 items-center justify-end gap-4">
                      <button
                        onClick={() => setExpenseTarget(job)}
                        className="text-sm font-medium text-c1 hover:underline"
                      >
                        {t('addExpenseAction')}
                      </button>
                      <button
                        onClick={() => setFormTarget(job)}
                        className="text-sm font-medium text-c1 hover:underline"
                      >
                        {t('edit')}
                      </button>
                      <button
                        onClick={() => setDeleting(job)}
                        className="text-sm font-medium text-crit hover:underline"
                      >
                        {t('delete')}
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Card>

      <ClosingRow
        left={
          data.marginDeclineFlag && data.flaggedVehicleMarginTrend ? (
            <Card
              title={t('marginTrendTitleWithVehicle', {
                registration: data.marginDeclineFlag.registrationNumber,
              })}
              subtitle={t('marginTrendSubtitle')}
            >
              <div className="flex h-32 items-end gap-2 px-4 pb-4">
                {data.flaggedVehicleMarginTrend.map((m) => (
                  <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                    <div
                      className={`w-full rounded-t ${m.marginPercent !== null && m.marginPercent < 0 ? 'bg-crit' : 'bg-c3'}`}
                      style={{
                        height: `${Math.max(2, Math.min(100, ((m.marginPercent ?? 0) + 20) * 2))}%`,
                      }}
                    />
                    <span className="text-[10px] text-txt-3">{m.month.slice(5)}</span>
                  </div>
                ))}
              </div>
            </Card>
          ) : (
            <Card title={t('marginTrendFallbackTitle')} subtitle={t('marginTrendFallbackSubtitle')}>
              <p className="p-4 text-sm text-txt-2">{t('noMarginDeclineFlagged')}</p>
            </Card>
          )
        }
        right={
          <Card title={t('marginGoesTitle')} subtitle={t('marginGoesSubtitle')}>
            <div className="px-4 pb-4">
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-panel-2">
                <div className="bg-crit" style={{ width: `${data.marginSplit.fuelPercent}%` }} />
                <div className="bg-warn" style={{ width: `${data.marginSplit.otherPercent}%` }} />
                <div
                  className="bg-good"
                  style={{ width: `${Math.max(0, data.marginSplit.profitPercent)}%` }}
                />
              </div>
              <div className="mt-3 space-y-1.5 text-sm text-txt-2">
                <div className="flex justify-between">
                  <span>{t('marginRowFuel')}</span>
                  <span className="text-txt">
                    {data.marginSplit.fuelPercent}% · {formatTZS(data.marginSplit.fuel)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{t('marginRowOtherCosts')}</span>
                  <span className="text-txt">
                    {data.marginSplit.otherPercent}% · {formatTZS(data.marginSplit.other)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{t('marginRowProfit')}</span>
                  <span className="text-txt">
                    {data.marginSplit.profitPercent}% · {formatTZS(data.marginSplit.profit)}
                  </span>
                </div>
              </div>
            </div>
          </Card>
        }
      />

      {formTarget && (
        <JobFormModal
          job={formTarget === 'new' ? null : formTarget}
          vehicles={vehicles}
          drivers={drivers}
          onClose={() => setFormTarget(null)}
          onSaved={handleSaved}
        />
      )}
      {expenseTarget && (
        <LogExpenseModal
          job={expenseTarget}
          onClose={() => setExpenseTarget(null)}
          onSaved={handleSaved}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t('deleteJobTitle')}
          message={t('deleteJobMessage', {
            origin: deleting.origin,
            destination: deleting.destination,
          })}
          confirmLabel={t('delete')}
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
      {reconciling && (
        <TransportReconciliationModal
          onClose={() => setReconciling(false)}
          onCommitted={(message) => {
            setReconciling(false);
            setSuccess(message);
            void load();
          }}
        />
      )}
    </PageChassis>
  );
}
