import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiFetch, apiFetchBlob, ApiError } from '../lib/api';
import { formatTZS } from '../lib/format';
import type {
  CreateDayExcusalPayload,
  DayExcusal,
  Document,
  OwnershipPlan,
  OwnershipPlanLedgerRow,
  PaymentAccount,
  UpdateOwnershipPlanPayload,
} from '../lib/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import { StatusBadge } from '../components/StatusBadge';

const DAY_EXCUSAL_STATUS_STYLES: Record<string, string> = {
  APPROVED: 'bg-green-100 text-green-800',
  REQUESTED: 'bg-amber-100 text-amber-800',
  DECLINED: 'bg-gray-100 text-gray-500',
};

// Stage L22 - the same missing-`label`-prop enum-badge bug already found and
// fixed at Fleet/Drivers/Assignments/TrackingLinks/Ownership: StatusBadge's
// own `label` prop was never passed here, even though DAY_EXCUSAL_STATUS_
// LABELS already existed for the caption text just below it. One map, two
// render sites now.
const DAY_EXCUSAL_STATUS_LABEL_KEY: Record<string, string> = {
  APPROVED: 'statusExcused',
  REQUESTED: 'statusPendingApproval',
  DECLINED: 'statusDeclinedLabel',
};

function runningPositionClass(value: string): string {
  const n = Number(value);
  if (n < 0) return 'text-crit font-medium';
  if (n > 0) return 'text-good font-medium';
  return 'text-txt-2';
}

