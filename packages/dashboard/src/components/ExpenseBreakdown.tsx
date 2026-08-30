import type { ExpenseCategory } from '../lib/types';
import { formatTZS } from '../lib/format';

// A small, dependency-free categorical palette for the breakdown bar - kept
// as literal hex (not theme tokens) because expense categories are free
// text with no fixed count to map onto a semantic token set, same
// reasoning as this file's own predecessor in ReportsPage.tsx. Chosen to
// stay legible on both the dark and light panel background.
const BAR_COLORS = [
  '#3987e5',
  '#16a34a',
  '#d97706',
  '#dc2626',
  '#8b5cf6',
  '#0891b2',
  '#db2777',
  '#65a30d',
];

/**
 * Stage UI2's Reports page originally owned this stacked-bar + legend view
 * of AnalyticsService.getExpenseBreakdown; Stage UI3's Expenses page needs
 * the exact same view twice (its "By category" main panel and the closing
 * row's Fuel-highlighted card), so it now lives here instead of being
 * duplicated.
 */
export function ExpenseBreakdown({
  rows,
  highlightCategory,
}: {
  rows: ExpenseCategory[];
  /** When set, every other category dims - Expenses' "Fuel, the largest
   *  single line" closing card passes 'Fuel' here over the same rows the
   *  main panel already fetched, rather than a second, filtered query. */
  highlightCategory?: string;
}) {
  const total = rows.reduce((sum, r) => sum + parseFloat(r.amount), 0);

  if (rows.length === 0) {
    return <p className="p-4 text-sm text-txt-2">No expenses recorded in this period.</p>;
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex h-4 w-full overflow-hidden rounded-full bg-panel-2">
        {rows.map((row, i) => {
          const pct = total > 0 ? (parseFloat(row.amount) / total) * 100 : 0;
          const dimmed = highlightCategory && row.category !== highlightCategory;
          return (
            <div
              key={row.category}
              style={{
                width: `${pct}%`,
                backgroundColor: BAR_COLORS[i % BAR_COLORS.length],
                opacity: dimmed ? 0.35 : 1,
              }}
              title={`${row.category}: ${formatTZS(row.amount)}`}
            />
          );
        })}
      </div>
      <ul className="space-y-2">
        {rows.map((row, i) => {
          const pct = total > 0 ? (parseFloat(row.amount) / total) * 100 : 0;
          const dimmed = highlightCategory && row.category !== highlightCategory;
          return (
            <li
              key={row.category}
              className={`flex items-center justify-between text-sm ${dimmed ? 'opacity-40' : ''}`}
            >
              <span className="flex items-center gap-2 text-txt">
                <span
                  className="inline-block h-3 w-3 rounded-sm"
                  style={{ backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }}
                />
                {row.category}
                <span className="text-txt-3">({row.count})</span>
              </span>
              <span className="text-txt-2">
                {formatTZS(row.amount)} <span className="text-txt-3">· {pct.toFixed(0)}%</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
