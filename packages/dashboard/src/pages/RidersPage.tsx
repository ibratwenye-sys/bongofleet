import { useEffect, useMemo, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import type { CreateRiderPayload, Rider, UpdateRiderPayload } from '../lib/types';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';

interface FormState {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  licenseNumber: string;
  initialPassword: string;
  nationalId: string;
  emergencyContact: string;
}

function toFormState(rider: Rider | null): FormState {
  return {
    firstName: rider?.user.firstName ?? '',
    lastName: rider?.user.lastName ?? '',
    phone: rider?.user.phone ?? '',
    email: rider?.user.email ?? '',
    licenseNumber: rider?.licenseNumber ?? '',
    initialPassword: '',
    nationalId: rider?.nationalId ?? '',
    emergencyContact: rider?.emergencyContact ?? '',
  };
}

function RiderFormModal({
  rider,
  onClose,
  onSaved,
}: {
  rider: Rider | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isEdit = rider != null;
  const [form, setForm] = useState<FormState>(() => toFormState(rider));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): string | null {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.phone.trim()) {
      return 'First name, last name, and phone are required.';
    }
    if (!form.licenseNumber.trim()) {
      return 'License number is required.';
    }
    if (!isEdit) {
      if (!form.email.trim() || !/^\S+@\S+\.\S+$/.test(form.email.trim())) {
        return 'A valid email is required.';
      }
      if (form.initialPassword.length < 8) {
        return 'Initial password must be at least 8 characters.';
      }
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      if (isEdit) {
        const payload: UpdateRiderPayload = {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          phone: form.phone.trim(),
          licenseNumber: form.licenseNumber.trim(),
          nationalId: form.nationalId.trim() || undefined,
          emergencyContact: form.emergencyContact.trim() || undefined,
        };
        await apiFetch(`/riders/${rider.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        onSaved('Rider updated.');
      } else {
        const payload: CreateRiderPayload = {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          licenseNumber: form.licenseNumber.trim(),
          initialPassword: form.initialPassword,
          nationalId: form.nationalId.trim() || undefined,
          emergencyContact: form.emergencyContact.trim() || undefined,
        };
        await apiFetch('/riders', { method: 'POST', body: JSON.stringify(payload) });
        onSaved('Rider added.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={isEdit ? 'Edit rider' : 'Add rider'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">First name</label>
            <input
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Last name</label>
            <input
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Phone</label>
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
          {isEdit ? (
            <p className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500">
              {form.email} <span className="text-xs">(cannot be changed here)</span>
            </p>
          ) : (
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          )}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">License number</label>
          <input
            value={form.licenseNumber}
            onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        {!isEdit && (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Initial password</label>
            <input
              type="password"
              value={form.initialPassword}
              onChange={(e) => setForm({ ...form, initialPassword: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              This is the rider's first login password — share it with them directly. At least 8
              characters.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              National ID (optional)
            </label>
            <input
              value={form.nationalId}
              onChange={(e) => setForm({ ...form, nationalId: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Emergency contact (optional)
            </label>
            <input
              value={form.emergencyContact}
              onChange={(e) => setForm({ ...form, emergencyContact: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
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

export function RidersPage() {
  const [riders, setRiders] = useState<Rider[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [formTarget, setFormTarget] = useState<'new' | Rider | null>(null);
  const [deactivating, setDeactivating] = useState<Rider | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function load() {
    try {
      const data = await apiFetch<Rider[]>('/riders');
      setRiders(data);
    } catch {
      setError('Could not load riders. Please try again.');
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
    if (!riders) return [];
    const term = search.trim().toLowerCase();
    if (!term) return riders;
    return riders.filter((r) => {
      const name = `${r.user.firstName} ${r.user.lastName}`.toLowerCase();
      return name.includes(term) || r.licenseNumber.toLowerCase().includes(term);
    });
  }, [riders, search]);

  function handleSaved(message: string) {
    setFormTarget(null);
    setSuccessMessage(message);
    void load();
  }

  async function handleDeactivate() {
    if (!deactivating) return;
    try {
      await apiFetch(`/riders/${deactivating.id}`, { method: 'DELETE' });
      setSuccessMessage('Rider deactivated - they can no longer log in.');
      setDeactivating(null);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not deactivate rider.');
      setDeactivating(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Riders</h1>
        <button
          onClick={() => setFormTarget('new')}
          className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
        >
          Add rider
        </button>
      </div>

      {successMessage && (
        <p className="mb-4 rounded bg-green-50 px-3 py-2 text-sm text-green-700">
          {successMessage}
        </p>
      )}
      {error && <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      <div className="mb-4">
        <input
          placeholder="Search name or license number…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 rounded border border-gray-300 px-3 py-1.5 text-sm"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Name</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Phone</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Email</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">License</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">National ID</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {riders === null ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  No riders found.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 font-medium text-gray-900">
                    {r.user.firstName} {r.user.lastName}
                  </td>
                  <td className="px-4 py-2 text-gray-600">{r.user.phone}</td>
                  <td className="px-4 py-2 text-gray-600">{r.user.email}</td>
                  <td className="px-4 py-2 text-gray-600">{r.licenseNumber}</td>
                  <td className="px-4 py-2 text-gray-600">{r.nationalId ?? '—'}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => setFormTarget(r)}
                      className="mr-3 text-sm font-medium text-gray-700 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeactivating(r)}
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
        <RiderFormModal
          rider={formTarget === 'new' ? null : formTarget}
          onClose={() => setFormTarget(null)}
          onSaved={handleSaved}
        />
      )}

      {deactivating && (
        <ConfirmDialog
          title="Deactivate rider"
          message={`Deactivate ${deactivating.user.firstName} ${deactivating.user.lastName}? They will immediately lose the ability to log in. Their assignment/payment history is kept.`}
          confirmLabel="Deactivate"
          danger
          onConfirm={handleDeactivate}
          onCancel={() => setDeactivating(null)}
        />
      )}
    </div>
  );
}
