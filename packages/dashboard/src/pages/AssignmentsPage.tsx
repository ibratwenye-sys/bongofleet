import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { apiFetch, ApiError } from '../lib/api';
import { formatTZS } from '../lib/format';
import type {
  Assignment,
  AssignmentSummaryResponse,
  CreateAssignmentPayload,
  Driver,
  Motorcycle,
  Payment,
  PaymentStatus,
  VehicleType,
} from '../lib/types';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PAYMENT_STATUS_STYLES, StatusBadge } from '../components/StatusBadge';
import { PaymentFormModal } from '../components/PaymentFormModal';
import { PageChassis } from '../components/chassis/PageChassis';
import { ChassisGrid, ClosingRow } from '../components/chassis/ChassisGrid';
import { Card } from '../components/chassis/Card';
import type { KpiTile } from '../components/chassis/KpiRail';

// Stage L9 - reuse PaymentsPage.tsx's own PAYMENT_STATUS_LABEL_KEY (L3)
// rather than inventing a third copy of these three strings: same
// PaymentStatus enum, same payments.json keys, just read via a second
// useTranslation('payments') hook here.
const PAYMENT_STATUS_LABEL_KEY: Record<PaymentStatus, string> = {
  PENDING: 'paymentStatusPending',
  COMPLETED: 'paymentStatusCompleted',
  FAILED: 'paymentStatusFailed',
};

// Stage L9 - this is now the THIRD page with its own private copy of this
// exact VehicleType label wrapper (Fleet L7, Maintenance L8, now this).
// Extracting VEHICLE_TYPE_LABEL_KEY/vehicleTypeLabel into a shared module
// is overdue - queued as a follow-up, not done here since Fleet and
// Maintenance are already shipped/verified and out of this stage's scope.
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

function todayDateInput(): string {
  return new Date().toISOString().slice(0, 10);
}

function kpisToTiles(data: AssignmentSummaryResponse, t: TFunction<'assignments'>): KpiTile[] {
  const k = data.kpis;
  return [
    {
      label: t('kpiAssignedToday'),
      value: String(k.assignedToday.count),
      valueSuffix: `/ ${k.assignedToday.fleetSize}`,
      delta: t('kpiAssignedTodayDelta', { percent: k.assignedToday.percentOfFleet }),
      accentColor: 'c1',
    },
    {
      label: t('kpiMoving'),
      value: String(k.movingToday.count),
      delta: t('kpiMovingDelta', { percent: k.movingToday.percentActuallyEarning }),
      accentColor: 'good',
    },
    {
      label: t('kpiAssignedWorkshop'),
      value: String(k.assignedInWorkshopToday.count),
      delta: t('kpiAssignedWorkshopDelta'),
      accentColor: k.assignedInWorkshopToday.count > 0 ? 'warn' : 'good',
    },
    {
      label: t('kpiInStockUnassigned'),
      value: String(k.inStockToday.count),
      delta: t('kpiInStockUnassignedDelta', { amount: formatTZS(k.inStockToday.targetLost) }),
      accentColor: k.inStockToday.count > 0 ? 'crit' : 'good',
    },
    {
      label: t('kpiCreatedThisMonth'),
      value: String(k.createdThisMonth.count),
      delta: t('kpiCreatedThisMonthDelta', {
        percent: k.createdThisMonth.percentEndedWithPayment,
      }),
      accentColor: 'c1',
    },
    {
      label: t('kpiCostOfIdleness'),
      value: formatTZS(k.costOfIdlenessThisMonth.amount),
      delta: t('kpiCostOfIdlenessDelta'),
      accentColor: 'violet',
    },
  ];
}

