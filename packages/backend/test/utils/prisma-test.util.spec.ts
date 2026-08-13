import type { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Stage H0c Part 1/4 - cleanDatabase() FLUSHDBs whatever Redis REDIS_URL
 * resolves to, so this is the second, independent guard (alongside
 * testRedisUrl()'s own collision check) that must fail loudly rather than
 * ever flushing database 0. jest.resetModules() per test: the module under
 * test memoizes its Redis connection at module scope.
 */
describe('cleanDatabase Redis guard (Stage H0c Part 1)', () => {
  const ORIGINAL_ENV = { ...process.env };

  function fakePrisma(dbName = 'bongofleet_test'): PrismaService {
    return {
      client: {
        $queryRawUnsafe: jest.fn().mockResolvedValue([{ db: dbName }]),
        $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      },
    } as unknown as PrismaService;
  }

  function load(): typeof import('./prisma-test.util') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.resetModules() needs a fresh require(), not a cached static import
    return require('./prisma-test.util');
  }

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('refuses (throws) rather than FLUSHDB-ing when REDIS_URL resolves to database 0', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379'; // no path segment -> db 0
    const { cleanDatabase } = load();

    await expect(cleanDatabase(fakePrisma())).rejects.toThrow(/refused to FLUSHDB/i);
  });

  it('refuses (throws) when REDIS_URL explicitly names database 0', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379/0';
    const { cleanDatabase } = load();

    await expect(cleanDatabase(fakePrisma())).rejects.toThrow(/refused to FLUSHDB/i);
  });

  it('proceeds (does not throw) when REDIS_URL resolves to a non-zero database', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379/15';
    const { cleanDatabase } = load();

    await expect(cleanDatabase(fakePrisma())).resolves.toBeUndefined();
  });
});
