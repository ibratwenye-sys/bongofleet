import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { apiFetch, ApiError } from '../lib/api';
import { formatTZS } from '../lib/format';
import type {
  CreateDriverPayload,
  Driver,
  DriverScore,
  DriverScoreboardResponse,
  DriverType,
  UpdateDriverPayload,
} from '../lib/types';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { INACTIVE_STYLES, StatusBadge } from '../components/StatusBadge';
import { useAuth } from '../lib/auth-context';
import { PasswordRecoveryLabel } from '../components/PasswordRecovery';
import { PageChassis } from '../components/chassis/PageChassis';
import { ChassisGrid, ClosingRow } from '../components/chassis/ChassisGrid';
import { Card } from '../components/chassis/Card';
import type { KpiAccent, KpiTile } from '../components/chassis/KpiRail';

const CATEGORY_OPTIONS: DriverType[] = ['RIDER', 'CAR_DRIVER', 'TRUCK_DRIVER'];
// Stage UI2-era literal labels, kept only for DriverFormModal (batch b scope,
// untouched this stage) - the main page body now reads CATEGORY_LABEL_KEY.
const CATEGORY_LABELS: Record<DriverType, string> = {
  RIDER: 'Rider',
  CAR_DRIVER: 'Car driver',
  TRUCK_DRIVER: 'Truck driver',
};
// Stage L10 (DESIGN_SWAHILI_UI.md, batch a) - first page needing a DriverType
// label map, so no centralization question yet (same starting point as
// STATUS_LABEL_KEY at L5 and MOTORCYCLE_STATUS_LABEL_KEY at L7).
const CATEGORY_LABEL_KEY: Record<DriverType, string> = {
  RIDER: 'categoryRider',
  CAR_DRIVER: 'categoryCarDriver',
  TRUCK_DRIVER: 'categoryTruckDriver',
};
const BAND_ACCENT: Record<DriverScore['band'], KpiAccent> = {
  Excellent: 'good',
  Good: 'c1',
  Fair: 'c2',
  Watch: 'warn',
  'At risk': 'crit',
};
// Stage L10 - band was rendered raw at both its call sites even though
// BAND_ACCENT already keys off these exact five values for color; this was
// a real gap; fixed the same way BAND_ACCENT itself was already handled.
const BAND_LABEL_KEY: Record<DriverScore['band'], string> = {
  Excellent: 'bandExcellent',
  Good: 'bandGood',
  Fair: 'bandFair',
  Watch: 'bandWatch',
  'At risk': 'bandAtRisk',
};

function kpisToTiles(data: DriverScoreboardResponse, t: TFunction<'drivers'>): KpiTile[] {
  const k = data.kpis;
  // Stage UI2 (§4) - 5 real tiles, not padded to 6: the mockup's 6th tile
  // ("Loan ready") is dropped entirely (no lending feature exists here to
  // back it), and there is no honest 6th number to replace it with - see
  // KpiRail's own "fewer than six genuine numbers" convention.
  return [
    { label: t('kpiDrivers'), value: String(k.totalDrivers), accentColor: 'c1' },
    { label: t('kpiExcellent'), value: String(k.excellent), accentColor: 'good' },
    { label: t('kpiGood'), value: String(k.good), accentColor: 'c1' },
    { label: t('kpiWatch'), value: String(k.watch), accentColor: 'warn' },
    { label: t('kpiAtRisk'), value: String(k.atRisk), accentColor: 'crit' },
  ];
}

