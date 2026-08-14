import { useMemo, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import type {
  Assignment,
  CreatePaymentPayload,
  Driver,
  DriverSearchResult,
  Motorcycle,
} from '../lib/types';
import { Modal } from './Modal';
import { DriverPicker } from './DriverPicker';

const PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER'];

function driverName(drivers: Driver[], driverId: string): string {
  const driver = drivers.find((d) => d.id === driverId);
  return driver ? `${driver.user.firstName} ${driver.user.lastName}` : 'Unknown driver';
}

function assignmentLabel(
  assignment: Assignment,
  drivers: Driver[],
  motorcycles: Motorcycle[],
): string {
  const motorcycle = motorcycles.find((m) => m.id === assignment.motorcycleId);
  const target = Number(assignment.targetAmount).toLocaleString();
  return `${assignment.assignedDate.slice(0, 10)} — ${driverName(drivers, assignment.driverId)} — ${
    motorcycle?.registrationNumber ?? 'Unknown bike'
  } — target ${target} TZS`;
}

export function PaymentFormModal({
  assignments,
  drivers,
  motorcycles,
  lockedAssignment,
  onClose,
  onSaved,
}: {
  assignments: Assignment[];
  drivers: Driver[];
  motorcycles: Motorcycle[];
  lockedAssignment?: Assignment;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  // Stage G6 Part 2 - "rent-to-own" (search a driver, pay against their
  // hire-purchase plan) vs "regular" (the original flat assignment picker,
  // unchanged). Both still resolve to one dailyAssignmentId at submit time -
  // payment.service.ts's overpayment allocation already spreads a
  // rent-to-own payment across that plan's oldest unpaid assignments no
  // matter which one of the plan's assignments is named here, so any of
  // them is a valid anchor; the most recent is the least surprising choice.
  const [mode, setMode] = useState<'rentToOwn' | 'regular'>('rentToOwn');
  const [selectedDriver, setSelectedDriver] = useState<DriverSearchResult | null>(null);
  const [assignmentId, setAssignmentId] = useState(lockedAssignment?.id ?? '');
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const driverPlanAssignments = useMemo(() => {
    if (!selectedDriver) return [];
    return assignments
      .filter((a) => a.driverId === selectedDriver.id && a.ownershipPlanId !== null)
      .sort((a, b) => (a.assignedDate < b.assignedDate ? 1 : -1));
  }, [assignments, selectedDriver]);
  const rentToOwnAssignment = driverPlanAssignments[0] ?? null;

  const selectedAssignment =
    lockedAssignment ??
    (mode === 'rentToOwn'
      ? rentToOwnAssignment
      : (assignments.find((a) => a.id === assignmentId) ?? null));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!selectedAssignment) {
      setError(
        mode === 'rentToOwn' && !lockedAssignment
          ? 'Search for and select a driver with a rent-to-own charge.'
          : 'Select an assignment.',
      );
      return;
    }
    const amountNumber = Number(amount);
    if (!amount || Number.isNaN(amountNumber) || amountNumber <= 0) {
      setError('Enter a valid amount.');
      return;
    }

    setSubmitting(true);
    try {
      const payload: CreatePaymentPayload = {
        dailyAssignmentId: selectedAssignment.id,
        driverId: selectedAssignment.driverId,
        amount: amountNumber,
        paymentMethod: paymentMethod || undefined,
      };
      await apiFetch('/payments', { method: 'POST', body: JSON.stringify(payload) });
      onSaved('Payment recorded.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Record payment" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {lockedAssignment ? (
          <div className="rounded bg-gray-50 px-3 py-2 text-sm text-gray-700">
            {assignmentLabel(lockedAssignment, drivers, motorcycles)}
          </div>
        ) : (
          <>
            <div className="flex gap-1 rounded border border-gray-200 bg-gray-50 p-1 text-sm">
              <button
                type="button"
                onClick={() => setMode('rentToOwn')}
                className={`flex-1 rounded px-2 py-1 font-medium ${
                  mode === 'rentToOwn' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                }`}
              >
                Rent-to-own
              </button>
              <button
                type="button"
                onClick={() => setMode('regular')}
                className={`flex-1 rounded px-2 py-1 font-medium ${
                  mode === 'regular' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                }`}
              >
                Regular assignment
              </button>
            </div>

            {mode === 'rentToOwn' ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Driver</label>
                <DriverPicker value={selectedDriver} onSelect={setSelectedDriver} />
                {selectedDriver && rentToOwnAssignment && (
                  <p className="mt-1 text-xs text-gray-500">
                    Latest charge: {rentToOwnAssignment.assignedDate.slice(0, 10)} — target{' '}
                    {Number(rentToOwnAssignment.targetAmount).toLocaleString()} TZS
                  </p>
                )}
                {selectedDriver && !rentToOwnAssignment && (
                  <p className="mt-1 text-xs text-amber-700">
                    This driver has no rent-to-own plan charge to record against.
                  </p>
                )}
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Assignment</label>
                <select
                  value={assignmentId}
                  onChange={(e) => setAssignmentId(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">Select an assignment…</option>
                  {assignments.map((a) => (
                    <option key={a.id} value={a.id}>
                      {assignmentLabel(a, drivers, motorcycles)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Amount (TZS)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Payment method</label>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">Unspecified</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
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
