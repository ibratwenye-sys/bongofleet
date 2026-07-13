import { useEffect, useMemo, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import type { Assignment, CreateAssignmentPayload, Motorcycle, Payment, Rider } from '../lib/types';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PAYMENT_STATUS_STYLES, StatusBadge } from '../components/StatusBadge';
import { PaymentFormModal } from '../components/PaymentFormModal';

function formatTZS(amount: number): string {
  return amount.toLocaleString(undefined, {
    style: 'currency',
    currency: 'TZS',
    maximumFractionDigits: 0,
  });
}

function todayDateInput(): string {
  return new Date().toISOString().slice(0, 10);
}

interface FormState {
  motorcycleId: string;
  riderId: string;
  assignedDate: string;
  targetAmount: string;
  notes: string;
}

function AssignmentFormModal({
  motorcycles,
  riders,
  onClose,
  onSaved,
}: {
  motorcycles: Motorcycle[];
  riders: Rider[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState<FormState>({
    motorcycleId: '',
    riderId: '',
    assignedDate: todayDateInput(),
    targetAmount: '',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.motorcycleId || !form.riderId || !form.assignedDate) {
      setError('Rider, motorcycle, and date are required.');
      return;
    }
    const targetAmount = Number(form.targetAmount);
    if (!form.targetAmount || Number.isNaN(targetAmount) || targetAmount <= 0) {
      setError('Enter a valid target amount.');
      return;
    }

    setSubmitting(true);
    try {
      const payload: CreateAssignmentPayload = {
        motorcycleId: form.motorcycleId,
        riderId: form.riderId,
        assignedDate: form.assignedDate,
        targetAmount,
        notes: form.notes.trim() || undefined,
      };
      await apiFetch('/assignments', { method: 'POST', body: JSON.stringify(payload) });
      onSaved('Assignment created.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Create assignment" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Rider</label>
          <select
            value={form.riderId}
            onChange={(e) => setForm({ ...form, riderId: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">Select a rider…</option>
            {riders.map((r) => (
              <option key={r.id} value={r.id}>
                {r.user.firstName} {r.user.lastName} — {r.licenseNumber}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Motorcycle</label>
          <select
            value={form.motorcycleId}
            onChange={(e) => setForm({ ...form, motorcycleId: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">Select a motorcycle…</option>
            {motorcycles.map((m) => (
              <option key={m.id} value={m.id}>
                {m.registrationNumber} {[m.make, m.model].filter(Boolean).join(' ')}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Date</label>
            <input
              type="date"
              value={form.assignedDate}
              onChange={(e) => setForm({ ...form, assignedDate: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Target amount (TZS)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.targetAmount}
              onChange={(e) => setForm({ ...form, targetAmount: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Notes (optional)</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            rows={2}
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
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function AssignmentsPage() {
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [motorcycles, setMotorcycles] = useState<Motorcycle[]>([]);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState<Assignment | null>(null);
  const [deleting, setDeleting] = useState<Assignment | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function load() {
    try {
      const [assignmentsData, motorcyclesData, ridersData, paymentsData] = await Promise.all([
        apiFetch<Assignment[]>('/assignments'),
        apiFetch<Motorcycle[]>('/motorcycles'),
        apiFetch<Rider[]>('/riders'),
        apiFetch<Payment[]>('/payments'),
      ]);
      setAssignments(assignmentsData);
      setMotorcycles(motorcyclesData);
      setRiders(ridersData);
      setPayments(paymentsData);
    } catch {
      setError('Could not load assignments. Please try again.');
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

  const motorcycleById = useMemo(() => new Map(motorcycles.map((m) => [m.id, m])), [motorcycles]);
  const riderById = useMemo(() => new Map(riders.map((r) => [r.id, r])), [riders]);

  const paymentsByAssignment = useMemo(() => {
    const map = new Map<string, Payment[]>();
    for (const payment of payments) {
      const list = map.get(payment.dailyAssignmentId) ?? [];
      list.push(payment);
      map.set(payment.dailyAssignmentId, list);
    }
    return map;
  }, [payments]);

  const filtered = useMemo(() => {
    if (!assignments) return [];
    if (!dateFilter) return assignments;
    return assignments.filter((a) => a.assignedDate.slice(0, 10) === dateFilter);
  }, [assignments, dateFilter]);

  function handleSaved(message: string) {
    setShowCreate(false);
    setPaymentTarget(null);
    setSuccessMessage(message);
    void load();
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await apiFetch(`/assignments/${deleting.id}`, { method: 'DELETE' });
      setSuccessMessage('Assignment deleted.');
      setDeleting(null);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete assignment.');
      setDeleting(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Assignments</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
        >
          Create assignment
        </button>
      </div>

      {successMessage && (
        <p className="mb-4 rounded bg-green-50 px-3 py-2 text-sm text-green-700">
          {successMessage}
        </p>
      )}
      {error && <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      <div className="mb-4 flex items-center gap-3">
        <label className="text-sm text-gray-600">Filter by date:</label>
        <input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm"
        />
        {dateFilter && (
          <button
            onClick={() => setDateFilter('')}
            className="text-sm text-gray-500 hover:underline"
          >
            Clear
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Date</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Rider</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Motorcycle</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Target</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Payments</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {assignments === null ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  No assignments found.
                </td>
              </tr>
            ) : (
              filtered.map((a) => {
                const rider = riderById.get(a.riderId);
                const motorcycle = motorcycleById.get(a.motorcycleId);
                const assignmentPayments = paymentsByAssignment.get(a.id) ?? [];
                const paidTotal = assignmentPayments
                  .filter((p) => p.status === 'COMPLETED')
                  .reduce((sum, p) => sum + parseFloat(p.amount), 0);
                const latest = assignmentPayments[0] ?? null;

                return (
                  <tr key={a.id}>
                    <td className="px-4 py-2 text-gray-600">{a.assignedDate.slice(0, 10)}</td>
                    <td className="px-4 py-2 text-gray-900">
                      {rider ? `${rider.user.firstName} ${rider.user.lastName}` : 'Unknown rider'}
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {motorcycle?.registrationNumber ?? 'Unknown bike'}
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {formatTZS(parseFloat(a.targetAmount))}
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {assignmentPayments.length === 0 ? (
                        'No payments yet'
                      ) : (
                        <span className="flex items-center gap-2">
                          {formatTZS(paidTotal)} / {formatTZS(parseFloat(a.targetAmount))}
                          {latest && (
                            <StatusBadge status={latest.status} styles={PAYMENT_STATUS_STYLES} />
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => setPaymentTarget(a)}
                        className="mr-3 text-sm font-medium text-gray-700 hover:underline"
                      >
                        Record payment
                      </button>
                      <button
                        onClick={() => setDeleting(a)}
                        className="text-sm font-medium text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <AssignmentFormModal
          motorcycles={motorcycles}
          riders={riders}
          onClose={() => setShowCreate(false)}
          onSaved={handleSaved}
        />
      )}

      {paymentTarget && (
        <PaymentFormModal
          assignments={assignments ?? []}
          riders={riders}
          motorcycles={motorcycles}
          lockedAssignment={paymentTarget}
          onClose={() => setPaymentTarget(null)}
          onSaved={handleSaved}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete assignment"
          message={`Delete the assignment for ${deleting.assignedDate.slice(0, 10)}? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
