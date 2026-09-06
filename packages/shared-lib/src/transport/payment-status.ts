/**
 * TRANSPORT_DESIGN.md §6 - one definition of a TransportJob's collection
 * status, shared so the backend (transport-reconciliation module) and the
 * dashboard (TransportPage.tsx's collection-status pill) never classify a
 * job differently. Same "one definition, not two that could quietly drift
 * apart" reasoning as position-severity.ts.
 *
 * Pure, DB-free: pass in the two numbers already on hand (revenue,
 * amountReceived), no Prisma/fetch inside. An overpaid job (amountReceived
 * > revenue) is still PAID, never rejected or capped - the excess is a UI
 * note, not an error state.
 */
export type TransportPaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';

export function transportPaymentStatus(
  revenue: number,
  amountReceived: number,
): TransportPaymentStatus {
  if (amountReceived <= 0) return 'UNPAID';
  if (amountReceived >= revenue) return 'PAID';
  return 'PARTIALLY_PAID';
}