function ContractSection({
  planId,
  hasContractEndDate,
}: {
  planId: string;
  hasContractEndDate: boolean;
}) {
  const { t } = useTranslation('ownershipPlanDetail');
  const { t: tOwnership } = useTranslation('ownership');
  const [contracts, setContracts] = useState<Document[] | null>(null);
  const [activePaymentAccounts, setActivePaymentAccounts] = useState<PaymentAccount[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [confirmingNoPaymentAccount, setConfirmingNoPaymentAccount] = useState(false);
  // Stage G6 Part 5 - same guard, same reason, as the payment-account one
  // below: a legal document going to a driver with a blank term is worse
  // than one that's never printed. Checked first so both warnings never
  // stack in one dialog - onConfirm falls through to the next check.
  const [confirmingNoEndDate, setConfirmingNoEndDate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [contractsData, paymentAccountsData] = await Promise.all([
        apiFetch<Document[]>(`/ownership-plans/${planId}/contracts`),
        apiFetch<PaymentAccount[]>('/payment-accounts?activeOnly=true'),
      ]);
      setContracts(contractsData);
      setActivePaymentAccounts(paymentAccountsData);
    } catch {
      setContracts([]);
      setActivePaymentAccounts([]);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      await apiFetch(`/ownership-plans/${planId}/contract`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('generateError'));
    } finally {
      setGenerating(false);
    }
  }

  async function handleDownload() {
    setError(null);
    setDownloading(true);
    try {
      const blob = await apiFetchBlob(`/ownership-plans/${planId}/contract`);
      window.open(URL.createObjectURL(blob), '_blank');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('openError'));
    } finally {
      setDownloading(false);
    }
  }

  function proceedPastEndDateCheck() {
    // Carry-in from the contract work: that PDF prints "Hakuna akaunti ya
    // malipo iliyowekwa" (no payment account configured) when the tenant has
    // none active - a document that reads that way should never reach a
    // driver by accident.
    if (activePaymentAccounts !== null && activePaymentAccounts.length === 0) {
      setConfirmingNoPaymentAccount(true);
      return;
    }
    void handleDownload();
  }

  function handleDownloadClick() {
    // Stage G6 Part 5 - same reasoning as the payment-account guard: the PDF
    // prints "Haijajazwa / Not on file" where the end date belongs when
    // contractEndDate is null, and that shouldn't reach a driver by accident.
    if (!hasContractEndDate) {
      setConfirmingNoEndDate(true);
      return;
    }
    proceedPastEndDateCheck();
  }

  const latest = contracts?.[0] ?? null;

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-medium text-txt">{t('contractSectionTitle')}</h2>
      <div className="rounded border border-line bg-panel p-4">
        {contracts === null ? (
          <p className="text-sm text-txt-2">{t('loading')}</p>
        ) : latest === null ? (
          <p className="mb-3 text-sm text-txt-2">{t('contractEmpty')}</p>
        ) : (
          <p className="mb-3 text-sm text-txt-2">
            {t('latestLine', { fileName: latest.fileName, date: latest.uploadedAt.slice(0, 10) })}
            {contracts.length > 1 && t('versionsSuffix', { count: contracts.length })}
          </p>
        )}

        {!hasContractEndDate && (
          <p className="mb-3 rounded bg-warn-d px-3 py-2 text-sm text-warn">
            {t('endDateMissingWarning')}
          </p>
        )}

        {activePaymentAccounts !== null && activePaymentAccounts.length === 0 && (
          <p className="mb-3 rounded bg-warn-d px-3 py-2 text-sm text-warn">
            {t('noPaymentAccountWarning')}
          </p>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => void handleGenerate()}
            disabled={generating}
            className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {generating
              ? t('generating')
              : latest
                ? t('regenerateContract')
                : t('generateContract')}
          </button>
          {latest && (
            <button
              onClick={handleDownloadClick}
              disabled={downloading}
              className="rounded border border-line px-3 py-1.5 text-sm font-medium text-txt-2 hover:bg-panel-2 disabled:opacity-50"
            >
              {downloading ? t('opening') : t('downloadLatest')}
            </button>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-crit">{error}</p>}
      </div>

      {confirmingNoEndDate && (
        <ConfirmDialog
          title={tOwnership('noEndDateDialogTitle')}
          message={t('noEndDateDownloadMessage')}
          confirmLabel={t('downloadAnyway')}
          danger
          onConfirm={() => {
            setConfirmingNoEndDate(false);
            proceedPastEndDateCheck();
          }}
          onCancel={() => setConfirmingNoEndDate(false)}
        />
      )}

      {confirmingNoPaymentAccount && (
        <ConfirmDialog
          title={t('noPaymentAccountDialogTitle')}
          message={t('noPaymentAccountDownloadMessage')}
          confirmLabel={t('downloadAnyway')}
          danger
          onConfirm={() => {
            setConfirmingNoPaymentAccount(false);
            void handleDownload();
          }}
          onCancel={() => setConfirmingNoPaymentAccount(false)}
        />
      )}
    </section>
  );
}

// Stage G5 Part 1/2. Handles both "excuse a fresh date" (opened from the
// section header, date picker free - the driver often gives notice before
// the generator has created that day's ledger row at all) and "excuse this
// specific row" (opened from a row, date pre-filled).
function ExcuseDayDialog({
  planId,
  initialDate,
  onClose,
  onExcused,
}: {
  planId: string;
  initialDate: string | null;
  onClose: () => void;
  onExcused: () => void;
}) {
  const { t } = useTranslation('ownershipPlanDetail');
  const { t: tCommon } = useTranslation('common');
  const [excusedDate, setExcusedDate] = useState(initialDate ?? '');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = excusedDate !== '' && reason.trim() !== '' && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload: CreateDayExcusalPayload = { excusedDate, reason: reason.trim() };
      await apiFetch(`/ownership-plans/${planId}/excusals`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      onExcused();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('excuseError'));
      setSubmitting(false);
    }
  }

  return (
    <Modal title={t('excuseADay')} onClose={onClose}>
      <p className="mb-4 rounded bg-warn-d px-3 py-2 text-sm text-warn">
        {t('excuseWarningPart1')}
        <strong>{t('excuseWarningBold')}</strong>
        {t('excuseWarningPart2')}
      </p>

      <label className="mb-3 block text-sm font-medium text-txt-2">
        {t('dateLabel')}
        <input
          type="date"
          value={excusedDate}
          onChange={(e) => setExcusedDate(e.target.value)}
          className="mt-1 block w-full rounded border border-line px-3 py-1.5 text-sm"
        />
      </label>

      <label className="mb-4 block text-sm font-medium text-txt-2">
        {t('reasonLabel')}
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder={t('reasonPlaceholder')}
          className="mt-1 block w-full rounded border border-line px-3 py-1.5 text-sm"
        />
      </label>

      {error && <p className="mb-3 text-sm text-crit">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          {tCommon('cancel')}
        </button>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
          className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {submitting ? t('excusing') : t('excuseDaySubmit')}
        </button>
      </div>
    </Modal>
  );
}

