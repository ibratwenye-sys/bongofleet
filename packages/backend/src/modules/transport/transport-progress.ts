/**
 * Stage UI2 (§3, decision 3) - Ibrahim's binding decision: real progress
 * only when TransportJob.expectedDistanceKm was set at job creation,
 * computed from actual GPS fixes recorded since the job's own pickedUpAt.
 * When it's absent, this returns elapsed time and the last known position
 * only - never a fabricated ETA or progress bar. Pure - no Prisma calls,
 * so the arithmetic is unit-testable without a database (same convention
 * as ownership-plan.derivation.ts).
 */
export interface TransportFix {
  latitude: number;
  longitude: number;
  recordedAt: Date;
}

export interface LastKnownPosition {
  latitude: number;
  longitude: number;
  recordedAt: string;
}

export type TransportProgress =
  | {
      kind: 'no-target';
      elapsedMs: number;
      lastPosition: LastKnownPosition | null;
    }
  | {
      kind: 'progress';
      elapsedMs: number;
      lastPosition: LastKnownPosition | null;
      kmCovered: number;
      kmRemaining: number;
      expectedDistanceKm: number;
    };

const EARTH_RADIUS_KM = 6371;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two points, in km. */
function haversineKm(a: TransportFix, b: TransportFix): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Sum of consecutive-fix distances, in km. 0 for fewer than 2 fixes. */
export function sumTrackKm(fixes: TransportFix[]): number {
  let total = 0;
  for (let i = 1; i < fixes.length; i += 1) {
    total += haversineKm(fixes[i - 1], fixes[i]);
  }
  return total;
}

/**
 * `fixes` must already be sorted oldest-first and scoped to this job's own
 * pickup window (the caller's responsibility - this function does no
 * filtering). `now` is the current instant, for elapsedMs.
 */
export function computeTransportProgress(
  fixes: TransportFix[],
  expectedDistanceKm: number | null,
  pickedUpAt: Date,
  now: Date,
): TransportProgress {
  const elapsedMs = Math.max(0, now.getTime() - pickedUpAt.getTime());
  const last = fixes[fixes.length - 1];
  const lastPosition: LastKnownPosition | null = last
    ? {
        latitude: last.latitude,
        longitude: last.longitude,
        recordedAt: last.recordedAt.toISOString(),
      }
    : null;

  if (expectedDistanceKm === null) {
    return { kind: 'no-target', elapsedMs, lastPosition };
  }

  const kmCovered = sumTrackKm(fixes);
  const kmRemaining = Math.max(0, expectedDistanceKm - kmCovered);
  return { kind: 'progress', elapsedMs, lastPosition, kmCovered, kmRemaining, expectedDistanceKm };
}
