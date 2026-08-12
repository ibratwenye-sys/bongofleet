import Redis from 'ioredis';
import { PrismaService } from '../../src/prisma/prisma.service';
import { requestContext } from '../../src/common/context/request-context';
import { throttleKeyPrefix } from '../../src/redis/throttler-redis.service';

// Stage H0 Part 4 - a standalone, UNPREFIXED connection (not resolved
// through the Nest app's DI container, since cleanDatabase only ever
// receives a PrismaService). Deliberately plain, not built with `keyPrefix:
// throttleKeyPrefix('test')` the way the app's own ThrottlerRedisService is -
// ioredis does not apply keyPrefix to the KEYS command's pattern argument
// (confirmed empirically; it silently matches and would silently mismatch
// on delete across the ENTIRE keyspace, not just this namespace), so the
// prefix is baked into the search pattern by hand below instead, and the
// same plain connection does the delete - no prefixing round-trip to get
// out of sync with itself.
//
// Built lazily, on first use inside cleanDatabase() rather than at
// module-import time - REDIS_URL isn't populated into process.env until
// ConfigModule's dotenv load runs during the file's own beforeAll(), which
// happens after this module is first imported.
let throttleTestRedis: Redis | null = null;
function getThrottleTestRedis(): Redis {
  if (!throttleTestRedis) {
    throttleTestRedis = new Redis(process.env.REDIS_URL as string);
  }
  return throttleTestRedis;
}

const TABLES_FK_SAFE_ORDER = [
  'maintenance_reminders',
  'assignment_alerts',
  'document_alerts',
  'gps_locations',
  'daily_payments',
  'daily_assignments',
  'maintenance_logs',
  'expenses',
  'documents',
  'guarantors',
  'riders',
  'motorcycles',
  'users',
  'tenants',
];

/**
 * Resets state between tests: every Postgres table, AND (Stage H0 Part 4)
 * every throttle counter in Redis's `throttle:test:` namespace. The name
 * predates the Redis half, kept as-is rather than renamed so the ~17 e2e
 * spec files that already call this in their own beforeEach don't all need
 * touching for this to take effect everywhere at once.
 *
 * The Redis half matters for the same reason the Postgres half does: e2e
 * spec files reuse the same default email ("owner@acme-fleet.test", from
 * signupOwner()) across many `it()` blocks and across files, all from the
 * test client's one IP. Without a flush between tests, that identifier's
 * login/signup throttle counters would accumulate across unrelated tests
 * and eventually 429 something that isn't actually testing the limiter -
 * exactly the kind of workaround Stage H0 exists to make unnecessary.
 */
export async function cleanDatabase(prisma: PrismaService): Promise<void> {
  await requestContext.runUnscoped(async () => {
    // Hard safety net: this helper TRUNCATEs every table, so refuse to run
    // unless we're connected to a dedicated *_test database. This makes it
    // impossible for a mis-pointed test run to wipe real dev/prod data, even if
    // DATABASE_URL is set wrong.
    const rows = await prisma.client.$queryRawUnsafe<Array<{ db: string }>>(
      'SELECT current_database() AS db',
    );
    const currentDb = rows[0]?.db ?? '';
    if (!/(^|_)test$/i.test(currentDb) && !/test/i.test(currentDb)) {
      throw new Error(
        `cleanDatabase() refused to truncate database "${currentDb}": e2e tests must run ` +
          'against a *_test database (set TEST_DATABASE_URL or let it derive <db>_test).',
      );
    }

    for (const table of TABLES_FK_SAFE_ORDER) {
      await prisma.client.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
    }
  });

  const redis = getThrottleTestRedis();
  const keys = await redis.keys(`${throttleKeyPrefix('test')}*`);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}