function StockChart({ series }: { series: AssignmentSummaryResponse['dailyStockSeries'] }) {
  const { t } = useTranslation('assignments');
  return (
    <div>
      <div className="flex h-32 items-end gap-1">
        {series.map((p) => {
          const total = p.outCount + p.inStockCount || 1;
          return (
            <div
              key={p.date}
              className="flex flex-1 flex-col items-center gap-0.5"
              title={t('stockChartTooltip', { out: p.outCount, inStock: p.inStockCount })}
            >
              <div className="flex w-full flex-1 flex-col justify-end overflow-hidden rounded-t">
                <div
                  className="w-full bg-crit"
                  style={{ height: `${(p.inStockCount / total) * 100}%` }}
                />
                <div
                  className="w-full bg-c1"
                  style={{ height: `${(p.outCount / total) * 100}%` }}
                />
              </div>
              <span className="text-[10px] text-txt-3">{p.date.slice(8, 10)}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-4 text-xs text-txt-2">
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-c1 align-middle" />
          {t('legendOutWithDriver')}
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-crit align-middle" />
          {t('legendInStock')}
        </span>
      </div>
    </div>
  );
}

// ---- Create assignment modal (unchanged CRUD) ----

interface FormState {
  motorcycleId: string;
  driverId: string;
  assignedDate: string;
  targetAmount: string;
  notes: string;
}

function AssignmentFormModal({
  motorcycles,
  drivers,
  onClose,
  onSaved,
}: {
  motorcycles: Motorcycle[];
  drivers: Driver[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t } = useTranslation('assignments');
  const { t: tCommon } = useTranslation('common');
  const [form, setForm] = useState<FormState>({
    motorcycleId: '',
    driverId: '',
    assignedDate: todayDateInput(),
    targetAmount: '',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.motorcycleId || !form.driverId || !form.assignedDate) {
      setError(t('errorRequiredFields'));
      return;
    }
    const targetAmount = Number(form.targetAmount);
    if (!form.targetAmount || Number.isNaN(targetAmount) || targetAmount <= 0) {
      setError(t('errorValidTargetAmount'));
      return;
    }

    setSubmitting(true);
    try {
      const payload: CreateAssignmentPayload = {
        motorcycleId: form.motorcycleId,
        driverId: form.driverId,
        assignedDate: form.assignedDate,
        targetAmount,
        notes: form.notes.trim() || undefined,
      };
      await apiFetch('/assignments', { method: 'POST', body: JSON.stringify(payload) });
      onSaved(t('assignmentCreated'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('genericError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={t('createAssignment')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-txt">{t('tableDriver')}</label>
          <select
            value={form.driverId}
            onChange={(e) => setForm({ ...form, driverId: e.target.value })}
            className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
          >
            <option value="">{t('selectDriverPlaceholder')}</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.user.firstName} {d.user.lastName} — {d.licenseNumber}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-txt">{t('tableVehicle')}</label>
          <select
            value={form.motorcycleId}
            onChange={(e) => setForm({ ...form, motorcycleId: e.target.value })}
            className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
          >
            <option value="">{t('selectVehiclePlaceholder')}</option>
            {motorcycles.map((m) => (
              <option key={m.id} value={m.id}>
                {m.registrationNumber} {[m.make, m.model].filter(Boolean).join(' ')}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">{t('tableDate')}</label>
            <input
              type="date"
              value={form.assignedDate}
              onChange={(e) => setForm({ ...form, assignedDate: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">
              {t('fieldTargetAmount')}
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.targetAmount}
              onChange={(e) => setForm({ ...form, targetAmount: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-txt">
            {t('fieldNotesOptional')}
          </label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            rows={2}
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

export function AssignmentsPage() {
  const { t } = useTranslation('assignments');
  const { t: tCommon } = useTranslation('common');
  const { t: tPayments } = useTranslation('payments');
  const [data, setData] = useState<AssignmentSummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Manage-assignments fallback: the new tables above are analytical
  // (a 14-day chart, the vehicles-in-stock list), not a per-assignment
  // list, so recording a payment or deleting a specific assignment needs
  // this compact card - same reasoning as the Fleet/Drivers pages' own
  // fallback sections.
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [motorcycles, setMotorcycles] = useState<Motorcycle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [dateFilter, setDateFilter] = useState('');
  const [paymentTarget, setPaymentTarget] = useState<Assignment | null>(null);
  const [deleting, setDeleting] = useState<Assignment | null>(null);

  async function load() {
    try {
      const [summary, assignmentsData, motorcyclesData, driversData, paymentsData] =
        await Promise.all([
          apiFetch<AssignmentSummaryResponse>('/assignments/summary'),
          apiFetch<Assignment[]>('/assignments'),
          apiFetch<Motorcycle[]>('/motorcycles'),
          apiFetch<Driver[]>('/drivers'),
          apiFetch<Payment[]>('/payments'),
        ]);
      setData(summary);
      setAssignments(assignmentsData);
      setMotorcycles(motorcyclesData);
      setDrivers(driversData);
      setPayments(paymentsData);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('loadError'));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  const motorcycleById = useMemo(() => new Map(motorcycles.map((m) => [m.id, m])), [motorcycles]);
  const driverById = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);
  const paymentsByAssignment = useMemo(() => {
    const map = new Map<string, Payment[]>();
    for (const payment of payments) {
      const list = map.get(payment.dailyAssignmentId) ?? [];
      list.push(payment);
      map.set(payment.dailyAssignmentId, list);
    }
    return map;
  }, [payments]);

  const filteredAssignments = useMemo(() => {
    if (!assignments) return [];
    if (!dateFilter) return assignments;
    return assignments.filter((a) => a.assignedDate.slice(0, 10) === dateFilter);
  }, [assignments, dateFilter]);

  function handleSaved(message: string) {
    setShowCreate(false);
    setPaymentTarget(null);
    setSuccessMessage(message);
    void load();
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await apiFetch(`/assignments/${deleting.id}`, { method: 'DELETE' });
      setSuccessMessage(t('assignmentDeleted'));
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
      statusPill={{ mode: 'live', text: t('statusPill', { count: data.kpis.assignedToday.count }) }}
      primaryAction={{ label: t('createAssignment'), onClick: () => setShowCreate(true) }}
      kpis={kpisToTiles(data, t)}
    >
      {successMessage && (
        <p className="rounded bg-good-d px-3 py-2 text-sm text-good-x">{successMessage}</p>
      )}
      {error && <p className="rounded bg-crit-d px-3 py-2 text-sm text-crit-x">{error}</p>}

      <ChassisGrid
        main={
          <>
            <Card title={t('stockChartTitle')} subtitle={t('stockChartSubtitle')}>
              <StockChart series={data.dailyStockSeries} />
            </Card>
            <Card
              title={t('utilisationTitle')}
              subtitle={t('utilisationSubtitle', {
                count:
                  data.utilisationToday.moving +
                  data.utilisationToday.workshop +
                  data.utilisationToday.inStock,
              })}
            >
              {(() => {
                const total =
                  data.utilisationToday.moving +
                    data.utilisationToday.workshop +
                    data.utilisationToday.inStock || 1;
                return (
                  <div>
                    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-panel-2">
                      <div
                        className="bg-c1"
                        style={{ width: `${(data.utilisationToday.moving / total) * 100}%` }}
                      />
                      <div
                        className="bg-warn"
                        style={{ width: `${(data.utilisationToday.workshop / total) * 100}%` }}
                      />
                      <div
                        className="bg-crit"
                        style={{ width: `${(data.utilisationToday.inStock / total) * 100}%` }}
                      />
                    </div>
                    <div className="mt-3 space-y-1.5 text-sm text-txt-2">
                      <div className="flex justify-between">
                        <span>{t('rowAssignedMoving')}</span>
                        <span className="text-txt">{data.utilisationToday.moving}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>{t('kpiAssignedWorkshop')}</span>
                        <span className="text-txt">{data.utilisationToday.workshop}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>{t('rowInStockNobody')}</span>
                        <span className="text-txt">{data.utilisationToday.inStock}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}
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
            <Card title={t('unassignedTitle')} subtitle={String(data.unassignedNow.length)}>
              {data.unassignedNow.length === 0 ? (
                <p className="p-4 text-sm text-txt-2">{t('everyActiveHasDriver')}</p>
              ) : (
                <div className="divide-y divide-line-soft">
                  {data.unassignedNow.slice(0, 6).map((v) => (
                    <div key={v.motorcycleId} className="px-4 py-2.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-txt">
                          {v.registrationNumber} · {vehicleTypeLabel(v.vehicleType, tCommon)}
                        </span>
                        <span className="text-txt-3">
                          {t('daysUnassignedSuffix', { count: v.daysUnassigned })}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-txt-2">{v.reason}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        }
      />

      <Card
        title={t('vehiclesInStockTitle')}
        subtitle={t('vehiclesInStockSubtitle', { count: data.unassignedNow.length })}
      >
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left text-xs text-txt-3">
                <th className="px-4 py-2 font-medium">{t('tableRegistration')}</th>
                <th className="px-4 py-2 font-medium">{t('tableType')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('tableDaysUnassigned')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('tableDailyTarget')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('tableLostSoFar')}</th>
                <th className="px-4 py-2 font-medium">{t('tableArea')}</th>
                <th className="px-4 py-2 font-medium">{t('tableWhy')}</th>
              </tr>
            </thead>
            <tbody>
              {data.unassignedNow.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-txt-2">
                    {t('nothingInStock')}
                  </td>
                </tr>
              ) : (
                data.unassignedNow.map((v) => (
                  <tr key={v.motorcycleId} className="border-b border-line-soft last:border-0">
                    <td className="px-4 py-2 font-medium text-txt">{v.registrationNumber}</td>
                    <td className="px-4 py-2 text-txt-2">
                      {vehicleTypeLabel(v.vehicleType, tCommon)}
                    </td>
                    <td className="px-4 py-2 text-right text-txt-2">{v.daysUnassigned}</td>
                    <td className="px-4 py-2 text-right text-txt-2">
                      {v.dailyTarget ? formatTZS(v.dailyTarget) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right font-medium text-crit">
                      {v.lostSoFar ? formatTZS(v.lostSoFar) : '—'}
                    </td>
                    <td className="px-4 py-2 text-txt-2">{v.operatingArea ?? '—'}</td>
                    <td className="px-4 py-2 text-txt-2">{v.reason}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="md:hidden">
          {data.unassignedNow.length === 0 ? (
            <p className="p-4 text-center text-sm text-txt-2">{t('nothingInStock')}</p>
          ) : (
            data.unassignedNow.map((v) => (
              <div
                key={v.motorcycleId}
                className="border-b border-line-soft px-4 py-3 last:border-0"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-txt">
                    {v.registrationNumber} · {vehicleTypeLabel(v.vehicleType, tCommon)}
                  </span>
                  <span className="shrink-0 text-txt-3">
                    {t('daysUnassignedSuffix', { count: v.daysUnassigned })}
                  </span>
                </div>
                <p className="mt-1 text-xs text-txt-2">
                  {v.operatingArea ?? '—'} · {v.reason}
                </p>
                <div className="mt-1 flex items-center justify-between text-sm">
                  <span className="text-txt-2">
                    {v.dailyTarget ? formatTZS(v.dailyTarget) : '—'}
                  </span>
                  <span className="font-medium text-crit">
                    {v.lostSoFar ? formatTZS(v.lostSoFar) : '—'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      <ClosingRow
        left={
          <Card
            title={t('thisMonthTitle')}
            subtitle={t('thisMonthSubtitle', { count: data.thisMonth.created })}
          >
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-line-soft">
                  <td className="px-4 py-2 text-txt-2">{t('rowAssignmentsCreated')}</td>
                  <td className="px-4 py-2 text-right text-txt">{data.thisMonth.created}</td>
                </tr>
                <tr className="border-b border-line-soft">
                  <td className="px-4 py-2 text-txt-2">{t('rowEndedWithPayment')}</td>
                  <td className="px-4 py-2 text-right text-good">
                    {data.thisMonth.endedWithPayment}
                  </td>
                </tr>
                <tr className="border-b border-line-soft">
                  <td className="px-4 py-2 text-txt-2">{t('rowEndedWithNothing')}</td>
                  <td className="px-4 py-2 text-right text-crit">
                    {data.thisMonth.endedWithNothing}
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-medium text-txt">{t('rowValueOfDays')}</td>
                  <td className="px-4 py-2 text-right font-medium text-crit">
                    {formatTZS(data.thisMonth.valueOfUnpaidDays)}
                  </td>
                </tr>
              </tbody>
            </table>
          </Card>
        }
        right={
          <Card title={t('idlenessTitle')} subtitle={t('idlenessSubtitle')}>
            {data.idlenessCostByType.length === 0 ? (
              <p className="p-4 text-sm text-txt-2">{t('noIdleVehicles')}</p>
            ) : (
              <div className="divide-y divide-line-soft px-4">
                {data.idlenessCostByType.map((row) => (
                  <div key={row.vehicleType} className="py-2.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-txt">
                        {t('idleRowLabel', { type: vehicleTypeLabel(row.vehicleType, tCommon) })}
                      </span>
                      <span className="text-txt-2">
                        {t('idleVehicleCount', { count: row.count })}
                      </span>
                      <span className="font-medium text-crit">{formatTZS(row.amount)}</span>
                    </div>
                    {row.topContributor && (
                      <p className="mt-0.5 text-xs text-txt-2">
                        {t('topContributorLine', { topContributor: row.topContributor })}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        }
      />

      <Card title={t('manageTitle')} subtitle={t('manageSubtitle')}>
        <div className="flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-3">
          <label className="text-sm text-txt-2">{t('filterByDate')}</label>
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="rounded border border-line bg-panel px-3 py-1.5 text-sm text-txt"
          />
          {dateFilter && (
            <button
              onClick={() => setDateFilter('')}
              className="text-sm text-txt-3 hover:underline"
            >
              {t('clear')}
            </button>
          )}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left text-xs text-txt-3">
                <th className="px-4 py-2 font-medium">{t('tableDate')}</th>
                <th className="px-4 py-2 font-medium">{t('tableDriver')}</th>
                <th className="px-4 py-2 font-medium">{t('tableVehicle')}</th>
                <th className="px-4 py-2 font-medium">{t('tableTarget')}</th>
                <th className="px-4 py-2 font-medium">{t('tablePayments')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('tableActions')}</th>
              </tr>
            </thead>
            <tbody>
              {assignments === null ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-txt-2">
                    {t('loading')}
                  </td>
                </tr>
              ) : filteredAssignments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-txt-2">
                    {t('noAssignmentsFound')}
                  </td>
                </tr>
              ) : (
                filteredAssignments.slice(0, 25).map((a) => {
                  const driver = driverById.get(a.driverId);
                  const motorcycle = motorcycleById.get(a.motorcycleId);
                  const assignmentPayments = paymentsByAssignment.get(a.id) ?? [];
                  const paidTotal = assignmentPayments
                    .filter((p) => p.status === 'COMPLETED')
                    .reduce((sum, p) => sum + parseFloat(p.amount), 0);
                  const latest = assignmentPayments[0] ?? null;
                  return (
                    <tr key={a.id} className="border-b border-line-soft last:border-0">
                      <td className="px-4 py-2 text-txt-2">{a.assignedDate.slice(0, 10)}</td>
                      <td className="px-4 py-2 text-txt">
                        {driver
                          ? `${driver.user.firstName} ${driver.user.lastName}`
                          : t('unknownDriver')}
                      </td>
                      <td className="px-4 py-2 text-txt-2">
                        {motorcycle?.registrationNumber ?? t('unknownVehicle')}
                      </td>
                      <td className="px-4 py-2 text-txt-2">{formatTZS(a.targetAmount)}</td>
                      <td className="px-4 py-2 text-txt-2">
                        {assignmentPayments.length === 0 ? (
                          t('noPaymentsYet')
                        ) : (
                          <span className="flex items-center gap-2">
                            {formatTZS(paidTotal)} / {formatTZS(a.targetAmount)}
                            {latest && (
                              <StatusBadge
                                status={latest.status}
                                styles={PAYMENT_STATUS_STYLES}
                                label={tPayments(PAYMENT_STATUS_LABEL_KEY[latest.status])}
                              />
                            )}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        <button
                          onClick={() => setPaymentTarget(a)}
                          className="mr-3 text-sm font-medium text-c1 hover:underline"
                        >
                          {t('recordPayment')}
                        </button>
                        <button
                          onClick={() => setDeleting(a)}
                          className="text-sm font-medium text-crit hover:underline"
                        >
                          {tCommon('delete')}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="md:hidden">
          {assignments === null ? (
            <p className="p-4 text-center text-sm text-txt-2">{t('loading')}</p>
          ) : filteredAssignments.length === 0 ? (
            <p className="p-4 text-center text-sm text-txt-2">{t('noAssignmentsFound')}</p>
          ) : (
            filteredAssignments.slice(0, 25).map((a) => {
              const driver = driverById.get(a.driverId);
              const motorcycle = motorcycleById.get(a.motorcycleId);
              const assignmentPayments = paymentsByAssignment.get(a.id) ?? [];
              const paidTotal = assignmentPayments
                .filter((p) => p.status === 'COMPLETED')
                .reduce((sum, p) => sum + parseFloat(p.amount), 0);
              const latest = assignmentPayments[0] ?? null;
              return (
                <div key={a.id} className="border-b border-line-soft px-4 py-3 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-txt">
                      {driver
                        ? `${driver.user.firstName} ${driver.user.lastName}`
                        : t('unknownDriver')}
                    </span>
                    <span className="text-xs text-txt-2">{a.assignedDate.slice(0, 10)}</span>
                  </div>
                  <p className="mt-1 text-xs text-txt-2">
                    {motorcycle?.registrationNumber ?? t('unknownVehicle')} ·{' '}
                    {formatTZS(a.targetAmount)}
                  </p>
                  <div className="mt-1 text-sm text-txt-2">
                    {assignmentPayments.length === 0 ? (
                      t('noPaymentsYet')
                    ) : (
                      <span className="flex items-center gap-2">
                        {formatTZS(paidTotal)} / {formatTZS(a.targetAmount)}
                        {latest && (
                          <StatusBadge
                            status={latest.status}
                            styles={PAYMENT_STATUS_STYLES}
                            label={tPayments(PAYMENT_STATUS_LABEL_KEY[latest.status])}
                          />
                        )}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex min-h-11 items-center justify-end gap-4">
                    <button
                      onClick={() => setPaymentTarget(a)}
                      className="text-sm font-medium text-c1 hover:underline"
                    >
                      {t('recordPayment')}
                    </button>
                    <button
                      onClick={() => setDeleting(a)}
                      className="text-sm font-medium text-crit hover:underline"
                    >
                      {tCommon('delete')}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>

      {showCreate && (
        <AssignmentFormModal
          motorcycles={motorcycles}
          drivers={drivers}
          onClose={() => setShowCreate(false)}
          onSaved={handleSaved}
        />
      )}

      {paymentTarget && (
        <PaymentFormModal
          assignments={assignments ?? []}
          drivers={drivers}
          motorcycles={motorcycles}
          lockedAssignment={paymentTarget}
          onClose={() => setPaymentTarget(null)}
          onSaved={handleSaved}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t('deleteAssignmentTitle')}
          message={t('deleteAssignmentMessage', { date: deleting.assignedDate.slice(0, 10) })}
          confirmLabel={tCommon('delete')}
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </PageChassis>
  );
}
