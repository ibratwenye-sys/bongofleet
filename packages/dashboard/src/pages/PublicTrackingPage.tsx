import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Marker } from 'react-leaflet';
import { apiFetch, ApiError } from '../lib/api';
import type { PublicVehiclePosition } from '../lib/types';
import { VehicleMap } from '../components/VehicleMap';
import { vehicleDivIcon } from '../lib/gps-status';

// Stage I2 (§8) - relative "how long ago" phrasing for a stranger with no
// login, who has no reason to know what an ISO timestamp means. Local to
// this page rather than added to lib/format.ts (formatDateTime there is
// absolute date+time, a different need, used across the authenticated
// dashboard) - nothing else in the app currently wants relative phrasing.
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

function googleMapsUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}

function VehicleCard({ position }: { position: PublicVehiclePosition }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-5 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-txt">{position.registrationNumber}</h2>
        {position.offline ? (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            Offline
          </span>
        ) : (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
            Live
          </span>
        )}
      </div>

      {position.offline ? (
        <p className="text-sm text-txt-2">
          {position.lastKnownAt
            ? `Last seen ${timeAgo(position.lastKnownAt)}.`
            : 'No location reported yet.'}
        </p>
      ) : (
        <>
          <p className="mb-2 text-sm text-txt-2">
            As of {timeAgo(position.recordedAt)} · {position.latitude.toFixed(5)},{' '}
            {position.longitude.toFixed(5)}
          </p>
          {/* Stage I3 (§8's map addendum) - the current dot only, no path:
              §10 open question 4 (today's path on the PUBLIC link) is still
              genuinely unresolved, unlike the authenticated live map. */}
          <VehicleMap
            center={[position.latitude, position.longitude]}
            zoom={15}
            heightClassName="h-64"
          >
            <Marker
              position={[position.latitude, position.longitude]}
              icon={vehicleDivIcon('live', position.source)}
            />
          </VehicleMap>
          <a
            href={googleMapsUrl(position.latitude, position.longitude)}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-xs font-medium text-blue-700 hover:underline"
          >
            Open in Google Maps ↗
          </a>
        </>
      )}
    </div>
  );
}

export function PublicTrackingPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicVehiclePosition | PublicVehiclePosition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // No head-management library exists in this app (App.tsx has no route
  // that needs one) - a plain document.title + injected meta tag is enough
  // for this one public page, restored on unmount so navigating elsewhere
  // in the SPA doesn't leave a stale noindex tag behind.
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Vehicle tracking - BongoFleet';
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => {
      document.title = previousTitle;
      document.head.removeChild(meta);
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    apiFetch<PublicVehiclePosition | PublicVehiclePosition[]>(`/public/track/${token}`)
      .then(setData)
      .catch((err) => {
        setError(
          err instanceof ApiError && err.status === 404
            ? 'This tracking link is invalid, expired, or has been revoked.'
            : 'Could not load this tracking link. Please try again.',
        );
      })
      .finally(() => setLoading(false));
  }, [token]);

  const positions = data === null ? [] : Array.isArray(data) ? data : [data];

  return (
    <div className="min-h-screen bg-page p-4 md:p-6">
      <div className="mx-auto max-w-lg">
        <h1 className="mb-4 text-lg font-semibold text-txt">BongoFleet vehicle tracking</h1>

        {loading && <p className="text-sm text-txt-2">Loading…</p>}
        {error && <p className="rounded bg-crit-d px-3 py-2 text-sm text-crit-x">{error}</p>}

        {!loading && !error && positions.length === 0 && (
          <p className="text-sm text-txt-2">No vehicles to show.</p>
        )}

        <div className="space-y-3">
          {positions.map((position) => (
            <VehicleCard key={position.registrationNumber} position={position} />
          ))}
        </div>
      </div>
    </div>
  );
}
