import { useEffect, useMemo, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import type {
  CreateMotorcyclePayload,
  Motorcycle,
  MotorcycleStatus,
  UpdateMotorcyclePayload,
} from '../lib/types';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StatusBadge } from '../components/StatusBadge';

const STATUS_OPTIONS: MotorcycleStatus[] = ['ACTIVE', 'MAINTENANCE', 'RETIRED'];

interface FormState {
  registrationNumber: string;
  make: string;
  model: string;
  year: string;
  gpsDeviceId: string;
  status: MotorcycleStatus;
}

function toFormState(motorcycle: Motorcycle | null): FormState {
  return {
    registrationNumber: motorcycle?.registrationNumber ?? '',
    make: motorcycle?.make ?? '',
    model: motorcycle?.model ?? '',
    year: motorcycle?.year != null ? String(motorcycle.year) : '',
    gpsDeviceId: motorcycle?.gpsDeviceId ?? '',
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
          make: form.make.trim() || undefined,
          model: form.model.trim() || undefined,
          year: form.year ? Number(form.year) : undefined,
          gpsDeviceId: form.gpsDeviceId.trim() || undefined,
          status: form.status,
        };
        await apiFetch(`/motorcycles/${motorcycle.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        onSaved('Motorcycle updated.');
      } else {
        const payload: CreateMotorcyclePayload = {
          registrationNumber: form.registrationNumber.trim(),
          make: form.make.trim() || undefined,
          model: form.model.trim() || undefined,
          year: form.year ? Number(form.year) : undefined,
          gpsDeviceId: form.gpsDeviceId.trim() || undefined,
        };
        await apiFetch('/motorcycles', { method: 'POST', body: JSON.stringify(payload) });
        onSaved('Motorcycle added.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={isEdit ? 'Edit motorcycle' : 'Add motorcycle'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Registration number
          </label>
          <input
            value={form.registrationNumber}
            onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Make</label>
            <input
              value={form.make}
              onChange={(e) => setForm({ ...form, make: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Model</label>
            <input
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Year</label>
            <input
              type="number"
              value={form.year}
              onChange={(e) => setForm({ ...form, year: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">GPS device id</label>
            <input
              value={form.gpsDeviceId}
              onChange={(e) => setForm({ ...form, gpsDeviceId: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        {isEdit && (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Status</label>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as MotorcycleStatus })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
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

export function FleetPage() {
  const [motorcycles, setMotorcycles] = useState<Motorcycle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<MotorcycleStatus | 'ALL'>('ALL');
  const [formTarget, setFormTarget] = useState<'new' | Motorcycle | null>(null);
  const [deactivating, setDeactivating] = useState<Motorcycle | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function load() {
    try {
      const data = await apiFetch<Motorcycle[]>('/motorcycles');
      setMotorcycles(data);
    } catch {
      setError('Could not load motorcycles. Please try again.');
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

  const filtered = useMemo(() => {
    if (!motorcycles) return [];
    return motorcycles.filter((m) => {
      const matchesStatus = statusFilter === 'ALL' || m.status === statusFilter;
      const matchesSearch =
        !search.trim() || m.registrationNumber.toLowerCase().includes(search.trim().toLowerCase());
      return matchesStatus && matchesSearch;
    });
  }, [motorcycles, search, statusFilter]);

  function handleSaved(message: string) {
    setFormTarget(null);
    setSuccessMessage(message);
    void load();
  }

  async function handleDeactivate() {
    if (!deactivating) return;
    try {
      await apiFetch(`/motorcycles/${deactivating.id}`, { method: 'DELETE' });
      setSuccessMessage('Motorcycle deactivated.');
      setDeactivating(null);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not deactivate motorcycle.');
      setDeactivating(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Fleet</h1>
        <button
          onClick={() => setFormTarget('new')}
          className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
        >
          Add motorcycle
        </button>
      </div>

      {successMessage && (
        <p className="mb-4 rounded bg-green-50 px-3 py-2 text-sm text-green-700">
          {successMessage}
        </p>
      )}
      {error && <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      <div className="mb-4 flex gap-3">
        <input
          placeholder="Search registration number…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 rounded border border-gray-300 px-3 py-1.5 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as MotorcycleStatus | 'ALL')}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="ALL">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Registration</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Make/Model</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Year</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Status</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">GPS device</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {motorcycles === null ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  No motorcycles found.
                </td>
              </tr>
            ) : (
              filtered.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-2 font-medium text-gray-900">{m.registrationNumber}</td>
                  <td className="px-4 py-2 text-gray-600">
                    {[m.make, m.model].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td className="px-4 py-2 text-gray-600">{m.year ?? '—'}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={m.status} />
                  </td>
                  <td className="px-4 py-2 text-gray-600">{m.gpsDeviceId ?? '—'}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => setFormTarget(m)}
                      className="mr-3 text-sm font-medium text-gray-700 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeactivating(m)}
                      className="text-sm font-medium text-red-600 hover:underline"
                    >
                      Deactivate
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {formTarget && (
        <MotorcycleFormModal
          motorcycle={formTarget === 'new' ? null : formTarget}
          onClose={() => setFormTarget(null)}
          onSaved={handleSaved}
        />
      )}

      {deactivating && (
        <ConfirmDialog
          title="Deactivate motorcycle"
          message={`Deactivate ${deactivating.registrationNumber}? It will be hidden from the fleet list, but its history is kept.`}
          confirmLabel="Deactivate"
          danger
          onConfirm={handleDeactivate}
          onCancel={() => setDeactivating(null)}
        />
      )}
    </div>
  );
}
