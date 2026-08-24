import * as Location from 'expo-location';
import type { QueuedGpsFix } from './types';

/**
 * Stage I1 (DESIGN_GPS_TRACKING.md §4). Wraps expo-location's foreground
 * permission + watchPositionAsync. Knows nothing about queuing/flushing
 * (gpsQueue.ts) or when tracking SHOULD run (DriverDataContext, which reads
 * "do I have an assignment today" off the same assignment state Leo/Lipa
 * already do, and gates on app foreground state) - this module only knows
 * how to start and stop watching the device's own location, and how to turn
 * one fix into the shape POST /gps/phone expects.
 *
 * Foreground-only, on purpose (§4/§10) - no background location mode is
 * requested, registered, or configured anywhere in this app.
 */

// Every 60s while foregrounded, or after 50m of movement, whichever comes
// first - a parked bike still gets checked in on at least once a minute
// (so a stalled/parked position stays visible), but a moving bike is not
// throttled to one fix a minute either. Matches the design's own numbers.
const TIME_INTERVAL_MS = 60_000;
const DISTANCE_INTERVAL_M = 50;

export type GpsPermissionStatus = 'granted' | 'denied' | 'undetermined';

function toPermissionStatus(status: Location.PermissionStatus): GpsPermissionStatus {
  if (status === Location.PermissionStatus.GRANTED) return 'granted';
  if (status === Location.PermissionStatus.DENIED) return 'denied';
  return 'undetermined';
}

export async function getGpsPermissionStatus(): Promise<GpsPermissionStatus> {
  const { status } = await Location.getForegroundPermissionsAsync();
  return toPermissionStatus(status);
}

/** The actual permission prompt. Callers are expected to have already
 *  explained, in their own UI, WHY - per §4, the rider is owed a
 *  plain-language explanation tied specifically to "off duty fixes are
 *  never recorded" before this fires, not a generic OS permission dialog
 *  out of nowhere. This function itself has no UI - it's the prompt call
 *  only. */
export async function requestGpsPermission(): Promise<GpsPermissionStatus> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return toPermissionStatus(status);
}

function toFix(location: Location.LocationObject): QueuedGpsFix {
  const { coords, timestamp } = location;
  return {
    recordedAt: new Date(timestamp).toISOString(),
    latitude: coords.latitude,
    longitude: coords.longitude,
    // speed is m/s from expo-location; the server wants km/h. -1 means
    // "unknown" on some platforms - never send a negative speed/heading.
    speedKmh: coords.speed != null && coords.speed >= 0 ? coords.speed * 3.6 : undefined,
    heading: coords.heading != null && coords.heading >= 0 ? coords.heading : undefined,
    accuracyMeters: coords.accuracy ?? undefined,
  };
}

let subscription: Location.LocationSubscription | null = null;

export function isGpsTrackingActive(): boolean {
  return subscription !== null;
}

/**
 * Starts watchPositionAsync if not already running - a no-op (returns
 * 'granted' immediately) if it already is, since the lifecycle effect that
 * calls this runs on every relevant state change, not just a rising edge.
 * Requests permission first if not already granted. onFix is called with
 * every fix as it arrives; what happens to it (queue it, try to flush) is
 * entirely the caller's business.
 */
export async function startGpsTracking(
  onFix: (fix: QueuedGpsFix) => void,
): Promise<GpsPermissionStatus> {
  if (subscription) {
    return 'granted';
  }

  let status = await getGpsPermissionStatus();
  if (status !== 'granted') {
    status = await requestGpsPermission();
  }
  if (status !== 'granted') {
    return status; // denied, or the rider dismissed without deciding - no crash, no retry loop
  }

  subscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.High,
      timeInterval: TIME_INTERVAL_MS,
      distanceInterval: DISTANCE_INTERVAL_M,
    },
    (location) => onFix(toFix(location)),
  );
  return 'granted';
}

export function stopGpsTracking(): void {
  subscription?.remove();
  subscription = null;
}
