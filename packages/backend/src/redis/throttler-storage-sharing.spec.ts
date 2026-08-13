import Redis from 'ioredis';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { deleteKeysByPrefix } from './redis-key-sweep.util';

/**
 * Stage H0 Part 4/6 - the whole point of moving off in-memory storage: two
 * separate ioredis connections (standing in for two separate backend
 * instances/processes) pointed at the same Redis must see the same
 * counters. In-memory storage could never pass this - each instance would
 * start every counter back at zero.
 */
describe('ThrottlerStorageRedisService shares state across instances (Stage H0 Part 4/6)', () => {
  const prefix = 'throttle:unit-spec-storage-sharing:';
  let connectionA: Redis;
  let connectionB: Redis;
  let storageA: ThrottlerStorageRedisService;
  let storageB: ThrottlerStorageRedisService;

  beforeAll(() => {
    connectionA = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      keyPrefix: prefix,
    });
    connectionB = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      keyPrefix: prefix,
    });
    storageA = new ThrottlerStorageRedisService(connectionA);
    storageB = new ThrottlerStorageRedisService(connectionB);
  });

  afterAll(async () => {
    // A plain (unprefixed) connection, not connectionA/B - ioredis does not
    // apply keyPrefix to a SCAN pattern, so a prefixed connection's sweep
    // would match (and then mismatch-delete against) the ENTIRE keyspace,
    // not just this namespace. deleteKeysByPrefix (Stage H0c Part 3) bakes
    // the prefix into the pattern by hand and walks it via SCAN, never KEYS.
    const plain = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    await deleteKeysByPrefix(plain, prefix);
    await plain.quit();
    await connectionA.quit();
    await connectionB.quit();
  });

  it('a counter incremented on instance A is visible and continues from instance B', async () => {
    const key = `shared-counter-${Date.now()}`;

    const first = await storageA.increment(key, 60_000, 100, 60_000, 'default');
    expect(first.totalHits).toBe(1);

    const second = await storageB.increment(key, 60_000, 100, 60_000, 'default');
    expect(second.totalHits).toBe(2); // not 1 - proves it's the same counter, not a fresh one

    const third = await storageA.increment(key, 60_000, 100, 60_000, 'default');
    expect(third.totalHits).toBe(3);
  });

  it('a block triggered via instance A is honoured immediately on instance B', async () => {
    const key = `shared-block-${Date.now()}`;
    const limit = 2;

    await storageA.increment(key, 60_000, limit, 5_000, 'login-identifier');
    await storageA.increment(key, 60_000, limit, 5_000, 'login-identifier');
    // Third hit on A exceeds the limit and sets the block.
    const third = await storageA.increment(key, 60_000, limit, 5_000, 'login-identifier');
    expect(third.isBlocked).toBe(true);

    // B sees the block immediately - it's the same Redis-backed state, not
    // a per-process flag.
    const fromB = await storageB.increment(key, 60_000, limit, 5_000, 'login-identifier');
    expect(fromB.isBlocked).toBe(true);
  });
});
