export const MOTORCYCLE_STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  MAINTENANCE: 'bg-amber-100 text-amber-800',
  RETIRED: 'bg-gray-100 text-gray-600',
};

export const PAYMENT_STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  COMPLETED: 'bg-green-100 text-green-800',
  FAILED: 'bg-red-100 text-red-700',
};

export const DOCUMENT_STATUS_STYLES: Record<string, string> = {
  VALID: 'bg-green-100 text-green-800',
  EXPIRING_SOON: 'bg-amber-100 text-amber-800',
  EXPIRED: 'bg-red-100 text-red-700',
};

export const INACTIVE_STYLES: Record<string, string> = {
  INACTIVE: 'bg-gray-200 text-gray-500',
};

export const TRACKING_LINK_STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  EXPIRED: 'bg-gray-100 text-gray-600',
  REVOKED: 'bg-red-100 text-red-700',
};

// TRANSPORT_DESIGN.md §6 - TransportPaymentStatus values from
// @bongofleet/shared-lib's transportPaymentStatus().
export const TRANSPORT_PAYMENT_STATUS_STYLES: Record<string, string> = {
  UNPAID: 'bg-red-100 text-red-700',
  PARTIALLY_PAID: 'bg-amber-100 text-amber-800',
  PAID: 'bg-green-100 text-green-800',
};

export function StatusBadge({
  status,
  styles,
  label,
}: {
  status: string;
  styles: Record<string, string>;
  /** Stage L3 - when a call site has a real translated label for this
   *  status (see PaymentsPage.tsx), render that instead of the raw enum
   *  value. Omitted, every other untranslated call site keeps rendering
   *  `status` verbatim exactly as before. */
  label?: string;
}) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? 'bg-gray-100 text-gray-600'}`}
    >
      {label ?? status}
    </span>
  );
}