function Sparkline({ points }: { points: DriverScore['sixMonthOnTimeRate'] }) {
  const { t } = useTranslation('drivers');
  const known = points.filter((p) => p.rate !== null);
  if (known.length < 2) return <span className="text-xs text-txt-3">{t('notEnoughHistory')}</span>;
  const w = 80;
  const h = 24;
  const step = w / (points.length - 1);
  const coords = points.map((p, i) => {
    const y = p.rate === null ? null : h - p.rate * h;
    return { x: i * step, y };
  });
  const last = known[known.length - 1].rate ?? 0;
  const color = last >= 0.85 ? 'var(--good)' : last >= 0.55 ? 'var(--warn)' : 'var(--crit)';
  const pathPoints = coords
    .filter((c): c is { x: number; y: number } => c.y !== null)
    .map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
      <polyline
        points={pathPoints}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Scorecard({ score }: { score: DriverScore }) {
  const { t } = useTranslation('drivers');
  const rows = [
    {
      label: t('rowPaymentReliability'),
      max: 50,
      points: score.components.reliability.points,
      detail: t('reliabilityDetail', {
        onTime: score.components.reliability.onTimeDays,
        expected: score.components.reliability.expectedDays,
      }),
    },
    {
      label: t('rowHonouringContract'),
      max: 20,
      points: score.components.contract.points,
      detail: !score.components.contract.hasPlan
        ? t('contractNoPlan')
        : score.components.contract.defaulted
          ? t('contractDefaulted')
          : t('contractMissedDays', {
              missed: score.components.contract.consecutiveMissedDays ?? 0,
              allowed: score.components.contract.breachAfterConsecutiveMissedDays ?? '—',
            }),
    },
    {
      label: t('rowVehicleCare'),
      max: 20,
      points: score.components.care.points,
      detail: !score.components.care.hasAssignmentToday
        ? t('careNoAssignment')
        : score.components.care.dueKind === 'OVERDUE'
          ? t('careOverdue')
          : score.components.care.dueKind === 'DUE_SOON'
            ? t('careDueSoon')
            : t('careUpToDate'),
    },
  ];
  return (
    <Card
      title={t('scorecardTitle', { firstName: score.firstName, lastName: score.lastName })}
      subtitle={t('scorecardSubtitle', {
        score: score.display,
        band: t(BAND_LABEL_KEY[score.band]),
      })}
    >
      <div className="space-y-3 px-4 pb-4">
        {rows.map((row) => (
          <div key={row.label}>
            <div className="flex items-center justify-between text-sm">
              <span className="text-txt-2">{row.label}</span>
              <span className="text-txt-3">{t('ptsSuffix', { max: row.max })}</span>
              <span className="font-medium text-txt">{row.points}</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-panel-2">
              <div
                className="h-full bg-c1"
                style={{ width: `${Math.min(100, (row.points / row.max) * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-txt-2">{row.detail}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---- Create / edit driver modal (unchanged CRUD) ----

interface FormState {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  licenseNumber: string;
  initialPassword: string;
  nationalId: string;
  emergencyContact: string;
  driverType: DriverType;
}

function toFormState(driver: Driver | null): FormState {
  return {
    firstName: driver?.user.firstName ?? '',
    lastName: driver?.user.lastName ?? '',
    phone: driver?.user.phone ?? '',
    email: driver?.user.email ?? '',
    licenseNumber: driver?.licenseNumber ?? '',
    initialPassword: '',
    nationalId: driver?.nationalId ?? '',
    emergencyContact: driver?.emergencyContact ?? '',
    driverType: driver?.driverType ?? 'RIDER',
  };
}

function DriverFormModal({
  driver,
  onClose,
  onSaved,
}: {
  driver: Driver | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isEdit = driver != null;
  const [form, setForm] = useState<FormState>(() => toFormState(driver));
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
        const payload: UpdateDriverPayload = {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          phone: form.phone.trim(),
          licenseNumber: form.licenseNumber.trim(),
          nationalId: form.nationalId.trim() || undefined,
          emergencyContact: form.emergencyContact.trim() || undefined,
          driverType: form.driverType,
        };
        await apiFetch(`/drivers/${driver.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        onSaved('Driver updated.');
      } else {
        const payload: CreateDriverPayload = {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          licenseNumber: form.licenseNumber.trim(),
          initialPassword: form.initialPassword,
          nationalId: form.nationalId.trim() || undefined,
          emergencyContact: form.emergencyContact.trim() || undefined,
          driverType: form.driverType,
        };
        await apiFetch('/drivers', { method: 'POST', body: JSON.stringify(payload) });
        onSaved('Driver added.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={isEdit ? 'Edit driver' : 'Add driver'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">First name</label>
            <input
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">Last name</label>
            <input
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-txt">Phone</label>
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-txt">
            Email{' '}
            {!isEdit && <span className="font-normal text-txt-2">(the driver&apos;s own)</span>}
          </label>
          {isEdit ? (
            <p className="rounded border border-line bg-panel-2 px-3 py-2 text-sm text-txt-2">
              {form.email} <span className="text-xs">(cannot be changed here)</span>
            </p>
          ) : (
            <>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-txt-2">
                He signs in with this address, and it is where his password reset code is sent. Use
                an address he can actually open - if you invent one, you will be the only person who
                can ever reset his password.
              </p>
            </>
          )}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-txt">License number</label>
          <input
            value={form.licenseNumber}
            onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })}
            className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-txt">Category</label>
          <select
            value={form.driverType}
            onChange={(e) => setForm({ ...form, driverType: e.target.value as DriverType })}
            className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
          >
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>

        {!isEdit && (
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">Initial password</label>
            <input
              type="password"
              value={form.initialPassword}
              onChange={(e) => setForm({ ...form, initialPassword: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              This is the driver's first login password — share it with them directly. At least 8
              characters.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">
              National ID (optional)
            </label>
            <input
              value={form.nationalId}
              onChange={(e) => setForm({ ...form, nationalId: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">
              Emergency contact (optional)
            </label>
            <input
              value={form.emergencyContact}
              onChange={(e) => setForm({ ...form, emergencyContact: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
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

function ResetPasswordModal({
  driver,
  onClose,
  onSaved,
}: {
  driver: Driver;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const name = `${driver.user.firstName} ${driver.user.lastName}`;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiFetch<{ sessionsRevoked: number }>(`/drivers/${driver.id}/password`, {
        method: 'PATCH',
        body: JSON.stringify({ newPassword }),
      });
      const revoked =
        result.sessionsRevoked > 0
          ? ` ${name} has been signed out on ${result.sessionsRevoked} device${
              result.sessionsRevoked === 1 ? '' : 's'
            }.`
          : '';
      onSaved(`Password updated - tell ${name} his new password.${revoked}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset the password.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Reset password - ${name}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-sm text-gray-600">
          Setting a new password signs {name} out everywhere. Share the new password with him
          directly - he will need it to log in again.
        </p>
        <div>
          <label htmlFor="reset-new-password" className="mb-1 block text-sm font-medium text-txt">
            New password
          </label>
          <input
            id="reset-new-password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-gray-500">At least 8 characters.</p>
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
            {submitting ? 'Saving…' : 'Set password'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function DriversPage() {
  const { t } = useTranslation('drivers');
  const { t: tCommon } = useTranslation('common');
  const [data, setData] = useState<DriverScoreboardResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const { user } = useAuth();

  // Manage-drivers fallback: the scored table above excludes drivers with
  // no assignment history yet (see driver-score.ts), so it cannot be the
  // only way to reach Edit/Deactivate/Reset password - see FleetPage's
  // identical reasoning for deactivated vehicles.
  const [allDrivers, setAllDrivers] = useState<Driver[] | null>(null);
  const [manageSearch, setManageSearch] = useState('');
  const [manageShowDeactivated, setManageShowDeactivated] = useState(false);
  const [formTarget, setFormTarget] = useState<'new' | Driver | null>(null);
  const [deactivating, setDeactivating] = useState<Driver | null>(null);
  const [reactivating, setReactivating] = useState<Driver | null>(null);
  const [resettingPassword, setResettingPassword] = useState<Driver | null>(null);

  async function load() {
    try {
      const [scoreboard, drivers] = await Promise.all([
        apiFetch<DriverScoreboardResponse>('/drivers/scoreboard'),
        apiFetch<Driver[]>(`/drivers${manageShowDeactivated ? '?includeInactive=true' : ''}`),
      ]);
      setData(scoreboard);
      setAllDrivers(drivers);
      setError(null);
      setSelectedId((current) => current ?? scoreboard.drivers[0]?.driverId ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('loadError'));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manageShowDeactivated]);

  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  const filteredManageDrivers = useMemo(() => {
    if (!allDrivers) return [];
    const term = manageSearch.trim().toLowerCase();
    if (!term) return allDrivers;
    return allDrivers.filter((d) => {
      const name = `${d.user.firstName} ${d.user.lastName}`.toLowerCase();
      return name.includes(term) || d.licenseNumber.toLowerCase().includes(term);
    });
  }, [allDrivers, manageSearch]);

  function handleSaved(message: string) {
    setFormTarget(null);
    setSuccessMessage(message);
    void load();
  }

  async function handleDeactivate() {
    if (!deactivating) return;
    try {
      await apiFetch(`/drivers/${deactivating.id}`, { method: 'DELETE' });
      setSuccessMessage(t('driverDeactivated'));
      setDeactivating(null);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('deactivateError'));
      setDeactivating(null);
    }
  }

  async function handleReactivate() {
    if (!reactivating) return;
    try {
      await apiFetch(`/drivers/${reactivating.id}/reactivate`, { method: 'PATCH' });
      setSuccessMessage(t('driverReactivated'));
      setReactivating(null);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('reactivateError'));
      setReactivating(null);
    }
  }

  if (error && !data) {
    return <p className="text-sm text-crit">{error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-txt-2">{t('loading')}</p>;
  }

  const selected = data.drivers.find((d) => d.driverId === selectedId) ?? null;

  return (
    <PageChassis
      title={t('title')}
      statusPill={{
        mode: 'reporting',
        text: t('statusPill', { count: data.kpis.totalDrivers }),
      }}
      primaryAction={{ label: t('addDriver'), onClick: () => setFormTarget('new') }}
      kpis={kpisToTiles(data, t)}
    >
      {successMessage && (
        <p className="rounded bg-good-d px-3 py-2 text-sm text-good-x">{successMessage}</p>
      )}
      {error && <p className="rounded bg-crit-d px-3 py-2 text-sm text-crit-x">{error}</p>}

      <ChassisGrid
        main={
          <>
            <Card title={t('driverPerformanceTitle')} subtitle={t('driverPerformanceSubtitle')}>
              {data.drivers.length === 0 ? (
                <p className="p-4 text-sm text-txt-2">{t('noScoreHistory')}</p>
              ) : (
                <>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-line-soft text-left text-xs text-txt-3">
                          <th className="px-4 py-2 text-right font-medium">{t('tableScore')}</th>
                          <th className="px-4 py-2 font-medium">{t('tableDriver')}</th>
                          <th className="px-4 py-2 font-medium">{t('tableCategory')}</th>
                          <th className="px-4 py-2 font-medium">{t('tableTrend')}</th>
                          <th className="px-4 py-2 font-medium">{t('tableNote')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.drivers.map((d) => (
                          <tr
                            key={d.driverId}
                            onClick={() => setSelectedId(d.driverId)}
                            className={`cursor-pointer border-b border-line-soft last:border-0 hover:bg-panel-2 ${
                              d.driverId === selectedId ? 'bg-panel-2' : ''
                            }`}
                          >
                            <td
                              className="px-4 py-2 text-right text-lg font-bold"
                              style={{ color: `var(--${BAND_ACCENT[d.band]})` }}
                            >
                              {d.display}
                            </td>
                            <td className="px-4 py-2">
                              <Link
                                to={`/drivers/${d.driverId}`}
                                onClick={(e) => e.stopPropagation()}
                                className="font-medium text-txt hover:underline"
                              >
                                {d.firstName} {d.lastName}
                              </Link>
                              <div className="text-xs text-txt-2">
                                {d.registrationNumber ?? '—'}
                              </div>
                            </td>
                            <td className="px-4 py-2 text-txt-2">
                              {t(CATEGORY_LABEL_KEY[d.driverType])}
                            </td>
                            <td className="px-4 py-2">
                              <Sparkline points={d.sixMonthOnTimeRate} />
                            </td>
                            <td className="px-4 py-2 text-txt-2">{d.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="md:hidden">
                    {data.drivers.map((d) => (
                      <div
                        key={d.driverId}
                        onClick={() => setSelectedId(d.driverId)}
                        className={`cursor-pointer border-b border-line-soft px-4 py-3 last:border-0 ${
                          d.driverId === selectedId ? 'bg-panel-2' : ''
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <Link
                              to={`/drivers/${d.driverId}`}
                              onClick={(e) => e.stopPropagation()}
                              className="font-medium text-txt hover:underline"
                            >
                              {d.firstName} {d.lastName}
                            </Link>
                            <div className="text-xs text-txt-2">{d.registrationNumber ?? '—'}</div>
                          </div>
                          <span
                            className="shrink-0 text-lg font-bold"
                            style={{ color: `var(--${BAND_ACCENT[d.band]})` }}
                          >
                            {d.display}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <span className="text-xs text-txt-2">
                            {t(CATEGORY_LABEL_KEY[d.driverType])}
                          </span>
                          <Sparkline points={d.sixMonthOnTimeRate} />
                        </div>
                        <p className="mt-1 text-xs text-txt-2">{d.note}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>

            {selected && <Scorecard score={selected} />}
          </>
        }
        rail={
          <>
            <Card title={t('aiInsightsTitle')} subtitle={t('aiInsightsSubtitle')}>
              {data.lowestScoring ? (
                <div className="p-4">
                  <p className="text-sm font-medium text-txt">
                    {t('lowestScoringLine', {
                      firstName: data.lowestScoring.firstName,
                      lastName: data.lowestScoring.lastName,
                      raw: data.lowestScoring.raw,
                    })}
                  </p>
                  <p className="mt-1 text-xs text-txt-2">{data.lowestScoring.note}</p>
                </div>
              ) : (
                <p className="p-4 text-sm text-txt-2">{t('noScoringHistory')}</p>
              )}
            </Card>

            <Card
              title={t('driverAlertsTitle')}
              subtitle={data.alerts.length > 0 ? String(data.alerts.length) : undefined}
            >
              {data.alerts.length === 0 ? (
                <p className="p-4 text-sm text-txt-2">{t('noAlerts')}</p>
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

      <Card
        title={t('scoreDistributionTitle')}
        subtitle={t('scoreDistributionSubtitle', { count: data.drivers.length })}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left text-xs text-txt-3">
                <th className="px-4 py-2 font-medium">{t('tableBand')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('tableDriversCol')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('tableShare')}</th>
              </tr>
            </thead>
            <tbody>
              {data.bandDistribution.map((row) => (
                <tr key={row.band} className="border-b border-line-soft last:border-0">
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2 text-txt">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: `var(--${BAND_ACCENT[row.band]})` }}
                      />
                      {t(BAND_LABEL_KEY[row.band])}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right text-txt-2">{row.count}</td>
                  <td className="px-4 py-2 text-right text-txt-2">{row.share}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <ClosingRow
        left={
          <Card title={t('scoreBuiltFromTitle')} subtitle={t('scoreBuiltFromSubtitle')}>
            <div className="space-y-3 px-4 pb-4">
              <p className="text-xs text-txt-2">{t('conductNote')}</p>
              {[
                { label: t('rowPaymentReliability'), pts: 50 },
                { label: t('rowHonouringContract'), pts: 20 },
                { label: t('rowVehicleCare'), pts: 20 },
              ].map((row) => (
                <div key={row.label}>
                  <div className="flex justify-between text-sm">
                    <span className="text-txt-2">{row.label}</span>
                    <span className="text-txt">{t('ptsOf90', { pts: row.pts })}</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-panel-2">
                    <div className="h-full bg-c1" style={{ width: `${(row.pts / 90) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        }
        right={
          <Card title={t('missedPaymentsTitle')} subtitle={t('missedPaymentsSubtitle')}>
            <div className="px-4 pb-4">
              <p className="text-2xl font-semibold text-crit">
                {formatTZS(data.missedPaymentTotalThisMonth)}
              </p>
              <p className="mt-1 text-xs text-txt-2">{t('missedPaymentsNote')}</p>
            </div>
          </Card>
        }
      />

      <Card title={t('manageDriversTitle')} subtitle={t('manageDriversSubtitle')}>
        <div className="flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-3">
          <input
            placeholder={t('searchPlaceholder')}
            value={manageSearch}
            onChange={(e) => setManageSearch(e.target.value)}
            className="w-full rounded border border-line bg-panel px-3 py-1.5 text-sm text-txt sm:w-64"
          />
          <label className="flex items-center gap-2 text-sm text-txt-2">
            <input
              type="checkbox"
              checked={manageShowDeactivated}
              onChange={(e) => setManageShowDeactivated(e.target.checked)}
            />
            {t('showDeactivated')}
          </label>
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left text-xs text-txt-3">
                <th className="px-4 py-2 font-medium">{t('tableName')}</th>
                <th className="px-4 py-2 font-medium">{t('tableCategory')}</th>
                <th className="px-4 py-2 font-medium">{t('tablePhone')}</th>
                <th className="px-4 py-2 font-medium">{t('tablePasswordRecovery')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('tableActions')}</th>
              </tr>
            </thead>
            <tbody>
              {allDrivers === null ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-txt-2">
                    {t('loading')}
                  </td>
                </tr>
              ) : filteredManageDrivers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-txt-2">
                    {t('noDriversFound')}
                  </td>
                </tr>
              ) : (
                filteredManageDrivers.map((d) => (
                  <tr
                    key={d.id}
                    className={`border-b border-line-soft last:border-0 ${d.isActive ? '' : 'opacity-50'}`}
                  >
                    <td className="px-4 py-2 font-medium text-txt">
                      {d.user.firstName} {d.user.lastName}
                      {!d.isActive && (
                        <span className="ml-2">
                          <StatusBadge status="INACTIVE" styles={INACTIVE_STYLES} />
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-txt-2">{t(CATEGORY_LABEL_KEY[d.driverType])}</td>
                    <td className="px-4 py-2 text-txt-2">{d.user.phone}</td>
                    <td className="px-4 py-2 text-txt-2">
                      <PasswordRecoveryLabel emailProvenAt={d.user.emailProvenAt} />
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {d.isActive ? (
                        <>
                          <button
                            onClick={() => setFormTarget(d)}
                            className="mr-3 text-sm font-medium text-c1 hover:underline"
                          >
                            {tCommon('edit')}
                          </button>
                          {user?.role === 'OWNER' && (
                            <button
                              onClick={() => setResettingPassword(d)}
                              className="mr-3 text-sm font-medium text-c1 hover:underline"
                            >
                              {t('resetPassword')}
                            </button>
                          )}
                          <button
                            onClick={() => setDeactivating(d)}
                            className="text-sm font-medium text-crit hover:underline"
                          >
                            {t('deactivate')}
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setReactivating(d)}
                          className="text-sm font-medium text-c1 hover:underline"
                        >
                          {t('reactivate')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="md:hidden">
          {allDrivers === null ? (
            <p className="p-4 text-center text-sm text-txt-2">{t('loading')}</p>
          ) : filteredManageDrivers.length === 0 ? (
            <p className="p-4 text-center text-sm text-txt-2">{t('noDriversFound')}</p>
          ) : (
            filteredManageDrivers.map((d) => (
              <div
                key={d.id}
                className={`border-b border-line-soft px-4 py-3 last:border-0 ${
                  d.isActive ? '' : 'opacity-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-txt">
                    {d.user.firstName} {d.user.lastName}
                  </span>
                  {!d.isActive && <StatusBadge status="INACTIVE" styles={INACTIVE_STYLES} />}
                </div>
                <p className="mt-1 text-xs text-txt-2">
                  {t(CATEGORY_LABEL_KEY[d.driverType])} · {d.user.phone}
                </p>
                <div className="mt-1 text-xs text-txt-2">
                  <PasswordRecoveryLabel emailProvenAt={d.user.emailProvenAt} />
                </div>
                <div className="mt-2 flex min-h-11 items-center justify-end gap-4">
                  {d.isActive ? (
                    <>
                      <button
                        onClick={() => setFormTarget(d)}
                        className="text-sm font-medium text-c1 hover:underline"
                      >
                        {tCommon('edit')}
                      </button>
                      {user?.role === 'OWNER' && (
                        <button
                          onClick={() => setResettingPassword(d)}
                          className="text-sm font-medium text-c1 hover:underline"
                        >
                          {t('resetPassword')}
                        </button>
                      )}
                      <button
                        onClick={() => setDeactivating(d)}
                        className="text-sm font-medium text-crit hover:underline"
                      >
                        {t('deactivate')}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setReactivating(d)}
                      className="text-sm font-medium text-c1 hover:underline"
                    >
                      {t('reactivate')}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      {resettingPassword && (
        <ResetPasswordModal
          driver={resettingPassword}
          onClose={() => setResettingPassword(null)}
          onSaved={(m) => {
            setResettingPassword(null);
            handleSaved(m);
          }}
        />
      )}

      {formTarget && (
        <DriverFormModal
          driver={formTarget === 'new' ? null : formTarget}
          onClose={() => setFormTarget(null)}
          onSaved={handleSaved}
        />
      )}

      {deactivating && (
        <ConfirmDialog
          title={t('deactivateDriverTitle')}
          message={t('deactivateDriverMessage', {
            firstName: deactivating.user.firstName,
            lastName: deactivating.user.lastName,
          })}
          confirmLabel={t('deactivate')}
          danger
          onConfirm={handleDeactivate}
          onCancel={() => setDeactivating(null)}
        />
      )}

      {reactivating && (
        <ConfirmDialog
          title={t('reactivateDriverTitle')}
          message={t('reactivateDriverMessage', {
            firstName: reactivating.user.firstName,
            lastName: reactivating.user.lastName,
          })}
          confirmLabel={t('reactivate')}
          onConfirm={handleReactivate}
          onCancel={() => setReactivating(null)}
        />
      )}
    </PageChassis>
  );
}
