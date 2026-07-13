import type { DocumentExpiryStatus } from './types';

// Mirrors packages/backend/src/modules/document/document.service.ts's
// computeDocumentStatus - the list endpoint (GET /documents) doesn't return a
// computed status, only GET /documents/expiring does, so per-slot views here
// need to compute it themselves from the same expiry/window rule.
export function computeDocumentStatus(
  expiryDate: string | null,
  withinDays = 30,
  now: Date = new Date(),
): DocumentExpiryStatus {
  if (!expiryDate) {
    return 'VALID';
  }
  const expiry = new Date(expiryDate);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const horizon = new Date(today);
  horizon.setUTCDate(horizon.getUTCDate() + withinDays);

  if (expiry.getTime() < today.getTime()) {
    return 'EXPIRED';
  }
  if (expiry.getTime() <= horizon.getTime()) {
    return 'EXPIRING_SOON';
  }
  return 'VALID';
}
