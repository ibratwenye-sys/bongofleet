import { useRef, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import { formatTZS } from '../lib/format';
import type {
  TransportPaymentCandidate,
  TransportReconciliationCommitResult,
  TransportReconciliationPreview,
  TransportReconciliationRowSelection,
} from '../lib/types';
import { Modal } from './Modal';

const SKIP = 'skip';

function candidateLabel(c: TransportPaymentCandidate): string {
  const reason = c.matchReason === 'reference' ? 'Reference match' : 'Amount match';
  const ref = c.reference ?? 'no reference';
  const who = c.customerName ? ` · ${c.customerName}` : '';
  return `${reason} — ${ref}${who} — owes ${formatTZS(c.remainingBalance)}`;
}

/**
 * TRANSPORT_DESIGN.md §6 - manual statement-upload payment reconciliation.
 * Mirrors BulkImportPage's own preview-then-commit UX: upload the file, see
 * parsed rows with their candidate matches, confirm, and the SAME file is
 * re-sent to /commit (no server-side draft between the two calls).
 */
export function TransportReconciliationModal({
  onClose,
  onCommitted,
}: {
  onClose: () => void;
  onCommitted: (message: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<TransportReconciliationPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<TransportReconciliationCommitResult | null>(
    null,
  );
  // rowIndex -> chosen transportJobId, or the literal 'skip'. A row simply
  // absent from this map is treated as 'skip' too (see buildSelections).
  const [choices, setChoices] = useState<Map<number, string>>(new Map());

  function handleFileChange(selected: File | null) {
    setFile(selected);
    setPreview(null);
    setCommitResult(null);
    setChoices(new Map());
    setError(null);
  }

  async function runPreview() {
    if (!file) return;
    setPreviewLoading(true);
    setError(null);
    setCommitResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const result = await apiFetch<TransportReconciliationPreview>(
        '/transport-reconciliation/preview',
        { method: 'POST', body: formData },
      );
      setPreview(result);
      // Pre-select only a single, unambiguous reference match - a lone
      // amount match is a weaker signal and the owner must actively choose
      // it (TRANSPORT_DESIGN.md §6's own instruction).
      const initial = new Map<number, string>();
      for (const row of result.rows) {
        if (row.candidates.length === 1 && row.candidates[0].matchReason === 'reference') {
          initial.set(row.rowIndex, row.candidates[0].jobId);
        }
      }
      setChoices(initial);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not read this statement.');
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function runCommit() {
    if (!file || !preview) return;
    const selections: TransportReconciliationRowSelection[] = preview.rows
      .filter((row) => !row.error)
      .map((row) => ({ rowIndex: row.rowIndex, transportJobId: choices.get(row.rowIndex) ?? SKIP }))
      .filter((s) => s.transportJobId !== SKIP);
    if (selections.length === 0) {
      setError('Pick at least one row to record before confirming.');
      return;
    }
    setCommitting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('selections', JSON.stringify(selections));
      const result = await apiFetch<TransportReconciliationCommitResult>(
        '/transport-reconciliation/commit',
        { method: 'POST', body: formData },
      );
      setCommitResult(result);
      const committedCount = result.results.filter((r) => r.status === 'committed').length;
      onCommitted(`Recorded ${committedCount} payment${committedCount === 1 ? '' : 's'}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record these payments.');
    } finally {
      setCommitting(false);
    }
  }

  const rowResultByIndex = new Map((commitResult?.results ?? []).map((r) => [r.rowIndex, r]));

  return (
    <Modal title="Reconcile payments" onClose={onClose} maxWidth="max-w-4xl">
      <div className="space-y-4">
        <p className="text-sm text-txt-2">
          Upload a bank or mobile-money statement export (.xlsx or .csv). We'll match its rows
          against transport jobs that still have a balance owed - review the suggestions below
          before confirming.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
          <button
            onClick={() => void runPreview()}
            disabled={!file || previewLoading}
            className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {previewLoading ? 'Reading…' : 'Preview'}
          </button>
        </div>

        {error && <p className="text-sm text-crit">{error}</p>}

        {preview && (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line-soft bg-panel-2 text-left text-xs text-txt-3">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Narrative</th>
                  <th className="px-3 py-2 font-medium">Match</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => {
                  const result = rowResultByIndex.get(row.rowIndex);
                  return (
                    <tr key={row.rowIndex} className="border-b border-line-soft last:border-0">
                      <td className="px-3 py-2 text-txt-2 whitespace-nowrap">
                        {row.date ? row.date.slice(0, 10) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-txt-2 whitespace-nowrap">
                        {row.amount !== null ? formatTZS(row.amount) : '—'}
                      </td>
                      <td className="px-3 py-2 text-txt-2">{row.narrative || '—'}</td>
                      <td className="px-3 py-2">
                        {row.error ? (
                          <span className="text-xs text-crit">{row.error}</span>
                        ) : row.candidates.length === 0 ? (
                          <span className="text-xs text-txt-3">No match found</span>
                        ) : (
                          <select
                            value={choices.get(row.rowIndex) ?? SKIP}
                            disabled={!!commitResult}
                            onChange={(e) => {
                              const next = new Map(choices);
                              if (e.target.value === SKIP) next.delete(row.rowIndex);
                              else next.set(row.rowIndex, e.target.value);
                              setChoices(next);
                            }}
                            className="w-full rounded border border-line bg-panel px-2 py-1 text-xs text-txt"
                          >
                            <option value={SKIP}>Skip this row</option>
                            {row.candidates.map((c) => (
                              <option key={c.jobId} value={c.jobId}>
                                {candidateLabel(c)}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {result ? (
                          result.status === 'committed' ? (
                            <span className="text-good">
                              Recorded
                              {result.overpaidWarning ? ' (overpaid - already fully paid)' : ''}
                            </span>
                          ) : (
                            <span className="text-crit">{result.message ?? result.status}</span>
                          )
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-line px-3 py-1.5 text-sm font-medium text-txt-2 hover:bg-panel-2"
          >
            {commitResult ? 'Close' : 'Cancel'}
          </button>
          {!commitResult && (
            <button
              onClick={() => void runCommit()}
              disabled={!preview || committing}
              className="rounded bg-green-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {committing ? 'Recording…' : 'Confirm and record'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
