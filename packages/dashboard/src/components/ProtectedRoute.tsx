import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';

export function ProtectedRoute() {
  const { status } = useAuth();

  if (status === 'loading') {
    return <div className="flex h-screen items-center justify-center text-gray-500">Loading…</div>;
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
