import { useEffect, useMemo, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import type {
  CreateMaintenancePayload,
  MaintenanceLog,
  Motorcycle,
  UpdateMaintenancePayload,
} from '../lib/types';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { formatTZS, startOfThisMonth, today } from '../lib/format';

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
      setError('Please choose a motorcycle.');
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
            <label className="mb-1 block text-sm font-medium text-gray-700">Motorcycle</label>
            <select
              value={form.motorcycleId}
              onChange={(e) => setForm({ ...form, motorcycleId: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Choose a motorcycle…</option>
              {motorcycles.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.registrationNumber} (current {m.currentMileage.toLocaleString()} km)
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Description</label>
          <input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder="e.g. Oil change, brake pads"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Cost (TZS)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.cost}
              onChange={(e) => setForm({ ...form, cost: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Service date</label>
            <input
              type="date"
              value={form.performedAt}
              onChange={(e) => setForm({ ...form, performedAt: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Odometer at service (km) <span className="text-gray-400">(optional)</span>
          </label>
          <input
            type="number"
            min="0"
            value={form.mileageAtService}
            onChange={(e) => setForm({ ...form, mileageAtService: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder="Updates the bike's current mileage"
          />
        </div>
        <div className="rounded border border-gray-100 bg-gray-50 p-3">
          <p className="mb-2 text-xs font-medium text-gray-500">
            Next service reminder (optional) — you'll be emailed when either is near.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Next due date</label>
              <input
                type="date"
                value={form.nextServiceDate}
                onChange={(e) => setForm({ ...form, nextServiceDate: e.target.value })}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Next due mileage (km)
              </label>
              <input
                type="number"
                min="0"
                value={form.nextServiceMileage}
                onChange={(e) => setForm({ ...form, nextServiceMileage: e.target.value })}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
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
  const [logs, setLogs] = useState<MaintenanceLog[] | null>(null);
  const [motorcycles, setMotorcycles] = useState<Motorcycle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [from, setFrom] = useState<string>(startOfThisMonth());
  const [to, setTo] = useState<string>(today());
  const [motorcycleFilter, setMotorcycleFilter] = useState<string>('ALL');
  const [formTarget, setFormTarget] = useState<'new' | MaintenanceLog | null>(null);
  const [deleting, setDeleting] = useState<MaintenanceLog | null>(null);

  async function load() {
    setError(null);
    const params = new URLSearchParams({ from, to });
    if (motorcycleFilter !== 'ALL') {
      params.set('motorcycleId', motorcycleFilter);
    }
    try {
      const data = await apiFetch<MaintenanceLog[]>(`/maintenance?${params.toString()}`);
      setLogs(data);
    } catch {
      setError('Could not load maintenance records. Please try again.');
    }
  }

  async function loadMotorcycles() {
    try {
      setMotorcycles(await apiFetch<Motorcycle[]>('/motorcycles'));
    } catch {
      setMotorcycles([]);
    }
  }

  useEffect(() => {
    void loadMotorcycles();
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, motorcycleFilter]);

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
    void loadMotorcycles(); // odometer may have moved
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await apiFetch(`/maintenance/${deleting.id}`, { method: 'DELETE' });
      setSuccessMessage('Service deleted.');
      setDeleting(null);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete service.');
      setDeleting(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Maintenance</h1>
        <button
          onClick={() => setFormTarget('new')}
          className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
        >
          Log service
        </button>
      </div>

      {successMessage && (
        <p className="mb-4 rounded bg-green-50 px-3 py-2 text-sm text-green-700">
          {successMessage}
        </p>
      )}
      {error && <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">From</label>
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">To</label>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Motorcycle</label>
          <select
            value={motorcycleFilter}
            onChange={(e) => setMotorcycleFilter(e.target.value)}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm"
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

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Date</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Motorcycle</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Description</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Odometer</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Next service</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Cost</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {logs === null ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-gray-500">
                  No maintenance in this period.
                </td>
              </tr>
            ) : (
              logs.map((m) => {
                const nextParts: string[] = [];
                if (m.nextServiceDate) nextParts.push(m.nextServiceDate.slice(0, 10));
                if (m.nextServiceMileage != null)
                  nextParts.push(`${m.nextServiceMileage.toLocaleString()} km`);
                return (
                  <tr key={m.id}>
                    <td className="px-4 py-2 text-gray-600">{m.performedAt.slice(0, 10)}</td>
                    <td className="px-4 py-2 font-medium text-gray-900">
                      {regById.get(m.motorcycleId) ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-gray-600">{m.description}</td>
                    <td className="px-4 py-2 text-right text-gray-500">
                      {m.mileageAtService != null
                        ? `${m.mileageAtService.toLocaleString()} km`
                        : '—'}
                    </td>
                    <td className="px-4 py-2 text-gray-500">
                      {nextParts.length > 0 ? nextParts.join(' · ') : '—'}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-700">{formatTZS(m.cost)}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => setFormTarget(m)}
                        className="mr-3 text-sm font-medium text-gray-700 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleting(m)}
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

      {formTarget !== null && (
        <MaintenanceFormModal
          log={formTarget === 'new' ? null : formTarget}
          motorcycles={motorcycles}
          defaultMotorcycleId={motorcycleFilter !== 'ALL' ? motorcycleFilter : ''}
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
    </div>
  );
}
