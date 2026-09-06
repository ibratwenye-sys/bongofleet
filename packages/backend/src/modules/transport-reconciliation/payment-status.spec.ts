/**
 * shared-lib's pure transportPaymentStatus, tested here per the
 * dashboard-has-no-test-runner rule (same convention as
 * ownership-plan/excusal-window.spec.ts testing shared-lib's date logic).
 * Rebuild shared-lib's dist/ before trusting a filtered run of just this
 * file - stale dist has silently masked source changes elsewhere in this
 * codebase before.
 */
import { transportPaymentStatus } from '@bongofleet/shared-lib';

describe('transportPaymentStatus', () => {
  it('is UNPAID when nothing has been received', () => {
    expect(transportPaymentStatus(450000, 0)).toBe('UNPAID');
  });

  it('is UNPAID for a negative amountReceived (defensive - should not occur in practice)', () => {
    expect(transportPaymentStatus(450000, -1)).toBe('UNPAID');
  });

  it('is PARTIALLY_PAID for anything between zero and the full revenue', () => {
    expect(transportPaymentStatus(450000, 1)).toBe('PARTIALLY_PAID');
    expect(transportPaymentStatus(450000, 449999.99)).toBe('PARTIALLY_PAID');
  });

  it('is PAID when amountReceived exactly equals revenue', () => {
    expect(transportPaymentStatus(450000, 450000)).toBe('PAID');
  });

  it('is PAID (not rejected or capped) when overpaid', () => {
    expect(transportPaymentStatus(450000, 500000)).toBe('PAID');
  });
});
