export type KpiAccent = 'c1' | 'c2' | 'good' | 'warn' | 'crit' | 'violet';

export interface KpiTile {
  label: string;
  value: string;
  /** e.g. "/ 48" or "TZS" - rendered smaller, right after value. */
  valueSuffix?: string;
  /** e.g. "68% of 612,000 target" or "1 overdue by 340 km" - real,
   *  computed text, never invented. */
  delta?: string;
  accentColor: KpiAccent;
}

const ACCENT_BORDER: Record<KpiAccent, string> = {
  c1: 'border-l-c1',
  c2: 'border-l-c2',
  good: 'border-l-good',
  warn: 'border-l-warn',
  crit: 'border-l-crit',
  violet: 'border-l-violet',
};

/**
 * Stage UI1 (DESIGN_UI_DIRECTIONS.md) - the chassis's KPI rail: up to six
 * {label, value, delta, accentColor} tiles in a fixed 6-column grid. A page
 * with fewer than six genuine numbers (Live Map) passes fewer tiles rather
 * than padding the row out with invented ones - the remaining columns are
 * simply empty, which is the honest state, not a bug to hide.
 */
export function KpiRail({ tiles }: { tiles: KpiTile[] }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className={`rounded-lg border border-line bg-panel border-l-[3px] p-3 ${ACCENT_BORDER[tile.accentColor]}`}
        >
          <div className="text-xs font-medium uppercase tracking-wide text-txt-3">{tile.label}</div>
          <div className="mt-1 text-xl font-semibold text-txt">
            {tile.value}
            {tile.valueSuffix && (
              <small className="ml-1 text-sm font-normal text-txt-2">{tile.valueSuffix}</small>
            )}
          </div>
          {tile.delta && <div className="mt-1 text-xs text-txt-2">{tile.delta}</div>}
        </div>
      ))}
    </div>
  );
}
