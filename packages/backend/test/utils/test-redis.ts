import * as path from 'node:path';
import * as dotenv from 'dotenv';

// Stage H0c Part 1 - mirrors test-database.ts exactly, for the same reason:
// the e2e suite must NEVER share a keyspace with dev/prod. cleanDatabase()
// wipes this Redis between every test, and RedisService writes real
// refresh-token keys with no environment-based namespacing of its own - see
// the Stage H0c report for what that let accumulate in dev's db 0. A
// dedicated DB INDEX (not just a key prefix, which Stage H0's throttle
// isolation already tried and which only ever covered throttle counters) is
// derived from the app's own REDIS_URL, or an explicit TEST_REDIS_URL.

// Redis ships with 16 logical databases (0-15) by default; picking the one
// furthest from dev's usual 0 minimizes the chance anything else is using it.
const TEST_REDIS_DB_INDEX = 15;

let envLoaded = false;
function loadEnv(): void {
  if (envLoaded) return;
  envLoaded = true;
  // dotenv never overrides an already-set process.env var, so loading these is
  // safe and mirrors how the app resolves its config (packages/backend cwd).
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
  dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
}

function withDbIndex(base: string, index: number): string {
  const url = new URL(base);
  url.pathname = `/${index}`;
  return url.toString();
}

function dbIndexOf(url: string): number {
  const pathname = new URL(url).pathname.replace(/^\//, '');
  return pathname === '' ? 0 : Number(pathname);
}

function hostPortOf(url: string): string {
  const parsed = new URL(url);
  return `${parsed.hostname}:${parsed.port || '6379'}`;
}

/** The connection string the e2e suite should use - always a dedicated DB
 *  index, never whatever database REDIS_URL's dev config happens to point
 *  at. */
export function testRedisUrl(): string {
  loadEnv();

  const devUrl = process.env.REDIS_URL;
  if (!devUrl) {
    throw new Error('REDIS_URL is not set - cannot resolve a test Redis database.');
  }

  const url = process.env.TEST_REDIS_URL ?? withDbIndex(devUrl, TEST_REDIS_DB_INDEX);

  // Single chokepoint, same shape as test-database.ts's *_test check: this
  // Redis gets swept between every test (cleanDatabase() FLUSHDBs it), so it
  // MUST resolve to a different host+port+db than REDIS_URL. An explicit
  // TEST_REDIS_URL that collides - or a REDIS_URL that already happens to
  // point at db 15 - is refused outright rather than silently sharing dev's
  // keyspace.
  if (hostPortOf(url) === hostPortOf(devUrl) && dbIndexOf(url) === dbIndexOf(devUrl)) {
    throw new Error(
      `Refusing to use Redis db ${dbIndexOf(url)} on ${hostPortOf(url)} for e2e tests: it is the ` +
        'same host, port, and database index REDIS_URL uses. Point TEST_REDIS_URL at a distinct ' +
        `database (or unset it to auto-derive db ${TEST_REDIS_DB_INDEX}), or run a separate Redis ` +
        'instance for tests.',
    );
  }

  return url;
}
