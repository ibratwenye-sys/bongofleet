import { useRef, useState } from 'react';
import { apiFetch, apiFetchBlob, ApiError } from '../lib/api';
import type { Document, DocType, DocumentOwnerType } from '../lib/types';
import { computeDocumentStatus } from '../lib/document-status';
import { ConfirmDialog } from './ConfirmDialog';
import { DOCUMENT_STATUS_STYLES, StatusBadge } from './StatusBadge';

const ACCEPTED_TYPES = 'image/jpeg,image/png,application/pdf';

export function DocumentSlot({
  ownerType,
  ownerId,
  docType,
  label,
  hint,
  documents,
  onChanged,
}: {
  ownerType: DocumentOwnerType;
  ownerId: string;
  docType: DocType;
  label: string;
  hint?: string;
  documents: Document[];
  onChanged: () => void;
}) {
  const existing = documents.find((d) => d.docType === docType) ?? null;
  const [replacing, setReplacing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noFileSelected, setNoFileSelected] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [referenceNumber, setReferenceNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetForm() {
    setFile(null);
    setReferenceNumber('');
    setExpiryDate('');
    setError(null);
    setNoFileSelected(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleView() {
    if (!existing) return;
    setViewing(true);
    setError(null);
    try {
      const blob = await apiFetchBlob(`/documents/${existing.id}/file`);
      window.open(URL.createObjectURL(blob), '_blank');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open the file.');
    } finally {
      setViewing(false);
    }
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!file) {
      setNoFileSelected(true);
      return;
    }
    setNoFileSelected(false);

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('ownerType', ownerType);
      formData.append('ownerId', ownerId);
      formData.append('docType', docType);
      if (referenceNumber.trim()) formData.append('referenceNumber', referenceNumber.trim());
      if (expiryDate) formData.append('expiryDate', expiryDate);
      formData.append('file', file);

      await apiFetch('/documents', { method: 'POST', body: formData });

      // Best-effort cleanup of the slot's previous document - the new upload
      // already succeeded, so a failure here shouldn't block refreshing the UI.
      if (replacing && existing) {
        await apiFetch(`/documents/${existing.id}`, { method: 'DELETE' }).catch(() => undefined);
      }

      resetForm();
      setReplacing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!existing) return;
    try {
      await apiFetch(`/documents/${existing.id}`, { method: 'DELETE' });
      setDeleting(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete document.');
      setDeleting(false);
    }
  }

  return (
    <div className="rounded border border-gray-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-gray-700">
          {label}
          {hint && <span className="ml-1 text-xs font-normal text-gray-500">{hint}</span>}
        </p>
        {existing && !replacing && (
          <StatusBadge
            status={computeDocumentStatus(existing.expiryDate)}
            styles={DOCUMENT_STATUS_STYLES}
          />
        )}
      </div>

      {existing && !replacing ? (
        <div className="space-y-1 text-sm text-gray-600">
          <p>Reference: {existing.referenceNumber ?? '—'}</p>
          <p>Expiry: {existing.expiryDate ? existing.expiryDate.slice(0, 10) : '—'}</p>
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              disabled={viewing}
              onClick={() => void handleView()}
              className="text-sm font-medium text-gray-700 hover:underline disabled:opacity-50"
            >
              {viewing ? 'Opening…' : 'View'}
            </button>
            <button
              type="button"
              onClick={() => setReplacing(true)}
              className="text-sm font-medium text-gray-700 hover:underline"
            >
              Replace
            </button>
            <button
              type="button"
              onClick={() => setDeleting(true)}
              className="text-sm font-medium text-red-600 hover:underline"
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleUpload} className="space-y-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setNoFileSelected(false);
            }}
            className="hidden"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Choose photo or PDF
            </button>
            {file && <span className="truncate text-sm text-gray-600">{file.name}</span>}
          </div>
          {noFileSelected && <p className="text-xs text-gray-500">Choose a file to upload.</p>}
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="Reference number (optional)"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1 text-sm"
            />
            <input
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded bg-gray-900 px-3 py-1 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {submitting ? 'Uploading…' : replacing ? 'Upload replacement' : 'Upload'}
            </button>
            {replacing && (
              <button
                type="button"
                onClick={() => {
                  setReplacing(false);
                  resetForm();
                }}
                className="rounded border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${label}`}
          message={`Delete this ${label.toLowerCase()} document? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleting(false)}
        />
      )}
    </div>
  );
}
