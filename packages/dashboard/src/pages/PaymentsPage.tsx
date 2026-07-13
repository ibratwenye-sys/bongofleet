import { useEffect, useMemo, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import type {
  Assignment,
  Motorcycle,
  Payment,
  PaymentStatus,
  Rider,
  UpdatePaymentPayload,
} from '../lib/types';
import { PAYMENT_STATUS_STYLES, StatusBadge } from '../components/StatusBadge';
import { PaymentFormModal } from '../components/PaymentFormModal';

const STATUS_OPTIONS: PaymentStatus[] = ['PENDING', 'COMPLETED', 'FAILED'];

function formatTZS(amount: number): string {
  return amount.toLocaleString(undefined, {
    style: 'currency',
    currency: 'TZS',
    maximumFractionDigits: 0,
  });
}

export function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [motorcycles, setMotorcycles] = useState<Motorcycle[]>([]);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | 'ALL'>('ALL');
  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function load() {
    try {
      const [paymentsData, assignmentsData, motorcyclesData, ridersData] = await Promise.all([
        apiFetch<Payment[]>('/payments'),
        apiFetch<Assignment[]>('/assignments'),
        apiFetch<Motorcycle[]>('/motorcycles'),
        apiFetch<Rider[]>('/riders'),
      ]);
      setPayments(paymentsData);
      setAssignments(assignmentsData);
      setMotorcycles(motorcyclesData);
      setRiders(ridersData);
    } catch {
      setError('Could not load payments. Please try again.');
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

  const riderById = useMemo(() => new Map(riders.map((r) => [r.id, r])), [riders]);

  const filtered = useMemo(() => {
    if (!payments) return [];
    if (statusFilter === 'ALL') return payments;
    return payments.filter((p) => p.status === statusFilter);
  }, [payments, statusFilter]);

  function handleSaved(message: string) {
    setShowRecordPayment(false);
    setSuccessMessage(message);
    void load();
  }

  async function handleUpdateStatus(payment: Payment, status: PaymentStatus) {
    setUpdatingId(payment.id);
    try {
      const payload: UpdatePaymentPayload = { status };
      await apiFetch(`/payments/${payment.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      setSuccessMessage(status === 'COMPLETED' ? 'Payment reconciled.' : 'Payment marked failed.');
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update payment.');
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Payments</h1>
        <button
          onClick={() => setShowRecordPayment(true)}
          className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
        >
          Record payment
        </button>
      </div>

      {successMessage && (
        <p className="mb-4 rounded bg-green-50 px-3 py-2 text-sm text-green-700">
          {successMessage}
        </p>
      )}
      {error && <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      <div className="mb-4 flex gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as PaymentStatus | 'ALL')}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="ALL">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Date</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Rider</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Amount</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Method</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Status</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {payments === null ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  No payments found.
                </td>
              </tr>
            ) : (
              filtered.map((p) => {
                const rider = riderById.get(p.riderId);
                return (
                  <tr key={p.id}>
                    <td className="px-4 py-2 text-gray-600">{p.createdAt.slice(0, 10)}</td>
                    <td className="px-4 py-2 text-gray-900">
                      {rider ? `${rider.user.firstName} ${rider.user.lastName}` : 'Unknown rider'}
                    </td>
                    <td className="px-4 py-2 text-gray-600">{formatTZS(parseFloat(p.amount))}</td>
                    <td className="px-4 py-2 text-gray-600">{p.paymentMethod ?? '—'}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={p.status} styles={PAYMENT_STATUS_STYLES} />
                    </td>
                    <td className="px-4 py-2 text-right">
                      {p.status === 'PENDING' && (
                        <>
                          <button
                            disabled={updatingId === p.id}
                            onClick={() => void handleUpdateStatus(p, 'COMPLETED')}
                            className="mr-3 text-sm font-medium text-gray-700 hover:underline disabled:opacity-50"
                          >
                            Reconcile
                          </button>
                          <button
                            disabled={updatingId === p.id}
                            onClick={() => void handleUpdateStatus(p, 'FAILED')}
                            className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
                          >
                            Mark failed
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {showRecordPayment && (
        <PaymentFormModal
          assignments={assignments}
          riders={riders}
          motorcycles={motorcycles}
          onClose={() => setShowRecordPayment(false)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
