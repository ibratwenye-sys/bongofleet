import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { estimatePlanTerm } from '@bongofleet/shared-lib';
import { apiFetch, ApiError } from '../lib/api';
import { formatTZS } from '../lib/format';
import type {
  CreateOwnershipPlanPayload,
  Driver,
  Guarantor,
  Motorcycle,
  OwnershipPlan,
} from '../lib/types';
import { Modal } from '../components/Modal';
import { StatusBadge } from '../components/StatusBadge';

const OWNERSHIP_PLAN_STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-blue-100 text-blue-800',
  COMPLETED: 'bg-green-100 text-green-800',
  DEFAULTED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-600',
};

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DEFAULT_ACTIVE_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

/** Stage G2 Part 1 - red and amber watch different quantities, on purpose.
 *  Red compares consecutiveMissedDays (an unbroken run) against the plan's
 *  own breachAfterConsecutiveMissedDays - the contract's actual repossession
 *  condition - independently of daysBehind's sign: a driver who is net
 *  ahead overall but has just missed a breach-length run in a row must still
 *  show red, not green. Amber is unchanged: daysBehind (a cumulative money
 *  position) past graceDays, never a hardcoded threshold. */
function positionSeverity(
  daysBehind: number,
  consecutiveMissedDays: number,
  graceDays: number,
  breachAfterConsecutiveMissedDays: number,
): 'ok' | 'amber' | 'red' {
  if (consecutiveMissedDays >= breachAfterConsecutiveMissedDays) return 'red';
  if (daysBehind > graceDays) return 'amber';
  return 'ok';
}

const SEVERITY_ROW_STYLES: Record<'ok' | 'amber' | 'red', string> = {
  ok: '',
  amber: 'bg-amber-50',
  red: 'bg-red-50',
};

const SEVERITY_TEXT_STYLES: Record<'ok' | 'amber' | 'red', string> = {
  ok: 'text-gray-600',
  amber: 'text-amber-700 font-medium',
  red: 'text-red-700 font-medium',
};

function positionLabel(daysBehind: number, daysAhead: number): string {
  if (daysBehind > 0) return `${daysBehind} day${daysBehind === 1 ? '' : 's'} behind`;
  if (daysAhead > 0) return `${daysAhead} day${daysAhead === 1 ? '' : 's'} ahead`;
  return 'On track';
}

/** Stage G2 Part 1 - the run length itself, shown separately from
 *  positionLabel's cumulative-position read so an owner deciding whether to
 *  repossess sees the number the red threshold actually watches. */
function missedStreakLabel(consecutiveMissedDays: number): string {
  if (consecutiveMissedDays <= 0) return '—';
  return `${consecutiveMissedDays} day${consecutiveMissedDays === 1 ? '' : 's'} missed in a row`;
}

/** Stage G5 Part 3 - a count, not a flag and not a limit: there is no
 *  threshold this turns red at. The point is only to make "excused twelve
 *  days this quarter" visible instead of invisible one day at a time, so an
 *  owner can go have that conversation. */
function recentExcusalLabel(recentExcusalCount: number): string {
  if (recentExcusalCount <= 0) return '—';
  return `${recentExcusalCount} in last 90 days`;
}

interface CreateFormState {
  driverId: string;
  motorcycleId: string;
  guarantorId: string;
  totalPrice: string;
  downPayment: string;
  dailyAmount: string;
  startDate: string;
  contractEndDate: string;
  activeWeekdays: number[];
  graceDays: string;
  notes: string;
}

function todayDateInput(): string {
  return new Date().toISOString().slice(0, 10);
}

