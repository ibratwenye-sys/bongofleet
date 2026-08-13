import { testDatabaseUrl } from './utils/test-database';
import { testRedisUrl } from './utils/test-redis';

// Runs (via jest `setupFiles`) before each e2e test file is imported, so the
// app's PrismaService picks up the test database instead of the real one.
// dotenv (loaded later by ConfigModule) will not override this value.
process.env.DATABASE_URL = testDatabaseUrl();
// Stage H0c Part 1 - same reasoning, same mechanism, for Redis: every
// service that reads REDIS_URL (RedisService, ThrottlerRedisService) picks
// up a dedicated test database instead of the real one.
process.env.REDIS_URL = testRedisUrl();
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
