import Redis from 'ioredis';
import { PrismaService } from '../../src/prisma/prisma.service';
import { requestContext } from '../../src/common/context/request-context';

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
 * Resets state between tests: every Postgres table, AND (Stage H0c Part 1)
 * the entire isolated test Redis database. Now that the test Redis is a
 * genuinely separate database (not a shared keyspace scoped by prefix - see
 * test/utils/test-redis.ts), a plain FLUSHDB is simpler and safer than any
 * pattern-matching sweep, and incidentally clears refresh-token keys too
 * (Stage H0's throttle-only prefix sweep never touched those).
 *
 * The Redis connection is opened and quit within this one call, on every
 * call, rather than reused across calls via a module-level singleton (what
 * this used to do, since Stage H0). That singleton was never closed by
 * anything - not by design, there was simply no correct place to do it:
 * setupFilesAfterEnv's own afterAll fires BEFORE each spec file's afterAll
 * (verified empirically), and ~18 of 19 e2e spec files call cleanDatabase()
 * again in their own afterAll as final teardown - so closing the shared
 * connection from a global afterAll would only have the file's own
 * afterAll immediately reopen it via the lazy getter, moments before that
 * file's module registry (and the new connection with it) is torn down
 * unclosed. A fresh connection per call costs a few ms against a local
 * Redis; it can never be the thing still open when Jest tries to exit.
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

  const redis = new Redis(process.env.REDIS_URL as string);
  try {
    // Same defense-in-depth as the Postgres check above: refuse to FLUSHDB
    // anything that looks like the dev/default database (index 0), even
    // though testRedisUrl() already refuses to let REDIS_URL resolve there
    // for e2e tests in the first place - this is the second, independent
    // guard right at the destructive call site.
    if ((redis.options.db ?? 0) === 0) {
      throw new Error(
        'cleanDatabase() refused to FLUSHDB Redis database 0: e2e tests must run against a ' +
          'dedicated test database (see test/utils/test-redis.ts) - REDIS_URL was not overridden ' +
          'to one.',
      );
    }
    await redis.flushdb();
  } finally {
    await redis.quit();
  }
}
