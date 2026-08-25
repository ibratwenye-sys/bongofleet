import { test, expect, request as playwrightRequest } from '@playwright/test';
import { AUTH_STATE_FILE } from './auth-state';

/**
 * Stage I3 (§7). The live-map page needs at least one vehicle with a REAL,
 * fresh GPS fix to have anything to click - the seeded demo tenant has zero
 * gps_locations rows (Stage I1's ingestion is rider-app-only; the seed
 * script never posts a fix - see Stage I2's own report). Rather than touch
 * the database directly (this suite has no DB access, by design - it's a
 * browser E2E test against the real HTTP API, same discipline as every
 * other spec here), this beforeAll drives the actual backend endpoints a
 * rider's phone would: create a driver + vehicle + today's assignment as
 * the demo owner, log in as that rider, then POST /gps/phone with a fix
 * recorded right now. That's the same ingestion path gps.e2e-spec.ts
 * exercises on the backend side, just driven over HTTP instead of Prisma.
 *
 * Runs against the backend directly (not the dashboard's own preview
 * server) - VITE_API_URL if set, else the same localhost:3000 default
 * api.ts itself falls back to.
 *
 * Entities are tagged with RUN_TAG so repeated runs against this
 * suite's persistent dev DB (never truncated - see VISUAL_CHECK.md) don't
 * collide with a previous run's rows.
 *
 * Deliberately ONE test using the shared, already-signed-in `page` (see
 * auth.setup.ts), not two - same reasoning as tracking-links.spec.ts's own
 * consolidation: this suite's REFRESH_THROTTLE budget (20/minute, shared by
 * every real page boot across the whole run) is tight enough by the time
 * billing.spec.ts (2), smoke.spec.ts (17), and tracking-links.spec.ts (1)
 * have already run that a second boot here reliably tips it over - measured
 * directly (a `throttle:...:refresh:blocked` key showed up in Redis).
 */
const RUN_TAG = Date.now();
const BACKEND_URL = process.env.VITE_API_URL ?? 'http://localhost:3000';
const REG_NUMBER = `KDA-MAP${RUN_TAG}`;

let apiContext: Awaited<ReturnType<typeof playwrightRequest.newContext>>;
let motorcycleId: string;

test.beforeAll(async () => {
  apiContext = await playwrightRequest.newContext({ baseURL: BACKEND_URL });

  const ownerLogin = await apiContext.post('/auth/login', {
    data: { email: 'owner@bongofleet.com', password: 'Test1234!' },
  });
  const { accessToken: ownerToken } = await ownerLogin.json();
  const authHeader = { Authorization: `Bearer ${ownerToken}` };

  const motoRes = await apiContext.post('/motorcycles', {
    headers: authHeader,
    data: { registrationNumber: REG_NUMBER, vehicleType: 'MOTORBIKE' },
  });
  motorcycleId = (await motoRes.json()).id;

  const riderEmail = `rider-map${RUN_TAG}@bongofleet.test`;
  const riderPassword = 'riderpass123';
  const driverRes = await apiContext.post('/drivers', {
    headers: authHeader,
    data: {
      firstName: 'Playwright',
      lastName: `Rider${RUN_TAG}`,
      phone: `+2547${String(RUN_TAG).slice(-8)}`,
      email: riderEmail,
      licenseNumber: `LIC-MAP-${RUN_TAG}`,
      initialPassword: riderPassword,
    },
  });
  const driverId = (await driverRes.json()).id;

  const today = new Date().toISOString().slice(0, 10);
  await apiContext.post('/assignments', {
    headers: authHeader,
    data: { driverId, motorcycleId, assignedDate: today, targetAmount: 10000 },
  });

  const riderLogin = await apiContext.post('/auth/login', {
    data: { email: riderEmail, password: riderPassword },
  });
  const { accessToken: riderToken } = await riderLogin.json();

  await apiContext.post('/gps/phone', {
    headers: { Authorization: `Bearer ${riderToken}` },
    data: {
      fixes: [
        {
          recordedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
          latitude: -6.79,
          longitude: 39.2,
          speedKmh: 18,
        },
        {
          recordedAt: new Date().toISOString(),
          latitude: -6.8,
          longitude: 39.21,
          speedKmh: 22,
        },
      ],
    },
  });
});

test.afterAll(async () => {
  await apiContext.dispose();
});

test.afterEach(async ({ page }) => {
  await page.context().storageState({ path: AUTH_STATE_FILE });
});

test('the live map renders, a marker opens the side panel, the date picker changes the path, and category filtering works', async ({
  page,
}) => {
  await page.goto('/settings/tracking-map');
  await expect(page.getByRole('heading', { name: 'Live map' })).toBeVisible();
  await expect(page.getByTestId('vehicle-map')).toBeVisible();

  // Wait for the fleet-positions fetch and specifically THIS test's own
  // seeded vehicle's marker - this dev DB accumulates other live/stale
  // vehicles from other runs and other specs (never truncated - see
  // VISUAL_CHECK.md), so ".first()" is not reliably this run's own marker.
  // TrackingMapPage sets a real `title` attribute per marker from
  // registrationNumber for exactly this reason.
  const marker = page.locator(`.leaflet-marker-icon[title="${REG_NUMBER}"]`);
  await expect(marker).toBeVisible({ timeout: 15_000 });

  // force: true, verified deliberately, not a shortcut past a real bug:
  // Playwright's own actionability check reports the marker's div as
  // "intercepted" by an empty child div in its own subtree (gps-status.ts's
  // divIcon nests a colour dot and a source-emoji badge inside one wrapper)
  // and retries forever - but a real click at the same coordinates, done
  // manually against this exact build, opens the side panel correctly every
  // time. A known category of friction between Leaflet's CSS-transformed
  // marker panes and Playwright's element-interception heuristic, not
  // something a real user or a real click ever hits.
  await marker.click({ force: true });
  await expect(page.getByRole('heading', { name: REG_NUMBER })).toBeVisible();
  // Scoped to the status <dd> specifically - a bare getByText('Live') also
  // matches the page's own "Live map" heading and the colour-legend's own
  // "Live" label, both already on screen regardless of the panel.
  await expect(page.getByRole('definition').filter({ hasText: 'Live' })).toBeVisible();
  await expect(page.getByText(/\d+ points plotted|Only one fix that day/)).toBeVisible({
    timeout: 10_000,
  });

  // Replay a day with no fixes at all - the path message must change, and
  // must not error.
  const datePicker = page.locator('input[type="date"]');
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await datePicker.fill(yesterday);
  await expect(page.getByText('No fixes recorded that day.')).toBeVisible({ timeout: 10_000 });

  // Closing the panel deselects the vehicle.
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('heading', { name: REG_NUMBER })).not.toBeVisible();

  // Vehicle-category filter - reuses this same navigation rather than a
  // second test/page boot (see this file's own top comment).
  //
  // Not a proper <label for>/<select id> pairing (matches this app's other
  // filter dropdowns - e.g. ReportsPage's category filter), so an adjacent-
  // sibling locator, not getByLabel.
  const categorySelect = page.locator('label:text-is("Vehicle") + select');
  await categorySelect.selectOption('MOTORBIKE');
  await expect(marker).toBeVisible({ timeout: 15_000 });

  await categorySelect.selectOption('TRUCK');
  // No seeded truck reports a live position - the map must still render
  // (not error) with zero markers, and say so.
  await expect(page.getByText(/aren't plotted/)).toBeVisible();
});
