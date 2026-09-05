/**
 * DESIGN_RIDER_EXPENSES.md's build-order step 5 - the rider app's own fixed
 * category picker (MatumiziScreen.tsx/TransportExpensesScreen.tsx),
 * copied here as the backend's single source of truth for which categories
 * a daily cap can be configured against - NOT re-derived from either
 * mobile file (those stay mobile-only duplicates of each other, per this
 * codebase's own established per-screen-constant convention).
 *
 * Deliberately narrower than Expense.category's own free-text validation:
 * a dashboard-created expense (ExpensesPage.tsx) can use any category
 * string and is auto-APPROVED, never reaching the Approvals queue - only a
 * rider submission (always one of these 7) ever does, so caps only ever
 * need to cover these 7.
 *
 * Exact strings, case-sensitive. Order matters: GET /expense-category-caps
 * always returns all 7 in this exact order.
 */
export const RIDER_EXPENSE_CATEGORIES = [
  'Fuel',
  'Repairs',
  'Spare parts',
  'Puncture',
  'Wash',
  'Parking',
  'Other',
] as const;

export type RiderExpenseCategory = (typeof RIDER_EXPENSE_CATEGORIES)[number];

export function isRiderExpenseCategory(value: string): value is RiderExpenseCategory {
  return (RIDER_EXPENSE_CATEGORIES as readonly string[]).includes(value);
}
