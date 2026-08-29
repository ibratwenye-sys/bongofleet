import { useEffect, useMemo, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import { formatTZS } from '../lib/format';
import type {
  Assignment,
  AssignmentSummaryResponse,
  CreateAssignmentPayload,
  Driver,
  Motorcycle,
  Payment,
} from '../lib/types';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PAYMENT_STATUS_STYLES, StatusBadge } from '../components/StatusBadge';
import { PaymentFormModal } from '../components/PaymentFormModal';
import { PageChassis } from '../components/chassis/PageChassis';
import { ChassisGrid, ClosingRow } from '../components/chassis/ChassisGrid';
import { Card } from '../components/chassis/Card';
import type { KpiTile } from '../components/chassis/KpiRail';

function todayDateInput(): string {
  return new Date().toISOString().slice(0, 10);
}

function kpisToTiles(data: AssignmentSummaryResponse): KpiTile[] {
  const k = data.kpis;
  return [
    {
      label: 'Assigned today',
      value: String(k.assignedToday.count),
      valueSuffix: `/ ${k.assignedToday.fleetSize}`,
      delta: `${k.assignedToday.percentOfFleet}% of the fleet`,
      accentColor: 'c1',
    },
    {
      label: 'Moving',
      value: String(k.movingToday.count),
      delta: `${k.movingToday.percentActuallyEarning}% actually earning`,
      accentColor: 'good',
    },
    {
      label: 'Assigned, in workshop',
      value: String(k.assignedInWorkshopToday.count),
      delta: 'Has a driver, earns nothing',
      accentColor: k.assignedInWorkshopToday.count > 0 ? 'warn' : 'good',
    },
    {
      label: 'In stock, unassigned',
      value: String(k.inStockToday.count),
      delta: `${formatTZS(k.inStockToday.targetLost)} a day`,
      accentColor: k.inStockToday.count > 0 ? 'crit' : 'good',
    },
    {
      label: 'Created this month',
      value: String(k.createdThisMonth.count),
      delta: `${k.createdThisMonth.percentEndedWithPayment}% ended with a payment`,
      accentColor: 'c1',
    },
    {
      label: 'Cost of idleness',
      value: formatTZS(k.costOfIdlenessThisMonth.amount),
      delta: 'this month to date',
      accentColor: 'violet',
    },
  ];
}

