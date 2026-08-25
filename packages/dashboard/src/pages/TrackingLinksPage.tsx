import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth-context';
import { apiFetch, ApiError } from '../lib/api';
import type { CreateTrackingLinkPayload, Motorcycle, TrackingLink } from '../lib/types';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StatusBadge, TRACKING_LINK_STATUS_STYLES } from '../components/StatusBadge';
import { formatDateTime, toDateInput } from '../lib/format';

function sevenDaysFromNow(): string {
  return toDateInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
}

function publicUrl(token: string): string {
  return `${window.location.origin}/track/${token}`;
}

interface CreateFormState {
  motorcycleId: string; // '' = whole fleet
  label: string;
  expiryDate: string; // YYYY-MM-DD, ignored when neverExpires is checked
  neverExpires: boolean;
}

function CreateLinkModal({
  motorcycles,
  onClose,
  onSaved,
}: {
  motorcycles: Motorcycle[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState<CreateFormState>({
    motorcycleId: '',
    label: '',
    expiryDate: sevenDaysFromNow(),
    neverExpires: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.label.trim()) return setError('Give the link a label.');
    if (!form.neverExpires && Number.isNaN(new Date(form.expiryDate).getTime())) {
      return setError('Pick a valid expiry date, or check "Never expires".');
    }

    setSubmitting(true);
    try {
      const payload: CreateTrackingLinkPayload = {
        motorcycleId: form.motorcycleId || undefined,
        label: form.label.trim(),
        expiresAt: form.neverExpires ? null : new Date(form.expiryDate).toISOString(),
      };
      await apiFetch('/tracking-links', { method: 'POST', body: JSON.stringify(payload) });
      onSaved('Tracking link created.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="New tracking link" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Vehicle</label>
          <select
            value={form.motorcycleId}
            onChange={(e) => setForm({ ...form, motorcycleId: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">Whole fleet</option>
            {motorcycles.map((m) => (
              <option key={m.id} value={m.id}>
                {m.registrationNumber}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Label</label>
          <input
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder="e.g. Truck T203 - Mombasa delivery"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Expires</label>
          <input
            type="date"
            value={form.expiryDate}
            min={toDateInput(new Date())}
            disabled={form.neverExpires}
            onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-400"
          />
          <label className="mt-2 flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={form.neverExpires}
              onChange={(e) => setForm({ ...form, neverExpires: e.target.checked })}
            />
            Never expires
          </label>
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
            {submitting ? 'Creating…' : 'Create link'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function TrackingLinksPage() {
  const { user } = useAuth();
  const [links, setLinks] = useState<TrackingLink[] | null>(null);
  const [motorcycles, setMotorcycles] = useState<Motorcycle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<TrackingLink | null>(null);

  async function load() {
    setError(null);
    try {
      const data = await apiFetch<TrackingLink[]>('/tracking-links');
      setLinks(data);
    } catch {
      setError('Could not load tracking links. Please try again.');
    }
  }

  useEffect(() => {
    apiFetch<Motorcycle[]>('/motorcycles')
      .then(setMotorcycles)
      .catch(() => setMotorcycles([]));
    void load();
  }, []);

  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  const regById = new Map(motorcycles.map((m) => [m.id, m.registrationNumber]));

  function handleSaved(message: string) {
    setCreating(false);
    setSuccessMessage(message);
    void load();
  }

  async function handleCopy(token: string) {
    try {
      await navigator.clipboard.writeText(publicUrl(token));
      setSuccessMessage('Link copied to clipboard.');
    } catch {
      setError('Could not copy the link - your browser may be blocking clipboard access.');
    }
  }

  async function handleRevoke() {
    if (!revoking) return;
    try {
      await apiFetch(`/tracking-links/${revoking.id}/revoke`, { method: 'PATCH' });
      setSuccessMessage('Tracking link revoked.');
      setRevoking(null);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not revoke the link.');
      setRevoking(null);
    }
  }

  // Stage I2 - same OWNER-or-MANAGER gate as the backend's
  // TrackingLinkController; the nav link is already hidden for other roles
  // (AppShell.tsx), this covers a direct navigation to the URL.
  if (user && user.role !== 'OWNER' && user.role !== 'MANAGER') {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600 shadow-sm">
        Only the fleet owner or a manager can view tracking links.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Tracking links</h1>
        <button
          onClick={() => setCreating(true)}
          className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
        >
          New link
        </button>
      </div>

      <p className="mb-4 text-sm text-gray-500">
        Shareable, no-login-required links for checking a vehicle's position - hand one to a
        customer watching a delivery, or keep one for yourself on your phone.
      </p>

      {successMessage && (
        <p className="mb-4 rounded bg-green-50 px-3 py-2 text-sm text-green-700">
          {successMessage}
        </p>
      )}
      {error && <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Label</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Vehicle</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Status</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Views</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Last viewed</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {links === null ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : links.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  No tracking links yet.
                </td>
              </tr>
            ) : (
              links.map((link) => (
                <tr key={link.id}>
                  <td className="px-4 py-2 font-medium text-gray-900">{link.label}</td>
                  <td className="px-4 py-2 text-gray-600">
                    {link.motorcycleId ? (regById.get(link.motorcycleId) ?? '—') : 'Whole fleet'}
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={link.status} styles={TRACKING_LINK_STATUS_STYLES} />
                  </td>
                  <td className="px-4 py-2 text-right text-gray-700">{link.viewCount}</td>
                  <td className="px-4 py-2 text-gray-500">
                    {link.lastViewedAt ? formatDateTime(link.lastViewedAt) : 'Never'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => void handleCopy(link.token)}
                      className="mr-3 text-sm font-medium text-gray-700 hover:underline"
                    >
                      Copy link
                    </button>
                    {link.status !== 'REVOKED' && (
                      <button
                        onClick={() => setRevoking(link)}
                        className="text-sm font-medium text-red-600 hover:underline"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {creating && (
        <CreateLinkModal
          motorcycles={motorcycles}
          onClose={() => setCreating(false)}
          onSaved={handleSaved}
        />
      )}

      {revoking && (
        <ConfirmDialog
          title="Revoke tracking link"
          message={`Revoke "${revoking.label}"? Anyone with this link will immediately lose access - this cannot be undone.`}
          confirmLabel="Revoke"
          danger
          onConfirm={() => void handleRevoke()}
          onCancel={() => setRevoking(null)}
        />
      )}
    </div>
  );
}
