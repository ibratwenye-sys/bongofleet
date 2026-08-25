import { test, expect } from '@playwright/test';
import { AUTH_STATE_FILE } from './auth-state';

/**
 * Stage SUB1 - the Billing page is the first Settings-area page in the
 * dashboard. Same session-chaining convention as smoke.spec.ts: every test
 * starts already signed in as the seeded demo owner, and hands the rotated
 * refresh token to the next test via afterEach.
 *
 * Deliberately ONE test, not two - Stage I3 folded these together once the
 * combined suite's REFRESH_THROTTLE budget (20/minute, shared by every real
 * page boot across the whole run) started landing exactly on the ceiling
 * with the map specs' own boots added; one fewer boot here restores margin.
 * Same reasoning as tracking-links.spec.ts's and tracking-map.spec.ts's own
 * consolidations - see tracking-map.spec.ts's top comment for the measured
 * evidence (a `throttle:...:refresh:blocked` Redis key).
 */
test.afterEach(async ({ page }) => {
  await page.context().storageState({ path: AUTH_STATE_FILE });
});

test('Billing page loads from the nav, shows the seeded rate, and never implies a charge is coming', async ({
  page,
}) => {
  await page.goto('/');

  // Stage I2 - AppShell.tsx's desktop/drawer breakpoint moved to 2xl
  // (1536px), so this test's default 1280px viewport is drawer-only now;
  // an unconditional wait-then-click on the menu button, same pattern
  // smoke.spec.ts's own responsive tests use, rather than a one-shot
  // `isVisible()` racing React's hydration (that used to work only because
  // the desktop nav was ALSO reachable at this viewport before the
  // breakpoint moved - the fallback papered over the race, it didn't fix it).
  const menu = page.getByRole('button', { name: 'Open menu' });
  await expect(menu).toBeVisible();
  await menu.click();
  await page.getByRole('link', { name: 'Billing' }).click();
  await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible();

  await expect(page.getByText('Active bikes')).toBeVisible();
  await expect(page.getByText('Price per bike / month')).toBeVisible();
  await expect(page.getByText('Estimated monthly total')).toBeVisible();

  // Stage SUB1 migration seeds exactly one tier at TZS 10,000/bike/month -
  // formatTZS renders it with zero decimal places and a currency symbol.
  await expect(page.getByText(/TZS.*10,000/)).toBeVisible();

  // The honest disclosure line - must always be present, regardless of
  // status/trial state (see BillingPage.tsx's StatusBanner comment).
  await expect(page.getByText(/Payment collection isn't connected yet/)).toBeVisible();
});
