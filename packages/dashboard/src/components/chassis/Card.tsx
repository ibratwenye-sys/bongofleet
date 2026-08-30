import type { ReactNode } from 'react';

/**
 * Stage UI1 - the one card shell reused everywhere in the chassis (main
 * column, rail, closing row) so a new card is a props object, not a new
 * layout. `subtitle` is the small trailing label the reference calls
 * card-s ("4 new", "Needs action", "Sun 26 Jul").
 */
export function Card({
  title,
  subtitle,
  children,
  bodyClassName = 'p-4',
}: {
  title: string;
  /** Usually the small trailing label ("4 new", "Sun 26 Jul"), but any
   *  node works - Stage UI3's period-selector cards pass a pair of date
   *  inputs here instead of plain text. */
  subtitle?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
        <h3 className="text-sm font-semibold text-txt">{title}</h3>
        {subtitle && <span className="text-xs text-txt-3">{subtitle}</span>}
      </div>
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}
