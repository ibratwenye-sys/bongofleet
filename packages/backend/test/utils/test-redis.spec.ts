/**
 * Stage H0c Part 1/4. testRedisUrl() is what stands between the e2e suite
 * (which FLUSHDBs whatever Redis it resolves) and the dev keyspace - these
 * tests are the proof that forgetting to configure isolation can never
 * result in quietly running against dev's database, only a loud failure.
 *
 * jest.resetModules() + a fresh require() per test: the module under test
 * has its own top-level `envLoaded` memoization flag, so re-importing is
 * necessary for each test to see a clean slate.
 */
// dotenv would otherwise load the real repo-root .env (which DOES set
// REDIS_URL) during loadEnv(), defeating the "REDIS_URL is not set" case
// below - mocked to a no-op so each test fully controls process.env itself.
jest.mock('dotenv', () => ({ config: jest.fn() }));

describe('testRedisUrl (Stage H0c Part 1)', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    delete process.env.REDIS_URL;
    delete process.env.TEST_REDIS_URL;
  });

  afterAll(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function load(): typeof import('./test-redis') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.resetModules() needs a fresh require(), not a cached static import
    return require('./test-redis');
  }

  it('throws loudly when REDIS_URL is not set at all - no Redis to derive anything from', () => {
    const { testRedisUrl } = load();
    expect(() => testRedisUrl()).toThrow(/REDIS_URL is not set/);
  });

  it('auto-derives db 15 from REDIS_URL when TEST_REDIS_URL is not set', () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const { testRedisUrl } = load();
    expect(testRedisUrl()).toBe('redis://localhost:6379/15');
  });

  it('an explicit TEST_REDIS_URL on a different host/port is honoured as-is', () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.TEST_REDIS_URL = 'redis://test-redis-host:6379/0';
    const { testRedisUrl } = load();
    expect(testRedisUrl()).toBe('redis://test-redis-host:6379/0');
  });

  it('refuses (throws) when REDIS_URL itself already points at the auto-derived test db - the e2e suite cannot run against the dev keyspace without real isolation', () => {
    process.env.REDIS_URL = 'redis://localhost:6379/15';
    const { testRedisUrl } = load();
    expect(() => testRedisUrl()).toThrow(/same host, port, and database index/i);
  });

  it('refuses (throws) when an explicit TEST_REDIS_URL collides with REDIS_URL on host+port+db', () => {
    process.env.REDIS_URL = 'redis://localhost:6379/3';
    process.env.TEST_REDIS_URL = 'redis://localhost:6379/3';
    const { testRedisUrl } = load();
    expect(() => testRedisUrl()).toThrow(/same host, port, and database index/i);
  });

  it('does NOT refuse when host/port matches but the db index differs', () => {
    process.env.REDIS_URL = 'redis://localhost:6379/3';
    process.env.TEST_REDIS_URL = 'redis://localhost:6379/4';
    const { testRedisUrl } = load();
    expect(() => testRedisUrl()).not.toThrow();
    expect(testRedisUrl()).toBe('redis://localhost:6379/4');
  });
});
