import { NavLink } from 'react-router-dom';
import { useAuth } from '../../lib/auth-context';
import { ThemeToggle } from '../ThemeToggle';
import type { CurrentUser } from '../../lib/types';
import { filterVisibleGroups } from './nav-visibility';

// Exported for reuse by the phone-width BottomTabBar/MobileSubNav
// (Stage UI4a) - same badge, one definition.
export function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-crit px-1 text-xs font-semibold text-white">
      {count}
    </span>
  );
}

function initials(user: CurrentUser): string {
  return `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();
}

/**
 * Stage UI1 (DESIGN_UI_DIRECTIONS.md) - the chassis sidebar's content: nav
 * groups (Live/Fleet/Money/Admin) + the signed-in user's identity/logout.
 * Rendered both as a persistent column (>= md) and inside a slide-over
 * drawer (< md) by AppShell.tsx - this component only knows its own
 * content, not which of those two containers it's sitting in.
 */
export function Sidebar({
  approvalsCount,
  onNavigate,
}: {
  approvalsCount: number;
  /** Called after a nav link is clicked - AppShell uses this to close the
   *  mobile drawer; a no-op on the persistent desktop sidebar. */
  onNavigate?: () => void;
}) {
  const { user, logout } = useAuth();

  const visibleGroups = filterVisibleGroups(user);

  return (
    <div className="flex h-full flex-col bg-side text-txt">
      <div className="px-4 py-4">
        <span className="text-lg font-semibold">BongoFleet</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Main">
        {visibleGroups.map((group) => (
          <div key={group.label} className="mb-4">
            <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-txt-3">
              {group.label}
            </div>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  // min-h-11 (44px, a real thumb target) below md, where this
                  // renders inside the mobile drawer; min-h-9 (36px) at md+,
                  // where it's a persistent desktop sidebar link under a
                  // cursor - same distinction the pre-chassis nav made.
                  `flex min-h-11 items-center rounded px-2 text-sm font-medium md:min-h-9 ${
                    isActive ? 'bg-panel-2 text-txt' : 'text-txt-2 hover:bg-panel-2 hover:text-txt'
                  }`
                }
              >
                {item.label}
                {item.badgeKey === 'approvals' && <NavBadge count={approvalsCount} />}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="flex items-center justify-between gap-2 border-t border-line-soft px-3 py-2">
        <ThemeToggle />
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line-soft px-3 py-3">
        {user && (
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-panel-2 text-xs font-semibold text-txt">
              {initials(user)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm text-txt">
                {user.firstName} {user.lastName}
              </span>
              <span className="block text-xs text-txt-3">{user.role}</span>
            </span>
          </div>
        )}
        <button
          onClick={() => void logout()}
          className="shrink-0 rounded border border-line px-2 py-1 text-xs font-medium text-txt-2 hover:bg-panel-2"
        >
          Logout
        </button>
      </div>
    </div>
  );
}
