import { testDatabaseUrl } from './utils/test-database';

// Runs (via jest `setupFiles`) before each e2e test file is imported, so the
// app's PrismaService picks up the test database instead of the real one.
// dotenv (loaded later by ConfigModule) will not override this value.
process.env.DATABASE_URL = testDatabaseUrl();
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
