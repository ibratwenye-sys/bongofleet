import { test, expect } from '@playwright/test';
import { AUTH_STATE_FILE } from './auth-state';

/**
 * Stage I2 - the tracking-links management page and the public, logged-out
 * /track/:token view.
 *
 * Deliberately ONE test using the shared, already-signed-in `page` (see
 * auth.setup.ts) rather than two: this suite's REFRESH_THROTTLE budget
 * (20/minute, shared across every real page boot in the whole e2e run - see
 * throttle.constants.ts) is tracked per USER, not per file, and by the time
 * billing.spec.ts (2) and smoke.spec.ts (17) have run, only a few boots of
 * headroom are left. A second `page.goto()` here to re-open the management
 * page just to grab a link for the public-view check was one boot more than
 * necessary - reusing the link created below costs nothing and avoids it.
 * The bogus-token test needs no session at all, so it costs nothing either.
 *
 * Clipboard read/write needs explicit permission in a Chromium test context
 * (unlike a real user's browser, which prompts) - granted per-context below.
 *
 * The label carries Date.now() so repeated runs against the same persistent
 * dev DB (this suite never truncates it - see VISUAL_CHECK.md) never
 * collide with a row an earlier run left behind, which would otherwise make
 * the `tr` locator below match more than one row.
 *
 * Every `browser.newContext()` below passes `storageState: undefined`
 * EXPLICITLY - Stage I3 found the hard way that omitting it does NOT yield
 * a blank profile, it silently inherits the "chromium" project's own
 * configured default (`storageState: AUTH_STATE_FILE`). A context built to
 * simulate a logged-out visitor was loading the real owner's session,
 * silently refreshing (and so rotating/spending) it, in a context nothing
 * ever saves back to disk - corrupting the shared session for every later
 * test using the real `page` fixture. It stayed invisible here only because
 * this file happens to sort after smoke.spec.ts alphabetically, so nothing
 * downstream of it depended on the session surviving. See
 * public-tracking-map.spec.ts's own note on this for the full story.
 */
const RUN_TAG = Date.now();

test.afterEach(async ({ page }) => {
  await page.context().storageState({ path: AUTH_STATE_FILE });
});

test('a tracking link can be created, opened publicly (logged out), copied, and revoked', async ({
  page,
  context,
  browser,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const label = `Playwright smoke link ${RUN_TAG}`;

  await page.goto('/settings/tracking-links');
  await expect(page.getByRole('heading', { name: 'Tracking links' })).toBeVisible();

  await page.getByRole('button', { name: 'New link' }).click();
  await expect(page.getByRole('heading', { name: 'New tracking link' })).toBeVisible();
  await page.locator('label:text-is("Label") + input').fill(label);
  await page.getByRole('button', { name: 'Create link' }).click();

  await expect(page.getByText('Tracking link created.')).toBeVisible();
  const row = page.locator('tr', { hasText: label });
  await expect(row).toBeVisible();
  await expect(row.getByText('ACTIVE')).toBeVisible();
  await expect(row.getByText('Whole fleet')).toBeVisible();

  await row.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByText('Link copied to clipboard.')).toBeVisible();
  const copiedUrl = await page.evaluate(() => navigator.clipboard.readText());
  expect(copiedUrl).toMatch(/\/track\/[A-Za-z0-9_-]{40,}$/);

  // The public view, from a fresh context with no BongoFleet session at all -
  // this must work for an actual customer, not just the owner who made the
  // link. Uses `browser` (not the shared `page`), so it costs no extra
  // REFRESH_THROTTLE budget (see this file's own top comment).
  const publicContext = await browser.newContext({ storageState: undefined });
  const publicPage = await publicContext.newPage();
  await publicPage.goto(copiedUrl);
  await expect(
    publicPage.getByRole('heading', { name: 'BongoFleet vehicle tracking' }),
  ).toBeVisible();
  // Not asserting "No vehicles to show." specifically: true when this
  // suite was written (Stage I1's ingestion is rider-app-only, the seed
  // script never posts a fix), but Stage I3's own tracking-map.spec.ts /
  // public-tracking-map.spec.ts now seed real GPS-reporting vehicles onto
  // this same demo tenant on every run, so "empty" is no longer a safe
  // assumption - and exactly which vehicles are live/stale/absent at this
  // point depends on file-execution order and timing this test has no
  // business depending on. What's actually worth asserting, regardless of
  // fleet contents: this valid link does NOT land on the "invalid, expired,
  // or revoked" error state a bad token would - the "Loading…" text must
  // also be gone, or a fleet that loaded zero rows and one that's still
  // fetching would both silently satisfy a bare "no error" check.
  await expect(publicPage.getByText('Loading…')).not.toBeVisible({ timeout: 10_000 });
  await expect(
    publicPage.getByText('This tracking link is invalid, expired, or has been revoked.'),
  ).not.toBeVisible();
  await publicContext.close();

  await row.getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByRole('heading', { name: 'Revoke tracking link' })).toBeVisible();
  // The confirm dialog's own "Revoke" button is the one rendered LAST in the
  // DOM (it mounts after the row's, which stays visible underneath) -
  // .last() rather than an index tied to how many rows happen to precede it.
  await page.getByRole('button', { name: 'Revoke' }).last().click();
  await expect(page.getByText('Tracking link revoked.')).toBeVisible();
  await expect(row.getByText('REVOKED')).toBeVisible();
  // A revoked link no longer offers Revoke again.
  await expect(row.getByRole('button', { name: 'Revoke' })).toHaveCount(0);

  // And the now-revoked link's public URL immediately stops working too.
  const revokedContext = await browser.newContext({ storageState: undefined });
  const revokedPage = await revokedContext.newPage();
  await revokedPage.goto(copiedUrl);
  await expect(
    revokedPage.getByText('This tracking link is invalid, expired, or has been revoked.'),
  ).toBeVisible();
  await revokedContext.close();
});

test('the public /track page renders without a session and rejects a bogus token', async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  await page.goto('/track/this-token-does-not-exist');
  await expect(page.getByRole('heading', { name: 'BongoFleet vehicle tracking' })).toBeVisible();
  await expect(
    page.getByText('This tracking link is invalid, expired, or has been revoked.'),
  ).toBeVisible();

  await context.close();
});
