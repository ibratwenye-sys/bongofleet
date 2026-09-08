import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth-context';
import { apiFetch, ApiError } from '../lib/api';
import type { GpsProviderConfig } from '../lib/types';
import { formatDateTime } from '../lib/format';
import { ConfirmDialog } from '../components/ConfirmDialog';

interface FormState {
  baseUrl: string;
  token: string;
}

/**
 * Stage 1b (DESIGN_GPS_TRACKING.md §5) - purely "is the connection to
 * Traccar configured and healthy." No map, no per-vehicle detail here -
 * that's the Tracking Map page (Stage I3); this page never renders a
 * position, only connection status.
 *
 * The token field is write-only by design: baseUrl comes back from GET and
 * pre-fills the form (not sensitive), but the token never does - only
 * hasCredentials (a boolean) tells this page whether one is on file. A
 * saved token is never re-displayed, masked or otherwise.
 */
export function GpsProviderSettingsPage() {
  const { t } = useTranslation('gpsProviderSettings');
  const { user } = useAuth();
  const [config, setConfig] = useState<GpsProviderConfig | null | undefined>(undefined);
  const [form, setForm] = useState<FormState>({ baseUrl: '', token: '' });
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiFetch<GpsProviderConfig | null>('/gps-provider-config');
      setConfig(data);
      setForm((f) => ({ ...f, baseUrl: data?.baseUrl ?? f.baseUrl }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('loadError'));
      setConfig(null);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.baseUrl.trim()) return setError(t('errorUrlRequired'));
    if (!form.token.trim()) return setError(t('errorTokenRequired'));

    setSaving(true);
    try {
      const saved = await apiFetch<GpsProviderConfig>('/gps-provider-config', {
        method: 'PUT',
        body: JSON.stringify({ baseUrl: form.baseUrl.trim(), token: form.token.trim() }),
      });
      setConfig(saved);
      setForm({ baseUrl: saved.baseUrl, token: '' });
      setSuccessMessage(t('connectionSavedMessage'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('genericError'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate() {
    setConfirmingDeactivate(false);
    setError(null);
    try {
      const updated = await apiFetch<GpsProviderConfig>('/gps-provider-config/deactivate', {
        method: 'PATCH',
      });
      setConfig(updated);
      setSuccessMessage(t('connectionDeactivatedMessage'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('deactivateError'));
    }
  }

  // Same OWNER-only gate as the backend's GpsProviderConfigController; the
  // nav link is already hidden for other roles (nav-config.ts), this covers
  // a direct navigation to the URL, same precedent BillingPage.tsx sets.
  if (user && user.role !== 'OWNER') {
    return (
      <div className="rounded-lg border border-line bg-panel p-6 text-sm text-txt-2 shadow-sm">
        {t('ownerOnlyGate')}
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-txt">{t('title')}</h1>
      <p className="mb-4 text-sm text-txt-2">{t('subtitle')}</p>

      {successMessage && (
        <p className="mb-4 rounded bg-good-d px-3 py-2 text-sm text-good-x">{successMessage}</p>
      )}
      {error && <p className="mb-4 rounded bg-crit-d px-3 py-2 text-sm text-crit-x">{error}</p>}

      {config === undefined ? (
        <p className="text-sm text-txt-2">{t('loading')}</p>
      ) : (
        <div className="space-y-4">
          {config && (
            <div className="rounded-lg border border-line bg-panel p-6 shadow-sm">
              <p className="mb-3 text-sm font-medium text-txt-2">{t('statusLabel')}</p>
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-txt-3">{t('dtConnection')}</dt>
                  <dd className={config.isActive ? 'text-good' : 'text-txt-2'}>
                    {config.isActive
                      ? t('connectionStatusActive')
                      : t('connectionStatusDeactivated')}
                  </dd>
                </div>
                <div>
                  <dt className="text-txt-3">{t('dtLastPolled')}</dt>
                  <dd className="text-txt">
                    {config.lastPolledAt ? formatDateTime(config.lastPolledAt) : t('never')}
                  </dd>
                </div>
                <div>
                  <dt className="text-txt-3">{t('dtLastSuccessfulPoll')}</dt>
                  <dd className="text-txt">
                    {config.lastSuccessAt ? formatDateTime(config.lastSuccessAt) : t('never')}
                  </dd>
                </div>
              </dl>
              {config.lastErrorMessage && (
                <p className="mt-4 rounded bg-crit-d px-3 py-2 text-sm text-crit-x">
                  {t('lastErrorPrefix')} {config.lastErrorMessage}
                </p>
              )}
              {config.isActive && (
                <button
                  onClick={() => setConfirmingDeactivate(true)}
                  className="mt-4 text-sm font-medium text-crit hover:underline"
                >
                  {t('deactivateConnectionButton')}
                </button>
              )}
            </div>
          )}

          <form
            onSubmit={(e) => void handleSubmit(e)}
            className="max-w-md space-y-3 rounded-lg border border-line bg-panel p-6 shadow-sm"
          >
            <p className="text-sm font-medium text-txt-2">
              {config ? t('replaceConnectionHeading') : t('connectTraccarHeading')}
            </p>

            <div>
              <label className="mb-1 block text-sm font-medium text-txt-2">
                {t('fieldServerUrl')}
              </label>
              <input
                value={form.baseUrl}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                placeholder="https://demo.traccar.org"
                className="w-full rounded border border-line px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-txt-2">
                {t('fieldApiToken')}
              </label>
              <input
                type="password"
                value={form.token}
                onChange={(e) => setForm({ ...form, token: e.target.value })}
                placeholder={config?.hasCredentials ? t('tokenSavedPlaceholder') : ''}
                autoComplete="new-password"
                className="w-full rounded border border-line px-3 py-2 text-sm"
              />
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {saving ? t('saving') : config ? t('saveChanges') : t('connect')}
              </button>
            </div>
          </form>
        </div>
      )}

      {confirmingDeactivate && (
        <ConfirmDialog
          title={t('deactivateDialogTitle')}
          message={t('deactivateDialogMessage')}
          confirmLabel={t('deactivateConfirmLabel')}
          danger
          onConfirm={() => void handleDeactivate()}
          onCancel={() => setConfirmingDeactivate(false)}
        />
      )}
    </div>
  );
}
