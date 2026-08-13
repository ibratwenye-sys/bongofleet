import Redis from 'ioredis';
import { deleteKeysByPrefix, scanKeysByPrefix } from './redis-key-sweep.util';

/**
 * Stage H0c Part 3/4. Real Redis, real SCAN - the whole point is proving
 * this never degrades into the KEYS('*')-matches-everything shape Stage
 * H0's cleanup helper had.
 */
describe('redis-key-sweep.util (Stage H0c Part 3)', () => {
  const testPrefix = `sweep-spec-${Date.now()}:`;
  const unrelatedPrefix = `sweep-spec-unrelated-${Date.now()}:`;
  let redis: Redis;

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    await redis.mset(
      `${testPrefix}a`,
      '1',
      `${testPrefix}b`,
      '1',
      `${testPrefix}c`,
      '1',
      `${unrelatedPrefix}x`,
      '1',
      `${unrelatedPrefix}y`,
      '1',
    );
  });

  afterAll(async () => {
    // Cleanup uses the same helper it's testing - if this were broken, the
    // "it deletes exactly what it matched" test below would already have
    // failed first.
    await deleteKeysByPrefix(redis, testPrefix);
    await deleteKeysByPrefix(redis, unrelatedPrefix);
    await redis.quit();
  });

  it.each(['', '   ', undefined as unknown as string, null as unknown as string])(
    'refuses an empty/blank/missing prefix (%p) rather than matching everything',
    async (badPrefix) => {
      await expect(scanKeysByPrefix(redis, badPrefix)).rejects.toThrow(/empty prefix/i);
      await expect(deleteKeysByPrefix(redis, badPrefix)).rejects.toThrow(/empty prefix/i);
    },
  );

  it('scanKeysByPrefix finds exactly the keys under that prefix, nothing else', async () => {
    const found = await scanKeysByPrefix(redis, testPrefix);
    expect(found.sort()).toEqual([`${testPrefix}a`, `${testPrefix}b`, `${testPrefix}c`].sort());
  });

  it('scanKeysByPrefix never deletes anything - the keys are still there afterwards', async () => {
    await scanKeysByPrefix(redis, testPrefix);
    expect(await redis.exists(`${testPrefix}a`)).toBe(1);
  });

  it('deleteKeysByPrefix deletes exactly the matched keys, leaving an unrelated prefix untouched', async () => {
    const deleted = await deleteKeysByPrefix(redis, testPrefix);
    expect(deleted.sort()).toEqual([`${testPrefix}a`, `${testPrefix}b`, `${testPrefix}c`].sort());

    expect(await redis.exists(`${testPrefix}a`)).toBe(0);
    expect(await redis.exists(`${testPrefix}b`)).toBe(0);
    expect(await redis.exists(`${testPrefix}c`)).toBe(0);

    // The unrelated prefix survives - this is the exact Stage H0 failure
    // mode (a mismatched sweep touching keys outside its own namespace),
    // now proven not to happen.
    expect(await redis.exists(`${unrelatedPrefix}x`)).toBe(1);
    expect(await redis.exists(`${unrelatedPrefix}y`)).toBe(1);
  });

  it('a prefix with no matches deletes nothing and returns an empty list', async () => {
    const deleted = await deleteKeysByPrefix(redis, `no-such-prefix-${Date.now()}:`);
    expect(deleted).toEqual([]);
  });
});
