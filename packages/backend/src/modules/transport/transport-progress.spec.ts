import { computeTransportProgress, sumTrackKm } from './transport-progress';

const PICKUP = new Date('2026-08-25T06:00:00.000Z');
const NOW = new Date('2026-08-25T09:00:00.000Z'); // 3h later

// Dar es Salaam -> roughly along the Morogoro road, a few points ~10km apart.
const FIXES = [
  { latitude: -6.8, longitude: 39.28, recordedAt: new Date('2026-08-25T06:00:00.000Z') },
  { latitude: -6.75, longitude: 39.2, recordedAt: new Date('2026-08-25T07:00:00.000Z') },
  { latitude: -6.7, longitude: 39.1, recordedAt: new Date('2026-08-25T08:00:00.000Z') },
];

describe('computeTransportProgress', () => {
  it('without expectedDistanceKm: elapsed time and last position only, no progress fields', () => {
    const result = computeTransportProgress(FIXES, null, PICKUP, NOW);
    expect(result.kind).toBe('no-target');
    expect(result.elapsedMs).toBe(3 * 60 * 60 * 1000);
    expect(result.lastPosition).toEqual({
      latitude: -6.7,
      longitude: 39.1,
      recordedAt: '2026-08-25T08:00:00.000Z',
    });
    expect('kmCovered' in result).toBe(false);
  });

  it('with expectedDistanceKm: real km covered from the fixes, and km remaining floored at 0', () => {
    const result = computeTransportProgress(FIXES, 100, PICKUP, NOW);
    expect(result.kind).toBe('progress');
    if (result.kind !== 'progress') throw new Error('unreachable');
    expect(result.kmCovered).toBeGreaterThan(0);
    expect(result.kmCovered).toBeCloseTo(sumTrackKm(FIXES), 6);
    expect(result.kmRemaining).toBeCloseTo(100 - result.kmCovered, 6);
  });

  it('floors kmRemaining at 0 when the track already exceeds the expected distance', () => {
    const result = computeTransportProgress(FIXES, 1, PICKUP, NOW);
    if (result.kind !== 'progress') throw new Error('unreachable');
    expect(result.kmRemaining).toBe(0);
  });

  it('no fixes at all: lastPosition is null, kmCovered is 0', () => {
    const result = computeTransportProgress([], 50, PICKUP, NOW);
    if (result.kind !== 'progress') throw new Error('unreachable');
    expect(result.lastPosition).toBeNull();
    expect(result.kmCovered).toBe(0);
    expect(result.kmRemaining).toBe(50);
  });

  it('a single fix has nothing to sum a track from - 0 km covered, but is still the last position', () => {
    const result = computeTransportProgress([FIXES[0]], 50, PICKUP, NOW);
    if (result.kind !== 'progress') throw new Error('unreachable');
    expect(result.kmCovered).toBe(0);
    expect(result.lastPosition?.latitude).toBe(FIXES[0].latitude);
  });
});

describe('sumTrackKm', () => {
  it('is 0 for fewer than 2 fixes', () => {
    expect(sumTrackKm([])).toBe(0);
    expect(sumTrackKm([FIXES[0]])).toBe(0);
  });

  it('sums consecutive great-circle distances', () => {
    const total = sumTrackKm(FIXES);
    // Roughly known: ~10-12km per hop at this latitude for these deltas.
    expect(total).toBeGreaterThan(5);
    expect(total).toBeLessThan(30);
  });
});
