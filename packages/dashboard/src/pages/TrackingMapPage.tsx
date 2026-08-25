import { useEffect, useMemo, useState } from 'react';
import { Marker, Polyline } from 'react-leaflet';
import { useAuth } from '../lib/auth-context';
import { apiFetch } from '../lib/api';
import type {
  Assignment,
  Driver,
  FleetVehiclePosition,
  VehiclePathPoint,
  VehicleType,
} from '../lib/types';
import { VehicleMap } from '../components/VehicleMap';
import { markerStatus, vehicleDivIcon, STATUS_COLOR, STATUS_LABEL } from '../lib/gps-status';
import { today, formatDateTime } from '../lib/format';

const CATEGORY_OPTIONS: (VehicleType | 'ALL')[] = ['ALL', 'MOTORBIKE', 'BAJAJI', 'CAR', 'TRUCK'];
const CATEGORY_LABELS: Record<VehicleType | 'ALL', string> = {
  ALL: 'All vehicles',
  MOTORBIKE: 'Motorbike',
  BAJAJI: 'Bajaji',
  CAR: 'Car',
  TRUCK: 'Truck',
};

// Dar es Salaam - a reasonable default centre for a fleet with no vehicles
// reporting yet; the map recentres on nothing else automatically once real
// positions load, that would fight anyone panning around.
const DEFAULT_CENTER: [number, number] = [-6.8, 39.28];

// Stage H3's own "don't let pending money go unnoticed" poll used 60s;
// GPS fixes arrive roughly every 60s per vehicle too (Stage I1), so
// anything shorter just re-fetches the same data.
const FLEET_POLL_MS = 30_000;

function speedFromPath(path: VehiclePathPoint[]): number | null {
  return path.length > 0 ? path[path.length - 1].speedKmh : null;
}

function fixTime(position: FleetVehiclePosition): string | null {
  return position.offline ? position.lastRecordedAt : position.recordedAt;
}

