import type { ReactNode } from 'react';

/**
 * Stage UI1 - the chassis's main 2-column region: 1fr main column (able to
 * stack more than one card - callers just put multiple <Card>s in
 * `main`) + a fixed 340px rail. Stacks to one column below lg so the rail
 * never squeezes the main column unreadably narrow on a tablet.
 */
export function ChassisGrid({ main, rail }: { main: ReactNode; rail: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[1fr_var(--spacing-rail)]">
      <div className="flex flex-col gap-3.5">{main}</div>
      <div className="flex flex-col gap-3.5">{rail}</div>
    </div>
  );
}

/** The chassis's closing two-card row - always equal width, side by side
 *  from md up, stacked below it. */
export function ClosingRow({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
      {left}
      {right}
    </div>
  );
}
