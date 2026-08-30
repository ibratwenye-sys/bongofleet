import { useEffect, useMemo, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import { formatTZS, startOfThisMonth, today } from '../lib/format';
import type {
  CreateMaintenancePayload,
  MaintenanceLog,
  MaintenanceSummaryResponse,
  Motorcycle,
  UpdateMaintenancePayload,
} from '../lib/types';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PageChassis } from '../components/chassis/PageChassis';
import { ChassisGrid, ClosingRow } from '../components/chassis/ChassisGrid';
import { Card } from '../components/chassis/Card';
import type { KpiTile } from '../components/chassis/KpiRail';

function kpisToTiles(data: MaintenanceSummaryResponse): KpiTile[] {
  const k = data.kpis;
  return [
    {
      label: 'Overdue',
      value: String(k.overdue.count),
      accentColor: k.overdue.count > 0 ? 'crit' : 'good',
    },
    {
      label: 'Due within 7 days',
      value: String(k.dueWithin7Days.count),
      accentColor: k.dueWithin7Days.count > 0 ? 'warn' : 'good',
    },
    { label: 'Due within 30 days', value: String(k.dueWithin30Days.count), accentColor: 'c1' },
    {
      label: 'Nothing due',
      value: String(k.nothingDue.count),
      delta: `${k.nothingDue.percentOfFleet}% of the fleet`,
      accentColor: 'good',
    },
    {
      label: 'Completed, this month',
      value: String(k.completedThisMonth.count),
      delta: formatTZS(k.completedThisMonth.cost),
      accentColor: 'violet',
    },
    {
      label: 'Repeat visits',
      value: String(k.repeatVisits.count),
      accentColor: k.repeatVisits.count > 0 ? 'crit' : 'good',
    },
  ];
}

