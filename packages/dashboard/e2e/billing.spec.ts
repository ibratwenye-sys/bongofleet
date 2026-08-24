import { test, expect } from '@playwright/test';
import { AUTH_STATE_FILE } from './auth-state';

/**
 * Stage SUB1 - the Billing page is the first Settings-area page in the
 * dashboard. Same session-chaining convention as smoke.spec.ts: every test
 * starts already signed in as the seeded demo owner, and hands the rotated
 * refresh token to the next test via afterEach.
 */
test.afterEach(async ({ page }) => {
  await page.context().storageState({ path: AUTH_STATE_FILE });
});

test('Billing page loads, shows the seeded rate, and never implies a charge is coming', async ({
  page,
}) => {
  await page.goto('/settings/billing');
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

test('Billing is reachable from the nav for the OWNER demo account', async ({ page }) => {
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'Open menu' });
  if (await menu.isVisible()) {
    await menu.click();
  }
  await page.getByRole('link', { name: 'Billing' }).click();
  await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible();
});
