import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import type { Document, Motorcycle } from '../lib/types';
import { DocumentSlot } from '../components/DocumentSlot';

export function MotorcycleDetailPage() {
  const { motorcycleId } = useParams<{ motorcycleId: string }>();
  const [motorcycle, setMotorcycle] = useState<Motorcycle | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!motorcycleId) return;
    try {
      const [motorcycleData, documentsData] = await Promise.all([
        apiFetch<Motorcycle>(`/motorcycles/${motorcycleId}`),
        apiFetch<Document[]>(
          `/documents?ownerType=MOTORCYCLE&ownerId=${encodeURIComponent(motorcycleId)}`,
        ),
      ]);
      setMotorcycle(motorcycleData);
      setDocuments(documentsData);
    } catch {
      setError('Could not load motorcycle. Please try again.');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motorcycleId]);

  if (!motorcycleId) return null;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!motorcycle) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div>
      <Link to="/fleet" className="mb-4 inline-block text-sm text-gray-600 hover:underline">
        ← Back to fleet
      </Link>
      <h1 className="mb-4 text-xl font-semibold text-gray-900">
        {motorcycle.registrationNumber}
        {(motorcycle.make || motorcycle.model) && (
          <span className="ml-2 text-base font-normal text-gray-500">
            {[motorcycle.make, motorcycle.model].filter(Boolean).join(' ')}
          </span>
        )}
      </h1>

      <section>
        <h2 className="mb-3 text-lg font-medium text-gray-900">Documents</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DocumentSlot
            ownerType="MOTORCYCLE"
            ownerId={motorcycleId}
            docType="INSURANCE"
            label="Insurance"
            documents={documents}
            onChanged={load}
          />
          <DocumentSlot
            ownerType="MOTORCYCLE"
            ownerId={motorcycleId}
            docType="REGISTRATION_CARD"
            label="Registration Card"
            documents={documents}
            onChanged={load}
          />
          <DocumentSlot
            ownerType="MOTORCYCLE"
            ownerId={motorcycleId}
            docType="LATRA"
            label="LATRA"
            documents={documents}
            onChanged={load}
          />
          <DocumentSlot
            ownerType="MOTORCYCLE"
            ownerId={motorcycleId}
            docType="VEHICLE_INSPECTION"
            label="Vehicle Inspection"
            documents={documents}
            onChanged={load}
          />
          <DocumentSlot
            ownerType="MOTORCYCLE"
            ownerId={motorcycleId}
            docType="ROAD_SAFETY_WEEK"
            label="Road Safety Week"
            documents={documents}
            onChanged={load}
          />
          <DocumentSlot
            ownerType="MOTORCYCLE"
            ownerId={motorcycleId}
            docType="TBS_CERTIFICATE"
            label="TBS Certificate"
            hint="(for delivery bikes)"
            documents={documents}
            onChanged={load}
          />
        </div>
      </section>
    </div>
  );
}
