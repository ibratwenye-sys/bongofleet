import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { Assignment, ExpiringDocument, Motorcycle, Payment } from '../lib/types';
import { DOCUMENT_STATUS_STYLES, StatusBadge } from '../components/StatusBadge';

interface Kpis {
  todaysRevenue: number;
  pendingPayments: number;
  todaysAssignments: number;
  fleetSize: number;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  NATIONAL_ID: 'National ID',
  DRIVERS_LICENSE: "Driver's License",
  LATRA: 'LATRA',
  INSURANCE: 'Insurance',
  REGISTRATION_CARD: 'Registration Card',
  VEHICLE_INSPECTION: 'Vehicle Inspection',
  ROAD_SAFETY_WEEK: 'Road Safety Week',
  TBS_CERTIFICATE: 'TBS Certificate',
  GUARANTOR_ID: 'Guarantor ID',
  OTHER: 'Document',
};

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
  const [expiringDocuments, setExpiringDocuments] = useState<ExpiringDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [payments, assignments, motorcycles, expiring] = await Promise.all([
          apiFetch<Payment[]>('/payments'),
          apiFetch<Assignment[]>('/assignments'),
          apiFetch<Motorcycle[]>('/motorcycles'),
          apiFetch<ExpiringDocument[]>('/documents/expiring?withinDays=30'),
        ]);
        setKpis(computeKpis(payments, assignments, motorcycles));
        setExpiringDocuments(expiring);
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
    <div>
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

      <div className="mt-8">
        <h2 className="mb-3 text-lg font-medium text-gray-900">Expiring & expired documents</h2>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Owner</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Document</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Expiry date</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {expiringDocuments === null ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                    Loading…
                  </td>
                </tr>
              ) : expiringDocuments.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                    Nothing expiring in the next 30 days.
                  </td>
                </tr>
              ) : (
                expiringDocuments.map((doc) => (
                  <tr key={doc.id}>
                    <td className="px-4 py-2 text-gray-900">{doc.ownerLabel}</td>
                    <td className="px-4 py-2 text-gray-600">
                      {DOC_TYPE_LABELS[doc.docType] ?? doc.docType}
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {doc.expiryDate ? doc.expiryDate.slice(0, 10) : '—'}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={doc.status} styles={DOCUMENT_STATUS_STYLES} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
