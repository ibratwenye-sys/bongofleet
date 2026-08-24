import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { estimatePlanTerm, type PlanTermOption } from '@bongofleet/shared-lib';
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
import { ConfirmDialog } from '../components/ConfirmDialog';
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

/** Stage G10 - a THIRD signal, deliberately separate from positionSeverity's
 *  amber/red (daysBehind vs graceDays; consecutiveMissedDays vs breach) -
 *  a date condition, not a payment-streak condition. Purple, not reusing
 *  amber/red, so it never reads as "the same thing as being behind". */
const PAST_DEADLINE_BADGE_STYLES = 'bg-purple-100 text-purple-800';

/** Stage G5 Part 3 - a count, not a flag and not a limit: there is no
 *  threshold this turns red at. The point is only to make "excused twelve
 *  days this quarter" visible instead of invisible one day at a time, so an
 *  owner can go have that conversation. */
function recentExcusalLabel(recentExcusalCount: number): string {
  if (recentExcusalCount <= 0) return '—';
  return `${recentExcusalCount} in last 90 days`;
}

/** Stage H1 - contractEndDate (what was actually typed into the contract)
 *  and derivedEndDate (what the plan's own terms - instalmentCount days from
 *  startDate - work out to) are never the same field: an owner reading this
 *  column needs to be able to tell which one they're looking at, not just
 *  see a date. contractEndDate is now never re-derived on the client and
 *  derivedEndDate is never presented as if it were agreed - see
 *  ownership-plan.derivation.ts. */
function EndDateCell({
  contractEndDate,
  derivedEndDate,
}: {
  contractEndDate: string | null;
  derivedEndDate: string;
}) {
  if (contractEndDate) {
    return <span>{contractEndDate.slice(0, 10)}</span>;
  }
  return (
    <span
      className="italic text-gray-500"
      title="Not typed into the contract - worked out from the plan's own terms (days, start date, active weekdays)."
    >
      {derivedEndDate} (derived)
    </span>
  );
}

/** Stage G8 - the owner always enters the daily amount, then picks which of
 *  the other two (days or total) they enter; the remaining one is computed
 *  live, never both entered by hand. */
type TermMode = 'days' | 'total';

interface CreateFormState {
  driverId: string;
  motorcycleId: string;
  guarantorId: string;
  totalPrice: string;
  downPayment: string;
  // Stage G10 (§9e) - only offered (and only sent) once downPayment is
  // actually entered; default APPLIED matches the server's own default.
  depositHandling: 'APPLIED' | 'HELD_REFUNDABLE';
  dailyAmount: string;
  termMode: TermMode;
  days: string;
  total: string;
  // Set only when termMode is 'total' and the total does not divide evenly
  // by dailyAmount - the day count the owner picked from the two
  // neighbouring whole-day options. Cleared whenever total/dailyAmount
  // changes, so a stale pick from a previous total can never silently ride
  // along to a new one.
  pickedDays: number | null;
  startDate: string;
  contractEndDate: string;
  activeWeekdays: number[];
  graceDays: string;
  notes: string;
}

function todayDateInput(): string {
  return new Date().toISOString().slice(0, 10);
}

