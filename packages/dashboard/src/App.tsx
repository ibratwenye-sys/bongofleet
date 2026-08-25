import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AuthProvider } from './lib/auth-context';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { FleetPage } from './pages/FleetPage';
import { DriversPage } from './pages/DriversPage';
import { AssignmentsPage } from './pages/AssignmentsPage';
import { TransportPage } from './pages/TransportPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { DriverDetailPage } from './pages/DriverDetailPage';
import { MotorcycleDetailPage } from './pages/MotorcycleDetailPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { ReportsPage } from './pages/ReportsPage';
import { MaintenancePage } from './pages/MaintenancePage';
import { OwnershipPage } from './pages/OwnershipPage';
import { OwnershipPlanDetailPage } from './pages/OwnershipPlanDetailPage';
import { BillingPage } from './pages/BillingPage';
import { TrackingLinksPage } from './pages/TrackingLinksPage';

// Stage I3 - leaflet/react-leaflet added ~160kB (gzipped) to the single
// bundle every other page also pays for on first load. These are the only
// two pages that ever touch a map, so they're the only ones code-split -
// no other page in this app has needed that before now.
const TrackingMapPage = lazy(() =>
  import('./pages/TrackingMapPage').then((m) => ({ default: m.TrackingMapPage })),
);
const PublicTrackingPage = lazy(() =>
  import('./pages/PublicTrackingPage').then((m) => ({ default: m.PublicTrackingPage })),
);

function PageLoadingFallback() {
  return <p className="p-6 text-sm text-gray-500">Loading…</p>;
}

// Kept for one release so an old bookmark/link to /riders/:id still lands on the
// same driver's detail page rather than a dead end.
function DriverRedirect() {
  const { driverId } = useParams<{ driverId: string }>();
  return <Navigate to={`/drivers/${driverId}`} replace />;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<PageLoadingFallback />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            {/* Stage I2 (§8) - public, unauthenticated, outside the login-gated
              layout entirely, same precedent as /login above. */}
            <Route path="/track/:token" element={<PublicTrackingPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<AppShell />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/fleet" element={<FleetPage />} />
                <Route path="/fleet/:motorcycleId" element={<MotorcycleDetailPage />} />
                <Route path="/drivers" element={<DriversPage />} />
                <Route path="/drivers/:driverId" element={<DriverDetailPage />} />
                {/* Kept for one release so an old bookmark/link to /riders still lands somewhere. */}
                <Route path="/riders" element={<Navigate to="/drivers" replace />} />
                <Route path="/riders/:driverId" element={<DriverRedirect />} />
                <Route path="/assignments" element={<AssignmentsPage />} />
                <Route path="/ownership" element={<OwnershipPage />} />
                <Route path="/ownership/:planId" element={<OwnershipPlanDetailPage />} />
                <Route path="/transport" element={<TransportPage />} />
                <Route path="/payments" element={<PaymentsPage />} />
                <Route path="/expenses" element={<ExpensesPage />} />
                <Route path="/approvals" element={<ApprovalsPage />} />
                <Route path="/maintenance" element={<MaintenancePage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/settings/billing" element={<BillingPage />} />
                <Route path="/settings/tracking-map" element={<TrackingMapPage />} />
                <Route path="/settings/tracking-links" element={<TrackingLinksPage />} />
              </Route>
            </Route>
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
