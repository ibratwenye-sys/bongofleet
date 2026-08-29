import type { ReactNode } from 'react';
import { KpiRail, type KpiTile } from './KpiRail';

export type StatusPillMode = { mode: 'live'; text: string } | { mode: 'reporting'; text: string };

function StatusPill({ pill }: { pill: StatusPillMode }) {
  if (pill.mode === 'live') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-good/30 bg-good-d px-2.5 py-1 text-xs font-medium text-good-x">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-good" aria-hidden="true" />
        {pill.text}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-line bg-panel-2 px-2.5 py-1 text-xs font-medium text-txt-2">
      {pill.text}
    </span>
  );
}

/**
 * Stage UI1 (DESIGN_UI_DIRECTIONS.md) - the reusable page shell every
 * section renders itself with: a top bar (title + status pill + optional
 * primary action) and an optional KPI rail, both in "the same slot, same
 * position" on every page that uses this. A new section is a props
 * object, not a new layout - see OperationsCenterPage.tsx and
 * TrackingMapPage.tsx, the two pages that prove it this stage.
 *
 * Does NOT render the sidebar - that's AppShell.tsx's job, rendered once
 * for the whole app rather than re-rendered per page.
 */
export function PageChassis({
  title,
  statusPill,
  primaryAction,
  kpis,
  children,
}: {
  title: string;
  statusPill: StatusPillMode;
  primaryAction?: { label: string; onClick: () => void };
  /** Omit entirely (rather than padding to six) when a page doesn't
   *  naturally produce six real numbers - see KpiRail's own comment. */
  kpis?: KpiTile[];
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex min-h-(--spacing-topbar) flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold text-txt">{title}</h1>
        <StatusPill pill={statusPill} />
        {primaryAction && (
          <button
            onClick={primaryAction.onClick}
            className="ml-auto rounded bg-c1 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            {primaryAction.label}
          </button>
        )}
      </div>

      {kpis && kpis.length > 0 && <KpiRail tiles={kpis} />}

      {children}
    </div>
  );
}
