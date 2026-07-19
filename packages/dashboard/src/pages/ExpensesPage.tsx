import { useEffect, useMemo, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import type { CreateExpensePayload, Expense, Motorcycle, UpdateExpensePayload } from '../lib/types';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { formatTZS, startOfThisMonth, today } from '../lib/format';

// Common categories offered as quick suggestions; the field is still free text
// so an owner can type anything (backend accepts any non-empty category).
const CATEGORY_SUGGESTIONS = [
  'Fuel',
  'Repairs',
  'Spare parts',
  'Insurance',
  'Office rent',
  'Other',
];

interface FormState {
  category: string;
  amount: string;
  incurredAt: string;
  motorcycleId: string;
  description: string;
}

function toFormState(expense: Expense | null): FormState {
  return {
    category: expense?.category ?? '',
    amount: expense?.amount != null ? String(parseFloat(expense.amount)) : '',
    incurredAt: expense?.incurredAt ? expense.incurredAt.slice(0, 10) : today(),
    motorcycleId: expense?.motorcycleId ?? '',
    description: expense?.description ?? '',
  };
}

function ExpenseFormModal({
  expense,
  motorcycles,
  onClose,
  onSaved,
}: {
  expense: Expense | null;
  motorcycles: Motorcycle[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isEdit = expense != null;
  const [form, setForm] = useState<FormState>(() => toFormState(expense));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.category.trim()) {
      setError('Category is required.');
      return;
    }
    const amount = Number(form.amount);
    if (!form.amount || Number.isNaN(amount) || amount <= 0) {
      setError('Amount must be a positive number.');
      return;
    }
    if (!form.incurredAt) {
      setError('Date is required.');
      return;
    }

    setSubmitting(true);
    try {
      if (isEdit) {
        const payload: UpdateExpensePayload = {
          category: form.category.trim(),
          amount,
          incurredAt: form.incurredAt,
          motorcycleId: form.motorcycleId || undefined,
          description: form.description.trim() || undefined,
        };
        await apiFetch(`/expenses/${expense.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        onSaved('Expense updated.');
      } else {
        const payload: CreateExpensePayload = {
          category: form.category.trim(),
          amount,
          incurredAt: form.incurredAt,
          motorcycleId: form.motorcycleId || undefined,
          description: form.description.trim() || undefined,
        };
        await apiFetch('/expenses', { method: 'POST', body: JSON.stringify(payload) });
        onSaved('Expense recorded.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={isEdit ? 'Edit expense' : 'Record expense'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Category</label>
          <input
            list="expense-categories"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder="e.g. Fuel"
          />
          <datalist id="expense-categories">
            {CATEGORY_SUGGESTIONS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Amount (TZS)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Date</label>
            <input
              type="date"
              value={form.incurredAt}
              onChange={(e) => setForm({ ...form, incurredAt: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Motorcycle <span className="text-gray-400">(optional)</span>
          </label>
          <select
            value={form.motorcycleId}
            onChange={(e) => setForm({ ...form, motorcycleId: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">Fleet-wide (not bike-specific)</option>
            {motorcycles.map((m) => (
              <option key={m.id} value={m.id}>
                {m.registrationNumber}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Description <span className="text-gray-400">(optional)</span>
          </label>
          <input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
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
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [motorcycles, setMotorcycles] = useState<Motorcycle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [from, setFrom] = useState<string>(startOfThisMonth());
  const [to, setTo] = useState<string>(today());
  const [motorcycleFilter, setMotorcycleFilter] = useState<string>('ALL');
  const [formTarget, setFormTarget] = useState<'new' | Expense | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);

  async function load() {
    setError(null);
    const params = new URLSearchParams({ from, to });
    if (motorcycleFilter !== 'ALL') {
      params.set('motorcycleId', motorcycleFilter);
    }
    try {
      const data = await apiFetch<Expense[]>(`/expenses?${params.toString()}`);
      setExpenses(data);
    } catch {
      setError('Could not load expenses. Please try again.');
    }
  }

  useEffect(() => {
    apiFetch<Motorcycle[]>('/motorcycles')
      .then(setMotorcycles)
      .catch(() => setMotorcycles([]));
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, motorcycleFilter]);

  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  const regById = useMemo(
    () => new Map(motorcycles.map((m) => [m.id, m.registrationNumber])),
    [motorcycles],
  );

  const total = useMemo(
    () => (expenses ?? []).reduce((sum, e) => sum + parseFloat(e.amount), 0),
    [expenses],
  );

  function handleSaved(message: string) {
    setFormTarget(null);
    setSuccessMessage(message);
    void load();
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await apiFetch(`/expenses/${deleting.id}`, { method: 'DELETE' });
      setSuccessMessage('Expense deleted.');
      setDeleting(null);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete expense.');
      setDeleting(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Expenses</h1>
        <button
          onClick={() => setFormTarget('new')}
          className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
        >
          Record expense
        </button>
      </div>

      {successMessage && (
        <p className="mb-4 rounded bg-green-50 px-3 py-2 text-sm text-green-700">
          {successMessage}
        </p>
      )}
      {error && <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">From</label>
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">To</label>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Motorcycle</label>
          <select
            value={motorcycleFilter}
            onChange={(e) => setMotorcycleFilter(e.target.value)}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm"
          >
            <option value="ALL">All</option>
            {motorcycles.map((m) => (
              <option key={m.id} value={m.id}>
                {m.registrationNumber}
              </option>
            ))}
          </select>
        </div>
        <div className="ml-auto text-right">
          <p className="text-xs font-medium text-gray-500">Total shown</p>
          <p className="text-lg font-semibold text-gray-900">{formatTZS(total)}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Date</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Category</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Motorcycle</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Description</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Amount</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {expenses === null ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : expenses.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  No expenses in this period.
                </td>
              </tr>
            ) : (
              expenses.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-2 text-gray-600">{e.incurredAt.slice(0, 10)}</td>
                  <td className="px-4 py-2 font-medium text-gray-900">{e.category}</td>
                  <td className="px-4 py-2 text-gray-600">
                    {e.motorcycleId ? (regById.get(e.motorcycleId) ?? '—') : 'Fleet-wide'}
                  </td>
                  <td className="px-4 py-2 text-gray-500">{e.description ?? '—'}</td>
                  <td className="px-4 py-2 text-right text-gray-700">{formatTZS(e.amount)}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => setFormTarget(e)}
                      className="mr-3 text-sm font-medium text-gray-700 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeleting(e)}
                      className="text-sm font-medium text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {formTarget !== null && (
        <ExpenseFormModal
          expense={formTarget === 'new' ? null : formTarget}
          motorcycles={motorcycles}
          onClose={() => setFormTarget(null)}
          onSaved={handleSaved}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete expense"
          message={`Delete the ${deleting.category} expense of ${formatTZS(deleting.amount)}? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => void handleDelete()}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
