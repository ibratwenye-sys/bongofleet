import { useRef, useState } from 'react';
import { useAuth } from '../lib/auth-context';
import { apiFetch, apiFetchBlob, ApiError } from '../lib/api';
import type {
  BulkImportCommitCounts,
  BulkImportCommitResult,
  BulkImportPreviewResult,
  BulkImportRowResult,
  BulkImportSheet,
} from '../lib/types';

const SHEET_LABEL: Record<BulkImportSheet, string> = {
  vehicles: 'Vehicles',
  drivers: 'Drivers',
  assignments: 'Assignments',
  ownershipPlans: 'Ownership plans',
};

const SHEETS: BulkImportSheet[] = ['vehicles', 'drivers', 'assignments', 'ownershipPlans'];

const COUNT_LABEL: Record<keyof BulkImportCommitCounts, string> = {
  vehiclesCreated: 'Vehicles created',
  vehiclesUpdated: 'Vehicles updated',
  driversCreated: 'Drivers created',
  driversUpdated: 'Drivers updated',
  ownershipPlansCreated: 'Ownership plans created',
  ownershipPlansUpdated: 'Ownership plans updated',
};

// A downloaded template needs a real save-as-filename, unlike the PDF/blob
// preview pattern elsewhere in this app (OwnershipPlanDetailPage etc., which
// open a blob URL in a new tab) - an .xlsx has nothing to render inline, and
// an owner expects it to land in Downloads under a name they recognize.
function saveBlobAs(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function statusBadge(status: BulkImportRowResult['status']) {
  const styles: Record<BulkImportRowResult['status'], string> = {
    new: 'bg-good-d text-good',
    update: 'bg-c1-d text-c1',
    reference: 'bg-panel-2 text-txt-2',
    error: 'bg-crit-d text-crit',
  };
  const label: Record<BulkImportRowResult['status'], string> = {
    new: 'New',
    update: 'Update',
    reference: 'Reference',
    error: 'Error',
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {label[status]}
    </span>
  );
}

function RowMessages({ row }: { row: BulkImportRowResult }) {
  if (row.messages.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {row.messages.map((m, i) => (
        <li key={i} className={`text-xs ${m.severity === 'error' ? 'text-crit' : 'text-warn'}`}>
          {m.severity === 'error' ? '⚠ ' : '• '}
          {m.text}
        </li>
      ))}
    </ul>
  );
}

function SheetResultCard({ sheet, rows }: { sheet: BulkImportSheet; rows: BulkImportRowResult[] }) {
  const errorCount = rows.filter((r) => r.status === 'error').length;
  const warningCount = rows.filter((r) => r.messages.some((m) => m.severity === 'warning')).length;

  return (
    <div className="rounded-lg border border-line bg-panel shadow-sm">
      <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
        <h3 className="text-sm font-semibold text-txt">{SHEET_LABEL[sheet]}</h3>
        <p className="text-xs text-txt-2">
          {rows.length} row{rows.length === 1 ? '' : 's'}
          {errorCount > 0 && <span className="ml-2 text-crit">{errorCount} error(s)</span>}
          {warningCount > 0 && <span className="ml-2 text-warn">{warningCount} warning(s)</span>}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-txt-2">No rows in this sheet.</p>
      ) : (
        <div className="max-h-80 divide-y divide-line-soft overflow-y-auto">
          {rows.map((row) => (
            <div key={row.row} className="px-4 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-txt-2">Row {row.row}</span>
                {statusBadge(row.status)}
              </div>
              <RowMessages row={row} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function BulkImportPage() {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BulkImportPreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commitCounts, setCommitCounts] = useState<BulkImportCommitCounts | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);

  async function downloadTemplate(sheet: BulkImportSheet) {
    setTemplateError(null);
    try {
      const blob = await apiFetchBlob(`/bulk-import/templates/${sheet}`);
      saveBlobAs(blob, `bongofleet-${sheet}-template.xlsx`);
    } catch (err) {
      setTemplateError(err instanceof ApiError ? err.message : 'Could not download the template.');
    }
  }

  function handleFileChange(selected: File | null) {
    setFile(selected);
    setPreview(null);
    setCommitCounts(null);
    setError(null);
  }

  async function runPreview() {
    if (!file) return;
    setPreviewLoading(true);
    setError(null);
    setCommitCounts(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const result = await apiFetch<BulkImportPreviewResult>('/bulk-import/preview', {
        method: 'POST',
        body: formData,
      });
      setPreview(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not validate this workbook.');
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function runCommit() {
    if (!file || !preview?.canCommit) return;
    setCommitting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const result = await apiFetch<BulkImportCommitResult>('/bulk-import/commit', {
        method: 'POST',
        body: formData,
      });
      setPreview(result.preview);
      setCommitCounts(result.counts);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not commit this workbook.');
    } finally {
      setCommitting(false);
    }
  }

  // Stage BI1 - OWNER-only (tighter than the document-upload OWNER+MANAGER
  // precedent - this changes dozens of records in one shot), same gate as
  // the backend's POST /bulk-import/preview and /commit.
  if (user && user.role !== 'OWNER') {
    return (
      <div className="rounded-lg border border-line bg-panel p-6 text-sm text-txt-2 shadow-sm">
        Only the fleet owner can bulk import.
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-txt">Bulk import</h1>

      <div className="mb-4 rounded-lg border border-line bg-panel p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-txt">1. Download the templates</h2>
        <p className="mb-3 text-xs text-txt-2">
          Fill these in with your fleet's data, then upload the workbook below. Each has one worked
          example row and notes on every column - format phone/NIDA/registration columns as Text if
          you add columns of your own.
        </p>
        <div className="flex flex-wrap gap-2">
          {SHEETS.map((sheet) => (
            <button
              key={sheet}
              onClick={() => void downloadTemplate(sheet)}
              className="rounded border border-line px-3 py-1.5 text-sm text-txt-2 hover:bg-panel-2"
            >
              {SHEET_LABEL[sheet]} template
            </button>
          ))}
        </div>
        {templateError && <p className="mt-2 text-xs text-crit">{templateError}</p>}
      </div>

      <div className="mb-4 rounded-lg border border-line bg-panel p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-txt">2. Upload your workbook</h2>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
          <button
            onClick={() => void runPreview()}
            disabled={!file || previewLoading}
            className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {previewLoading ? 'Checking…' : 'Preview'}
          </button>
          <button
            onClick={() => void runCommit()}
            disabled={!preview?.canCommit || committing}
            className="rounded bg-green-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            title={
              preview && !preview.canCommit
                ? 'Fix every error shown below before importing'
                : undefined
            }
          >
            {committing ? 'Importing…' : 'Import'}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-crit">{error}</p>}
      </div>

      {commitCounts && (
        <div className="mb-4 rounded-lg bg-good-d p-4">
          <h2 className="mb-2 text-sm font-semibold text-good">Import complete</h2>
          <div className="grid grid-cols-2 gap-2 text-sm text-good sm:grid-cols-3">
            {(Object.keys(COUNT_LABEL) as (keyof BulkImportCommitCounts)[]).map((key) => (
              <div key={key}>
                {COUNT_LABEL[key]}: <span className="font-semibold">{commitCounts[key]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {preview && (
        <div className="space-y-4">
          <p className={`text-sm ${preview.canCommit ? 'text-good' : 'text-crit'}`}>
            {preview.canCommit
              ? 'No errors - ready to import.'
              : 'Some rows have errors - fix them in the workbook, then upload and preview again.'}
          </p>
          {preview.sheets.map((s) => (
            <SheetResultCard key={s.sheet} sheet={s.sheet} rows={s.rows} />
          ))}
        </div>
      )}
    </div>
  );
}