function NeedsBookingTable({ rows }: { rows: MaintenanceSummaryResponse['needsBooking'] }) {
  if (rows.length === 0) {
    return <p className="p-4 text-sm text-txt-2">Nothing needs booking right now.</p>;
  }
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line-soft text-left text-xs text-txt-3">
              <th className="px-4 py-2 font-medium">Vehicle</th>
              <th className="px-4 py-2 font-medium">Driver</th>
              <th className="px-4 py-2 font-medium">Why</th>
              <th className="px-4 py-2 text-right font-medium">Odometer</th>
              <th className="px-4 py-2 font-medium">Status</th>
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
                    {r.status === 'OVERDUE' ? 'Overdue' : 'Due soon'}
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
                {r.status === 'OVERDUE' ? 'Overdue' : 'Due soon'}
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
  const isEdit = log != null;
  const [form, setForm] = useState<FormState>(() => toFormState(log, defaultMotorcycleId));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isEdit && !form.motorcycleId) {
      setError('Please choose a vehicle.');
      return;
    }
    if (!form.description.trim()) {
      setError('Description is required.');
      return;
    }
    const cost = Number(form.cost);
    if (!form.cost || Number.isNaN(cost) || cost <= 0) {
      setError('Cost must be a positive number.');
      return;
    }
    if (!form.performedAt) {
      setError('Service date is required.');
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
        onSaved('Service updated.');
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
        onSaved('Service logged.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={isEdit ? 'Edit service' : 'Log service'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {!isEdit && (
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">Vehicle</label>
            <select
              value={form.motorcycleId}
              onChange={(e) => setForm({ ...form, motorcycleId: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            >
              <option value="">Choose a vehicle…</option>
              {motorcycles.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.registrationNumber} (current {m.currentMileage.toLocaleString()} km)
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="mb-1 block text-sm font-medium text-txt">Description</label>
          <input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            placeholder="e.g. Oil change, brake pads"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">Cost (TZS)</label>
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
            <label className="mb-1 block text-sm font-medium text-txt">Service date</label>
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
            Odometer at service (km) <span className="text-txt-2">(optional)</span>
          </label>
          <input
            type="number"
            min="0"
            value={form.mileageAtService}
            onChange={(e) => setForm({ ...form, mileageAtService: e.target.value })}
            className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            placeholder="Updates the vehicle's current mileage"
          />
        </div>
        <div className="rounded border border-gray-100 bg-gray-50 p-3">
          <p className="mb-2 text-xs font-medium text-gray-500">
            Next service reminder (optional) — you'll be emailed when either is near.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-txt">Next due date</label>
              <input
                type="date"
                value={form.nextServiceDate}
                onChange={(e) => setForm({ ...form, nextServiceDate: e.target.value })}
                className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-txt">
                Next due mileage (km)
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

export function MaintenancePage() {
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
      setError(err instanceof ApiError ? err.message : 'Could not load the maintenance summary.');
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
      setSuccessMessage('Service deleted.');
      setDeleting(null);
      void load();
      void loadManageLogs();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete service.');
      setDeleting(null);
    }
  }

  if (error && !data) {
    return <p className="text-sm text-crit">{error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-txt-2">Loading…</p>;
  }

  const somethingDueCount =
    data.kpis.overdue.count + data.kpis.dueWithin7Days.count + data.kpis.dueWithin30Days.count;
  const pipelineColors: Record<string, string> = {
    OVERDUE: 'var(--crit)',
    DUE_7: 'var(--warn)',
    DUE_30: 'var(--c1)',
    NOTHING_DUE: 'var(--good)',
  };
  const pipelineLabels: Record<string, string> = {
    OVERDUE: 'Overdue',
    DUE_7: 'Due within 7 days',
    DUE_30: 'Due within 30 days',
    NOTHING_DUE: 'Nothing due',
  };

  return (
    <PageChassis
      title="Maintenance"
      statusPill={{ mode: 'reporting', text: `${somethingDueCount} vehicles have something due` }}
      primaryAction={{ label: 'Log service', onClick: () => setFormTarget('new') }}
      kpis={kpisToTiles(data)}
    >
      {successMessage && (
        <p className="rounded bg-good-d px-3 py-2 text-sm text-good-x">{successMessage}</p>
      )}
      {error && <p className="rounded bg-crit-d px-3 py-2 text-sm text-crit-x">{error}</p>}

      <ChassisGrid
        main={
          <>
            <Card
              title="Needs booking"
              subtitle={`${data.needsBooking.length} vehicles · overdue and at risk`}
            >
              <NeedsBookingTable rows={data.needsBooking} />
            </Card>
            <Card title="Service pipeline" subtitle="all vehicles">
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
                        {pipelineLabels[b.bucket]}
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
              title="AI Insights"
              subtitle={data.insights.length > 0 ? String(data.insights.length) : undefined}
            >
              {data.insights.length === 0 ? (
                <p className="p-4 text-sm text-txt-2">Nothing to flag right now.</p>
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
            <Card title="At risk" subtitle={`${data.atRisk.length} · nothing booked`}>
              {data.atRisk.length === 0 ? (
                <p className="p-4 text-sm text-txt-2">Nothing at risk right now.</p>
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
        title="Completed this month"
        subtitle={`${data.completedThisMonth.length} services · ${formatTZS(data.kpis.completedThisMonth.cost)}`}
      >
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left text-xs text-txt-3">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Vehicle</th>
                <th className="px-4 py-2 font-medium">Work</th>
                <th className="px-4 py-2 text-right font-medium">Odometer</th>
                <th className="px-4 py-2 text-right font-medium">Cost</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.completedThisMonth.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-txt-2">
                    No services completed yet this month.
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
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleting({ id: c.id, description: c.description })}
                        className="text-sm font-medium text-crit hover:underline"
                      >
                        Delete
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
            <p className="p-4 text-center text-sm text-txt-2">
              No services completed yet this month.
            </p>
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
                    Edit
                  </button>
                  <button
                    onClick={() => setDeleting({ id: c.id, description: c.description })}
                    className="text-sm font-medium text-crit hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      <ClosingRow
        left={
          <Card title="Maintenance spend by vehicle type" subtitle="this month">
            {data.spendByVehicleType.length === 0 ? (
              <p className="p-4 text-sm text-txt-2">No spend recorded this month.</p>
            ) : (
              <div className="divide-y divide-line-soft px-4">
                {data.spendByVehicleType.map((row) => (
                  <div
                    key={row.vehicleType}
                    className="flex items-center justify-between py-2.5 text-sm"
                  >
                    <span className="text-txt">{row.vehicleType.toLowerCase()}</span>
                    <span className="font-medium text-txt">{formatTZS(row.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        }
        right={
          <Card
            title="Repeat-visit vehicles"
            subtitle={`${data.repeatVisitVehicles.length} · rolling 45 days`}
          >
            {data.repeatVisitVehicles.length === 0 ? (
              <p className="p-4 text-sm text-txt-2">
                No vehicle has needed more than one visit recently.
              </p>
            ) : (
              <div className="divide-y divide-line-soft px-4">
                {data.repeatVisitVehicles.map((v) => (
                  <div
                    key={v.motorcycleId}
                    className="flex items-center justify-between py-2.5 text-sm"
                  >
                    <span className="text-txt">
                      {v.registrationNumber} · {v.visitCount} visits
                    </span>
                    <span className="font-medium text-crit">{formatTZS(v.totalSpend)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        }
      />

      <Card title="Manage older records" subtitle="edit or delete a service from any date range">
        <div className="flex flex-wrap items-end gap-3 border-b border-line-soft px-4 py-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-txt-3">From</label>
            <input
              type="date"
              value={manageFrom}
              max={manageTo}
              onChange={(e) => setManageFrom(e.target.value)}
              className="rounded border border-line bg-panel px-3 py-1.5 text-sm text-txt"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-txt-3">To</label>
            <input
              type="date"
              value={manageTo}
              min={manageFrom}
              onChange={(e) => setManageTo(e.target.value)}
              className="rounded border border-line bg-panel px-3 py-1.5 text-sm text-txt"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-txt-3">Vehicle</label>
            <select
              value={manageVehicle}
              onChange={(e) => setManageVehicle(e.target.value)}
              className="rounded border border-line bg-panel px-3 py-1.5 text-sm text-txt"
            >
              <option value="ALL">All</option>
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
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Vehicle</th>
                <th className="px-4 py-2 font-medium">Description</th>
                <th className="px-4 py-2 text-right font-medium">Cost</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {manageLogs === null ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-txt-2">
                    Loading…
                  </td>
                </tr>
              ) : manageLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-txt-2">
                    No maintenance in this period.
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
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleting({ id: m.id, description: m.description })}
                        className="text-sm font-medium text-crit hover:underline"
                      >
                        Delete
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
            <p className="p-4 text-center text-sm text-txt-2">Loading…</p>
          ) : manageLogs.length === 0 ? (
            <p className="p-4 text-center text-sm text-txt-2">No maintenance in this period.</p>
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
                    Edit
                  </button>
                  <button
                    onClick={() => setDeleting({ id: m.id, description: m.description })}
                    className="text-sm font-medium text-crit hover:underline"
                  >
                    Delete
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
          title="Delete service"
          message={`Delete the "${deleting.description}" service record? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => void handleDelete()}
          onCancel={() => setDeleting(null)}
        />
      )}
    </PageChassis>
  );
}
