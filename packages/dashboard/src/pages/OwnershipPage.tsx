import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { estimatePlanTerm, positionSeverity, type PlanTermOption } from '@bongofleet/shared-lib';
import { apiFetch, ApiError } from '../lib/api';
import { formatTZS } from '../lib/format';
import type {
  CreateOwnershipPlanPayload,
  Driver,
  Guarantor,
  Motorcycle,
  OwnershipPlan,
  OwnershipSummaryResponse,
} from '../lib/types';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StatusBadge } from '../components/StatusBadge';
import { PageChassis } from '../components/chassis/PageChassis';
import { ChassisGrid, ClosingRow } from '../components/chassis/ChassisGrid';
import { Card } from '../components/chassis/Card';
import type { KpiTile } from '../components/chassis/KpiRail';

const OWNERSHIP_PLAN_STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-blue-100 text-blue-800',
  COMPLETED: 'bg-green-100 text-green-800',
  DEFAULTED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-600',
};

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DEFAULT_ACTIVE_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

const SEVERITY_ROW_STYLES: Record<'ok' | 'amber' | 'red', string> = {
  ok: '',
  amber: 'bg-warn-d',
  red: 'bg-crit-d',
};

const SEVERITY_TEXT_STYLES: Record<'ok' | 'amber' | 'red', string> = {
  ok: 'text-txt-2',
  amber: 'text-warn font-medium',
  red: 'text-crit font-medium',
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
const PAST_DEADLINE_BADGE_STYLES = 'bg-violet-d text-violet';

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
      className="italic text-txt-3"
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
            <label className="mb-1 block text-sm font-medium text-txt">Driver</label>
            <select
              value={form.driverId}
              onChange={(e) => setForm({ ...form, driverId: e.target.value, guarantorId: '' })}
              className="w-full rounded border border-line px-3 py-2 text-sm"
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
            <label className="mb-1 block text-sm font-medium text-txt">Vehicle</label>
            <select
              value={form.motorcycleId}
              onChange={(e) => setForm({ ...form, motorcycleId: e.target.value })}
              className="w-full rounded border border-line px-3 py-2 text-sm"
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
            <label className="mb-1 block text-sm font-medium text-txt">Guarantor (optional)</label>
            <select
              value={form.guarantorId}
              onChange={(e) => setForm({ ...form, guarantorId: e.target.value })}
              disabled={!form.driverId}
              className="w-full rounded border border-line px-3 py-2 text-sm disabled:bg-panel-2"
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
              <label className="mb-1 block text-sm font-medium text-txt">
                Declared value (TZS)
              </label>
              <input
                type="number"
                value={form.totalPrice}
                onChange={(e) => setForm({ ...form, totalPrice: e.target.value })}
                className="w-full rounded border border-line px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-txt-2">
                The vehicle's value, for the contract only - independent of the payment plan below.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-txt">Down payment (TZS)</label>
              <input
                type="number"
                value={form.downPayment}
                onChange={(e) => setForm({ ...form, downPayment: e.target.value })}
                className="w-full rounded border border-line px-3 py-2 text-sm"
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
            <label className="mb-1 block text-sm font-medium text-txt">Active weekdays</label>
            <div className="flex gap-2">
              {WEEKDAY_LABELS.map((label, day) => (
                <button
                  type="button"
                  key={day}
                  onClick={() => toggleWeekday(day)}
                  className={`rounded border px-2 py-1 text-xs font-medium ${
                    form.activeWeekdays.includes(day)
                      ? 'border-gray-900 bg-gray-900 text-white'
                      : 'border-line text-txt-2 hover:bg-panel-2'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-txt">Start date</label>
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              className="w-full rounded border border-line px-3 py-2 text-sm"
            />
          </div>

          {/* Stage G8 - the payment plan itself: daily amount, then a clear
            choice of which of days/total the owner is entering, with the
            other computed live and exactly (total = daily x days, always;
            never the reverse division rounded away). */}
          <div className="rounded border border-line bg-panel-2 p-3">
            <label className="mb-1 block text-sm font-medium text-txt">Daily amount (TZS)</label>
            <input
              type="number"
              value={form.dailyAmount}
              onChange={(e) => setForm({ ...form, dailyAmount: e.target.value })}
              className="mb-3 w-full rounded border border-line px-3 py-2 text-sm"
            />

            <span className="mb-1 block text-sm font-medium text-txt">Then enter the term as</span>
            <div className="mb-3 flex overflow-hidden rounded border border-line text-sm">
              <button
                type="button"
                onClick={() => setForm({ ...form, termMode: 'days', pickedDays: null })}
                className={`flex-1 px-3 py-2 font-medium ${
                  form.termMode === 'days'
                    ? 'bg-gray-900 text-white'
                    : 'bg-panel-2 text-txt-2 hover:bg-panel'
                }`}
              >
                Number of days
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, termMode: 'total', pickedDays: null })}
                className={`flex-1 border-l border-line px-3 py-2 font-medium ${
                  form.termMode === 'total'
                    ? 'bg-gray-900 text-white'
                    : 'bg-panel-2 text-txt-2 hover:bg-panel'
                }`}
              >
                Total (TZS)
              </button>
            </div>

            {form.termMode === 'days' ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-txt">Number of days</label>
                <input
                  type="number"
                  min={1}
                  value={form.days}
                  onChange={(e) => setForm({ ...form, days: e.target.value })}
                  className="w-full rounded border border-line px-3 py-2 text-sm"
                />
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-sm font-medium text-txt">Total (TZS)</label>
                <input
                  type="number"
                  min={1}
                  value={form.total}
                  onChange={(e) => setForm({ ...form, total: e.target.value, pickedDays: null })}
                  className="w-full rounded border border-line px-3 py-2 text-sm"
                />
              </div>
            )}

            <div className="mt-3 rounded border border-line bg-panel p-3 text-sm">
              {notExactOptions ? (
                <div className="space-y-2">
                  <p className="text-txt">
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
                            ? 'border-txt bg-panel-2 ring-1 ring-txt'
                            : 'border-line bg-panel-2 hover:bg-panel'
                        }`}
                      >
                        <span className="block font-medium text-txt">{option.days} days</span>
                        <span className="block text-txt-2">{formatTZS(option.total)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : resolvedTerm ? (
                <div className="space-y-1">
                  <p className="text-txt">
                    <span className="font-medium">{resolvedTerm.days}</span> payment days ={' '}
                    <span className="font-medium">{formatTZS(resolvedTerm.total)}</span>, exactly.
                  </p>
                  <p className="text-txt">
                    Projected calendar end date:{' '}
                    <span className="font-medium">{resolvedTerm.calendarEndDate}</span> — filled in
                    below automatically; edit it if the agreed term is different.
                  </p>
                </div>
              ) : (
                <p className="text-txt-2">
                  Enter the daily amount, start date, at least one active weekday, and the term
                  above to see the projected total and end date.
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-txt">Grace days (optional)</label>
            <input
              type="number"
              min={0}
              value={form.graceDays}
              onChange={(e) => setForm({ ...form, graceDays: e.target.value })}
              className="w-full rounded border border-line px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-txt">Contract end date</label>
            <input
              type="date"
              value={form.contractEndDate}
              onChange={(e) => {
                setEndDateTouched(true);
                setForm({ ...form, contractEndDate: e.target.value });
              }}
              className="w-full rounded border border-line px-3 py-2 text-sm"
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
            <label className="mb-1 block text-sm font-medium text-txt">Notes (optional)</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className="w-full rounded border border-line px-3 py-2 text-sm"
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

// ---- Stage UI3 chassis pieces ----

function kpisToTiles(data: OwnershipSummaryResponse): KpiTile[] {
  const k = data.kpis;
  return [
    { label: 'Active plans', value: String(k.activePlanCount), accentColor: 'c1' },
    { label: 'On schedule', value: String(k.onScheduleCount), accentColor: 'good' },
    {
      label: 'Slipping',
      value: String(k.slippingCount),
      accentColor: k.slippingCount > 0 ? 'warn' : 'good',
    },
    {
      label: 'To terminate',
      value: String(k.toTerminateCount),
      accentColor: k.toTerminateCount > 0 ? 'crit' : 'good',
    },
    { label: 'Finishing early', value: String(k.finishingEarlyCount), accentColor: 'violet' },
    {
      label: 'Money at risk',
      value: formatTZS(k.moneyAtRisk),
      accentColor: k.moneyAtRisk !== '0.00' ? 'crit' : 'good',
    },
  ];
}

function PlanHealthCard({ health }: { health: OwnershipSummaryResponse['planHealth'] }) {
  const total = health.onSchedule + health.slipping + health.toTerminate + health.finishingEarly;
  const segments: { label: string; count: number; barColor: string; textColor: string }[] = [
    { label: 'On schedule', count: health.onSchedule, barColor: 'bg-good', textColor: 'text-good' },
    { label: 'Slipping', count: health.slipping, barColor: 'bg-warn', textColor: 'text-warn' },
    {
      label: 'To terminate',
      count: health.toTerminate,
      barColor: 'bg-crit',
      textColor: 'text-crit',
    },
    {
      label: 'Finishing early',
      count: health.finishingEarly,
      barColor: 'bg-violet',
      textColor: 'text-violet',
    },
  ];
  return (
    <Card title="Plan health">
      <div className="p-4">
        {total === 0 ? (
          <p className="text-sm text-txt-2">No active plans yet.</p>
        ) : (
          <>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-panel-2">
              {segments.map((s) => (
                <div
                  key={s.label}
                  className={s.barColor}
                  style={{ width: `${(s.count / total) * 100}%` }}
                  title={`${s.label}: ${s.count}`}
                />
              ))}
            </div>
            <ul className="mt-3 space-y-1.5 text-sm">
              {segments.map((s) => (
                <li key={s.label} className="flex items-center justify-between">
                  <span className="text-txt-2">{s.label}</span>
                  <span className={`font-medium ${s.textColor}`}>{s.count}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
}

function OwnershipInsightsCard({ insights }: { insights: OwnershipSummaryResponse['insights'] }) {
  return (
    <Card title="AI Insights">
      {insights.length === 0 ? (
        <p className="p-4 text-sm text-txt-2">Nothing to flag right now.</p>
      ) : (
        <div className="divide-y divide-line-soft">
          {insights.map((insight, i) => (
            <div key={i} className="px-4 py-3">
              <p className="text-sm font-medium text-txt">{insight.title}</p>
              <p className="mt-1 text-xs text-txt-2">{insight.description}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ExpectedCompletionsCard({
  points,
}: {
  points: OwnershipSummaryResponse['expectedCompletions'];
}) {
  const max = Math.max(...points.map((p) => p.count), 1);
  return (
    <Card title="Expected completions" subtitle="next 18 months">
      <div className="flex h-28 items-end gap-1 overflow-x-auto px-4 pb-4">
        {points.map((p) => (
          <div key={p.month} className="flex w-6 shrink-0 flex-col items-center gap-1">
            <div
              className="w-full rounded-t bg-c1"
              style={{ height: `${Math.max(2, (p.count / max) * 100)}%` }}
              title={`${p.month}: ${p.count}`}
            />
            <span className="text-[9px] whitespace-nowrap text-txt-3">{p.month.slice(2)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

const VERDICT_STYLES: Record<'Terminate' | 'Watch', string> = {
  Terminate: 'bg-crit-d text-crit',
  Watch: 'bg-warn-d text-warn',
};

function MissedDaysTable({ rows }: { rows: OwnershipSummaryResponse['missedDaysTable'] }) {
  return (
    <Card
      title="Missed days and what they are worth"
      subtitle={rows.length > 0 ? String(rows.length) : undefined}
    >
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-txt-2">No plan is currently behind or in a missed streak.</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line-soft text-left text-xs text-txt-3">
                  <th className="px-4 py-2 font-medium">Driver</th>
                  <th className="px-4 py-2 font-medium">Vehicle</th>
                  <th className="px-4 py-2 text-right font-medium">Missed streak</th>
                  <th className="px-4 py-2 text-right font-medium">Value at risk</th>
                  <th className="px-4 py-2 text-right font-medium">Recent excusals</th>
                  <th className="px-4 py-2 font-medium">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.planId} className="border-b border-line-soft last:border-0">
                    <td className="px-4 py-2 font-medium text-txt">
                      <Link to={`/ownership/${r.planId}`} className="hover:underline">
                        {r.driverName}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-txt-2">{r.vehicleRegistration ?? '—'}</td>
                    <td className="px-4 py-2 text-right text-txt-2">
                      {r.missedStreak} day{r.missedStreak === 1 ? '' : 's'}
                    </td>
                    <td className="px-4 py-2 text-right text-txt-2">{formatTZS(r.valueAtRisk)}</td>
                    <td className="px-4 py-2 text-right text-txt-2">
                      {r.recentExcusalCount || '—'}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${VERDICT_STYLES[r.verdict]}`}
                      >
                        {r.verdict}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden">
            {rows.map((r) => (
              <div key={r.planId} className="border-b border-line-soft px-4 py-3 last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    to={`/ownership/${r.planId}`}
                    className="font-medium text-txt hover:underline"
                  >
                    {r.driverName}
                  </Link>
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-medium ${VERDICT_STYLES[r.verdict]}`}
                  >
                    {r.verdict}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-txt-2">{r.vehicleRegistration ?? '—'}</p>
                <div className="mt-1 flex items-center justify-between text-xs text-txt-2">
                  <span>
                    {r.missedStreak} day{r.missedStreak === 1 ? '' : 's'} missed ·{' '}
                    {r.recentExcusalCount || '—'} recent excusals
                  </span>
                  <span className="text-sm font-medium text-txt">{formatTZS(r.valueAtRisk)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function ContractValueCard({
  totals,
}: {
  totals: OwnershipSummaryResponse['contractValueTotals'];
}) {
  const total = Math.max(parseFloat(totals.totalOwed), 1);
  const segments = [
    { label: 'Paid in', amount: totals.paidIn, barColor: 'bg-good' },
    { label: 'At risk', amount: totals.atRisk, barColor: 'bg-crit' },
    { label: 'Still to come', amount: totals.stillToCome, barColor: 'bg-panel-2' },
  ];
  return (
    <Card title="Contract value across all plans">
      <div className="p-4">
        <p className="text-2xl font-semibold text-txt">{formatTZS(totals.collectedToDate)}</p>
        <p className="text-xs text-txt-2">
          collected to date of {formatTZS(totals.totalOwed)} owed
        </p>
        <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-panel-2">
          {segments.map((s) => (
            <div
              key={s.label}
              className={s.barColor}
              style={{ width: `${(parseFloat(s.amount) / total) * 100}%` }}
              title={`${s.label}: ${formatTZS(s.amount)}`}
            />
          ))}
        </div>
        <ul className="mt-3 space-y-1 text-xs">
          {segments.map((s) => (
            <li key={s.label} className="flex items-center justify-between">
              <span className="text-txt-2">{s.label}</span>
              <span className="text-txt">{formatTZS(s.amount)}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function TwoBalancesCard({ balances }: { balances: OwnershipSummaryResponse['twoBalances'] }) {
  return (
    <Card title="Two balances, never one">
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-txt-2">Remaining to own</p>
          <p className="mt-1 text-lg font-semibold text-txt [overflow-wrap:anywhere]">
            {formatTZS(balances.remainingToOwn)}
          </p>
          <p className="text-[11px] text-txt-3">what drivers still owe</p>
        </div>
        <div>
          <p className="text-xs text-txt-2">Remaining to bill</p>
          <p className="mt-1 text-lg font-semibold text-txt [overflow-wrap:anywhere]">
            {formatTZS(balances.remainingToBill)}
          </p>
          <p className="text-[11px] text-txt-3">what the generator may still bill</p>
        </div>
        <div>
          <p className="text-xs text-txt-2">Arrears</p>
          <p
            className={`mt-1 text-lg font-semibold [overflow-wrap:anywhere] ${balances.arrears !== '0.00' ? 'text-crit' : 'text-txt'}`}
          >
            {formatTZS(balances.arrears)}
          </p>
          <p className="text-[11px] text-txt-3">billed but not yet paid</p>
        </div>
      </div>
    </Card>
  );
}

export function OwnershipPage() {
  const [plans, setPlans] = useState<OwnershipPlan[] | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [motorcycles, setMotorcycles] = useState<Motorcycle[]>([]);
  const [summary, setSummary] = useState<OwnershipSummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      const [plansData, driversData, motorcyclesData, summaryData] = await Promise.all([
        apiFetch<OwnershipPlan[]>('/ownership-plans'),
        apiFetch<Driver[]>('/drivers'),
        apiFetch<Motorcycle[]>('/motorcycles'),
        apiFetch<OwnershipSummaryResponse>('/ownership-plans/summary'),
      ]);
      setPlans(plansData);
      setDrivers(driversData);
      setMotorcycles(motorcyclesData);
      setSummary(summaryData);
      setError(null);
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

  if (error && !summary) {
    return <p className="text-sm text-crit">{error}</p>;
  }
  if (!summary || !plans) {
    return <p className="text-sm text-txt-2">Loading…</p>;
  }

  return (
    <PageChassis
      title="Ownership plans"
      statusPill={{ mode: 'live', text: 'LIVE' }}
      primaryAction={{ label: 'Create plan', onClick: () => setCreating(true) }}
      kpis={kpisToTiles(summary)}
    >
      {successMessage && (
        <p className="rounded bg-good-d px-3 py-2 text-sm text-good-x">{successMessage}</p>
      )}
      {error && <p className="rounded bg-crit-d px-3 py-2 text-sm text-crit-x">{error}</p>}

      <ChassisGrid
        main={
          <Card title="All plans" subtitle={`${plans.length} shown`}>
            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-line-soft text-left text-xs text-txt-3">
                    <th className="px-4 py-2 font-medium">Driver</th>
                    <th className="px-4 py-2 font-medium">Vehicle</th>
                    <th className="px-4 py-2 text-right font-medium">Daily amount</th>
                    <th className="px-4 py-2 font-medium">Progress</th>
                    <th className="px-4 py-2 text-right font-medium">Remaining</th>
                    <th className="px-4 py-2 font-medium">Position</th>
                    <th className="px-4 py-2 font-medium">Missed streak</th>
                    <th className="px-4 py-2 font-medium">Recent excusals</th>
                    <th className="px-4 py-2 font-medium">Start</th>
                    <th className="px-4 py-2 font-medium">End</th>
                    <th className="px-4 py-2 text-right font-medium">Days left</th>
                    <th className="px-4 py-2 font-medium">Projected completion</th>
                    <th className="px-4 py-2 font-medium">Deadline</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.length === 0 ? (
                    <tr>
                      <td colSpan={14} className="px-4 py-6 text-center text-txt-2">
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
                      const totalOwed =
                        parseFloat(plan.amountPaid) + parseFloat(plan.remainingToOwn);
                      const progressPct =
                        totalOwed > 0
                          ? Math.min(100, (parseFloat(plan.amountPaid) / totalOwed) * 100)
                          : 0;
                      return (
                        <tr
                          key={plan.id}
                          className={`border-b border-line-soft last:border-0 ${SEVERITY_ROW_STYLES[severity]}`}
                        >
                          <td className="px-4 py-2 font-medium text-txt">
                            <Link to={`/ownership/${plan.id}`} className="hover:underline">
                              {plan.driver
                                ? `${plan.driver.user.firstName} ${plan.driver.user.lastName}`
                                : '—'}
                            </Link>
                          </td>
                          <td className="px-4 py-2 text-txt-2">
                            {plan.motorcycle?.registrationNumber ?? '—'}
                          </td>
                          <td className="px-4 py-2 text-right text-txt-2">
                            {formatTZS(plan.dailyAmount)}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-panel-2">
                                <div
                                  className="h-full bg-c1"
                                  style={{ width: `${progressPct}%` }}
                                />
                              </div>
                              <span className="text-xs text-txt-3">{Math.round(progressPct)}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right text-txt-2">
                            {formatTZS(plan.remainingToOwn)}
                          </td>
                          <td className={`px-4 py-2 ${SEVERITY_TEXT_STYLES[severity]}`}>
                            {positionLabel(plan.daysBehind, plan.daysAhead)}
                          </td>
                          <td className={`px-4 py-2 ${SEVERITY_TEXT_STYLES[severity]}`}>
                            {missedStreakLabel(plan.consecutiveMissedDays)}
                          </td>
                          <td className="px-4 py-2 text-txt-2">
                            {recentExcusalLabel(plan.recentExcusalCount)}
                          </td>
                          <td className="px-4 py-2 text-txt-2">{plan.startDate.slice(0, 10)}</td>
                          <td className="px-4 py-2 text-txt-2">
                            <EndDateCell
                              contractEndDate={plan.contractEndDate}
                              derivedEndDate={plan.derivedEndDate}
                            />
                          </td>
                          <td className="px-4 py-2 text-right text-txt-2">{plan.daysLeft}</td>
                          <td className="px-4 py-2 text-txt-2">{plan.projectedCompletion}</td>
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
                            <StatusBadge
                              status={plan.status}
                              styles={OWNERSHIP_PLAN_STATUS_STYLES}
                            />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="md:hidden">
              {plans.length === 0 ? (
                <p className="p-4 text-center text-sm text-txt-2">No ownership plans yet.</p>
              ) : (
                plans.map((plan) => {
                  const severity = positionSeverity(
                    plan.daysBehind,
                    plan.consecutiveMissedDays,
                    plan.graceDays,
                    plan.breachAfterConsecutiveMissedDays,
                  );
                  const totalOwed = parseFloat(plan.amountPaid) + parseFloat(plan.remainingToOwn);
                  const progressPct =
                    totalOwed > 0
                      ? Math.min(100, (parseFloat(plan.amountPaid) / totalOwed) * 100)
                      : 0;
                  const severityBorder =
                    severity === 'red'
                      ? 'border-l-[3px] border-l-crit'
                      : severity === 'amber'
                        ? 'border-l-[3px] border-l-warn'
                        : '';
                  return (
                    <div
                      key={plan.id}
                      className={`border-b border-line-soft px-4 py-3 last:border-0 ${severityBorder}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Link
                          to={`/ownership/${plan.id}`}
                          className="font-medium text-txt hover:underline"
                        >
                          {plan.driver
                            ? `${plan.driver.user.firstName} ${plan.driver.user.lastName}`
                            : '—'}
                        </Link>
                        <StatusBadge status={plan.status} styles={OWNERSHIP_PLAN_STATUS_STYLES} />
                      </div>
                      <p className="mt-0.5 text-xs text-txt-2">
                        {plan.motorcycle?.registrationNumber ?? '—'}
                      </p>
                      {plan.pastDeadlineStillOwing && (
                        <span
                          className={`mt-1 inline-block rounded px-1.5 py-0.5 text-xs font-medium ${PAST_DEADLINE_BADGE_STYLES}`}
                        >
                          Past deadline, still owing
                        </span>
                      )}
                      <div className="mt-2 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2">
                          <div className="h-full bg-c1" style={{ width: `${progressPct}%` }} />
                        </div>
                        <span className="text-xs text-txt-3">{Math.round(progressPct)}%</span>
                      </div>
                      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                        <div>
                          <dt className="text-txt-3">Daily amount</dt>
                          <dd className="text-txt">{formatTZS(plan.dailyAmount)}</dd>
                        </div>
                        <div>
                          <dt className="text-txt-3">Remaining</dt>
                          <dd className="text-txt">{formatTZS(plan.remainingToOwn)}</dd>
                        </div>
                        <div>
                          <dt className="text-txt-3">Position</dt>
                          <dd className={SEVERITY_TEXT_STYLES[severity]}>
                            {positionLabel(plan.daysBehind, plan.daysAhead)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-txt-3">Missed streak</dt>
                          <dd className={SEVERITY_TEXT_STYLES[severity]}>
                            {missedStreakLabel(plan.consecutiveMissedDays)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-txt-3">Recent excusals</dt>
                          <dd className="text-txt">
                            {recentExcusalLabel(plan.recentExcusalCount)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-txt-3">Start</dt>
                          <dd className="text-txt">{plan.startDate.slice(0, 10)}</dd>
                        </div>
                        <div>
                          <dt className="text-txt-3">End</dt>
                          <dd className="text-txt">
                            <EndDateCell
                              contractEndDate={plan.contractEndDate}
                              derivedEndDate={plan.derivedEndDate}
                            />
                          </dd>
                        </div>
                        <div>
                          <dt className="text-txt-3">Days left</dt>
                          <dd className="text-txt">{plan.daysLeft}</dd>
                        </div>
                        <div className="col-span-2">
                          <dt className="text-txt-3">Projected completion</dt>
                          <dd className="text-txt">{plan.projectedCompletion}</dd>
                        </div>
                      </dl>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        }
        rail={
          <>
            <PlanHealthCard health={summary.planHealth} />
            <OwnershipInsightsCard insights={summary.insights} />
            <ExpectedCompletionsCard points={summary.expectedCompletions} />
          </>
        }
      />

      <MissedDaysTable rows={summary.missedDaysTable} />

      <ClosingRow
        left={<ContractValueCard totals={summary.contractValueTotals} />}
        right={<TwoBalancesCard balances={summary.twoBalances} />}
      />

      {creating && (
        <CreatePlanFormModal
          drivers={drivers}
          motorcycles={motorcycles}
          onClose={() => setCreating(false)}
          onSaved={handleSaved}
        />
      )}
    </PageChassis>
  );
}
