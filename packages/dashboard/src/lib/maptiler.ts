// Stage I3 (DESIGN_GPS_TRACKING.md §7/§8). MapTiler needs a key to serve
// tiles at all - VITE_MAPTILER_KEY, read the same way api.ts reads
// VITE_API_URL. Deliberately allowed to be unset: this module's job is to
// tell callers whether a key exists, not to fail if it doesn't - the map
// component renders without a tile layer (see VehicleMap.tsx) rather than
// blocking the rest of the feature on a key that may not exist yet.
export const MAPTILER_KEY = (import.meta.env.VITE_MAPTILER_KEY as string | undefined) ?? '';

export function hasMapTilerKey(): boolean {
  return MAPTILER_KEY.length > 0;
}

// streets-v2 is a standard MapTiler Cloud style id - legible at both the
// fleet-wide zoom (§7's live map) and a single-vehicle zoom (§8's public
// view). Raster PNG tiles, not vector, to avoid pulling in a second
// rendering library (maplibre-gl) alongside Leaflet for one feature.
export function mapTilerTileUrl(): string {
  return `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`;
}

// Required by MapTiler's ToS whenever their tiles are displayed.
export const MAPTILER_ATTRIBUTION =
  '<a href="https://www.maptiler.com/copyright/" target="_blank" rel="noreferrer">&copy; MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">&copy; OpenStreetMap contributors</a>';
