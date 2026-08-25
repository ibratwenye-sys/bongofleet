import { GpsSource } from '@prisma/client';
import {
  DEVICE_PREFERENCE_WINDOW_MINUTES,
  GPS_STALE_AFTER_MINUTES,
  resolveCurrentPosition,
} from './current-position';

const NOW = new Date('2026-08-24T12:00:00.000Z');

function minutesAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 60_000);
}

function fix(
  source: GpsSource,
  minutesOld: number,
  latitude = -6.8,
  longitude = 39.28,
): { source: GpsSource; latitude: number; longitude: number; recordedAt: Date } {
  return { source, latitude, longitude, recordedAt: minutesAgo(minutesOld) };
}

describe('resolveCurrentPosition (Stage I2, DESIGN_GPS_TRACKING.md §3)', () => {
  it('returns offline with no lastRecordedAt when there is no history at all', () => {
    expect(resolveCurrentPosition([], NOW)).toEqual({ offline: true, lastRecordedAt: null });
  });

  it('picks the newest PHONE fix when it is within the staleness window (today’s only real case)', () => {
    const fixes = [fix(GpsSource.PHONE, 4), fix(GpsSource.PHONE, 1), fix(GpsSource.PHONE, 2)];

    const result = resolveCurrentPosition(fixes, NOW);

    expect(result.offline).toBe(false);
    if (!result.offline) {
      expect(result.recordedAt).toEqual(minutesAgo(1));
      expect(result.source).toBe(GpsSource.PHONE);
    }
  });

  it('is offline (not the stale fix) when the only fix is older than GPS_STALE_AFTER_MINUTES', () => {
    const fixes = [fix(GpsSource.PHONE, GPS_STALE_AFTER_MINUTES + 1)];

    const result = resolveCurrentPosition(fixes, NOW);

    expect(result).toEqual({
      offline: true,
      lastRecordedAt: minutesAgo(GPS_STALE_AFTER_MINUTES + 1),
    });
  });

  it('a fix exactly at the staleness boundary still counts as current', () => {
    const fixes = [fix(GpsSource.PHONE, GPS_STALE_AFTER_MINUTES)];

    const result = resolveCurrentPosition(fixes, NOW);

    expect(result.offline).toBe(false);
  });

  it('prefers a DEVICE fix over a newer PHONE fix when the DEVICE fix is within the preference window', () => {
    const fixes = [
      fix(GpsSource.PHONE, 0.5), // newest overall
      fix(GpsSource.DEVICE, 1.5, -6.81, 39.29), // within DEVICE_PREFERENCE_WINDOW_MINUTES of it
    ];

    const result = resolveCurrentPosition(fixes, NOW);

    expect(result.offline).toBe(false);
    if (!result.offline) {
      expect(result.source).toBe(GpsSource.DEVICE);
      expect(result.latitude).toBe(-6.81);
    }
  });

  it('ignores a DEVICE fix older than the preference window and falls back to the newest fix', () => {
    const fixes = [
      fix(GpsSource.PHONE, 0.5),
      fix(GpsSource.DEVICE, 0.5 + DEVICE_PREFERENCE_WINDOW_MINUTES + 1),
    ];

    const result = resolveCurrentPosition(fixes, NOW);

    expect(result.offline).toBe(false);
    if (!result.offline) {
      expect(result.source).toBe(GpsSource.PHONE);
    }
  });

  it('a DEVICE fix that is itself the newest fix is used directly (no PHONE fix needed to trigger preference)', () => {
    const fixes = [fix(GpsSource.DEVICE, 0.5)];

    const result = resolveCurrentPosition(fixes, NOW);

    expect(result.offline).toBe(false);
    if (!result.offline) {
      expect(result.source).toBe(GpsSource.DEVICE);
    }
  });

  it('fix order in the input array does not matter - always resorts by recordedAt', () => {
    const fixes = [fix(GpsSource.PHONE, 1), fix(GpsSource.PHONE, 4), fix(GpsSource.PHONE, 2)];

    const result = resolveCurrentPosition(fixes, NOW);

    expect(result.offline).toBe(false);
    if (!result.offline) {
      expect(result.recordedAt).toEqual(minutesAgo(1));
    }
  });
});
