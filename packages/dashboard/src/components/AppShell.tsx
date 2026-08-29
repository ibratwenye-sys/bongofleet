import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';
import { useIdleTimer } from '../lib/useIdleTimer';
import { apiFetch } from '../lib/api';
import { IdleLogoutModal } from './IdleLogoutModal';
import { Sidebar } from './chassis/Sidebar';

// Stage H3 - "don't let pending money go unnoticed," not a live ticker, so a
// minute is plenty. Fetched here rather than read off ApprovalsPage's own
// state: this badge has to show correctly on every page, including ones
// ApprovalsPage never mounts, and approving/rejecting something there
// should not need to reach back up into AppShell to stay in sync - the next
// poll (or a fresh page load) catches it.
const PENDING_COUNT_POLL_MS = 60_000;

/**
 * Stage UI1 (DESIGN_UI_DIRECTIONS.md) - the app's persistent chrome, rebuilt
 * around the sidebar chassis (Live/Fleet/Money/Admin groups - see
 * nav-config.ts) rather than the old flat top-nav-row, which the Stage H0e
 * comment on git blame for this file already flagged as due for exactly
 * this: "a 'Settings' sub-menu would scale better than more flat top-level
 * items." The sidebar renders once here, persistently across navigation -
 * unlike the reference mockup's own static HTML (which re-emits the
 * sidebar per page, since it has no client-side router), a real SPA only
 * ever needs one.
 *
 * >= md (768px): the sidebar is a permanent 236px column. A 236px sidebar
 * has no reason to wait for a wide viewport the way the old 13-item flat
 * row did - this is a deliberately different breakpoint from that layout's
 * 2xl, not a leftover.
 *
 * < md: the sidebar collapses into a slide-over drawer behind the same
 * "Open menu" hamburger control the old header used, preserving every
 * existing e2e assertion about it (44px touch target, closes on
 * navigate/Escape).
 */
export function AppShell() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [idleWarning, setIdleWarning] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

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
    <div className="flex min-h-screen bg-page">
      {/* Persistent sidebar - >= md only. */}
      <div className="hidden w-(--spacing-sidebar) shrink-0 border-r border-line md:block">
        <Sidebar approvalsCount={pendingCount} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phone/tablet-only bar: one 44px-square control, the minimum
            comfortable thumb target. aria-expanded/aria-controls so the
            drawer is announced as a menu rather than loose links. */}
        <div className="flex items-center justify-between border-b border-line px-4 py-2 md:hidden">
          <span className="text-base font-semibold text-txt">BongoFleet</span>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            className="flex h-11 w-11 items-center justify-center rounded border border-line text-txt"
          >
            <span aria-hidden="true" className="text-xl leading-none">
              {menuOpen ? '✕' : '☰'}
            </span>
          </button>
        </div>

        {menuOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <button
              type="button"
              aria-label="Close menu"
              className="absolute inset-0 bg-shadow"
              onClick={() => setMenuOpen(false)}
            />
            <div
              id="mobile-nav"
              className="absolute inset-y-0 left-0 w-(--spacing-sidebar) shadow-lg"
            >
              <Sidebar approvalsCount={pendingCount} onNavigate={() => setMenuOpen(false)} />
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>

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