function CreatePlanFormModal({
  drivers,
  motorcycles,
  onClose,
  onSaved,
}: {
  drivers: Driver[];
  motorcycles: Motorcycle[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState<CreateFormState>({
    driverId: '',
    motorcycleId: '',
    guarantorId: '',
    totalPrice: '',
    downPayment: '',
    dailyAmount: '',
    startDate: todayDateInput(),
    contractEndDate: '',
    activeWeekdays: DEFAULT_ACTIVE_WEEKDAYS,
    graceDays: '',
    notes: '',
  });
  const [guarantors, setGuarantors] = useState<Guarantor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!form.driverId) {
      setGuarantors([]);
      return;
    }
    apiFetch<Guarantor[]>(`/drivers/${form.driverId}/guarantors`)
      .then(setGuarantors)
      .catch(() => setGuarantors([]));
  }, [form.driverId]);

  // Stage G Part 1/4b - the same estimatePlanTerm() the backend tests
  // against the real daily-charge generator. Never reimplemented here:
  // paymentDayCount and calendarEndDate are recomputed live as the owner
  // types, straight from shared-lib.
  const totalPrice = Number(form.totalPrice);
  const downPayment = Number(form.downPayment || 0);
  const dailyAmount = Number(form.dailyAmount);
  const canEstimate =
    form.totalPrice !== '' &&
    form.dailyAmount !== '' &&
    Number.isFinite(totalPrice) &&
    Number.isFinite(downPayment) &&
    Number.isFinite(dailyAmount) &&
    dailyAmount > 0 &&
    form.startDate !== '' &&
    form.activeWeekdays.length > 0;

  const estimate = canEstimate
    ? estimatePlanTerm({
        totalPrice,
        downPayment,
        dailyAmount,
        startDate: form.startDate,
        activeWeekdays: form.activeWeekdays,
      })
    : null;

  function toggleWeekday(day: number) {
    setForm((prev) => ({
      ...prev,
      activeWeekdays: prev.activeWeekdays.includes(day)
        ? prev.activeWeekdays.filter((d) => d !== day)
        : [...prev.activeWeekdays, day].sort(),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.driverId || !form.motorcycleId) {
      setError('Driver and vehicle are required.');
      return;
    }
    if (!form.totalPrice || totalPrice <= 0) {
      setError('Enter a valid total price.');
      return;
    }
    if (!form.dailyAmount || dailyAmount <= 0) {
      setError('Enter a valid daily amount.');
      return;
    }
    if (form.activeWeekdays.length === 0) {
      setError('At least one active weekday is required.');
      return;
    }

    setSubmitting(true);
    try {
      const payload: CreateOwnershipPlanPayload = {
        driverId: form.driverId,
        motorcycleId: form.motorcycleId,
        guarantorId: form.guarantorId || undefined,
        totalPrice,
        downPayment: form.downPayment ? downPayment : undefined,
        dailyAmount,
        startDate: form.startDate,
        contractEndDate: form.contractEndDate || undefined,
        activeWeekdays: form.activeWeekdays,
        graceDays: form.graceDays ? Number(form.graceDays) : undefined,
        notes: form.notes.trim() || undefined,
      };
      await apiFetch('/ownership-plans', { method: 'POST', body: JSON.stringify(payload) });
      onSaved('Ownership plan created.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Create ownership plan" onClose={onClose}>
      <form onSubmit={handleSubmit} className="max-h-[75vh] space-y-3 overflow-y-auto pr-1">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Driver</label>
          <select
            value={form.driverId}
            onChange={(e) => setForm({ ...form, driverId: e.target.value, guarantorId: '' })}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">Select a driver…</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.user.firstName} {d.user.lastName} — {d.licenseNumber}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Vehicle</label>
          <select
            value={form.motorcycleId}
            onChange={(e) => setForm({ ...form, motorcycleId: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">Select a vehicle…</option>
            {motorcycles.map((m) => (
              <option key={m.id} value={m.id}>
                {m.registrationNumber} {[m.make, m.model].filter(Boolean).join(' ')}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Guarantor (optional)
          </label>
          <select
            value={form.guarantorId}
            onChange={(e) => setForm({ ...form, guarantorId: e.target.value })}
            disabled={!form.driverId}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
          >
            <option value="">
              {form.driverId ? 'No guarantor on this contract' : 'Select a driver first…'}
            </option>
            {guarantors.map((g) => (
              <option key={g.id} value={g.id}>
                {g.firstName} {g.lastName} — {g.phone}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Total price (TZS)
            </label>
            <input
              type="number"
              value={form.totalPrice}
              onChange={(e) => setForm({ ...form, totalPrice: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Down payment (TZS)
            </label>
            <input
              type="number"
              value={form.downPayment}
              onChange={(e) => setForm({ ...form, downPayment: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Daily amount (TZS)
            </label>
            <input
              type="number"
              value={form.dailyAmount}
              onChange={(e) => setForm({ ...form, dailyAmount: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Active weekdays</label>
          <div className="flex gap-2">
            {WEEKDAY_LABELS.map((label, day) => (
              <button
                type="button"
                key={day}
                onClick={() => toggleWeekday(day)}
                className={`rounded border px-2 py-1 text-xs font-medium ${
                  form.activeWeekdays.includes(day)
                    ? 'border-gray-900 bg-gray-900 text-white'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Start date</label>
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Grace days (optional)
            </label>
            <input
              type="number"
              min={0}
              value={form.graceDays}
              onChange={(e) => setForm({ ...form, graceDays: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        {/* Two distinct figures, never merged: paymentDayCount is how many
            days the driver actually pays; calendarEndDate is the calendar
            date that lands on. A plan that skips a weekday takes MORE
            calendar days than payment days. */}
        <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm">
          {estimate ? (
            <div className="space-y-1">
              <p className="text-gray-700">
                <span className="font-medium">{estimate.paymentDayCount}</span> payment days
                {estimate.finalInstalment > 0 && (
                  <>
                    {' '}
                    (last day {formatTZS(estimate.finalInstalment)}, the rest at{' '}
                    {formatTZS(dailyAmount)})
                  </>
                )}
              </p>
              <p className="text-gray-700">
                Projected calendar end date:{' '}
                <span className="font-medium">{estimate.calendarEndDate}</span>
              </p>
              <button
                type="button"
                onClick={() =>
                  setForm((prev) => ({ ...prev, contractEndDate: estimate.calendarEndDate }))
                }
                className="text-sm font-medium text-gray-700 hover:underline"
              >
                Use as contract end date
              </button>
            </div>
          ) : (
            <p className="text-gray-500">
              Enter total price, daily amount, start date, and at least one active weekday to see
              the projected term.
            </p>
          )}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Contract end date (optional)
          </label>
          <input
            type="date"
            value={form.contractEndDate}
            onChange={(e) => setForm({ ...form, contractEndDate: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Notes (optional)</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={2}
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
            {submitting ? 'Creating…' : 'Create plan'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function OwnershipPage() {
  const [plans, setPlans] = useState<OwnershipPlan[] | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [motorcycles, setMotorcycles] = useState<Motorcycle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      const [plansData, driversData, motorcyclesData] = await Promise.all([
        apiFetch<OwnershipPlan[]>('/ownership-plans'),
        apiFetch<Driver[]>('/drivers'),
        apiFetch<Motorcycle[]>('/motorcycles'),
      ]);
      setPlans(plansData);
      setDrivers(driversData);
      setMotorcycles(motorcyclesData);
    } catch {
      setError('Could not load ownership plans. Please try again.');
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

  function handleSaved(message: string) {
    setCreating(false);
    setSuccessMessage(message);
    void load();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Ownership plans</h1>
        <button
          onClick={() => setCreating(true)}
          className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
        >
          Create plan
        </button>
      </div>

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
              <th className="px-4 py-2 text-left font-medium text-gray-500">Driver</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Vehicle</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Daily amount</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Paid to date</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Remaining</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Position</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Missed streak</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Recent excusals</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Start</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">End</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Days left</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">
                Projected completion
              </th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {plans === null ? (
              <tr>
                <td colSpan={13} className="px-4 py-6 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : plans.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-4 py-6 text-center text-gray-500">
                  No ownership plans yet.
                </td>
              </tr>
            ) : (
              plans.map((plan) => {
                const severity = positionSeverity(
                  plan.daysBehind,
                  plan.consecutiveMissedDays,
                  plan.graceDays,
                  plan.breachAfterConsecutiveMissedDays,
                );
                return (
                  <tr key={plan.id} className={SEVERITY_ROW_STYLES[severity]}>
                    <td className="px-4 py-2 font-medium text-gray-900">
                      <Link to={`/ownership/${plan.id}`} className="hover:underline">
                        {plan.driver
                          ? `${plan.driver.user.firstName} ${plan.driver.user.lastName}`
                          : '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {plan.motorcycle?.registrationNumber ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-600">
                      {formatTZS(plan.dailyAmount)}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-600">
                      {formatTZS(plan.amountPaid)}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-600">
                      {formatTZS(plan.remainingToOwn)}
                    </td>
                    <td className={`px-4 py-2 ${SEVERITY_TEXT_STYLES[severity]}`}>
                      {positionLabel(plan.daysBehind, plan.daysAhead)}
                    </td>
                    <td className={`px-4 py-2 ${SEVERITY_TEXT_STYLES[severity]}`}>
                      {missedStreakLabel(plan.consecutiveMissedDays)}
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {recentExcusalLabel(plan.recentExcusalCount)}
                    </td>
                    <td className="px-4 py-2 text-gray-600">{plan.startDate.slice(0, 10)}</td>
                    <td className="px-4 py-2 text-gray-600">
                      {plan.contractEndDate ? plan.contractEndDate.slice(0, 10) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-600">{plan.daysLeft ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-600">{plan.projectedCompletion}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={plan.status} styles={OWNERSHIP_PLAN_STATUS_STYLES} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {creating && (
        <CreatePlanFormModal
          drivers={drivers}
          motorcycles={motorcycles}
          onClose={() => setCreating(false)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
