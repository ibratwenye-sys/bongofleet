import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiFetch, ApiError } from '../lib/api';
import type {
  CreateGuarantorPayload,
  Document,
  Driver,
  Guarantor,
  UpdateGuarantorPayload,
} from '../lib/types';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DocumentSlot } from '../components/DocumentSlot';
import { PasswordRecoveryNote } from '../components/PasswordRecovery';

function GuarantorFormModal({
  driverId,
  guarantor,
  onClose,
  onSaved,
}: {
  driverId: string;
  guarantor: Guarantor | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t } = useTranslation('drivers');
  const { t: tCommon } = useTranslation('common');
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
      setError(t('errorNameRequired'));
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
        onSaved(t('guarantorUpdated'));
      } else {
        const payload: CreateGuarantorPayload = {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          phone: form.phone.trim(),
          relationship: form.relationship.trim() || undefined,
          nationalId: form.nationalId.trim() || undefined,
        };
        await apiFetch(`/drivers/${driverId}/guarantors`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onSaved(t('guarantorAdded'));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('genericError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={isEdit ? t('editGuarantorTitle') : t('addGuarantor')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('fieldFirstName')}
            </label>
            <input
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('fieldLastName')}
            </label>
            <input
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">{t('fieldPhone')}</label>
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('fieldRelationshipOptional')}
            </label>
            <input
              value={form.relationship}
              onChange={(e) => setForm({ ...form, relationship: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('fieldNationalIdOptional')}
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
            {tCommon('cancel')}
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {submitting ? tCommon('saving') : tCommon('save')}
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
  const { t } = useTranslation('drivers');
  const { t: tCommon } = useTranslation('common');
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
            {tCommon('edit')}
          </button>
          <button onClick={onRemove} className="text-sm font-medium text-red-600 hover:underline">
            {t('remove')}
          </button>
        </div>
      </div>
      {documents === null ? (
        <p className="text-sm text-gray-500">{t('loadingDocument')}</p>
      ) : (
        <DocumentSlot
          ownerType="GUARANTOR"
          ownerId={guarantor.id}
          docType="GUARANTOR_ID"
          label={t('documentGuarantorId')}
          documents={documents}
          onChanged={loadDocuments}
        />
      )}
    </div>
  );
}

export function DriverDetailPage() {
  const { t } = useTranslation('drivers');
  const { driverId } = useParams<{ driverId: string }>();
  const [driver, setDriver] = useState<Driver | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [guarantors, setGuarantors] = useState<Guarantor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [formTarget, setFormTarget] = useState<'new' | Guarantor | null>(null);
  const [removing, setRemoving] = useState<Guarantor | null>(null);

  async function load() {
    if (!driverId) return;
    try {
      const [driverData, documentsData, guarantorsData] = await Promise.all([
        apiFetch<Driver>(`/drivers/${driverId}`),
        apiFetch<Document[]>(`/documents?ownerType=RIDER&ownerId=${encodeURIComponent(driverId)}`),
        apiFetch<Guarantor[]>(`/drivers/${driverId}/guarantors`),
      ]);
      setDriver(driverData);
      setDocuments(documentsData);
      setGuarantors(guarantorsData);
    } catch {
      setError(t('loadDriverError'));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverId]);

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
      setSuccessMessage(t('guarantorRemoved'));
      setRemoving(null);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('removeGuarantorError'));
      setRemoving(null);
    }
  }

  if (!driverId) return null;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!driver) return <p className="text-sm text-gray-500">{t('loading')}</p>;

  return (
    <div>
      <Link to="/drivers" className="mb-4 inline-block text-sm text-gray-600 hover:underline">
        {t('backToDrivers')}
      </Link>
      <h1 className="mb-4 text-xl font-semibold text-gray-900">
        {driver.user.firstName} {driver.user.lastName}
      </h1>

      {successMessage && (
        <p className="mb-4 rounded bg-green-50 px-3 py-2 text-sm text-green-700">
          {successMessage}
        </p>
      )}

      {/* Stage H0f Part 2 - above Documents on purpose. This is the thing an owner
          needs to have already read before a rider calls him locked out, not
          something to go hunting for once he has. */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-medium text-gray-900">{t('tablePasswordRecovery')}</h2>
        <p className="mb-3 text-sm text-gray-600">{driver.user.email}</p>
        <PasswordRecoveryNote emailProvenAt={driver.user.emailProvenAt} />
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-medium text-gray-900">{t('documentsHeading')}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DocumentSlot
            ownerType="RIDER"
            ownerId={driverId}
            docType="NATIONAL_ID"
            label={t('documentNationalId')}
            documents={documents}
            onChanged={load}
          />
          <DocumentSlot
            ownerType="RIDER"
            ownerId={driverId}
            docType="DRIVERS_LICENSE"
            label={t('documentDriversLicense')}
            documents={documents}
            onChanged={load}
          />
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium text-gray-900">{t('guarantorsHeading')}</h2>
          <button
            onClick={() => setFormTarget('new')}
            className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
          >
            {t('addGuarantor')}
          </button>
        </div>
        {guarantors.length < 2 && (
          <p className="mb-3 text-sm text-amber-700">{t('addAtLeastTwoGuarantors')}</p>
        )}
        <div className="space-y-3">
          {guarantors.length === 0 ? (
            <p className="text-sm text-gray-500">{t('noGuarantorsYet')}</p>
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
          driverId={driverId}
          guarantor={formTarget === 'new' ? null : formTarget}
          onClose={() => setFormTarget(null)}
          onSaved={handleGuarantorSaved}
        />
      )}

      {removing && (
        <ConfirmDialog
          title={t('removeGuarantorTitle')}
          message={t('removeGuarantorMessage', {
            firstName: removing.firstName,
            lastName: removing.lastName,
          })}
          confirmLabel={t('remove')}
          danger
          onConfirm={handleRemoveGuarantor}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
