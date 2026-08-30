import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api';
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
import { PageChassis } from '../components/chassis/PageChassis';
import { ChassisGrid, ClosingRow } from '../components/chassis/ChassisGrid';
import { Card } from '../components/chassis/Card';
import type { KpiTile } from '../components/chassis/KpiRail';

const STATUS_OPTIONS: TransportJobStatus[] = ['SCHEDULED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'];
const STATUS_LABELS: Record<TransportJobStatus, string> = {
  SCHEDULED: 'Scheduled',
  IN_TRANSIT: 'In transit',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

interface DriverOption {
  id: string;
  user: { firstName: string; lastName: string };
}

function kpisToTiles(data: TransportOperationsResponse): KpiTile[] {
  const k = data.kpis;
  const net = parseFloat(k.netThisMonth.amount);
  return [
    {
      label: 'Trucks and cars',
      value: String(k.fleetCount.count),
      delta: `${k.fleetCount.trucks} trucks · ${k.fleetCount.cars} cars`,
      accentColor: 'c1',
    },
    {
      label: 'Trips this month',
      value: String(k.tripsThisMonth.count),
      delta: `${k.tripsThisMonth.inTransitNow} in transit now`,
      accentColor: 'c1',
    },
    {
      label: 'Revenue',
      value: formatTZS(k.revenueThisMonth.amount),
      delta: `${k.revenueThisMonth.percentOfAllRevenue}% of all revenue`,
      accentColor: 'good',
    },
    {
      label: 'Costs',
      value: formatTZS(k.costsThisMonth.amount),
      delta: `${k.costsThisMonth.percentFuel}% of it fuel`,
      accentColor: 'warn',
    },
    {
      label: 'Net',
      value: formatTZS(k.netThisMonth.amount),
      delta: `${formatTZS(k.netThisMonth.perVehicleAverage)} per vehicle`,
      accentColor: 'violet',
    },
    {
      label: 'Margin',
      value: `${k.marginThisMonth.percent}%`,
      delta:
        k.marginThisMonth.vsMotorbikeMarginPercent === null
          ? undefined
          : `vs ${k.marginThisMonth.vsMotorbikeMarginPercent}% on motorbikes`,
      accentColor: net >= 0 ? 'good' : 'crit',
    },
  ];
}

function InTransitCard({ job }: { job: TransportOperationsResponse['inTransitJob'] }) {
  if (!job) {
    return (
      <Card title="In transit now">
        <p className="p-4 text-sm text-txt-2">No job is currently in transit.</p>
      </Card>
    );
  }
  const hoursElapsed = (job.progress.elapsedMs / 3_600_000).toFixed(1);
  return (
    <Card title="In transit now" subtitle={job.reference ?? undefined}>
      <div className="px-4 pb-4">
        <p className="text-base font-semibold text-txt">
          {job.origin} → {job.destination}
        </p>
        <p className="text-xs text-txt-2">
          {job.registrationNumber} · {job.driverName ?? 'owner-driven'}
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
                <b className="text-txt">{job.progress.kmCovered.toFixed(0)} km</b> covered
              </span>
              <span>
                <b className="text-txt">{job.progress.kmRemaining.toFixed(0)} km</b> to go
              </span>
            </div>
          </>
        ) : (
          <p className="mt-3 text-xs text-txt-2">
            No expected distance was set for this job - showing elapsed time and last position only,
            never an invented ETA.
          </p>
        )}
        <p className="mt-2 text-xs text-txt-2">
          {hoursElapsed}h since pickup
          {job.progress.lastPosition
            ? ` · last position ${formatDateTime(job.progress.lastPosition.recordedAt)}`
            : ' · no GPS fix received yet'}
        </p>
      </div>
    </Card>
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
  revenue: string;
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
    revenue: job?.revenue ?? '',
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
  const isEdit = job != null;
  const [form, setForm] = useState<JobFormState>(() => toJobForm(job, vehicles));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.motorcycleId) return setError('Pick a vehicle.');
    if (!form.origin.trim() || !form.destination.trim())
      return setError('Origin and destination are required.');
    const revenue = Number(form.revenue);
    if (!form.revenue || Number.isNaN(revenue) || revenue <= 0)
      return setError('Enter a positive revenue.');
    const expectedDistanceKm = form.expectedDistanceKm ? Number(form.expectedDistanceKm) : null;
    if (
      form.expectedDistanceKm &&
      (Number.isNaN(expectedDistanceKm) || (expectedDistanceKm ?? 0) <= 0)
    ) {
      return setError('Expected distance must be a positive number of km.');
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
          revenue,
          scheduledDate: form.scheduledDate,
          expectedDistanceKm,
        };
        await apiFetch(`/transport-jobs/${job.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        onSaved('Transport job updated.');
      } else {
        const payload: CreateTransportJobPayload = {
          motorcycleId: form.motorcycleId,
          ownerDriven: form.ownerDriven,
          driverId: form.ownerDriven ? undefined : form.driverId || undefined,
          origin: form.origin.trim(),
          destination: form.destination.trim(),
          cargo: form.cargo.trim() || undefined,
          revenue,
          scheduledDate: form.scheduledDate,
          expectedDistanceKm,
        };
        await apiFetch('/transport-jobs', { method: 'POST', body: JSON.stringify(payload) });
        onSaved('Transport job created.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={isEdit ? 'Edit transport job' : 'New transport job'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {!isEdit && (
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">Vehicle</label>
            <select
              value={form.motorcycleId}
              onChange={(e) => setForm({ ...form, motorcycleId: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            >
              <option value="">Select a vehicle…</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.registrationNumber} ({v.vehicleType.toLowerCase()})
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">Origin</label>
            <input
              value={form.origin}
              onChange={(e) => setForm({ ...form, origin: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">Destination</label>
            <input
              value={form.destination}
              onChange={(e) => setForm({ ...form, destination: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-txt">Cargo / description</label>
          <input
            value={form.cargo}
            onChange={(e) => setForm({ ...form, cargo: e.target.value })}
            placeholder="e.g. 20 bags of cement, or a Toyota Vitz"
            className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">Revenue (TZS)</label>
            <input
              type="number"
              value={form.revenue}
              onChange={(e) => setForm({ ...form, revenue: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">Scheduled date</label>
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
            Expected distance (km) <span className="text-txt-2">(optional)</span>
          </label>
          <input
            type="number"
            min="0"
            step="0.1"
            value={form.expectedDistanceKm}
            onChange={(e) => setForm({ ...form, expectedDistanceKm: e.target.value })}
            className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-gray-500">
            Set this to show real progress while the job is in transit. Leave it blank and the map
            card will show elapsed time and last position only - never a guessed ETA.
          </p>
        </div>
        <div>
          <label className="mb-1 flex items-center gap-2 text-sm font-medium text-txt">
            <input
              type="checkbox"
              checked={form.ownerDriven}
              onChange={(e) => setForm({ ...form, ownerDriven: e.target.checked })}
            />
            Owner-driven (no assigned driver)
          </label>
          {!form.ownerDriven && (
            <select
              value={form.driverId}
              onChange={(e) => setForm({ ...form, driverId: e.target.value })}
              className="mt-1 w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            >
              <option value="">Driver (optional)…</option>
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

function LogExpenseModal({
  job,
  onClose,
  onSaved,
}: {
  job: TransportJob;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
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
    if (!amount || Number.isNaN(value) || value <= 0) return setError('Enter a positive amount.');
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
      onSaved('Expense logged against the job.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not log the expense.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Log expense — ${job.origin} → ${job.destination}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">Category</label>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Fuel, Driver, Repairs…"
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">Amount (TZS)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-txt">Date</label>
          <input
            type="date"
            value={incurredAt}
            onChange={(e) => setIncurredAt(e.target.value)}
            className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-txt">Description (optional)</label>
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
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Log expense'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function TransportPage() {
  const [data, setData] = useState<TransportOperationsResponse | null>(null);
  const [vehicles, setVehicles] = useState<Motorcycle[]>([]);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [jobsById, setJobsById] = useState<Map<string, TransportJob>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [formTarget, setFormTarget] = useState<'new' | TransportJob | null>(null);
  const [expenseTarget, setExpenseTarget] = useState<TransportJob | null>(null);
  const [deleting, setDeleting] = useState<TransportJob | null>(null);

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
      setError(err instanceof ApiError ? err.message : 'Could not load transport operations.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 4000);
    return () => clearTimeout(t);
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
      setSuccess('Status updated.');
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update status.');
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await apiFetch(`/transport-jobs/${deleting.id}`, { method: 'DELETE' });
      setSuccess('Transport job deleted.');
      setDeleting(null);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the job.');
      setDeleting(null);
    }
  }

  if (error && !data) {
    return <p className="text-sm text-crit">{error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-txt-2">Loading…</p>;
  }

  return (
    <PageChassis
      title="Transport"
      statusPill={{
        mode: 'live',
        text: data.inTransitJob ? 'LIVE · 1 job in transit' : 'LIVE · 0 jobs in transit',
      }}
      primaryAction={{ label: 'New job', onClick: () => setFormTarget('new') }}
      kpis={kpisToTiles(data)}
    >
      {success && <p className="rounded bg-good-d px-3 py-2 text-sm text-good-x">{success}</p>}
      {error && <p className="rounded bg-crit-d px-3 py-2 text-sm text-crit-x">{error}</p>}

      <ChassisGrid
        main={
          <>
            <Card
              title="Per vehicle, this month"
              subtitle="ranked - the sell decision falls out of the ranking"
            >
              {data.perVehicleThisMonth.length === 0 ? (
                <p className="p-4 text-sm text-txt-2">No transport jobs this month.</p>
              ) : (
                <>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-line-soft text-left text-xs text-txt-3">
                          <th className="px-4 py-2 font-medium">Vehicle</th>
                          <th className="px-4 py-2 text-right font-medium">Trips</th>
                          <th className="px-4 py-2 text-right font-medium">Revenue</th>
                          <th className="px-4 py-2 text-right font-medium">Expenses</th>
                          <th className="px-4 py-2 text-right font-medium">Net</th>
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
                          <span className="text-txt-2">{v.jobCount} trips</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-sm">
                          <span className="text-txt-2">
                            Revenue {formatTZS(v.revenue)} · Expenses {formatTZS(v.expenses)}
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
            <Card title="AI Insight">
              {data.marginDeclineFlag ? (
                <div className="p-4">
                  <p className="text-sm font-medium text-txt">
                    {data.marginDeclineFlag.registrationNumber}: margin fell to{' '}
                    {data.marginDeclineFlag.currentMarginPercent}%
                  </p>
                  <p className="mt-1 text-xs text-txt-2">
                    Averaged {data.marginDeclineFlag.priorAverageMarginPercent}% over the prior{' '}
                    {data.marginDeclineFlag.priorMonthCount} months.
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
                <p className="p-4 text-sm text-txt-2">Nothing to flag right now.</p>
              )}
            </Card>
            <Card
              title="Transport alerts"
              subtitle={data.alerts.length > 0 ? String(data.alerts.length) : undefined}
            >
              {data.alerts.length === 0 ? (
                <p className="p-4 text-sm text-txt-2">Nothing needs attention right now.</p>
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

      <Card title="Trips this month" subtitle={`${data.tripsThisMonth.length} trips`}>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left text-xs text-txt-3">
                <th className="px-4 py-2 font-medium">Reference</th>
                <th className="px-4 py-2 font-medium">Route</th>
                <th className="px-4 py-2 font-medium">Vehicle</th>
                <th className="px-4 py-2 text-right font-medium">Revenue</th>
                <th className="px-4 py-2 text-right font-medium">Cost</th>
                <th className="px-4 py-2 text-right font-medium">Profit</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.tripsThisMonth.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-txt-2">
                    No trips yet this month.
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
                                {STATUS_LABELS[s]}
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
                              + Expense
                            </button>
                            <button
                              onClick={() => setFormTarget(job)}
                              className="mr-3 text-sm font-medium text-c1 hover:underline"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => setDeleting(job)}
                              className="text-sm font-medium text-crit hover:underline"
                            >
                              Delete
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
            <p className="p-4 text-center text-sm text-txt-2">No trips yet this month.</p>
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
                      Revenue {formatTZS(trip.revenue)} · Cost {formatTZS(trip.expensesTotal)}
                    </span>
                    <span className={`font-medium ${net >= 0 ? 'text-good' : 'text-crit'}`}>
                      {formatTZS(trip.netProfit)}
                    </span>
                  </div>
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
                            {STATUS_LABELS[s]}
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
                        + Expense
                      </button>
                      <button
                        onClick={() => setFormTarget(job)}
                        className="text-sm font-medium text-c1 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleting(job)}
                        className="text-sm font-medium text-crit hover:underline"
                      >
                        Delete
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
              title={`${data.marginDeclineFlag.registrationNumber} — margin trend`}
              subtitle="over recent months"
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
            <Card title="Margin trend" subtitle="no decline flagged">
              <p className="p-4 text-sm text-txt-2">
                No vehicle has a flagged margin decline right now.
              </p>
            </Card>
          )
        }
        right={
          <Card title="Where transport margin goes" subtitle="per shilling earned">
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
                  <span>Fuel</span>
                  <span className="text-txt">
                    {data.marginSplit.fuelPercent}% · {formatTZS(data.marginSplit.fuel)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Other costs</span>
                  <span className="text-txt">
                    {data.marginSplit.otherPercent}% · {formatTZS(data.marginSplit.other)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Kept as profit</span>
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
          title="Delete transport job"
          message={`Delete the job ${deleting.origin} → ${deleting.destination}? This can't be undone. (Jobs with expenses can't be deleted.)`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </PageChassis>
  );
}