export function TrackingMapPage() {
  const { user } = useAuth();
  const [positions, setPositions] = useState<FleetVehiclePosition[] | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<VehicleType | 'ALL'>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pathDate, setPathDate] = useState(today());
  const [path, setPath] = useState<VehiclePathPoint[] | null>(null);
  const [pathLoading, setPathLoading] = useState(false);
  const [todayRiderName, setTodayRiderName] = useState<string | null | undefined>(undefined);

  async function loadPositions() {
    try {
      const data = await apiFetch<FleetVehiclePosition[]>('/gps/fleet-positions');
      setPositions(data);
      setError(null);
    } catch {
      setError('Could not load vehicle positions. Please try again.');
    }
  }

  useEffect(() => {
    void loadPositions();
    apiFetch<Driver[]>('/drivers')
      .then(setDrivers)
      .catch(() => setDrivers([]));
    const interval = setInterval(() => void loadPositions(), FLEET_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  const selected = useMemo(
    () => positions?.find((p) => p.motorcycleId === selectedId) ?? null,
    [positions, selectedId],
  );

  // The date picker only replays the PATH line - "today's rider" always
  // means literally today, regardless of which day is selected for replay,
  // so this is keyed on selectedId alone, not pathDate.
  useEffect(() => {
    if (!selectedId) {
      setTodayRiderName(undefined);
      return;
    }
    setTodayRiderName(undefined);
    const todayStr = today();
    apiFetch<Assignment[]>(
      `/assignments?motorcycleId=${encodeURIComponent(selectedId)}&dateFrom=${todayStr}&dateTo=${todayStr}`,
    )
      .then((assignments) => {
        const assignment = assignments[0];
        if (!assignment) return setTodayRiderName(null);
        const driver = drivers.find((d) => d.id === assignment.driverId);
        setTodayRiderName(driver ? `${driver.user.firstName} ${driver.user.lastName}` : null);
      })
      .catch(() => setTodayRiderName(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, drivers.length]);

  useEffect(() => {
    if (!selectedId) {
      setPath(null);
      return;
    }
    setPathLoading(true);
    apiFetch<VehiclePathPoint[]>(
      `/gps/vehicles/${encodeURIComponent(selectedId)}/path?date=${pathDate}`,
    )
      .then(setPath)
      .catch(() => setPath([]))
      .finally(() => setPathLoading(false));
  }, [selectedId, pathDate]);

  const visiblePositions = (positions ?? []).filter(
    (p) => categoryFilter === 'ALL' || p.vehicleType === categoryFilter,
  );
  const markerPoints: [number, number][] = visiblePositions
    .filter((p): p is Extract<FleetVehiclePosition, { offline: false }> => !p.offline)
    .map((p) => [p.latitude, p.longitude]);

  function handleSelect(motorcycleId: string) {
    setSelectedId(motorcycleId);
    setPathDate(today());
  }

  // Stage I3 - same OWNER-or-MANAGER gate as the backend's GET
  // /gps/fleet-positions and /gps/vehicles/:id/path; the nav link is
  // already hidden for other roles (AppShell.tsx), this covers a direct
  // navigation to the URL.
  if (user && user.role !== 'OWNER' && user.role !== 'MANAGER') {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600 shadow-sm">
        Only the fleet owner or a manager can view the live map.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-gray-900">Live map</h1>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Vehicle</label>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as VehicleType | 'ALL')}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm"
          >
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-gray-600">
        {(['live', 'stale', 'offline'] as const).map((status) => (
          <span key={status} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: STATUS_COLOR[status] }}
            />
            {STATUS_LABEL[status]}
          </span>
        ))}
        <span>📱 Phone · 📡 Device</span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <VehicleMap
            center={DEFAULT_CENTER}
            fitBoundsTo={markerPoints.length > 0 ? markerPoints : undefined}
            heightClassName="h-[560px]"
          >
            {visiblePositions.map((position) => {
              if (position.offline) return null; // no coordinates to plot
              const status = markerStatus(position);
              return (
                <Marker
                  key={position.motorcycleId}
                  position={[position.latitude, position.longitude]}
                  icon={vehicleDivIcon(status, position.source)}
                  // title -> a real `title` attribute on the marker's own
                  // icon element: a native hover tooltip for a real user,
                  // and what lets a test target ONE specific vehicle's
                  // marker instead of an arbitrary "first on the map" one
                  // once the fleet has more than one live position.
                  title={position.registrationNumber}
                  eventHandlers={{ click: () => handleSelect(position.motorcycleId) }}
                />
              );
            })}
            {path && path.length > 1 && (
              <Polyline
                positions={path.map((p) => [p.latitude, p.longitude])}
                pathOptions={{ color: '#2563eb', weight: 3 }}
              />
            )}
          </VehicleMap>
          {positions !== null && visiblePositions.every((p) => p.offline) && (
            <p className="mt-2 text-xs text-gray-400">
              No vehicles in this category are currently reporting a live position - offline
              vehicles aren't plotted (no coordinates to show), but still appear in the fleet.
            </p>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          {!selected ? (
            <p className="text-sm text-gray-500">Click a vehicle on the map to see details here.</p>
          ) : (
            <div>
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">
                    {selected.registrationNumber}
                  </h2>
                  <p className="text-xs text-gray-500">{selected.vehicleType}</p>
                </div>
                <button
                  onClick={() => setSelectedId(null)}
                  aria-label="Close"
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>

              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500">Status</dt>
                  <dd
                    className="font-medium"
                    style={{ color: STATUS_COLOR[markerStatus(selected)] }}
                  >
                    {STATUS_LABEL[markerStatus(selected)]}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Today's rider</dt>
                  <dd className="text-gray-900">
                    {todayRiderName === undefined
                      ? 'Loading…'
                      : (todayRiderName ?? 'No rider assigned today')}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Last fix</dt>
                  <dd className="text-gray-900">
                    {(() => {
                      const t = fixTime(selected);
                      return t ? formatDateTime(t) : 'Never reported';
                    })()}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Speed</dt>
                  <dd className="text-gray-900">
                    {(() => {
                      const speed = speedFromPath(path ?? []);
                      return speed != null ? `${speed.toFixed(0)} km/h` : '—';
                    })()}
                  </dd>
                </div>
              </dl>

              <div className="mt-4 border-t border-gray-200 pt-3">
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  Replay path for
                </label>
                <input
                  type="date"
                  value={pathDate}
                  max={today()}
                  onChange={(e) => setPathDate(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
                />
                <p className="mt-2 text-xs text-gray-500">
                  {pathLoading
                    ? 'Loading path…'
                    : path && path.length > 1
                      ? `${path.length} points plotted on the map above.`
                      : path && path.length === 1
                        ? 'Only one fix that day - not enough to draw a path.'
                        : 'No fixes recorded that day.'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
