import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';
import type {
  CreateGuarantorPayload,
  Document,
  Guarantor,
  Rider,
  UpdateGuarantorPayload,
} from '../lib/types';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DocumentSlot } from '../components/DocumentSlot';

function GuarantorFormModal({
  riderId,
  guarantor,
  onClose,
  onSaved,
}: {
  riderId: string;
  guarantor: Guarantor | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isEdit = guarantor != null;
  const [form, setForm] = useState({
    firstName: guarantor?.firstName ?? '',
    lastName: guarantor?.lastName ?? '',
    phone: guarantor?.phone ?? '',
    relationship: guarantor?.relationship ?? '',
    nationalId: guarantor?.nationalId ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.firstName.trim() || !form.lastName.trim() || !form.phone.trim()) {
      setError('First name, last name, and phone are required.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      if (isEdit) {
        const payload: UpdateGuarantorPayload = {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          phone: form.phone.trim(),
          relationship: form.relationship.trim() || undefined,
          nationalId: form.nationalId.trim() || undefined,
        };
        await apiFetch(`/guarantors/${guarantor.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        onSaved('Guarantor updated.');
      } else {
        const payload: CreateGuarantorPayload = {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          phone: form.phone.trim(),
          relationship: form.relationship.trim() || undefined,
          nationalId: form.nationalId.trim() || undefined,
        };
        await apiFetch(`/riders/${riderId}/guarantors`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onSaved('Guarantor added.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={isEdit ? 'Edit guarantor' : 'Add guarantor'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">First name</label>
            <input
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Last name</label>
            <input
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Phone</label>
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Relationship (optional)
            </label>
            <input
              value={form.relationship}
              onChange={(e) => setForm({ ...form, relationship: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              National ID (optional)
            </label>
            <input
              value={form.nationalId}
              onChange={(e) => setForm({ ...form, nationalId: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
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

function GuarantorRow({
  guarantor,
  onEdit,
  onRemove,
}: {
  guarantor: Guarantor;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [documents, setDocuments] = useState<Document[] | null>(null);

  async function loadDocuments() {
    try {
      const data = await apiFetch<Document[]>(
        `/documents?ownerType=GUARANTOR&ownerId=${encodeURIComponent(guarantor.id)}`,
      );
      setDocuments(data);
    } catch {
      setDocuments([]);
    }
  }

  useEffect(() => {
    void loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guarantor.id]);

  return (
    <div className="rounded border border-gray-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="font-medium text-gray-900">
            {guarantor.firstName} {guarantor.lastName}
          </p>
          <p className="text-sm text-gray-600">
            {guarantor.phone}
            {guarantor.relationship ? ` — ${guarantor.relationship}` : ''}
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={onEdit} className="text-sm font-medium text-gray-700 hover:underline">
            Edit
          </button>
          <button onClick={onRemove} className="text-sm font-medium text-red-600 hover:underline">
            Remove
          </button>
        </div>
      </div>
      {documents === null ? (
        <p className="text-sm text-gray-500">Loading document…</p>
      ) : (
        <DocumentSlot
          ownerType="GUARANTOR"
          ownerId={guarantor.id}
          docType="GUARANTOR_ID"
          label="Guarantor ID"
          documents={documents}
          onChanged={loadDocuments}
        />
      )}
    </div>
  );
}

export function RiderDetailPage() {
  const { riderId } = useParams<{ riderId: string }>();
  const [rider, setRider] = useState<Rider | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [guarantors, setGuarantors] = useState<Guarantor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [formTarget, setFormTarget] = useState<'new' | Guarantor | null>(null);
  const [removing, setRemoving] = useState<Guarantor | null>(null);

  async function load() {
    if (!riderId) return;
    try {
      const [riderData, documentsData, guarantorsData] = await Promise.all([
        apiFetch<Rider>(`/riders/${riderId}`),
        apiFetch<Document[]>(`/documents?ownerType=RIDER&ownerId=${encodeURIComponent(riderId)}`),
        apiFetch<Guarantor[]>(`/riders/${riderId}/guarantors`),
      ]);
      setRider(riderData);
      setDocuments(documentsData);
      setGuarantors(guarantorsData);
    } catch {
      setError('Could not load rider. Please try again.');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riderId]);

  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  function handleGuarantorSaved(message: string) {
    setFormTarget(null);
    setSuccessMessage(message);
    void load();
  }

  async function handleRemoveGuarantor() {
    if (!removing) return;
    try {
      await apiFetch(`/guarantors/${removing.id}`, { method: 'DELETE' });
      setSuccessMessage('Guarantor removed.');
      setRemoving(null);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove guarantor.');
      setRemoving(null);
    }
  }

  if (!riderId) return null;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!rider) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div>
      <Link to="/riders" className="mb-4 inline-block text-sm text-gray-600 hover:underline">
        ← Back to riders
      </Link>
      <h1 className="mb-4 text-xl font-semibold text-gray-900">
        {rider.user.firstName} {rider.user.lastName}
      </h1>

      {successMessage && (
        <p className="mb-4 rounded bg-green-50 px-3 py-2 text-sm text-green-700">
          {successMessage}
        </p>
      )}

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-medium text-gray-900">Documents</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <DocumentSlot
            ownerType="RIDER"
            ownerId={riderId}
            docType="NATIONAL_ID"
            label="National ID"
            documents={documents}
            onChanged={load}
          />
          <DocumentSlot
            ownerType="RIDER"
            ownerId={riderId}
            docType="DRIVERS_LICENSE"
            label="Driver's License"
            documents={documents}
            onChanged={load}
          />
          <DocumentSlot
            ownerType="RIDER"
            ownerId={riderId}
            docType="LATRA"
            label="LATRA"
            documents={documents}
            onChanged={load}
          />
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium text-gray-900">Guarantors</h2>
          <button
            onClick={() => setFormTarget('new')}
            className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
          >
            Add guarantor
          </button>
        </div>
        {guarantors.length < 2 && (
          <p className="mb-3 text-sm text-amber-700">Add at least two guarantors.</p>
        )}
        <div className="space-y-3">
          {guarantors.length === 0 ? (
            <p className="text-sm text-gray-500">No guarantors yet.</p>
          ) : (
            guarantors.map((g) => (
              <GuarantorRow
                key={g.id}
                guarantor={g}
                onEdit={() => setFormTarget(g)}
                onRemove={() => setRemoving(g)}
              />
            ))
          )}
        </div>
      </section>

      {formTarget && (
        <GuarantorFormModal
          riderId={riderId}
          guarantor={formTarget === 'new' ? null : formTarget}
          onClose={() => setFormTarget(null)}
          onSaved={handleGuarantorSaved}
        />
      )}

      {removing && (
        <ConfirmDialog
          title="Remove guarantor"
          message={`Remove ${removing.firstName} ${removing.lastName} as a guarantor?`}
          confirmLabel="Remove"
          danger
          onConfirm={handleRemoveGuarantor}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
