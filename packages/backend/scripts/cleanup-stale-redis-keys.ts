/**
 * Stage H0c Part 3 - a one-off, reviewable cleanup for the dev Redis's
 * accumulated refresh:* keys (see the Stage H0c report: 1400+ live keys,
 * every one correctly TTL'd, left behind by e2e test churn that - before
 * Part 1's isolation - shared dev's keyspace). Never run automatically:
 * this is a script an operator reads and runs by hand.
 *
 * Defaults to a DRY RUN - prints the prefix pattern and every key it would
 * delete, deletes nothing. Pass --yes to actually delete.
 *
 * Uses scanKeysByPrefix/deleteKeysByPrefix (redis-key-sweep.util.ts): SCAN,
 * never KEYS, and the prefix is required and asserted non-empty before
 * anything is matched.
 *
 * Run (dry run):      pnpm --filter backend exec ts-node scripts/cleanup-stale-redis-keys.ts
 * Run (actually delete): pnpm --filter backend exec ts-node scripts/cleanup-stale-redis-keys.ts --yes
 * Different prefix:   ... --prefix="refresh:"
 */
import * as path from 'node:path';
import * as dotenv from 'dotenv';
import Redis from 'ioredis';
import { deleteKeysByPrefix, scanKeysByPrefix } from '../src/redis/redis-key-sweep.util';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

function parseArgs(argv: string[]): { prefix: string; confirm: boolean } {
  const confirm = argv.includes('--yes');
  const prefixArg = argv.find((a) => a.startsWith('--prefix='));
  const prefix = prefixArg ? prefixArg.slice('--prefix='.length) : 'refresh:';
  return { prefix, confirm };
}

async function main(): Promise<void> {
  const { prefix, confirm } = parseArgs(process.argv.slice(2));

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL is not set.');
  }

  const redis = new Redis(redisUrl);
  const dbIndex = redis.options.db ?? 0;

  // eslint-disable-next-line no-console
  console.log(`Target: ${redisUrl} (database ${dbIndex})`);
  // eslint-disable-next-line no-console
  console.log(`Pattern: "${prefix}*"`);

  const matched = await scanKeysByPrefix(redis, prefix);
  // eslint-disable-next-line no-console
  console.log(`Matched ${matched.length} key(s).`);
  for (const key of matched.slice(0, 20)) {
    // eslint-disable-next-line no-console
    console.log(`  ${key}`);
  }
  if (matched.length > 20) {
    // eslint-disable-next-line no-console
    console.log(`  ...and ${matched.length - 20} more`);
  }

  if (!confirm) {
    // eslint-disable-next-line no-console
    console.log('\nDry run only - nothing deleted. Re-run with --yes to actually delete these.');
    await redis.quit();
    return;
  }

  const deleted = await deleteKeysByPrefix(redis, prefix);
  // eslint-disable-next-line no-console
  console.log(`\nDeleted ${deleted.length} key(s).`);
  await redis.quit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
