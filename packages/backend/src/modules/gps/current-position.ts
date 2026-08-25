import { GpsSource } from '@prisma/client';

/**
 * Stage I2 (DESIGN_GPS_TRACKING.md §3, "which fix wins"). How many minutes
 * old a fix can be and still count as "the vehicle is currently here" rather
 * than "offline". Not specified as a fixed number anywhere in the design
 * doc excerpts this stage was built from - chosen here as roughly 5x the
 * mobile app's normal reporting cadence (gpsTracking.ts's TIME_INTERVAL_MS,
 * 60s under Stage I1), so a couple of missed intervals or a brief
 * connectivity gap don't flip a genuinely-still-driving vehicle to offline,
 * while a rider who has actually gone home for the night reads as offline
 * within a few minutes, not hours. Revisit this once real usage shows
 * whether 5 minutes reads right in practice.
 */
export const GPS_STALE_AFTER_MINUTES = 5;

/**
 * How close two fixes have to be in time for the DEVICE one to be preferred
 * over a technically-newer PHONE fix - a fixed value from §3's rule, not a
 * judgment call like GPS_STALE_AFTER_MINUTES above.
 */
export const DEVICE_PREFERENCE_WINDOW_MINUTES = 2;

// Generous enough to cover both GPS_STALE_AFTER_MINUTES and the device-
// preference window at the mobile app's ~60s reporting cadence (Stage I1),
// with room to spare for a slower or bursty reporter - see the callers in
// tracking-link.service.ts for where this bounds the DB query.
export const CURRENT_POSITION_FIX_LOOKBACK = 20;

export interface GpsFixCandidate {
  source: GpsSource;
  latitude: number;
  longitude: number;
  recordedAt: Date;
}

export type ResolvedPosition =
  | { offline: false; latitude: number; longitude: number; recordedAt: Date; source: GpsSource }
  | { offline: true; lastRecordedAt: Date | null };

/**
 * Stage I2 (§3). Pure and DB-free on purpose, same convention as
 * resolvePricingTier (Stage SUB1) - pass in fixes you've already fetched
 * (see CURRENT_POSITION_FIX_LOOKBACK), most-recent-first or not, any order.
 *
 * Rule: take the newest fix within GPS_STALE_AFTER_MINUTES of `now`. If a
 * DEVICE fix exists within DEVICE_PREFERENCE_WINDOW_MINUTES of THAT fix's
 * timestamp, prefer the DEVICE fix instead, even when it is a few seconds
 * or minutes older than the newest PHONE fix - device hardware is trusted
 * over a rider's phone GPS when both are reporting something current.
 * Inert today: Stage I1 only ever writes PHONE fixes, so `device` below is
 * never found in production data yet - implemented anyway per §3, not
 * skipped as dead code, and covered by the tests below against synthetic
 * DEVICE fixtures.
 *
 * No fix within the window at all -> offline, carrying the single most
 * recent fix's timestamp (however old) as `lastRecordedAt`, or null if this
 * vehicle has never reported one.
 */
export function resolveCurrentPosition(
  fixes: GpsFixCandidate[],
  now: Date,
  staleAfterMinutes: number = GPS_STALE_AFTER_MINUTES,
  devicePreferenceWindowMinutes: number = DEVICE_PREFERENCE_WINDOW_MINUTES,
): ResolvedPosition {
  if (fixes.length === 0) {
    return { offline: true, lastRecordedAt: null };
  }

  const sorted = [...fixes].sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime());
  const newest = sorted[0];
  const staleCutoffMs = now.getTime() - staleAfterMinutes * 60_000;

  if (newest.recordedAt.getTime() < staleCutoffMs) {
    return { offline: true, lastRecordedAt: newest.recordedAt };
  }

  const preferenceCutoffMs = newest.recordedAt.getTime() - devicePreferenceWindowMinutes * 60_000;
  const device = sorted.find(
    (fix) => fix.source === GpsSource.DEVICE && fix.recordedAt.getTime() >= preferenceCutoffMs,
  );
  const winner = device ?? newest;

  return {
    offline: false,
    latitude: winner.latitude,
    longitude: winner.longitude,
    recordedAt: winner.recordedAt,
    source: winner.source,
  };
}
