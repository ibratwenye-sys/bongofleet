import { test as setup, expect } from '@playwright/test';
import { AUTH_STATE_FILE } from './auth-state';

/**
 * Stage H0d - the suite used to sign in through the UI in a beforeEach, once
 * per test. That was fine at five tests and broke at seven: the backend
 * allows five login attempts per email per minute
 * (LOGIN_IDENTIFIER_THROTTLE, packages/backend/src/common/throttle), so the
 * sixth and seventh tests were rejected before they ran. The limit is
 * correct and deliberately tight against brute-forcing a single account -
 * the suite is what had to change, not the number.
 *
 * So: sign in once here, save the storage state, and let every test start
 * already authenticated. Each test then costs one silent /auth/refresh on
 * boot (the dashboard bootstraps from the refresh token it finds in
 * localStorage - see src/lib/auth-context.tsx) against a much roomier
 * REFRESH_THROTTLE of 20/minute, instead of a fresh login against a limit of
 * five. Adding more tests no longer walks the suite into a rate limit.
 *
 * Credentials are the seed script's own demo owner account
 * (packages/backend/prisma/seed.ts) - already printed in plain text in
 * VISUAL_CHECK.md, not a secret.
 */
const OWNER_EMAIL = 'owner@bongofleet.com';
const OWNER_PASSWORD = 'Test1234!';

setup('sign in once and save the session', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(OWNER_EMAIL);
  await page.getByLabel('Password').fill(OWNER_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/');

  // The access token is deliberately memory-only (src/lib/token-store.ts);
  // what gets persisted here is the refresh token in localStorage, which is
  // exactly what the app bootstraps a session from. The written file is
  // gitignored - it holds a real, working refresh token.
  await page.context().storageState({ path: AUTH_STATE_FILE });
});
