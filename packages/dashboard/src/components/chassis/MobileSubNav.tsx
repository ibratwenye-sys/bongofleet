import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth-context';
import { NavBadge } from './Sidebar';
import { filterVisibleGroups, getActiveGroupLabel } from './nav-visibility';

/**
 * Stage UI4a - the phone-width sub-nav row: the active tab's other
 * destinations (Fleet's 5, Money's 5), as a horizontal pill row above the
 * page content. Renders nothing when the active group has only one
 * role-visible item (e.g. Home for a role that can't see Live Map), or
 * while More is active - that's a sheet, not a route, so it has no row
 * here.
 */
export function MobileSubNav({ pendingCount }: { pendingCount: number }) {
  const location = useLocation();
  const { user } = useAuth();
  const activeGroupLabel = getActiveGroupLabel(location.pathname);

  if (activeGroupLabel === 'Admin') return null;

  const group = filterVisibleGroups(user).find((g) => g.label === activeGroupLabel);
  if (!group || group.items.length <= 1) return null;

  return (
    <nav
      aria-label={`${activeGroupLabel} sections`}
      className="flex gap-1 overflow-x-auto border-b border-line bg-panel px-3 py-2 md:hidden"
    >
      {group.items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            `flex min-h-9 shrink-0 items-center gap-1 rounded-full px-3 py-2 text-sm font-medium whitespace-nowrap ${
              isActive ? 'bg-panel-2 text-txt' : 'text-txt-2 hover:bg-panel-2 hover:text-txt'
            }`
          }
        >
          {item.label}
          {item.badgeKey === 'approvals' && <NavBadge count={pendingCount} />}
        </NavLink>
      ))}
    </nav>
  );
}
