import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Client } from 'pg';
import { adminDatabaseUrl, testDatabaseName, testDatabaseUrl } from './utils/test-database';

// Runs once before the whole e2e suite. Ensures a dedicated *_test database
// exists and holds the current schema, by resetting its `public` schema and
// replaying every migration SQL file in order. This needs no Prisma CLI/engine
// (just node-postgres), so it works identically in CI, locally, and in
// restricted sandboxes. Because it's a throwaway test database, a full reset
// each run guarantees the schema always matches the latest migrations.
export default async function globalSetup(): Promise<void> {
  const dbName = testDatabaseName();

  const admin = new Client({ connectionString: adminDatabaseUrl() });
  await admin.connect();
  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (existing.rowCount === 0) {
      // Identifier can't be parameterized; dbName is derived from our own config.
      await admin.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await admin.end();
  }

  const db = new Client({ connectionString: testDatabaseUrl() });
  await db.connect();
  try {
    await db.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    const migrationsDir = path.resolve(process.cwd(), 'prisma/migrations');
    const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    for (const dir of dirs) {
      const sql = await fs.readFile(path.join(migrationsDir, dir, 'migration.sql'), 'utf8');
      await db.query(sql);
    }
  } finally {
    await db.end();
  }
}
