import * as path from 'node:path';
import * as dotenv from 'dotenv';

// The e2e suite must NEVER run against the real (dev/prod) database - its
// cleanDatabase() helper truncates every table. This module resolves a
// dedicated *_test database URL derived from the app's own DATABASE_URL (or an
// explicit TEST_DATABASE_URL), so tests wipe only their own throwaway database.

let envLoaded = false;
function loadEnv(): void {
  if (envLoaded) return;
  envLoaded = true;
  // dotenv never overrides an already-set process.env var, so loading these is
  // safe and mirrors how the app resolves its config (packages/backend cwd).
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
  dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
}

function deriveTestUrl(base: string): string {
  const url = new URL(base);
  const dbName = url.pathname.replace(/^\//, '');
  if (dbName.endsWith('_test')) {
    return base;
  }
  url.pathname = `/${dbName}_test`;
  return url.toString();
}

/** The connection string the e2e suite should use - always a *_test database. */
export function testDatabaseUrl(): string {
  loadEnv();

  let url: string;
  if (process.env.TEST_DATABASE_URL) {
    url = process.env.TEST_DATABASE_URL;
  } else {
    const base = process.env.DATABASE_URL;
    if (!base) {
      throw new Error(
        'Neither TEST_DATABASE_URL nor DATABASE_URL is set - cannot resolve a test database.',
      );
    }
    url = deriveTestUrl(base);
  }

  // Single chokepoint: the e2e suite resets and truncates this database, so it
  // MUST be a dedicated *_test database. Refusing here protects globalSetup's
  // schema reset, the per-file DATABASE_URL override, and cleanDatabase alike -
  // a TEST_DATABASE_URL accidentally pointed at a real database is rejected
  // before anything destructive runs.
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!/_test$/i.test(dbName)) {
    throw new Error(
      `Refusing to use database "${dbName}" for e2e tests: its name must end in "_test". ` +
        'Point TEST_DATABASE_URL at a throwaway *_test database (or unset it to auto-derive one).',
    );
  }
  return url;
}

/** The bare database name of the test database (e.g. "bongofleet_test"). */
export function testDatabaseName(): string {
  return new URL(testDatabaseUrl()).pathname.replace(/^\//, '');
}

/** A connection string to the server's default `postgres` db, for CREATE DATABASE. */
export function adminDatabaseUrl(): string {
  const url = new URL(testDatabaseUrl());
  url.pathname = '/postgres';
  return url.toString();
}
