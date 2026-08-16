import { defineConfig, devices } from '@playwright/test';
import { AUTH_STATE_FILE } from './e2e/auth-state';

// Stage H2 - these are smoke tests, not a full suite: they exist to catch
// the specific class of bug that has already shipped twice on a green
// build (the create-plan toggle freezing, an End/Days left column that
// never populates) because nothing in this project actually opened the
// real bundled app in a real browser. They run against a PRODUCTION build
// (`vite build` + `vite preview`), not the dev server - a dev-only bug like
// Stage G9's stale Vite dependency cache would not exist in this build at
// all, so this suite intentionally cannot catch that specific mechanism
// again. What it catches is the same as what a person clicking through the
// built app would: a frozen form, a computation that's silently wrong, a
// page that never finishes loading.
const PORT = process.env.PLAYWRIGHT_PORT ?? '4173';
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  // All tests share one seeded backend, so they run serially - a failure's
  // console output isn't interleaved with the others, and nothing races on
  // shared data. (They no longer each sign in: see the `setup` project
  // below for why that had to stop.)
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `pnpm exec vite preview --port ${PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    // Stage H0d - signs in once and saves the session. Each test then starts
    // already authenticated instead of logging in itself, which the backend's
    // five-logins-per-email-per-minute limit had begun rejecting outright once
    // the suite passed five tests. See e2e/auth.setup.ts.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: AUTH_STATE_FILE },
      dependencies: ['setup'],
    },
  ],
});
