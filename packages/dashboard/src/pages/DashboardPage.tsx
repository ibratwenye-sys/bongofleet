import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { Assignment, Motorcycle, Payment } from '../lib/types';

interface Kpis {
  todaysRevenue: number;
  pendingPayments: number;
  todaysAssignments: number;
  fleetSize: number;
}

function toDateKey(iso: string): string {
  return iso.slice(0, 10);
}

function computeKpis(
  payments: Payment[],
  assignments: Assignment[],
  motorcycles: Motorcycle[],
): Kpis {
  const todayKey = new Date().toISOString().slice(0, 10);

  const todaysRevenue = payments
    .filter((p) => p.status === 'COMPLETED' && p.paidAt && toDateKey(p.paidAt) === todayKey)
    .reduce((sum, p) => sum + parseFloat(p.amount), 0);

  const pendingPayments = payments.filter((p) => p.status === 'PENDING').length;

  const todaysAssignments = assignments.filter(
    (a) => toDateKey(a.assignedDate) === todayKey,
  ).length;

  return { todaysRevenue, pendingPayments, todaysAssignments, fleetSize: motorcycles.length };
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

export function DashboardPage() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [payments, assignments, motorcycles] = await Promise.all([
          apiFetch<Payment[]>('/payments'),
          apiFetch<Assignment[]>('/assignments'),
          apiFetch<Motorcycle[]>('/motorcycles'),
        ]);
        setKpis(computeKpis(payments, assignments, motorcycles));
      } catch {
        setError('Could not load dashboard data. Please try again.');
      }
    }
    void load();
  }, []);

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (!kpis) {
    return <p className="text-sm text-gray-500">Loading…</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        label="Today's revenue"
        value={kpis.todaysRevenue.toLocaleString(undefined, {
          style: 'currency',
          currency: 'TZS',
          maximumFractionDigits: 0,
        })}
      />
      <KpiCard label="Pending payments" value={String(kpis.pendingPayments)} />
      <KpiCard label="Today's assignments" value={String(kpis.todaysAssignments)} />
      <KpiCard label="Fleet size" value={String(kpis.fleetSize)} />
    </div>
  );
}
