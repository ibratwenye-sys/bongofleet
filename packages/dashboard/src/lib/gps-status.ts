import L from 'leaflet';
import type { FleetVehiclePosition } from './types';

export type MarkerStatus = 'live' | 'stale' | 'offline';

/**
 * Stage I3 (§7). The backend's resolveCurrentPosition (Stage I2) only ever
 * distinguishes two states - offline: true/false - because that's the whole
 * of §3's "which fix wins" rule. §7's map wants a third, purely
 * presentational distinction this stage adds on top, client-side, with no
 * backend change: an offline vehicle that has SOME history (lastRecordedAt
 * set) reads as "stale" - it was here recently, just not within
 * GPS_STALE_AFTER_MINUTES - while one that has never reported at all
 * (lastRecordedAt: null) reads as "offline" outright. Nothing about §3's
 * actual staleness rule changes; this only affects marker colour.
 */
export function markerStatus(position: FleetVehiclePosition): MarkerStatus {
  if (!position.offline) return 'live';
  return position.lastRecordedAt !== null ? 'stale' : 'offline';
}

export const STATUS_COLOR: Record<MarkerStatus, string> = {
  live: '#16a34a', // green-600
  stale: '#d97706', // amber-600
  offline: '#6b7280', // gray-500
};

export const STATUS_LABEL: Record<MarkerStatus, string> = {
  live: 'Live',
  stale: 'Stale',
  offline: 'Offline',
};

// §3 - DEVICE hardware vs. a rider's phone. MANUAL fixes (a hand-entered
// position, never actually written by anything yet) get no badge - there
// is no real-world "manual" source to badge with an icon.
const SOURCE_BADGE: Partial<Record<string, string>> = {
  PHONE: '📱',
  DEVICE: '📡',
};

/**
 * A small coloured dot with an optional source badge, built as a Leaflet
 * DivIcon (plain HTML/CSS) rather than an image asset - no icon files to
 * ship, and the colour/badge are just data.
 */
export function vehicleDivIcon(status: MarkerStatus, source?: string): L.DivIcon {
  const color = STATUS_COLOR[status];
  const badge = source ? (SOURCE_BADGE[source] ?? '') : '';
  return L.divIcon({
    className: '',
    html: `
      <div style="position:relative;width:22px;height:22px;">
        <div style="width:22px;height:22px;border-radius:9999px;background:${color};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.4);"></div>
        ${
          badge
            ? `<div style="position:absolute;top:-8px;right:-8px;font-size:13px;line-height:1;">${badge}</div>`
            : ''
        }
      </div>
    `,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}
