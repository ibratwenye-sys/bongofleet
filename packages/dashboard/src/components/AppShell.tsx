import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';
import { useIdleTimer } from '../lib/useIdleTimer';
import { IdleLogoutModal } from './IdleLogoutModal';

const NAV_LINKS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/fleet', label: 'Fleet' },
  { to: '/riders', label: 'Riders' },
  { to: '/assignments', label: 'Assignments' },
  { to: '/payments', label: 'Payments' },
];

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [idleWarning, setIdleWarning] = useState(false);

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

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <div className="flex items-center gap-8">
          <Link to="/" className="text-lg font-semibold text-gray-900">
            BongoFleet
          </Link>
          <nav className="flex gap-4">
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  `rounded px-3 py-1.5 text-sm font-medium ${
                    isActive ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
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
      </header>
      <main className="p-6">
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