// estimatePlanTerm throws on inputs it can't compute a term from (e.g. an
// empty activeWeekdays array). Every call here sits directly in the render
// path, so a throw would unmount the whole modal instead of just leaving the
// estimate blank - catch it at the boundary and treat it the same as "not
// enough input yet" rather than ever letting it reach React.
function safeEstimatePlanTerm(
  input: Parameters<typeof estimatePlanTerm>[0],
): ReturnType<typeof estimatePlanTerm> | null {
  try {
    return estimatePlanTerm(input);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('estimatePlanTerm could not compute a term for the current input', err);
    return null;
  }
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
    depositHandling: 'APPLIED',
    dailyAmount: '',
    termMode: 'days',
    days: '',
    total: '',
    pickedDays: null,
    startDate: todayDateInput(),
    contractEndDate: '',
    activeWeekdays: DEFAULT_ACTIVE_WEEKDAYS,
    graceDays: '',
    notes: '',
  });
  const [guarantors, setGuarantors] = useState<Guarantor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Stage G6 Part 1 - once the owner has touched the end-date field
  // (typed in it, or cleared it), stop overwriting their choice with the
  // estimate. Before that, the estimate IS the field's value: prefilling
  // beats "offering" it via a button, because a blank end date should mean
  // someone deliberately cleared it, not that nobody clicked a button.
  const [endDateTouched, setEndDateTouched] = useState(false);
  const [confirmingNoEndDate, setConfirmingNoEndDate] = useState(false);

  useEffect(() => {
    if (!form.driverId) {
      setGuarantors([]);
      return;
    }
    apiFetch<Guarantor[]>(`/drivers/${form.driverId}/guarantors`)
      .then(setGuarantors)
      .catch(() => setGuarantors([]));
  }, [form.driverId]);

  const totalPrice = Number(form.totalPrice);
  const downPayment = Number(form.downPayment || 0);
  const dailyAmount = Number(form.dailyAmount);
  const canEstimateBase =
    form.dailyAmount !== '' &&
    Number.isFinite(dailyAmount) &&
    dailyAmount > 0 &&
    form.startDate !== '' &&
    form.activeWeekdays.length > 0;

  // Stage G8 - the owner enters daily amount plus EITHER days OR total
  // (form.termMode); the other is computed live via estimatePlanTerm
  // (shared-lib), the same function the backend tests against the real
  // daily-charge generator. Never reimplemented here.
  //
  // "total" mode is the only one that can fail to divide evenly - "days"
  // mode is exact by construction (total = daily x days). When it doesn't
  // divide evenly, nothing is rounded and nothing is blocked: both
  // neighbouring whole-day options are shown (notExactOptions below) and the
  // owner picks one (form.pickedDays). Once a day count is settled - by
  // typing it directly, or by picking an option - resolvedDays is that
  // number, and everything else (the exact total, the calendar end date) is
  // derived from it via one more estimatePlanTerm call, in "days" mode,
  // which is always exact.
  let resolvedDays: number | null = null;
  let notExactOptions: [PlanTermOption, PlanTermOption] | null = null;

  if (canEstimateBase) {
    if (form.termMode === 'days') {
      const days = Number(form.days);
      if (form.days !== '' && Number.isFinite(days) && days > 0) {
        resolvedDays = days;
      }
    } else {
      const total = Number(form.total);
      if (form.total !== '' && Number.isFinite(total) && total > 0) {
        const result = safeEstimatePlanTerm({
          dailyAmount,
          total,
          startDate: form.startDate,
          activeWeekdays: form.activeWeekdays,
        });
        if (result?.exact) {
          resolvedDays = result.days;
        } else if (result) {
          notExactOptions = result.options;
          if (
            form.pickedDays === result.options[0].days ||
            form.pickedDays === result.options[1].days
          ) {
            resolvedDays = form.pickedDays;
          }
        }
      }
    }
  }

  const estimate =
    canEstimateBase && resolvedDays !== null
      ? safeEstimatePlanTerm({
          dailyAmount,
          days: resolvedDays,
          startDate: form.startDate,
          activeWeekdays: form.activeWeekdays,
        })
      : null;

  // estimate is always the exact-days shape here (constructed from a settled
  // resolvedDays via the "days" input variant, never "total"), but
  // estimatePlanTerm's return type doesn't know that statically - narrow it
  // once, here.
  const resolvedTerm = estimate?.exact ? estimate : null;

  // Stage G6 Part 1 - prefill, not offer: as soon as there's enough input to
  // project a calendar end date, that becomes the field's value. Stops the
  // instant the owner touches the field themselves (see endDateTouched).
  useEffect(() => {
    if (!endDateTouched && resolvedTerm) {
      setForm((prev) => ({ ...prev, contractEndDate: resolvedTerm.calendarEndDate }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTerm?.calendarEndDate, endDateTouched]);

  function toggleWeekday(day: number) {
    setForm((prev) => ({
      ...prev,
      activeWeekdays: prev.activeWeekdays.includes(day)
        ? prev.activeWeekdays.filter((d) => d !== day)
        : [...prev.activeWeekdays, day].sort(),
    }));
  }

  async function submitPlan() {
    if (resolvedDays === null) return; // handleSubmit already guarded this
    setSubmitting(true);
    try {
      const payload: CreateOwnershipPlanPayload = {
        driverId: form.driverId,
        motorcycleId: form.motorcycleId,
        guarantorId: form.guarantorId || undefined,
        dailyAmount,
        instalmentCount: resolvedDays,
        totalPrice,
        downPayment: form.downPayment ? downPayment : undefined,
        depositHandling: form.downPayment ? form.depositHandling : undefined,
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.driverId || !form.motorcycleId) {
      setError('Driver and vehicle are required.');
      return;
    }
    if (!form.totalPrice || totalPrice <= 0) {
      setError('Enter a valid declared value.');
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
    if (resolvedDays === null) {
      setError(
        form.termMode === 'total' && notExactOptions
          ? 'Pick one of the two day-count options below before creating the plan.'
          : 'Enter the number of days or the total to determine the term.',
      );
      return;
    }

    // Stage G6 Part 1/3 - a blank end date at this point was a deliberate
    // clear (prefill already put the estimate there otherwise), but the cost
    // is real and the printed contract is the one place it can't be quietly
    // fixed later. Say what it costs, concretely, before it's submitted.
    if (!form.contractEndDate) {
      setConfirmingNoEndDate(true);
      return;
    }

    await submitPlan();
  }

  return (
    <>
      <Modal title="Create ownership plan" onClose={onClose}>
        {/* Stage H0d - this form used to carry its own
            `max-h-[75vh] overflow-y-auto pr-1`, a local workaround for the
            shared Modal having no scrolling of its own. Modal now bounds and
            scrolls its body for every caller, so keeping this would nest a
            second scroll region inside the first. */}
        <form onSubmit={handleSubmit} className="space-y-3">
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Declared value (TZS)
              </label>
              <input
                type="number"
                value={form.totalPrice}
                onChange={(e) => setForm({ ...form, totalPrice: e.target.value })}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">
                The vehicle's value, for the contract only - independent of the payment plan below.
              </p>
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
              {/* Stage G10 (§9e) - only shown once a down payment is actually
                  entered; there is nothing to choose between otherwise. */}
              {form.downPayment && Number(form.downPayment) > 0 && (
                <div className="mt-2 flex gap-3 text-sm">
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="radio"
                      name="depositHandling"
                      checked={form.depositHandling === 'APPLIED'}
                      onChange={() => setForm({ ...form, depositHandling: 'APPLIED' })}
                    />
                    Applied to schedule
                  </label>
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="radio"
                      name="depositHandling"
                      checked={form.depositHandling === 'HELD_REFUNDABLE'}
                      onChange={() => setForm({ ...form, depositHandling: 'HELD_REFUNDABLE' })}
                    />
                    Held, refundable
                  </label>
                </div>
              )}
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

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Start date</label>
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          {/* Stage G8 - the payment plan itself: daily amount, then a clear
            choice of which of days/total the owner is entering, with the
            other computed live and exactly (total = daily x days, always;
            never the reverse division rounded away). */}
          <div className="rounded border border-gray-300 bg-white p-3">
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Daily amount (TZS)
            </label>
            <input
              type="number"
              value={form.dailyAmount}
              onChange={(e) => setForm({ ...form, dailyAmount: e.target.value })}
              className="mb-3 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />

            <span className="mb-1 block text-sm font-medium text-gray-700">
              Then enter the term as
            </span>
            <div className="mb-3 flex overflow-hidden rounded border border-gray-300 text-sm">
              <button
                type="button"
                onClick={() => setForm({ ...form, termMode: 'days', pickedDays: null })}
                className={`flex-1 px-3 py-2 font-medium ${
                  form.termMode === 'days'
                    ? 'bg-gray-900 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Number of days
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, termMode: 'total', pickedDays: null })}
                className={`flex-1 border-l border-gray-300 px-3 py-2 font-medium ${
                  form.termMode === 'total'
                    ? 'bg-gray-900 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Total (TZS)
              </button>
            </div>

            {form.termMode === 'days' ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Number of days
                </label>
                <input
                  type="number"
                  min={1}
                  value={form.days}
                  onChange={(e) => setForm({ ...form, days: e.target.value })}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Total (TZS)</label>
                <input
                  type="number"
                  min={1}
                  value={form.total}
                  onChange={(e) => setForm({ ...form, total: e.target.value, pickedDays: null })}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
            )}

            <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-3 text-sm">
              {notExactOptions ? (
                <div className="space-y-2">
                  <p className="text-gray-700">
                    {formatTZS(Number(form.total))} does not divide evenly by{' '}
                    {formatTZS(dailyAmount)}/day. Pick the term to use - settle the difference with
                    the driver now, not on the printed contract:
                  </p>
                  <div className="flex gap-2">
                    {notExactOptions.map((option) => (
                      <button
                        type="button"
                        key={option.days}
                        onClick={() => setForm({ ...form, pickedDays: option.days })}
                        className={`flex-1 rounded border px-3 py-2 text-left ${
                          form.pickedDays === option.days
                            ? 'border-gray-900 bg-white ring-1 ring-gray-900'
                            : 'border-gray-300 bg-white hover:bg-gray-100'
                        }`}
                      >
                        <span className="block font-medium text-gray-900">{option.days} days</span>
                        <span className="block text-gray-600">{formatTZS(option.total)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : resolvedTerm ? (
                <div className="space-y-1">
                  <p className="text-gray-700">
                    <span className="font-medium">{resolvedTerm.days}</span> payment days ={' '}
                    <span className="font-medium">{formatTZS(resolvedTerm.total)}</span>, exactly.
                  </p>
                  <p className="text-gray-700">
                    Projected calendar end date:{' '}
                    <span className="font-medium">{resolvedTerm.calendarEndDate}</span> — filled in
                    below automatically; edit it if the agreed term is different.
                  </p>
                </div>
              ) : (
                <p className="text-gray-500">
                  Enter the daily amount, start date, at least one active weekday, and the term
                  above to see the projected total and end date.
                </p>
              )}
            </div>
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

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Contract end date
            </label>
            <input
              type="date"
              value={form.contractEndDate}
              onChange={(e) => {
                setEndDateTouched(true);
                setForm({ ...form, contractEndDate: e.target.value });
              }}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
            {/* Stage G6 Part 2 - the consequence has to be visible at the field,
              live, while the owner is still looking at it - a submit-time
              warning is too late for someone who half-typed a date and moved
              on without noticing it didn't take. */}
            {!form.contractEndDate && (
              <p className="mt-1 text-xs text-amber-700">
                No end date - this plan will have no agreed term, and the contract will print a
                blank where the end date belongs.
              </p>
            )}
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
      {confirmingNoEndDate && (
        <ConfirmDialog
          title="No contract end date"
          message="This plan will have no agreed end date, and the generated contract will print a blank where the term should be. Create it anyway?"
          confirmLabel="Create anyway"
          danger
          onConfirm={() => {
            setConfirmingNoEndDate(false);
            void submitPlan();
          }}
          onCancel={() => setConfirmingNoEndDate(false)}
        />
      )}
    </>
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

      {/* Stage H0e - the phone view of this page. Thirteen columns is the
          right answer at a desk and a useless one on a handset: finding
          "days behind" meant scrolling sideways past eight other columns.
          These cards are not the table shrunk - they carry the four things
          that answer the question this page exists to answer ("who do I
          need to worry about today"): who, how far behind or ahead, the
          missed streak, and what is still owed. Everything else stays one
          tap away on the plan itself. The table below is untouched and
          simply takes over at md. */}
      <ul className="space-y-3 md:hidden">
        {plans === null ? (
          <li className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">
            Loading…
          </li>
        ) : plans.length === 0 ? (
          <li className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">
            No ownership plans yet.
          </li>
        ) : (
          plans.map((plan) => {
            const severity = positionSeverity(
              plan.daysBehind,
              plan.consecutiveMissedDays,
              plan.graceDays,
              plan.breachAfterConsecutiveMissedDays,
            );
            return (
              <li key={plan.id}>
                {/* The whole card is the tap target, not just the name - a
                    44px-tall link inside a card is a smaller thing to hit
                    than the card itself. */}
                <Link
                  to={`/ownership/${plan.id}`}
                  className={`block rounded-lg border border-gray-200 p-4 ${SEVERITY_ROW_STYLES[severity]}`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-gray-900">
                      {plan.driver
                        ? `${plan.driver.user.firstName} ${plan.driver.user.lastName}`
                        : '—'}
                    </span>
                    <div className="flex items-center gap-1">
                      {plan.pastDeadlineStillOwing && (
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs font-medium ${PAST_DEADLINE_BADGE_STYLES}`}
                        >
                          Past deadline
                        </span>
                      )}
                      <StatusBadge status={plan.status} styles={OWNERSHIP_PLAN_STATUS_STYLES} />
                    </div>
                  </div>
                  <p className={`mt-1 text-sm ${SEVERITY_TEXT_STYLES[severity]}`}>
                    {positionLabel(plan.daysBehind, plan.daysAhead)}
                    {plan.consecutiveMissedDays > 0 && (
                      <> · {missedStreakLabel(plan.consecutiveMissedDays)}</>
                    )}
                  </p>
                  <p className="mt-2 text-sm text-gray-600">
                    {formatTZS(plan.remainingToOwn)} remaining
                  </p>
                </Link>
              </li>
            );
          })
        )}
      </ul>

      <div className="hidden overflow-x-auto rounded-lg border border-gray-200 bg-white md:block">
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
              <th className="px-4 py-2 text-left font-medium text-gray-500">Deadline</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {plans === null ? (
              <tr>
                <td colSpan={14} className="px-4 py-6 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : plans.length === 0 ? (
              <tr>
                <td colSpan={14} className="px-4 py-6 text-center text-gray-500">
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
                      <EndDateCell
                        contractEndDate={plan.contractEndDate}
                        derivedEndDate={plan.derivedEndDate}
                      />
                    </td>
                    <td className="px-4 py-2 text-right text-gray-600">{plan.daysLeft}</td>
                    <td className="px-4 py-2 text-gray-600">{plan.projectedCompletion}</td>
                    <td className="px-4 py-2">
                      {plan.pastDeadlineStillOwing && (
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs font-medium ${PAST_DEADLINE_BADGE_STYLES}`}
                        >
                          Past deadline, still owing
                        </span>
                      )}
                    </td>
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
