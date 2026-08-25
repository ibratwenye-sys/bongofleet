import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';
import { useIdleTimer } from '../lib/useIdleTimer';
import { apiFetch } from '../lib/api';
import type { UserRole } from '../lib/types';
import { IdleLogoutModal } from './IdleLogoutModal';

const NAV_LINKS: Array<{ to: string; label: string; end?: boolean; roles?: UserRole[] }> = [
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
  // (there is no platform-admin role in this codebase).
  { to: '/settings/billing', label: 'Billing', roles: ['OWNER'] },
  // Stage I3 - the live GPS map (§7). OWNER or MANAGER, same gate as the
  // backend's GET /gps/fleet-positions. "Map" rather than "Tracking" -
  // "Tracking" was already taken by the link-management item below before
  // this stage, and reusing it for two different destinations would point
  // the same word at two different pages. Kept to one word for the same
  // width reason as every label here (see this file's header comment).
  { to: '/settings/tracking-map', label: 'Map', roles: ['OWNER', 'MANAGER'] },
  // Stage I2 - OWNER or MANAGER, same gate as the backend's
  // TrackingLinkController (an operational action, unlike billing).
  // Renamed from "Tracking" to "Links" in Stage I3, once the live map
  // above needed that word for itself - this page is specifically about
  // creating/sharing/revoking the public links, which "Links" names more
  // precisely anyway.
  { to: '/settings/tracking-links', label: 'Links', roles: ['OWNER', 'MANAGER'] },
  // Stage BI1 - OWNER only, tighter than every other Settings-area item
  // above except Billing: this changes dozens of records in one shot, a
  // bigger blast radius than the OWNER+MANAGER document-upload precedent.
  // Same gate as the backend's BulkImportController.
  { to: '/settings/bulk-import', label: 'Import', roles: ['OWNER'] },
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
 * The switch was originally at `xl` (1280px) with the row hand-fitted to
 * clear it by eight pixels - see the git history on this comment for that
 * math. Stage SUB1 and Stage I2 each added a nav item (Billing, Tracking),
 * and the row's measured width at 1280px is now ~1532px: comfortably past
 * `xl`, and re-tuning to fit exactly at 1280 again (as gap-4/px-3 did
 * before) isn't realistic with 13 items without shrinking text past
 * legibility. Moved to `2xl` (1536px) instead, with the row's own gap and
 * per-link padding trimmed a little (gap-3, px-2.5) for real margin under
 * that, rather than repeating the same zero-headroom fit that broke again
 * this soon. The real cost: a 1280-1535px laptop, which used to get the
 * full desktop row, now gets the phone/tablet drawer instead - not broken,
 * just less roomy, and worth revisiting if this list keeps growing (a
 * "Settings" sub-menu would scale better than more flat top-level items).
 */
export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [idleWarning, setIdleWarning] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const visibleNavLinks = NAV_LINKS.filter(
    (link) => !link.roles || (user != null && link.roles.includes(user.role)),
  );

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

          {/* Desktop nav - gated to 2xl and up (see this file's header comment). */}
          <nav className="hidden flex-1 gap-3 2xl:flex">
            {visibleNavLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  `flex items-center rounded px-2.5 py-1.5 text-sm font-medium ${
                    isActive ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
                  }`
                }
              >
                {link.label}
                {link.to === '/approvals' && <NavBadge count={pendingCount} />}
              </NavLink>
            ))}
          </nav>

          <div className="hidden items-center gap-4 2xl:flex">
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
            className="flex h-11 w-11 items-center justify-center rounded border border-gray-300 text-gray-700 2xl:hidden"
          >
            <span aria-hidden="true" className="text-xl leading-none">
              {menuOpen ? '✕' : '☰'}
            </span>
          </button>
        </div>

        {menuOpen && (
          <nav
            id="mobile-nav"
            className="border-t border-gray-200 px-4 pb-3 2xl:hidden"
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
