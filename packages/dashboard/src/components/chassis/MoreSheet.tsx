import { NavLink } from 'react-router-dom';
import { useAuth } from '../../lib/auth-context';
import { ThemeToggle } from '../ThemeToggle';
import type { CurrentUser } from '../../lib/types';
import { filterVisibleGroups } from './nav-visibility';

function initials(user: CurrentUser): string {
  return `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();
}

/**
 * Stage UI4a - the More tab's content: the Admin group's links plus the
 * account/theme/logout controls, ported directly from Sidebar.tsx's own
 * footer (unchanged in substance - just reachable from a bottom sheet
 * instead of always-visible sidebar real estate). AppShell owns the
 * open/close state and reuses the same backdrop/Escape/close-on-navigate
 * pattern the old drawer used.
 */
export function MoreSheet({ onClose }: { onClose: () => void }) {
  const { user, logout } = useAuth();
  const adminGroup = filterVisibleGroups(user).find((g) => g.label === 'Admin');

  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <button
        type="button"
        aria-label="Close more menu"
        className="absolute inset-0 bg-shadow"
        onClick={onClose}
      />
      <div
        id="more-sheet"
        role="dialog"
        aria-label="More"
        className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-lg border-t border-line bg-side pb-[env(safe-area-inset-bottom)] shadow-lg"
      >
        <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
          <span className="text-base font-semibold text-txt">More</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center text-txt-2"
          >
            <span aria-hidden="true" className="text-xl leading-none">
              ✕
            </span>
          </button>
        </div>

        {adminGroup && adminGroup.items.length > 0 && (
          <nav className="px-3 py-2" aria-label="Admin">
            {adminGroup.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onClose}
                className={({ isActive }) =>
                  `flex min-h-11 items-center rounded px-2 text-sm font-medium ${
                    isActive ? 'bg-panel-2 text-txt' : 'text-txt-2 hover:bg-panel-2 hover:text-txt'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-line-soft px-4 py-3">
          <ThemeToggle />
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line-soft px-4 py-3">
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
    </div>
  );
}
