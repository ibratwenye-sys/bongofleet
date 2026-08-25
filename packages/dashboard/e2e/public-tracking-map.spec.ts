import { test, expect, request as playwrightRequest } from '@playwright/test';

/**
 * Stage I3 (§8's map addendum). The public tracking page's new inline map -
 * renders for a live vehicle, and doesn't error for an offline/never-
 * reported one (no coordinates to plot, so no map - see PublicTrackingPage.
 * tsx's own reasoning).
 *
 * Every `browser.newContext()` below passes `storageState: undefined`
 * EXPLICITLY. Without it, a new context silently inherits the CHROMIUM
 * PROJECT's own configured default (`storageState: AUTH_STATE_FILE` in
 * playwright.config.ts) - not a blank profile. That default exists so the
 * shared `page` fixture starts signed in; it was never meant to leak into a
 * context built specifically to simulate a logged-out visitor. Caught by
 * this exact stage's own suite going red end to end: a "fresh" context
 * loaded the real owner's refresh token, the mounted page's AuthProvider
 * silently refreshed it (rotating it) in a context nothing ever saves, and
 * the shared session in AUTH_STATE_FILE was left pointing at a token
 * already spent - every later test using the real `page` fixture then
 * failed to refresh and landed back on /login. Same latent gap existed
 * already in tracking-links.spec.ts's own public-view test; harmless there
 * only because 't' sorts after 's', so smoke.spec.ts always finished first.
 * Fixed there too, alongside this file.
 *
 * Deliberately uses ONLY these explicitly-blank contexts, never the shared
 * authenticated `page` fixture: this page is genuinely unauthenticated
 * (testing it through a logged-in session would prove nothing about what an
 * actual customer sees), and it costs nothing against this suite's tight
 * REFRESH_THROTTLE budget (20/minute, shared by every real page boot across
 * the whole e2e run - see tracking-map.spec.ts's own comment on this).
 * Setup below is pure API calls, not page.goto(), for the same reason.
 */
const RUN_TAG = Date.now();
const BACKEND_URL = process.env.VITE_API_URL ?? 'http://localhost:3000';

let apiContext: Awaited<ReturnType<typeof playwrightRequest.newContext>>;
let liveTrackUrl: string;
let neverReportedTrackUrl: string;

test.beforeAll(async ({ baseURL }) => {
  apiContext = await playwrightRequest.newContext({ baseURL: BACKEND_URL });

  const ownerLogin = await apiContext.post('/auth/login', {
    data: { email: 'owner@bongofleet.com', password: 'Test1234!' },
  });
  const { accessToken: ownerToken } = await ownerLogin.json();
  const authHeader = { Authorization: `Bearer ${ownerToken}` };

  const liveMotoRes = await apiContext.post('/motorcycles', {
    headers: authHeader,
    data: { registrationNumber: `KDA-PUBMAP${RUN_TAG}` },
  });
  const liveMotorcycleId = (await liveMotoRes.json()).id;

  const neverMotoRes = await apiContext.post('/motorcycles', {
    headers: authHeader,
    data: { registrationNumber: `KDA-PUBNEVER${RUN_TAG}` },
  });
  const neverMotorcycleId = (await neverMotoRes.json()).id;

  const riderEmail = `rider-pubmap${RUN_TAG}@bongofleet.test`;
  const riderPassword = 'riderpass123';
  const driverRes = await apiContext.post('/drivers', {
    headers: authHeader,
    data: {
      firstName: 'Playwright',
      lastName: `PubRider${RUN_TAG}`,
      phone: `+2548${String(RUN_TAG).slice(-8)}`,
      email: riderEmail,
      licenseNumber: `LIC-PUBMAP-${RUN_TAG}`,
      initialPassword: riderPassword,
    },
  });
  const driverId = (await driverRes.json()).id;

  const today = new Date().toISOString().slice(0, 10);
  await apiContext.post('/assignments', {
    headers: authHeader,
    data: { driverId, motorcycleId: liveMotorcycleId, assignedDate: today, targetAmount: 10000 },
  });

  const riderLogin = await apiContext.post('/auth/login', {
    data: { email: riderEmail, password: riderPassword },
  });
  const { accessToken: riderToken } = await riderLogin.json();

  await apiContext.post('/gps/phone', {
    headers: { Authorization: `Bearer ${riderToken}` },
    data: {
      fixes: [{ recordedAt: new Date().toISOString(), latitude: -6.79, longitude: 39.2 }],
    },
  });

  const liveLinkRes = await apiContext.post('/tracking-links', {
    headers: authHeader,
    data: { motorcycleId: liveMotorcycleId, label: `Public map check ${RUN_TAG}` },
  });
  const liveToken = (await liveLinkRes.json()).token;

  const neverLinkRes = await apiContext.post('/tracking-links', {
    headers: authHeader,
    data: { motorcycleId: neverMotorcycleId, label: `Public map never-reported ${RUN_TAG}` },
  });
  const neverToken = (await neverLinkRes.json()).token;

  liveTrackUrl = `${baseURL}/track/${liveToken}`;
  neverReportedTrackUrl = `${baseURL}/track/${neverToken}`;
});

test.afterAll(async () => {
  await apiContext.dispose();
});

test('a live vehicle shows an inline map with a marker', async ({ browser }) => {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  await page.goto(liveTrackUrl);
  await expect(page.getByRole('heading', { name: 'BongoFleet vehicle tracking' })).toBeVisible();
  await expect(page.getByText('Live')).toBeVisible();
  await expect(page.getByTestId('vehicle-map')).toBeVisible();
  await expect(page.locator('.leaflet-marker-icon').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('link', { name: /Open in Google Maps/ })).toBeVisible();

  await context.close();
});

test('a vehicle that has never reported shows no map, and no error', async ({ browser }) => {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  await page.goto(neverReportedTrackUrl);
  await expect(page.getByRole('heading', { name: 'BongoFleet vehicle tracking' })).toBeVisible();
  await expect(page.getByText('No location reported yet.')).toBeVisible();
  await expect(page.getByTestId('vehicle-map')).not.toBeVisible();

  await context.close();
});
