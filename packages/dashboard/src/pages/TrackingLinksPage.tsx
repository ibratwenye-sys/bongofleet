import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth-context';
import { apiFetch, ApiError } from '../lib/api';
import type {
  CreateTrackingLinkPayload,
  Motorcycle,
  TrackingLink,
  TrackingLinkStatus,
} from '../lib/types';
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

// Stage L17 (DESIGN_SWAHILI_UI.md) - real bug fix: StatusBadge's own `label`
// prop (added at L3) was never passed here, so the raw ACTIVE/EXPIRED/
// REVOKED enum rendered untranslated even in Swahili mode. First label map
// for this specific type.
const TRACKING_LINK_STATUS_LABEL_KEY: Record<TrackingLinkStatus, string> = {
  ACTIVE: 'statusActive',
  EXPIRED: 'statusExpired',
  REVOKED: 'statusRevoked',
};

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
  const { t } = useTranslation('trackingLinks');
  const { t: tCommon } = useTranslation('common');
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
    if (!form.label.trim()) return setError(t('errorLabelRequired'));
    if (!form.neverExpires && Number.isNaN(new Date(form.expiryDate).getTime())) {
      return setError(t('errorExpiryInvalid'));
    }

    setSubmitting(true);
    try {
      const payload: CreateTrackingLinkPayload = {
        motorcycleId: form.motorcycleId || undefined,
        label: form.label.trim(),
        expiresAt: form.neverExpires ? null : new Date(form.expiryDate).toISOString(),
      };
      await apiFetch('/tracking-links', { method: 'POST', body: JSON.stringify(payload) });
      onSaved(t('linkCreated'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('genericError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={t('modalTitle')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-txt-2">{t('tableVehicle')}</label>
          <select
            value={form.motorcycleId}
            onChange={(e) => setForm({ ...form, motorcycleId: e.target.value })}
            className="w-full rounded border border-line px-3 py-2 text-sm"
          >
            <option value="">{t('wholeFleet')}</option>
            {motorcycles.map((m) => (
              <option key={m.id} value={m.id}>
                {m.registrationNumber}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-txt-2">{t('tableLabel')}</label>
          <input
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder={t('labelPlaceholder')}
            className="w-full rounded border border-line px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-txt-2">{t('fieldExpires')}</label>
          <input
            type="date"
            value={form.expiryDate}
            min={toDateInput(new Date())}
            disabled={form.neverExpires}
            onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
            className="w-full rounded border border-line px-3 py-2 text-sm disabled:bg-panel-2 disabled:text-txt-3"
          />
          <label className="mt-2 flex items-center gap-2 text-sm text-txt-2">
            <input
              type="checkbox"
              checked={form.neverExpires}
              onChange={(e) => setForm({ ...form, neverExpires: e.target.checked })}
            />
            {t('neverExpires')}
          </label>
        </div>

        {error && <p className="text-sm text-crit">{error}</p>}

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
            {submitting ? t('creating') : t('createLink')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function TrackingLinksPage() {
  const { t } = useTranslation('trackingLinks');
  const { user } = useAuth();
  const [links, setLinks] = useState<TrackingLink[] | null>(null);
  const [motorcycles, setMotorcycles] = useState<Motorcycle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<TrackingLink | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiFetch<TrackingLink[]>('/tracking-links');
      setLinks(data);
    } catch {
      setError(t('loadError'));
    }
  }, [t]);

  useEffect(() => {
    apiFetch<Motorcycle[]>('/motorcycles')
      .then(setMotorcycles)
      .catch(() => setMotorcycles([]));
    void load();
  }, [load]);

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
      setSuccessMessage(t('copySuccess'));
    } catch {
      setError(t('copyError'));
    }
  }

  async function handleRevoke() {
    if (!revoking) return;
    try {
      await apiFetch(`/tracking-links/${revoking.id}/revoke`, { method: 'PATCH' });
      setSuccessMessage(t('revokeSuccess'));
      setRevoking(null);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('revokeError'));
      setRevoking(null);
    }
  }

  // Stage I2 - same OWNER-or-MANAGER gate as the backend's
  // TrackingLinkController; the nav link is already hidden for other roles
  // (AppShell.tsx), this covers a direct navigation to the URL.
  if (user && user.role !== 'OWNER' && user.role !== 'MANAGER') {
    return (
      <div className="rounded-lg border border-line bg-panel p-6 text-sm text-txt-2 shadow-sm">
        {t('ownerOrManagerGate')}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-txt">{t('title')}</h1>
        <button
          onClick={() => setCreating(true)}
          className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
        >
          {t('newLink')}
        </button>
      </div>

      <p className="mb-4 text-sm text-txt-2">{t('intro')}</p>

      {successMessage && (
        <p className="mb-4 rounded bg-good-d px-3 py-2 text-sm text-good-x">{successMessage}</p>
      )}
      {error && <p className="mb-4 rounded bg-crit-d px-3 py-2 text-sm text-crit-x">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-line bg-panel">
        <table className="min-w-full divide-y divide-line-soft text-sm">
          <thead className="bg-panel-2">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-txt-3">{t('tableLabel')}</th>
              <th className="px-4 py-2 text-left font-medium text-txt-3">{t('tableVehicle')}</th>
              <th className="px-4 py-2 text-left font-medium text-txt-3">{t('tableStatus')}</th>
              <th className="px-4 py-2 text-right font-medium text-txt-3">{t('tableViews')}</th>
              <th className="px-4 py-2 text-left font-medium text-txt-3">{t('tableLastViewed')}</th>
              <th className="px-4 py-2 text-right font-medium text-txt-3">{t('tableActions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {links === null ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-txt-2">
                  {t('loading')}
                </td>
              </tr>
            ) : links.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-txt-2">
                  {t('noLinksYet')}
                </td>
              </tr>
            ) : (
              links.map((link) => (
                <tr key={link.id}>
                  <td className="px-4 py-2 font-medium text-txt">{link.label}</td>
                  <td className="px-4 py-2 text-txt-2">
                    {link.motorcycleId ? (regById.get(link.motorcycleId) ?? '—') : t('wholeFleet')}
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge
                      status={link.status}
                      styles={TRACKING_LINK_STATUS_STYLES}
                      label={t(TRACKING_LINK_STATUS_LABEL_KEY[link.status])}
                    />
                  </td>
                  <td className="px-4 py-2 text-right text-txt-2">{link.viewCount}</td>
                  <td className="px-4 py-2 text-txt-2">
                    {link.lastViewedAt ? formatDateTime(link.lastViewedAt) : t('never')}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => void handleCopy(link.token)}
                      className="mr-3 text-sm font-medium text-txt-2 hover:underline"
                    >
                      {t('copyLink')}
                    </button>
                    {link.status !== 'REVOKED' && (
                      <button
                        onClick={() => setRevoking(link)}
                        className="text-sm font-medium text-crit hover:underline"
                      >
                        {t('revoke')}
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
          title={t('revokeDialogTitle')}
          message={t('revokeDialogMessage', { label: revoking.label })}
          confirmLabel={t('revoke')}
          danger
          onConfirm={() => void handleRevoke()}
          onCancel={() => setRevoking(null)}
        />
      )}
    </div>
  );
}
