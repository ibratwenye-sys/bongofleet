import { useState } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import type { Assignment, CreatePaymentPayload, Motorcycle, Rider } from '../lib/types';
import { Modal } from './Modal';

const PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER'];

function riderName(riders: Rider[], riderId: string): string {
  const rider = riders.find((r) => r.id === riderId);
  return rider ? `${rider.user.firstName} ${rider.user.lastName}` : 'Unknown rider';
}

function assignmentLabel(
  assignment: Assignment,
  riders: Rider[],
  motorcycles: Motorcycle[],
): string {
  const motorcycle = motorcycles.find((m) => m.id === assignment.motorcycleId);
  const target = Number(assignment.targetAmount).toLocaleString();
  return `${assignment.assignedDate.slice(0, 10)} — ${riderName(riders, assignment.riderId)} — ${
    motorcycle?.registrationNumber ?? 'Unknown bike'
  } — target ${target} TZS`;
}

export function PaymentFormModal({
  assignments,
  riders,
  motorcycles,
  lockedAssignment,
  onClose,
  onSaved,
}: {
  assignments: Assignment[];
  riders: Rider[];
  motorcycles: Motorcycle[];
  lockedAssignment?: Assignment;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [assignmentId, setAssignmentId] = useState(lockedAssignment?.id ?? '');
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedAssignment =
    lockedAssignment ?? assignments.find((a) => a.id === assignmentId) ?? null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!selectedAssignment) {
      setError('Select an assignment.');
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
        riderId: selectedAssignment.riderId,
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
            {assignmentLabel(lockedAssignment, riders, motorcycles)}
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
                  {assignmentLabel(a, riders, motorcycles)}
                </option>
              ))}
            </select>
          </div>
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