interface MergedLedgerRow {
  date: string;
  ledger: OwnershipPlanLedgerRow | null;
  excusal: DayExcusal | null;
}

// The most recently decided/created excusal for a date stands for that date
// in the merged row - an APPROVED one wins over a stale DECLINED attempt
// from an earlier excuse-then-revoke, since it's the one actually in effect.
function primaryExcusalForDate(excusals: DayExcusal[], date: string): DayExcusal | null {
  const forDate = excusals.filter((e) => e.excusedDate.slice(0, 10) === date);
  if (forDate.length === 0) return null;
  const approved = forDate.find((e) => e.status === 'APPROVED');
  if (approved) return approved;
  return [...forDate].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

// Every ledger date, plus every excusal date the ledger doesn't have a row
// for yet (Stage G5 Part 1 - a future excusal predating the generator).
function buildMergedRows(
  ledgerRows: OwnershipPlanLedgerRow[],
  excusals: DayExcusal[],
): MergedLedgerRow[] {
  const dates = new Set<string>();
  for (const row of ledgerRows) dates.add(row.assignedDate.slice(0, 10));
  for (const excusal of excusals) dates.add(excusal.excusedDate.slice(0, 10));

  return [...dates].sort().map((date) => ({
    date,
    ledger: ledgerRows.find((row) => row.assignedDate.slice(0, 10) === date) ?? null,
    excusal: primaryExcusalForDate(excusals, date),
  }));
}

function LedgerSection({ planId }: { planId: string }) {
  const { t } = useTranslation('ownershipPlanDetail');
  const { t: tTrackingLinks } = useTranslation('trackingLinks');
  const [ledgerRows, setLedgerRows] = useState<OwnershipPlanLedgerRow[] | null>(null);
  const [excusals, setExcusals] = useState<DayExcusal[] | null>(null);
  const [excuseDialogDate, setExcuseDialogDate] = useState<string | null | undefined>(undefined);
  const [revoking, setRevoking] = useState<DayExcusal | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function load() {
    try {
      const [ledgerData, excusalsData] = await Promise.all([
        apiFetch<OwnershipPlanLedgerRow[]>(`/ownership-plans/${planId}/ledger`),
        apiFetch<DayExcusal[]>(`/ownership-plans/${planId}/excusals`),
      ]);
      setLedgerRows(ledgerData);
      setExcusals(excusalsData);
    } catch {
      setLedgerRows([]);
      setExcusals([]);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  async function handleRevoke(excusal: DayExcusal) {
    setActionError(null);
    try {
      await apiFetch(`/ownership-plans/${planId}/excusals/${excusal.id}/decline`, {
        method: 'PATCH',
      });
      setRevoking(null);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('declineRevokeError'));
      setRevoking(null);
    }
  }

  const rows =
    ledgerRows !== null && excusals !== null ? buildMergedRows(ledgerRows, excusals) : null;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-medium text-txt">{t('ledgerSectionTitle')}</h2>
        <button
          type="button"
          onClick={() => setExcuseDialogDate(null)}
          className="rounded border border-line px-3 py-1.5 text-sm font-medium text-txt-2 hover:bg-panel-2"
        >
          {t('excuseADay')}
        </button>
      </div>

      {actionError && <p className="mb-3 text-sm text-crit">{actionError}</p>}

      <div className="max-h-[32rem] overflow-y-auto overflow-x-auto rounded-lg border border-line bg-panel">
        <table className="min-w-full divide-y divide-line-soft text-sm">
          <thead className="sticky top-0 bg-panel-2">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-txt-3">{t('dateLabel')}</th>
              <th className="px-4 py-2 text-right font-medium text-txt-3">{t('colOwed')}</th>
              <th className="px-4 py-2 text-right font-medium text-txt-3">{t('colPaid')}</th>
              <th className="px-4 py-2 text-right font-medium text-txt-3">
                {t('colRunningPosition')}
              </th>
              <th className="px-4 py-2 text-left font-medium text-txt-3">{t('colExcusal')}</th>
              <th className="px-4 py-2 text-left font-medium text-txt-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {rows === null ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-txt-2">
                  {t('loading')}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-txt-2">
                  {t('ledgerEmpty')}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.date}
                  className={row.excusal?.status === 'APPROVED' ? 'bg-good-d' : ''}
                >
                  <td className="px-4 py-2 text-txt-2">{row.date}</td>
                  <td className="px-4 py-2 text-right text-txt-2">
                    {row.ledger ? formatTZS(row.ledger.owed) : '—'}
                  </td>
                  <td className="px-4 py-2 text-right text-txt-2">
                    {row.ledger ? formatTZS(row.ledger.paid) : '—'}
                  </td>
                  <td
                    className={`px-4 py-2 text-right ${row.ledger ? runningPositionClass(row.ledger.runningPosition) : 'text-txt-3'}`}
                  >
                    {row.ledger ? formatTZS(row.ledger.runningPosition) : '—'}
                  </td>
                  <td className="px-4 py-2">
                    {row.excusal ? (
                      <div>
                        <StatusBadge
                          status={row.excusal.status}
                          styles={DAY_EXCUSAL_STATUS_STYLES}
                          label={t(
                            DAY_EXCUSAL_STATUS_LABEL_KEY[row.excusal.status] ?? row.excusal.status,
                          )}
                        />
                        <p className="mt-1 text-xs text-txt-2">
                          {t(
                            DAY_EXCUSAL_STATUS_LABEL_KEY[row.excusal.status] ?? row.excusal.status,
                          )}
                          {row.excusal.reason && ` — ${row.excusal.reason}`}
                        </p>
                        {row.excusal.status !== 'REQUESTED' && row.excusal.decidedByName && (
                          <p className="text-xs text-txt-3">
                            {t('byName', { name: row.excusal.decidedByName })}
                            {row.excusal.decidedAt && ` · ${row.excusal.decidedAt.slice(0, 10)}`}
                          </p>
                        )}
                      </div>
                    ) : (
                      <span className="text-txt-3">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {row.excusal && row.excusal.status !== 'DECLINED' ? (
                      <button
                        type="button"
                        onClick={() => setRevoking(row.excusal)}
                        className="text-xs font-medium text-crit hover:underline"
                      >
                        {row.excusal.status === 'APPROVED'
                          ? tTrackingLinks('revoke')
                          : t('actionDecline')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setExcuseDialogDate(row.date)}
                        className="text-xs font-medium text-txt-2 hover:underline"
                      >
                        {t('excuseAction')}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {excuseDialogDate !== undefined && (
        <ExcuseDayDialog
          planId={planId}
          initialDate={excuseDialogDate}
          onClose={() => setExcuseDialogDate(undefined)}
          onExcused={() => {
            setExcuseDialogDate(undefined);
            void load();
          }}
        />
      )}

      {revoking && (
        <ConfirmDialog
          title={
            revoking.status === 'APPROVED' ? t('revokeExcusalTitle') : t('declineRequestTitle')
          }
          message={
            revoking.status === 'APPROVED'
              ? t('revokeMessage', { date: revoking.excusedDate.slice(0, 10) })
              : t('declineMessage', { date: revoking.excusedDate.slice(0, 10) })
          }
          confirmLabel={
            revoking.status === 'APPROVED' ? tTrackingLinks('revoke') : t('actionDecline')
          }
          danger
          onConfirm={() => void handleRevoke(revoking)}
          onCancel={() => setRevoking(null)}
        />
      )}
    </section>
  );
}

/**
 * Stage G6 Part 4 - a plan created with no contract end date (JUMA BAKARI's,
 * and both seeded demo plans that predate this field) had no way to get one
 * short of cancelling and recreating the plan. This is the one place
 * UpdateOwnershipPlanDto.contractEndDate is reachable from the dashboard for
 * a plan that already exists.
 */
function ContractEndDateEditor({
  plan,
  onUpdated,
}: {
  plan: OwnershipPlan;
  onUpdated: (plan: OwnershipPlan) => void;
}) {
  const { t } = useTranslation('ownershipPlanDetail');
  const { t: tCommon } = useTranslation('common');
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(plan.contractEndDate?.slice(0, 10) ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    setValue(plan.contractEndDate?.slice(0, 10) ?? '');
    setError(null);
    setEditing(true);
  }

  async function handleSave() {
    if (!value) return;
    setSaving(true);
    setError(null);
    try {
      const payload: UpdateOwnershipPlanPayload = { contractEndDate: value };
      const updated = await apiFetch<OwnershipPlan>(`/ownership-plans/${plan.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      onUpdated(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('saveEndDateError'));
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <span>
        {plan.contractEndDate ? (
          t('endsLine', { date: plan.contractEndDate.slice(0, 10) })
        ) : (
          <span className="text-warn">{t('noEndDateSet', { date: plan.derivedEndDate })}</span>
        )}{' '}
        <button
          type="button"
          onClick={startEditing}
          className="text-txt-2 underline hover:text-txt"
        >
          {plan.contractEndDate ? t('editButton') : t('setEndDateButton')}
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <input
        type="date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="rounded border border-line px-2 py-1 text-sm"
      />
      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={saving || !value}
        className="rounded bg-gray-900 px-2 py-1 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {saving ? tCommon('saving') : tCommon('save')}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="text-xs text-txt-2 hover:underline"
      >
        {tCommon('cancel')}
      </button>
      {error && <span className="text-xs text-crit">{error}</span>}
    </span>
  );
}

/**
 * Stage G10 - registrationCardHandedOverAt/spareKeyHandedOverAt/
 * nameTransferConfirmedAt had sat on the schema unused since Stage F2 -
 * this is the first UI (and the first API path, on UpdateOwnershipPlanDto)
 * either has ever reached. depositReturned is a fourth item, shown only for
 * a HELD_REFUNDABLE plan - there is nothing to return on an APPLIED one,
 * and the service 400s an attempt to set it there.
 *
 * Each item is a genuine two-way toggle, not a one-shot "mark done" button:
 * checking sends true (stamps *At to now), unchecking sends false (clears
 * it back to null) - a mis-click is recoverable without reaching for
 * Prisma Studio.
 */
function CompletionChecklistSection({
  plan,
  onUpdated,
}: {
  plan: OwnershipPlan;
  onUpdated: (plan: OwnershipPlan) => void;
}) {
  const { t } = useTranslation('ownershipPlanDetail');
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(field: keyof UpdateOwnershipPlanPayload, checked: boolean) {
    setSaving(field);
    setError(null);
    try {
      const payload: UpdateOwnershipPlanPayload = { [field]: checked };
      const updated = await apiFetch<OwnershipPlan>(`/ownership-plans/${plan.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('checklistUpdateError'));
    } finally {
      setSaving(null);
    }
  }

  const items: Array<{ key: keyof UpdateOwnershipPlanPayload; label: string; at: string | null }> =
    [
      {
        key: 'registrationCardHandedOver',
        label: t('checklistRegistrationCard'),
        at: plan.registrationCardHandedOverAt,
      },
      {
        key: 'spareKeyHandedOver',
        label: t('checklistSpareKey'),
        at: plan.spareKeyHandedOverAt,
      },
      {
        key: 'nameTransferConfirmed',
        label: t('checklistNameTransfer'),
        at: plan.nameTransferConfirmedAt,
      },
    ];
  if (plan.depositHandling === 'HELD_REFUNDABLE') {
    items.push({
      key: 'depositReturned',
      label: t('checklistDepositReturned'),
      at: plan.depositReturnedAt,
    });
  }

  return (
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-semibold text-txt">{t('checklistSectionTitle')}</h2>
      <div className="space-y-2 rounded border border-line bg-panel p-4">
        {items.map((item) => (
          <label key={item.key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={item.at !== null}
              disabled={saving === item.key}
              onChange={(e) => void toggle(item.key, e.target.checked)}
            />
            <span className="text-txt">{item.label}</span>
            {item.at && <span className="text-xs text-txt-2">— {item.at.slice(0, 10)}</span>}
          </label>
        ))}
        {error && <p className="text-xs text-crit">{error}</p>}
      </div>
    </section>
  );
}

export function OwnershipPlanDetailPage() {
  const { t } = useTranslation('ownershipPlanDetail');
  const { t: tOwnership } = useTranslation('ownership');
  const { planId } = useParams<{ planId: string }>();
  const [plan, setPlan] = useState<OwnershipPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPlan = useCallback(() => {
    if (!planId) return;
    apiFetch<OwnershipPlan>(`/ownership-plans/${planId}`)
      .then(setPlan)
      .catch(() => setError(t('pageLoadError')));
  }, [planId, t]);

  useEffect(() => {
    loadPlan();
  }, [loadPlan]);

  if (!planId) return null;
  if (error) return <p className="text-sm text-crit">{error}</p>;
  if (!plan) return <p className="text-sm text-txt-2">{t('loading')}</p>;

  return (
    <div>
      <Link to="/ownership" className="mb-4 inline-block text-sm text-txt-2 hover:underline">
        {t('backLink')}
      </Link>
      <h1 className="mb-1 text-xl font-semibold text-txt">
        {plan.driver
          ? `${plan.driver.user.firstName} ${plan.driver.user.lastName}`
          : tOwnership('tableDriver')}
        {' — '}
        {plan.motorcycle?.registrationNumber ?? tOwnership('tableVehicle')}
      </h1>
      <p className="mb-4 text-sm text-txt-2">
        {t('perDayForDays', { daily: formatTZS(plan.dailyAmount), count: plan.instalmentCount })}
        {' · '}
        {t('declaredValueSummary', { amount: formatTZS(plan.totalPrice) })}
        {' · '}
        {t('downPaymentSummary', { amount: formatTZS(plan.downPayment) })}
        {' · '}
        {t('startedSummary', { date: plan.startDate.slice(0, 10) })}
        {' · '}
        <ContractEndDateEditor plan={plan} onUpdated={setPlan} />
      </p>
      {/* Stage G10 - a THIRD signal, separate from the behind/ahead figures
          below and the breach threshold OwnershipPage's severity colouring
          watches - a date condition, not a payment-streak condition. */}
      {plan.pastDeadlineStillOwing && (
        <p className="mb-4 text-sm font-medium text-violet">
          {t('pastDeadlineMessage', { amount: formatTZS(plan.remainingToOwn) })}
        </p>
      )}

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded border border-line bg-panel p-3">
          <p className="text-xs text-txt-2">{t('kpiPaidToDate')}</p>
          <p className="text-lg font-semibold text-txt">{formatTZS(plan.amountPaid)}</p>
        </div>
        <div className="rounded border border-line bg-panel p-3">
          <p className="text-xs text-txt-2">{tOwnership('tableRemaining')}</p>
          <p className="text-lg font-semibold text-txt">{formatTZS(plan.remainingToOwn)}</p>
        </div>
        <div className="rounded border border-line bg-panel p-3">
          <p className="text-xs text-txt-2">{tOwnership('tableDaysLeft')}</p>
          <p className="text-lg font-semibold text-txt">{plan.daysLeft}</p>
        </div>
        <div className="rounded border border-line bg-panel p-3">
          <p className="text-xs text-txt-2">{tOwnership('tableProjectedCompletion')}</p>
          <p className="text-lg font-semibold text-txt">{plan.projectedCompletion}</p>
        </div>
      </div>

      <ContractSection planId={planId} hasContractEndDate={plan.contractEndDate !== null} />
      <CompletionChecklistSection plan={plan} onUpdated={setPlan} />
      <LedgerSection planId={planId} />
    </div>
  );
}
