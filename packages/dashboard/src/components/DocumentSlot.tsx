import { useState } from 'react';
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
  documents,
  onChanged,
}: {
  ownerType: DocumentOwnerType;
  ownerId: string;
  docType: DocType;
  label: string;
  documents: Document[];
  onChanged: () => void;
}) {
  const existing = documents.find((d) => d.docType === docType) ?? null;
  const [replacing, setReplacing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [referenceNumber, setReferenceNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');

  function resetForm() {
    setFile(null);
    setReferenceNumber('');
    setExpiryDate('');
    setError(null);
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
      setError('Choose a file to upload.');
      return;
    }

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
        <p className="text-sm font-medium text-gray-700">{label}</p>
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
            type="file"
            accept={ACCEPTED_TYPES}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm"
          />
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
