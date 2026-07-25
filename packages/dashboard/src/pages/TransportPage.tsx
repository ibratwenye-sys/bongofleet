import { useEffect, useMemo, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import type {
  CreateTransportJobPayload,
  Motorcycle,
  TransportJob,
  TransportJobStatus,
  UpdateTransportJobPayload,
  VehicleTransportSummary,
} from '../lib/types';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';

const STATUS_OPTIONS: TransportJobStatus[] = ['SCHEDULED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'];
const STATUS_LABELS: Record<TransportJobStatus, string> = {
  SCHEDULED: 'Scheduled',
  IN_TRANSIT: 'In transit',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

function tzs(value: string | number): string {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return `TZS ${Math.round(Number.isFinite(n) ? n : 0).toLocaleString()}`;
}

interface RiderOption {
  id: string;
  user: { firstName: string; lastName: string };
}

// ---- Create / edit job modal ----

interface JobFormState {
  motorcycleId: string;
  ownerDriven: boolean;
  riderId: string;
  origin: string;
  destination: string;
  cargo: string;
  revenue: string;
  scheduledDate: string;
}

function toJobForm(job: TransportJob | null, vehicles: Motorcycle[]): JobFormState {
  const firstTransport =
    vehicles.find((v) => v.vehicleType === 'CAR' || v.vehicleType === 'TRUCK') ?? vehicles[0];
  return {
    motorcycleId: job?.motorcycleId ?? firstTransport?.id ?? '',
    ownerDriven: job?.ownerDriven ?? false,
    riderId: job?.riderId ?? '',
    origin: job?.origin ?? '',
    destination: job?.destination ?? '',
    cargo: job?.cargo ?? '',
    revenue: job?.revenue ?? '',
    scheduledDate: job?.scheduledDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  };
}

function JobFormModal({
  job,
  vehicles,
  riders,
  onClose,
  onSaved,
}: {
  job: TransportJob | null;
  vehicles: Motorcycle[];
  riders: RiderOption[];
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

    setSubmitting(true);
    try {
      if (isEdit) {
        const payload: UpdateTransportJobPayload = {
          ownerDriven: form.ownerDriven,
          riderId: form.ownerDriven ? undefined : form.riderId || undefined,
          origin: form.origin.trim(),
          destination: form.destination.trim(),
          cargo: form.cargo.trim() || undefined,
          revenue,
          scheduledDate: form.scheduledDate,
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
          riderId: form.ownerDriven ? undefined : form.riderId || undefined,
          origin: form.origin.trim(),
          destination: form.destination.trim(),
          cargo: form.cargo.trim() || undefined,
          revenue,
          scheduledDate: form.scheduledDate,
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
            <label className="mb-1 block text-sm font-medium text-gray-700">Vehicle</label>
            <select
              value={form.motorcycleId}
              onChange={(e) => setForm({ ...form, motorcycleId: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
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
            <label className="mb-1 block text-sm font-medium text-gray-700">Origin</label>
            <input
              value={form.origin}
              onChange={(e) => setForm({ ...form, origin: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Destination</label>
            <input
              value={form.destination}
              onChange={(e) => setForm({ ...form, destination: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Cargo / description
          </label>
          <input
            value={form.cargo}
            onChange={(e) => setForm({ ...form, cargo: e.target.value })}
            placeholder="e.g. 20 bags of cement, or a Toyota Vitz"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Revenue (TZS)</label>
            <input
              type="number"
              value={form.revenue}
              onChange={(e) => setForm({ ...form, revenue: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Scheduled date</label>
            <input
              type="date"
              value={form.scheduledDate}
              onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={form.ownerDriven}
              onChange={(e) => setForm({ ...form, ownerDriven: e.target.checked })}
            />
            Owner-driven (no assigned driver)
          </label>
          {!form.ownerDriven && (
            <select
              value={form.riderId}
              onChange={(e) => setForm({ ...form, riderId: e.target.value })}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Driver (optional)…</option>
              {riders.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.user.firstName} {r.user.lastName}
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

// ---- Log expense against a job ----

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
            <label className="mb-1 block text-sm font-medium text-gray-700">Category</label>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Fuel, Driver, Repairs…"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Amount (TZS)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Date</label>
          <input
            type="date"
            value={incurredAt}
            onChange={(e) => setIncurredAt(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Description (optional)
          </label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
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

// ---- Page ----

export function TransportPage() {
  const [jobs, setJobs] = useState<TransportJob[] | null>(null);
  const [summary, setSummary] = useState<VehicleTransportSummary[]>([]);
  const [vehicles, setVehicles] = useState<Motorcycle[]>([]);
  const [riders, setRiders] = useState<RiderOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [formTarget, setFormTarget] = useState<'new' | TransportJob | null>(null);
  const [expenseTarget, setExpenseTarget] = useState<TransportJob | null>(null);
  const [deleting, setDeleting] = useState<TransportJob | null>(null);

  async function load() {
    try {
      const [jobList, summaryList, vehicleList, riderList] = await Promise.all([
        apiFetch<TransportJob[]>('/transport-jobs'),
        apiFetch<VehicleTransportSummary[]>('/transport-jobs/summary'),
        apiFetch<Motorcycle[]>('/motorcycles'),
        apiFetch<RiderOption[]>('/riders'),
      ]);
      setJobs(jobList);
      setSummary(summaryList);
      setVehicles(vehicleList);
      setRiders(riderList);
    } catch {
      setError('Could not load transport jobs. Please try again.');
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

  const totals = useMemo(() => {
    return summary.reduce(
      (acc, v) => ({
        revenue: acc.revenue + parseFloat(v.revenue),
        expenses: acc.expenses + parseFloat(v.expenses),
        net: acc.net + parseFloat(v.netProfit),
      }),
      { revenue: 0, expenses: 0, net: 0 },
    );
  }, [summary]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Transport</h1>
        <button
          onClick={() => setFormTarget('new')}
          className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
        >
          New transport job
        </button>
      </div>

      {success && (
        <p className="mb-4 rounded bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p>
      )}
      {error && <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      {/* Per-vehicle cost-benefit summary */}
      {summary.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Profit / loss by vehicle</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {summary.map((v) => {
              const net = parseFloat(v.netProfit);
              const loss = net < 0;
              return (
                <div
                  key={v.motorcycleId}
                  className={`rounded-lg border bg-white p-4 ${loss ? 'border-red-300' : 'border-gray-200'}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900">{v.registrationNumber}</span>
                    <span className="text-xs text-gray-500">
                      {v.vehicleType?.toLowerCase()} · {v.jobCount} job{v.jobCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="mt-2 flex justify-between text-sm">
                    <span className="text-gray-500">Revenue</span>
                    <span className="text-gray-800">{tzs(v.revenue)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Expenses</span>
                    <span className="text-gray-800">{tzs(v.expenses)}</span>
                  </div>
                  <div className="mt-1 flex justify-between border-t border-gray-100 pt-1 text-sm font-semibold">
                    <span className="text-gray-600">{loss ? 'Loss' : 'Profit'}</span>
                    <span className={loss ? 'text-red-600' : 'text-green-700'}>
                      {tzs(v.netProfit)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-sm text-gray-600">
            Overall: {tzs(totals.revenue)} revenue − {tzs(totals.expenses)} expenses ={' '}
            <span
              className={
                totals.net < 0 ? 'font-semibold text-red-600' : 'font-semibold text-green-700'
              }
            >
              {tzs(totals.net)}
            </span>
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Route</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Vehicle</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Driver</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Revenue</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Expenses</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Net</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Status</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {jobs === null ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : jobs.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-gray-500">
                  No transport jobs yet. Create one to start tracking a car or truck.
                </td>
              </tr>
            ) : (
              jobs.map((job) => {
                const net = parseFloat(job.netProfit);
                return (
                  <tr key={job.id}>
                    <td className="px-4 py-2">
                      <div className="font-medium text-gray-900">
                        {job.origin} → {job.destination}
                      </div>
                      <div className="text-xs text-gray-500">
                        {job.scheduledDate.slice(0, 10)}
                        {job.reference ? ` · ${job.reference}` : ''}
                        {job.cargo ? ` · ${job.cargo}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {job.motorcycle?.registrationNumber ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {job.ownerDriven
                        ? 'Owner-driven'
                        : job.rider
                          ? `${job.rider.user.firstName} ${job.rider.user.lastName}`
                          : '—'}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-800">{tzs(job.revenue)}</td>
                    <td className="px-4 py-2 text-right text-gray-800">{tzs(job.expensesTotal)}</td>
                    <td
                      className={`px-4 py-2 text-right font-semibold ${net < 0 ? 'text-red-600' : 'text-green-700'}`}
                    >
                      {tzs(job.netProfit)}
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={job.status}
                        onChange={(e) =>
                          void changeStatus(job, e.target.value as TransportJobStatus)
                        }
                        className="rounded border border-gray-300 px-2 py-1 text-xs"
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => setExpenseTarget(job)}
                        className="mr-3 text-sm font-medium text-blue-600 hover:underline"
                      >
                        + Expense
                      </button>
                      <button
                        onClick={() => setFormTarget(job)}
                        className="mr-3 text-sm font-medium text-gray-700 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleting(job)}
                        className="text-sm font-medium text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {formTarget && (
        <JobFormModal
          job={formTarget === 'new' ? null : formTarget}
          vehicles={vehicles}
          riders={riders}
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
    </div>
  );
}
