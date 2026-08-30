import { NavLink, useLocation } from 'react-router-dom';
import { NavBadge } from './Sidebar';
import { NAV_GROUPS } from './nav-config';
import { MOBILE_TABS, getActiveGroupLabel } from './nav-visibility';

/**
 * Stage UI4a - the phone-width nav's primary control, replacing the old
 * hamburger + slide-over drawer. Four fixed tabs mapped from NAV_GROUPS
 * (see nav-visibility.ts for why the Home/More labels live separately
 * from the sidebar's own Live/Admin headings). Home/Fleet/Money are real
 * links to their group's first item; More opens MoreSheet instead of
 * navigating - AppShell owns that open/close state.
 *
 * Active tab is derived from the whole group (so /drivers still lights up
 * Fleet), not NavLink's own exact/prefix match against a single `to`.
 */
export function BottomTabBar({
  pendingCount,
  moreOpen,
  onToggleMore,
}: {
  pendingCount: number;
  moreOpen: boolean;
  onToggleMore: () => void;
}) {
  const location = useLocation();
  const activeGroupLabel = getActiveGroupLabel(location.pathname);

  return (
    <nav
      aria-label="Tab bar"
      className="fixed inset-x-0 bottom-0 z-30 flex min-h-14 border-t border-line bg-side pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {MOBILE_TABS.map((tab) => {
        const isMore = tab.id === 'more';
        const isActive = isMore ? moreOpen : activeGroupLabel === tab.groupLabel;
        const className = `flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium ${
          isActive ? 'bg-panel-2 text-txt' : 'text-txt-2'
        }`;

        if (isMore) {
          return (
            <button
              key={tab.id}
              type="button"
              onClick={onToggleMore}
              aria-expanded={moreOpen}
              aria-controls="more-sheet"
              className={className}
            >
              {tab.label}
            </button>
          );
        }

        const group = NAV_GROUPS.find((g) => g.label === tab.groupLabel);
        const to = group?.items[0]?.to ?? '/';

        return (
          <NavLink key={tab.id} to={to} end={to === '/'} className={className}>
            <span className="flex items-center gap-1">
              {tab.label}
              {tab.groupLabel === 'Money' && <NavBadge count={pendingCount} />}
            </span>
          </NavLink>
        );
      })}
    </nav>
  );
}
