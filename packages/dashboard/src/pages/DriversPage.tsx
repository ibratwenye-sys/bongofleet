import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';
import type { CreateDriverPayload, Driver, DriverType, UpdateDriverPayload } from '../lib/types';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { INACTIVE_STYLES, StatusBadge } from '../components/StatusBadge';
import { useAuth } from '../lib/auth-context';

const CATEGORY_OPTIONS: DriverType[] = ['RIDER', 'CAR_DRIVER', 'TRUCK_DRIVER'];
const CATEGORY_LABELS: Record<DriverType, string> = {
  RIDER: 'Rider',
  CAR_DRIVER: 'Car driver',
  TRUCK_DRIVER: 'Truck driver',
};

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

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Category</label>
          <select
            value={form.driverType}
            onChange={(e) => setForm({ ...form, driverType: e.target.value as DriverType })}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
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
            <label className="mb-1 block text-sm font-medium text-gray-700">Initial password</label>
            <input
              type="password"
              value={form.initialPassword}
              onChange={(e) => setForm({ ...form, initialPassword: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              This is the driver's first login password — share it with them directly. At least 8
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

/**
 * Stage H0f - the owner's half of the reset story. Until this stage there was
 * no way to change a rider's password after creation at all, so a rider who
 * forgot the one his owner typed for him needed database access to get back
 * in. With refresh tokens lasting seven days, that was every rider who spent
 * a week off the app.
 *
 * Deliberately blunt: the owner types a new password and tells the rider what
 * it is. No temporary-password ceremony, no forced change on next login -
 * those are worth building only once it is clear this is used enough to need
 * them.
 */
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
    // Matched to the backend's own floor (ResetDriverPasswordDto) so the
    // error arrives before the round trip rather than after it.
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
      // Say plainly that he has been signed out everywhere. An owner doing
      // this because a phone was lost wants to know it worked; one doing it
      // because the rider forgot his password needs to know the rider must
      // log in again on his own handset too.
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
          {/* htmlFor/id, unlike the other forms on this page: it costs two
              attributes, makes the label click into the field, and is what
              lets a screen reader (or a test) name this input at all. */}
          <label
            htmlFor="reset-new-password"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            New password
          </label>
          <input
            id="reset-new-password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
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
  const [drivers, setDrivers] = useState<Driver[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<DriverType | 'ALL'>('ALL');
  const [formTarget, setFormTarget] = useState<'new' | Driver | null>(null);
  const [deactivating, setDeactivating] = useState<Driver | null>(null);
  const [reactivating, setReactivating] = useState<Driver | null>(null);
  const [resettingPassword, setResettingPassword] = useState<Driver | null>(null);
  const [showDeactivated, setShowDeactivated] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const { user } = useAuth();

  async function load() {
    try {
      const data = await apiFetch<Driver[]>(
        `/drivers${showDeactivated ? '?includeInactive=true' : ''}`,
      );
      setDrivers(data);
    } catch {
      setError('Could not load drivers. Please try again.');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDeactivated]);

  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  const filtered = useMemo(() => {
    if (!drivers) return [];
    const term = search.trim().toLowerCase();
    return drivers.filter((d) => {
      const matchesCategory = categoryFilter === 'ALL' || d.driverType === categoryFilter;
      const name = `${d.user.firstName} ${d.user.lastName}`.toLowerCase();
      const matchesSearch =
        !term || name.includes(term) || d.licenseNumber.toLowerCase().includes(term);
      return matchesCategory && matchesSearch;
    });
  }, [drivers, search, categoryFilter]);

  function handleSaved(message: string) {
    setFormTarget(null);
    setSuccessMessage(message);
    void load();
  }

  async function handleDeactivate() {
    if (!deactivating) return;
    try {
      await apiFetch(`/drivers/${deactivating.id}`, { method: 'DELETE' });
      setSuccessMessage('Driver deactivated - they can no longer log in.');
      setDeactivating(null);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not deactivate driver.');
      setDeactivating(null);
    }
  }

  async function handleReactivate() {
    if (!reactivating) return;
    try {
      await apiFetch(`/drivers/${reactivating.id}/reactivate`, { method: 'PATCH' });
      setSuccessMessage('Driver reactivated - they can log in again.');
      setReactivating(null);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reactivate driver.');
      setReactivating(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Drivers</h1>
        <button
          onClick={() => setFormTarget('new')}
          className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
        >
          Add driver
        </button>
      </div>

      {successMessage && (
        <p className="mb-4 rounded bg-green-50 px-3 py-2 text-sm text-green-700">
          {successMessage}
        </p>
      )}
      {error && <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      {/* flex-wrap + a full-width-then-fixed search box: at 390px a 256px
          input beside a select and a checkbox pushed the row past the
          viewport. */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          placeholder="Search name or license number…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm sm:w-64"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as DriverType | 'ALL')}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="ALL">All categories</option>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showDeactivated}
            onChange={(e) => setShowDeactivated(e.target.checked)}
          />
          Show deactivated
        </label>
      </div>

      {/* Stage H0e - looking a driver up is a reading task, so the phone
          gets the identifying fields (name, category, whether they are still
          active) plus the phone number, which is the one thing you are
          usually reaching for it to find - and it is tappable here, which it
          never was in the table. Email, licence and national ID stay on the
          driver's own page. Editing and deactivating are deliberately absent
          below md: they are management actions, not reading, and the forms
          behind them are still desktop-first. */}
      <ul className="space-y-3 md:hidden">
        {drivers === null ? (
          <li className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">
            Loading…
          </li>
        ) : filtered.length === 0 ? (
          <li className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">
            No drivers found.
          </li>
        ) : (
          filtered.map((d) => (
            <li
              key={d.id}
              className={`rounded-lg border border-gray-200 p-4 ${
                d.isActive ? 'bg-white' : 'bg-gray-50'
              }`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <Link
                  to={`/drivers/${d.id}`}
                  className={`font-medium ${d.isActive ? 'text-gray-900' : 'text-gray-400'}`}
                >
                  {d.user.firstName} {d.user.lastName}
                </Link>
                {!d.isActive && <StatusBadge status="INACTIVE" styles={INACTIVE_STYLES} />}
              </div>
              <p className="mt-1 text-sm text-gray-600">{CATEGORY_LABELS[d.driverType]}</p>
              <a
                href={`tel:${d.user.phone}`}
                className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-gray-700 underline"
              >
                {d.user.phone}
              </a>
            </li>
          ))
        )}
      </ul>

      <div className="hidden overflow-x-auto rounded-lg border border-gray-200 bg-white md:block">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Name</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Category</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Phone</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Email</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">License</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">National ID</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {drivers === null ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-gray-500">
                  No drivers found.
                </td>
              </tr>
            ) : (
              filtered.map((d) => (
                <tr key={d.id} className={d.isActive ? undefined : 'bg-gray-50 text-gray-400'}>
                  <td className="px-4 py-2 font-medium text-gray-900">
                    <Link
                      to={`/drivers/${d.id}`}
                      className={`hover:underline ${d.isActive ? '' : 'text-gray-400'}`}
                    >
                      {d.user.firstName} {d.user.lastName}
                    </Link>
                    {!d.isActive && (
                      <span className="ml-2">
                        <StatusBadge status="INACTIVE" styles={INACTIVE_STYLES} />
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-gray-600">{CATEGORY_LABELS[d.driverType]}</td>
                  <td className="px-4 py-2 text-gray-600">{d.user.phone}</td>
                  <td className="px-4 py-2 text-gray-600">{d.user.email}</td>
                  <td className="px-4 py-2 text-gray-600">{d.licenseNumber}</td>
                  <td className="px-4 py-2 text-gray-600">{d.nationalId ?? '—'}</td>
                  <td className="px-4 py-2 text-right">
                    {d.isActive ? (
                      <>
                        <button
                          onClick={() => setFormTarget(d)}
                          className="mr-3 text-sm font-medium text-gray-700 hover:underline"
                        >
                          Edit
                        </button>
                        {/* Stage H0f - OWNER only, matching the endpoint. A
                            MANAGER would get a 403, so showing them a button
                            would only be a lie. Hiding it is presentation;
                            the guard on PATCH :id/password is the control. */}
                        {user?.role === 'OWNER' && (
                          <button
                            onClick={() => setResettingPassword(d)}
                            className="mr-3 text-sm font-medium text-gray-700 hover:underline"
                          >
                            Reset password
                          </button>
                        )}
                        <button
                          onClick={() => setDeactivating(d)}
                          className="text-sm font-medium text-red-600 hover:underline"
                        >
                          Deactivate
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setReactivating(d)}
                        className="text-sm font-medium text-gray-700 hover:underline"
                      >
                        Reactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

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
          title="Deactivate driver"
          message={`Deactivate ${deactivating.user.firstName} ${deactivating.user.lastName}? They will immediately lose the ability to log in. Their assignment/payment history is kept.`}
          confirmLabel="Deactivate"
          danger
          onConfirm={handleDeactivate}
          onCancel={() => setDeactivating(null)}
        />
      )}

      {reactivating && (
        <ConfirmDialog
          title="Reactivate driver"
          message={`Reactivate ${reactivating.user.firstName} ${reactivating.user.lastName}? This restores their ability to log in.`}
          confirmLabel="Reactivate"
          onConfirm={handleReactivate}
          onCancel={() => setReactivating(null)}
        />
      )}
    </div>
  );
}