function StockChart({ series }: { series: AssignmentSummaryResponse['dailyStockSeries'] }) {
  return (
    <div>
      <div className="flex h-32 items-end gap-1">
        {series.map((p) => {
          const total = p.outCount + p.inStockCount || 1;
          return (
            <div
              key={p.date}
              className="flex flex-1 flex-col items-center gap-0.5"
              title={`${p.outCount} out, ${p.inStockCount} in stock`}
            >
              <div className="flex w-full flex-1 flex-col justify-end overflow-hidden rounded-t">
                <div
                  className="w-full bg-crit"
                  style={{ height: `${(p.inStockCount / total) * 100}%` }}
                />
                <div
                  className="w-full bg-c1"
                  style={{ height: `${(p.outCount / total) * 100}%` }}
                />
              </div>
              <span className="text-[10px] text-txt-3">{p.date.slice(8, 10)}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-4 text-xs text-txt-2">
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-c1 align-middle" />
          Out with a driver
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-crit align-middle" />
          In stock
        </span>
      </div>
    </div>
  );
}

// ---- Create assignment modal (unchanged CRUD) ----

interface FormState {
  motorcycleId: string;
  driverId: string;
  assignedDate: string;
  targetAmount: string;
  notes: string;
}

function AssignmentFormModal({
  motorcycles,
  drivers,
  onClose,
  onSaved,
}: {
  motorcycles: Motorcycle[];
  drivers: Driver[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState<FormState>({
    motorcycleId: '',
    driverId: '',
    assignedDate: todayDateInput(),
    targetAmount: '',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.motorcycleId || !form.driverId || !form.assignedDate) {
      setError('Driver, vehicle, and date are required.');
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
        driverId: form.driverId,
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
          <label className="mb-1 block text-sm font-medium text-txt">Driver</label>
          <select
            value={form.driverId}
            onChange={(e) => setForm({ ...form, driverId: e.target.value })}
            className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
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
            className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
          >
            <option value="">Select a vehicle…</option>
            {motorcycles.map((m) => (
              <option key={m.id} value={m.id}>
                {m.registrationNumber} {[m.make, m.model].filter(Boolean).join(' ')}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">Date</label>
            <input
              type="date"
              value={form.assignedDate}
              onChange={(e) => setForm({ ...form, assignedDate: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-txt">Target amount (TZS)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.targetAmount}
              onChange={(e) => setForm({ ...form, targetAmount: e.target.value })}
              className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-txt">Notes (optional)</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="w-full rounded border border-line bg-panel text-txt px-3 py-2 text-sm"
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
  const [data, setData] = useState<AssignmentSummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Manage-assignments fallback: the new tables above are analytical
  // (a 14-day chart, the vehicles-in-stock list), not a per-assignment
  // list, so recording a payment or deleting a specific assignment needs
  // this compact card - same reasoning as the Fleet/Drivers pages' own
  // fallback sections.
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [motorcycles, setMotorcycles] = useState<Motorcycle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [dateFilter, setDateFilter] = useState('');
  const [paymentTarget, setPaymentTarget] = useState<Assignment | null>(null);
  const [deleting, setDeleting] = useState<Assignment | null>(null);

  async function load() {
    try {
      const [summary, assignmentsData, motorcyclesData, driversData, paymentsData] =
        await Promise.all([
          apiFetch<AssignmentSummaryResponse>('/assignments/summary'),
          apiFetch<Assignment[]>('/assignments'),
          apiFetch<Motorcycle[]>('/motorcycles'),
          apiFetch<Driver[]>('/drivers'),
          apiFetch<Payment[]>('/payments'),
        ]);
      setData(summary);
      setAssignments(assignmentsData);
      setMotorcycles(motorcyclesData);
      setDrivers(driversData);
      setPayments(paymentsData);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load assignments.');
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
  const driverById = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);
  const paymentsByAssignment = useMemo(() => {
    const map = new Map<string, Payment[]>();
    for (const payment of payments) {
      const list = map.get(payment.dailyAssignmentId) ?? [];
      list.push(payment);
      map.set(payment.dailyAssignmentId, list);
    }
    return map;
  }, [payments]);

  const filteredAssignments = useMemo(() => {
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

  if (error && !data) {
    return <p className="text-sm text-crit">{error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-txt-2">Loading…</p>;
  }

  return (
    <PageChassis
      title="Assignments"
      statusPill={{ mode: 'live', text: `LIVE · ${data.kpis.assignedToday.count} assigned today` }}
      primaryAction={{ label: 'Create assignment', onClick: () => setShowCreate(true) }}
      kpis={kpisToTiles(data)}
    >
      {successMessage && (
        <p className="rounded bg-good-d px-3 py-2 text-sm text-good-x">{successMessage}</p>
      )}
      {error && <p className="rounded bg-crit-d px-3 py-2 text-sm text-crit-x">{error}</p>}

      <ChassisGrid
        main={
          <>
            <Card title="Out with a driver vs in stock" subtitle="last 14 days, count of vehicles">
              <StockChart series={data.dailyStockSeries} />
            </Card>
            <Card
              title="Utilisation today"
              subtitle={`${data.utilisationToday.moving + data.utilisationToday.workshop + data.utilisationToday.inStock} vehicles`}
            >
              {(() => {
                const total =
                  data.utilisationToday.moving +
                    data.utilisationToday.workshop +
                    data.utilisationToday.inStock || 1;
                return (
                  <div>
                    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-panel-2">
                      <div
                        className="bg-c1"
                        style={{ width: `${(data.utilisationToday.moving / total) * 100}%` }}
                      />
                      <div
                        className="bg-warn"
                        style={{ width: `${(data.utilisationToday.workshop / total) * 100}%` }}
                      />
                      <div
                        className="bg-crit"
                        style={{ width: `${(data.utilisationToday.inStock / total) * 100}%` }}
                      />
                    </div>
                    <div className="mt-3 space-y-1.5 text-sm text-txt-2">
                      <div className="flex justify-between">
                        <span>Assigned and moving</span>
                        <span className="text-txt">{data.utilisationToday.moving}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Assigned, in workshop</span>
                        <span className="text-txt">{data.utilisationToday.workshop}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>In stock, nobody on it</span>
                        <span className="text-txt">{data.utilisationToday.inStock}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </Card>
          </>
        }
        rail={
          <>
            <Card
              title="AI Insights"
              subtitle={data.insights.length > 0 ? String(data.insights.length) : undefined}
            >
              {data.insights.length === 0 ? (
                <p className="p-4 text-sm text-txt-2">Nothing to flag right now.</p>
              ) : (
                <div className="divide-y divide-line-soft">
                  {data.insights.map((ins, i) => (
                    <div key={i} className="px-4 py-3">
                      <p className="text-sm font-medium text-txt">{ins.title}</p>
                      <p className="mt-1 text-xs text-txt-2">{ins.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card title="Unassigned right now" subtitle={String(data.unassignedNow.length)}>
              {data.unassignedNow.length === 0 ? (
                <p className="p-4 text-sm text-txt-2">Every active vehicle has a driver today.</p>
              ) : (
                <div className="divide-y divide-line-soft">
                  {data.unassignedNow.slice(0, 6).map((v) => (
                    <div key={v.motorcycleId} className="px-4 py-2.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-txt">
                          {v.registrationNumber} · {v.vehicleType.toLowerCase()}
                        </span>
                        <span className="text-txt-3">{v.daysUnassigned}d</span>
                      </div>
                      <p className="mt-0.5 text-xs text-txt-2">{v.reason}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        }
      />

      <Card
        title="Vehicles in stock"
        subtitle={`${data.unassignedNow.length} · each one is a decision, not a status`}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left text-xs text-txt-3">
                <th className="px-4 py-2 font-medium">Registration</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 text-right font-medium">Days unassigned</th>
                <th className="px-4 py-2 text-right font-medium">Daily target</th>
                <th className="px-4 py-2 text-right font-medium">Lost so far</th>
                <th className="px-4 py-2 font-medium">Area</th>
                <th className="px-4 py-2 font-medium">Why</th>
              </tr>
            </thead>
            <tbody>
              {data.unassignedNow.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-txt-2">
                    Nothing in stock right now.
                  </td>
                </tr>
              ) : (
                data.unassignedNow.map((v) => (
                  <tr key={v.motorcycleId} className="border-b border-line-soft last:border-0">
                    <td className="px-4 py-2 font-medium text-txt">{v.registrationNumber}</td>
                    <td className="px-4 py-2 text-txt-2">{v.vehicleType.toLowerCase()}</td>
                    <td className="px-4 py-2 text-right text-txt-2">{v.daysUnassigned}</td>
                    <td className="px-4 py-2 text-right text-txt-2">
                      {v.dailyTarget ? formatTZS(v.dailyTarget) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right font-medium text-crit">
                      {v.lostSoFar ? formatTZS(v.lostSoFar) : '—'}
                    </td>
                    <td className="px-4 py-2 text-txt-2">{v.operatingArea ?? '—'}</td>
                    <td className="px-4 py-2 text-txt-2">{v.reason}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <ClosingRow
        left={
          <Card title="This month" subtitle={`${data.thisMonth.created} assignments`}>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-line-soft">
                  <td className="px-4 py-2 text-txt-2">Assignments created</td>
                  <td className="px-4 py-2 text-right text-txt">{data.thisMonth.created}</td>
                </tr>
                <tr className="border-b border-line-soft">
                  <td className="px-4 py-2 text-txt-2">Ended with a payment</td>
                  <td className="px-4 py-2 text-right text-good">
                    {data.thisMonth.endedWithPayment}
                  </td>
                </tr>
                <tr className="border-b border-line-soft">
                  <td className="px-4 py-2 text-txt-2">Ended with nothing paid</td>
                  <td className="px-4 py-2 text-right text-crit">
                    {data.thisMonth.endedWithNothing}
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-medium text-txt">Value of those days</td>
                  <td className="px-4 py-2 text-right font-medium text-crit">
                    {formatTZS(data.thisMonth.valueOfUnpaidDays)}
                  </td>
                </tr>
              </tbody>
            </table>
          </Card>
        }
        right={
          <Card title="What idleness costs, by type" subtitle="cumulative">
            {data.idlenessCostByType.length === 0 ? (
              <p className="p-4 text-sm text-txt-2">No idle vehicles.</p>
            ) : (
              <div className="divide-y divide-line-soft px-4">
                {data.idlenessCostByType.map((row) => (
                  <div key={row.vehicleType} className="py-2.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-txt">{row.vehicleType.toLowerCase()} idle</span>
                      <span className="text-txt-2">
                        {row.count} vehicle{row.count === 1 ? '' : 's'}
                      </span>
                      <span className="font-medium text-crit">{formatTZS(row.amount)}</span>
                    </div>
                    {row.topContributor && (
                      <p className="mt-0.5 text-xs text-txt-2">
                        {row.topContributor} — the largest line
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        }
      />

      <Card title="Manage assignments" subtitle="record a payment or delete a specific assignment">
        <div className="flex items-center gap-3 border-b border-line-soft px-4 py-3">
          <label className="text-sm text-txt-2">Filter by date:</label>
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="rounded border border-line bg-panel px-3 py-1.5 text-sm text-txt"
          />
          {dateFilter && (
            <button
              onClick={() => setDateFilter('')}
              className="text-sm text-txt-3 hover:underline"
            >
              Clear
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left text-xs text-txt-3">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Driver</th>
                <th className="px-4 py-2 font-medium">Vehicle</th>
                <th className="px-4 py-2 font-medium">Target</th>
                <th className="px-4 py-2 font-medium">Payments</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {assignments === null ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-txt-2">
                    Loading…
                  </td>
                </tr>
              ) : filteredAssignments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-txt-2">
                    No assignments found.
                  </td>
                </tr>
              ) : (
                filteredAssignments.slice(0, 25).map((a) => {
                  const driver = driverById.get(a.driverId);
                  const motorcycle = motorcycleById.get(a.motorcycleId);
                  const assignmentPayments = paymentsByAssignment.get(a.id) ?? [];
                  const paidTotal = assignmentPayments
                    .filter((p) => p.status === 'COMPLETED')
                    .reduce((sum, p) => sum + parseFloat(p.amount), 0);
                  const latest = assignmentPayments[0] ?? null;
                  return (
                    <tr key={a.id} className="border-b border-line-soft last:border-0">
                      <td className="px-4 py-2 text-txt-2">{a.assignedDate.slice(0, 10)}</td>
                      <td className="px-4 py-2 text-txt">
                        {driver
                          ? `${driver.user.firstName} ${driver.user.lastName}`
                          : 'Unknown driver'}
                      </td>
                      <td className="px-4 py-2 text-txt-2">
                        {motorcycle?.registrationNumber ?? 'Unknown vehicle'}
                      </td>
                      <td className="px-4 py-2 text-txt-2">{formatTZS(a.targetAmount)}</td>
                      <td className="px-4 py-2 text-txt-2">
                        {assignmentPayments.length === 0 ? (
                          'No payments yet'
                        ) : (
                          <span className="flex items-center gap-2">
                            {formatTZS(paidTotal)} / {formatTZS(a.targetAmount)}
                            {latest && (
                              <StatusBadge status={latest.status} styles={PAYMENT_STATUS_STYLES} />
                            )}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        <button
                          onClick={() => setPaymentTarget(a)}
                          className="mr-3 text-sm font-medium text-c1 hover:underline"
                        >
                          Record payment
                        </button>
                        <button
                          onClick={() => setDeleting(a)}
                          className="text-sm font-medium text-crit hover:underline"
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
      </Card>

      {showCreate && (
        <AssignmentFormModal
          motorcycles={motorcycles}
          drivers={drivers}
          onClose={() => setShowCreate(false)}
          onSaved={handleSaved}
        />
      )}

      {paymentTarget && (
        <PaymentFormModal
          assignments={assignments ?? []}
          drivers={drivers}
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
    </PageChassis>
  );
}
