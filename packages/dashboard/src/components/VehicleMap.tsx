import { useEffect, type ReactNode } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { hasMapTilerKey, mapTilerTileUrl, MAPTILER_ATTRIBUTION } from '../lib/maptiler';

/**
 * A fixed `center`/`zoom` only ever matches real marker positions by luck -
 * seeded/real fleet data doesn't know what DEFAULT_CENTER a page picked.
 * When there's at least one point to show, this re-fits the view to
 * contain all of them (with padding) every time the point set changes,
 * instead of leaving markers to render wherever a hardcoded center happens
 * to put them - possibly clipped at the very edge of the container, which
 * is exactly what made TrackingMapPage's own marker unclickable in
 * practice (caught by Playwright's actionability check refusing to click
 * an element sitting outside the viewport, not by a human eyeballing it).
 * A single point still benefits: fitBounds on a one-point "box" centers and
 * zooms to it directly, which is strictly better than an arbitrary fixed
 * center for that point too.
 */
function FitBoundsToPoints({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    // animate: false - an animated pan/zoom leaves markers mid-transition
    // (and briefly under a stale hit-test target) for the length of the
    // animation; an instant snap has no such window and is a perfectly
    // reasonable default for a page that re-fits on every position poll.
    map.fitBounds(points, { padding: [40, 40], maxZoom: 15, animate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(points)]);
  return null;
}

/**
 * Stage I3 (§7/§8) - the one map component both the authenticated live-map
 * page and the public tracking page render tiles through. VITE_MAPTILER_KEY
 * may not be set yet (no key existed when this stage shipped - see the
 * stage's own report): rather than block the rest of the feature on that,
 * this renders the map WITHOUT a tile layer and a visible banner explaining
 * why, so markers/clicks/the side panel are all still real and testable.
 * The moment a key is added to the environment, tiles start rendering with
 * no code change - `hasMapTilerKey()` is the only thing that changes.
 */
export function VehicleMap({
  center,
  zoom = 13,
  fitBoundsTo,
  children,
  heightClassName = 'h-[500px]',
  // Stage UI1 - PublicTrackingPage.tsx (the one caller outside the
  // signed-in chassis - no data-theme is ever set for an anonymous
  // visitor there, see auth-context.tsx) needs this literal gray, not the
  // token-driven border-line the two chassis pages pass instead. Left as
  // the default so that page needed no change.
  borderClassName = 'border-gray-200',
}: {
  center: [number, number];
  zoom?: number;
  /** When given (even a single point), the view re-fits to contain every
   *  point here instead of using `center`/`zoom` as fixed values. */
  fitBoundsTo?: [number, number][];
  children?: ReactNode;
  heightClassName?: string;
  borderClassName?: string;
}) {
  return (
    <div
      data-testid="vehicle-map"
      className={`relative w-full ${heightClassName} overflow-hidden rounded-lg border ${borderClassName}`}
    >
      {!hasMapTilerKey() && (
        <div className="absolute inset-x-0 top-0 z-[1000] bg-amber-50 px-3 py-1.5 text-center text-xs text-amber-800">
          Map tiles unavailable - VITE_MAPTILER_KEY is not set. Markers below still work.
        </div>
      )}
      <MapContainer center={center} zoom={zoom} className="h-full w-full" scrollWheelZoom>
        {hasMapTilerKey() && (
          <TileLayer url={mapTilerTileUrl()} attribution={MAPTILER_ATTRIBUTION} />
        )}
        {fitBoundsTo && <FitBoundsToPoints points={fitBoundsTo} />}
        {children}
      </MapContainer>
    </div>
  );
}
