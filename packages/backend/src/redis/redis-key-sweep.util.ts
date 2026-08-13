import type Redis from 'ioredis';

/**
 * Stage H0c Part 3. The two rules any key-sweeping code in this repo must
 * follow, after Stage H0's near miss (a prefixed client's KEYS('*') matched
 * - and a mismatched delete then no-op'd against - the ENTIRE keyspace,
 * not just its own namespace):
 *
 *   1. Never KEYS. It is O(N) and blocks the whole Redis server for the
 *      duration of the scan - on a production keyspace that stalls every
 *      other client. SCAN walks the keyspace in small cursor-based batches
 *      instead, never blocking.
 *   2. Bake the prefix into the pattern by hand, on a PLAIN (no keyPrefix)
 *      connection. ioredis does not apply keyPrefix to a KEYS or SCAN
 *      pattern - a prefixed connection's scan silently matches (and a
 *      subsequent delete then silently mismatches against) the whole
 *      keyspace. Passing `redis` here is deliberately a bare Redis client;
 *      `prefix` is matched literally, not combined with any connection-level
 *      prefix.
 *
 * Refuses to run at all against an empty/blank prefix - the one guard that
 * turns "sweep everything by accident" into a thrown error instead of a
 * deleted keyspace.
 */
function assertNonEmptyPrefix(prefix: string, caller: string): void {
  if (!prefix || prefix.trim().length === 0) {
    throw new Error(`${caller}() refuses an empty prefix - that would match every key.`);
  }
}

/** Read-only: every key matching `prefix + '*'`, via SCAN. Never deletes
 *  anything - use this to see what a sweep WOULD match before running
 *  deleteKeysByPrefix. */
export async function scanKeysByPrefix(redis: Redis, prefix: string): Promise<string[]> {
  assertNonEmptyPrefix(prefix, 'scanKeysByPrefix');

  const found: string[] = [];
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
    cursor = nextCursor;
    found.push(...keys);
  } while (cursor !== '0');

  return found;
}

/** Deletes every key matching `prefix + '*'`, via SCAN + batched DEL. Returns
 *  the keys it deleted. */
export async function deleteKeysByPrefix(redis: Redis, prefix: string): Promise<string[]> {
  assertNonEmptyPrefix(prefix, 'deleteKeysByPrefix');

  const deleted: string[] = [];
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
    cursor = nextCursor;
    if (keys.length > 0) {
      await redis.del(...keys);
      deleted.push(...keys);
    }
  } while (cursor !== '0');

  return deleted;
}
