import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';
import { useIdleTimer } from '../lib/useIdleTimer';
import { apiFetch } from '../lib/api';
import { IdleLogoutModal } from './IdleLogoutModal';

const NAV_LINKS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/fleet', label: 'Fleet' },
  { to: '/drivers', label: 'Drivers' },
  { to: '/assignments', label: 'Assignments' },
  { to: '/ownership', label: 'Ownership' },
  { to: '/transport', label: 'Transport' },
  { to: '/payments', label: 'Payments' },
  { to: '/expenses', label: 'Expenses' },
  { to: '/approvals', label: 'Approvals' },
  { to: '/maintenance', label: 'Maintenance' },
  { to: '/reports', label: 'Reports' },
  // Stage SUB1 - the first Settings-area page and the first nav link gated
  // by role: OWNER only, same gate as the backend's GET /tenant/billing
  // (there is no platform-admin role in this codebase). Filtered below
  // rather than adding a per-link role field to every other entry, which
  // has never needed one.
  { to: '/settings/billing', label: 'Billing', ownerOnly: true },
];

// Stage H3 - "don't let pending money go unnoticed," not a live ticker, so a
// minute is plenty. Fetched here rather than read off ApprovalsPage's own
// state: this badge has to show correctly on every page, including ones
// ApprovalsPage never mounts, and approving/rejecting something there
// should not need to reach back up into AppShell to stay in sync - the next
// poll (or a fresh page load) catches it.
const PENDING_COUNT_POLL_MS = 60_000;

function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-semibold text-white">
      {count}
    </span>
  );
}

/**
 * Stage H0e - this header was the single reason every page scrolled sideways
 * on a phone. Ten nav links, the wordmark, the user's name and Logout sat in
 * one flex row that could not wrap or shrink, so the header measured 1272px
 * wide and dragged the whole document to that width: at 390px the content
 * area was not merely cramped, it was 882px off to the left, and tapping a
 * nav item left you looking at blank page. The tables being wrapped in
 * overflow-x-auto never mattered, because the overflow was the document's,
 * not theirs.
 *
 * The switch is at `xl` (1280px), not at a phone-sized breakpoint, because
 * 1272px is where this row actually fits - a 1280px laptop clears it by
 * eight pixels and everything narrower does not. Gating it at `md` would
 * have left an 820px tablet with the same 1272px header and the same
 * sideways scroll, just with a hamburger it never showed. Below xl the row
 * is replaced by a menu button and a drawer; at or above it, nothing
 * changes.
 */
export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [idleWarning, setIdleWarning] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const visibleNavLinks = NAV_LINKS.filter((link) => !link.ownerOnly || user?.role === 'OWNER');

  useEffect(() => {
    let cancelled = false;
    async function loadPendingCount() {
      try {
        const res = await apiFetch<{ count: number }>('/expenses/pending-count');
        if (!cancelled) setPendingCount(res.count);
      } catch {
        // Not critical - leave the badge showing whatever it last knew
        // rather than surfacing an error for a background poll.
      }
    }
    void loadPendingCount();
    const interval = setInterval(() => void loadPendingCount(), PENDING_COUNT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  const { reset: resetIdleTimer } = useIdleTimer({
    onWarn: () => setIdleWarning(true),
    onTimeout: () => {
      setIdleWarning(false);
      void handleLogout();
    },
  });

  // Navigating from inside the drawer must close it, or the destination
  // renders underneath a still-open menu. Keyed on the location rather than
  // an onClick per link so a redirect (or the browser's back button) closes
  // it too.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Same reasoning as Modal (Stage H0d): a panel covering the screen with no
  // way out is a trap, and Escape is the cheap second exit.
  useEffect(() => {
    if (!menuOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between gap-2 px-4 py-3 md:px-6">
          <Link to="/" className="text-lg font-semibold text-gray-900">
            BongoFleet
          </Link>

          {/* Desktop nav - unchanged, just gated to xl and up. */}
          <nav className="hidden flex-1 gap-4 xl:flex">
            {visibleNavLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  `flex items-center rounded px-3 py-1.5 text-sm font-medium ${
                    isActive ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
                  }`
                }
              >
                {link.label}
                {link.to === '/approvals' && <NavBadge count={pendingCount} />}
              </NavLink>
            ))}
          </nav>

          <div className="hidden items-center gap-4 xl:flex">
            {user && (
              <span className="text-sm text-gray-600">
                {user.firstName} {user.lastName}
              </span>
            )}
            <button
              onClick={handleLogout}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Logout
            </button>
          </div>

          {/* Phone/tablet: one 44px-square control, the minimum comfortable
              thumb target. aria-expanded/aria-controls so the drawer is
              announced as a menu rather than as loose links. */}
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            className="flex h-11 w-11 items-center justify-center rounded border border-gray-300 text-gray-700 xl:hidden"
          >
            <span aria-hidden="true" className="text-xl leading-none">
              {menuOpen ? '✕' : '☰'}
            </span>
          </button>
        </div>

        {menuOpen && (
          <nav
            id="mobile-nav"
            className="border-t border-gray-200 px-4 pb-3 xl:hidden"
            aria-label="Main"
          >
            {visibleNavLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  // min-h-11 (44px) on every row - the desktop links are 32px
                  // tall, which is fine for a cursor and too small for a thumb.
                  `flex min-h-11 items-center rounded px-3 text-base font-medium ${
                    isActive ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'
                  }`
                }
              >
                {link.label}
                {link.to === '/approvals' && <NavBadge count={pendingCount} />}
              </NavLink>
            ))}

            <div className="mt-2 flex items-center justify-between border-t border-gray-200 pt-3">
              {user && (
                <span className="text-sm text-gray-600">
                  {user.firstName} {user.lastName}
                </span>
              )}
              <button
                onClick={handleLogout}
                className="min-h-11 rounded border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Logout
              </button>
            </div>
          </nav>
        )}
      </header>

      <main className="p-4 md:p-6">
        <Outlet />
      </main>

      {idleWarning && (
        <IdleLogoutModal
          onStay={() => {
            resetIdleTimer();
            setIdleWarning(false);
          }}
        />
      )}
    </div>
  );
}
