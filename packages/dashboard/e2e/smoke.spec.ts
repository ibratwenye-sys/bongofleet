import { test, expect, type Page } from '@playwright/test';

/**
 * Stage H2 - the smallest set of tests that would have caught Stage G8's
 * create-plan toggle freeze, Stage G9's dev-cache infinite loop, and Stage
 * H1's End/Days left columns reading blank for every plan - all three
 * shipped on a green build because nothing here opened the real app in a
 * real browser. These run against `vite build` + `vite preview` (see
 * playwright.config.ts), never the dev server.
 *
 * Credentials are the seed script's own demo owner account
 * (packages/backend/prisma/seed.ts) - already printed in plain text in
 * VISUAL_CHECK.md, not a secret.
 */
const OWNER_EMAIL = 'owner@bongofleet.com';
const OWNER_PASSWORD = 'Test1234!';

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(OWNER_EMAIL);
  await page.getByLabel('Password').fill(OWNER_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/');
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('Ownership page loads and lists plans', async ({ page }) => {
  await page.goto('/ownership');
  await expect(page.getByRole('heading', { name: 'Ownership plans' })).toBeVisible();
  await expect(page.getByText('Loading…')).not.toBeVisible({ timeout: 15_000 });

  const firstRow = page.locator('table tbody tr').first();
  await expect(firstRow).toBeVisible();

  // Stage H1: every plan now derives an End date and a Days left count even
  // when contractEndDate was never typed in (true of every seeded demo
  // plan) - both used to read blank ("—" / nothing) for every row. "End" is
  // the 10th column, "Days left" the 11th (0-indexed 9 and 10) - see the
  // <th> order this reads against, just above in the same file.
  const cells = firstRow.locator('td');
  await expect(cells.nth(9)).toContainText('(derived)');
  await expect(cells.nth(10)).toHaveText(/^\d+$/);
});

test('Create plan: the days/total toggle switches both directions without freezing, and 12,000/day x 430 days shows 5,160,000', async ({
  page,
}) => {
  await page.goto('/ownership');
  await page.getByRole('button', { name: 'Create plan' }).click();
  await expect(page.getByRole('heading', { name: 'Create ownership plan' })).toBeVisible();

  const dailyAmount = page.locator('label:text-is("Daily amount (TZS)") + input');
  await dailyAmount.fill('12000');

  // days -> total -> days. Stage G9's freeze was a hard browser hang on
  // this exact sequence - if it regresses, these fills/assertions below
  // simply time out rather than reporting a clean failure, which is itself
  // the signal: a real freeze looks like a timeout here, same as it did to
  // a person.
  await page.getByRole('button', { name: 'Total (TZS)' }).click();
  await expect(page.locator('label:text-is("Total (TZS)") + input')).toBeVisible();

  await page.getByRole('button', { name: 'Number of days' }).click();
  const days = page.locator('label:text-is("Number of days") + input');
  await expect(days).toBeVisible();

  await days.fill('430');
  // Scoped to the confirmation sentence's exact combined text, not a bare
  // '5,160,000' - the Ownership table stays mounted (unstyled, just
  // visually covered) behind the modal and already has rows totalling that
  // same amount, so a bare getByText matches three elements under strict
  // mode. This also ties the days and total together in one assertion,
  // which is the actual claim being tested.
  await expect(page.getByText('430 payment days = TZS 5,160,000, exactly.')).toBeVisible();
});

test('Create plan: a non-dividing total offers two day-count options and one can be selected', async ({
  page,
}) => {
  await page.goto('/ownership');
  await page.getByRole('button', { name: 'Create plan' }).click();
  await expect(page.getByRole('heading', { name: 'Create ownership plan' })).toBeVisible();

  await page.locator('label:text-is("Daily amount (TZS)") + input').fill('12000');
  await page.getByRole('button', { name: 'Total (TZS)' }).click();
  await page.locator('label:text-is("Total (TZS)") + input').fill('5000000');

  // 5,000,000 / 12,000 = 416.67 - does not divide evenly by design (see
  // estimatePlanTerm, shared-lib), so both neighbouring whole-day options
  // must appear, never a rounded middle value.
  const option416 = page.getByRole('button', { name: /^416 days/ });
  const option417 = page.getByRole('button', { name: /^417 days/ });
  await expect(option416).toBeVisible();
  await expect(option417).toBeVisible();

  const contractEndDate = page.locator('label:text-is("Contract end date") + input');

  await option416.click();
  const endDateFor416 = await contractEndDate.inputValue();
  expect(endDateFor416).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  await option417.click();
  const endDateFor417 = await contractEndDate.inputValue();
  expect(endDateFor417).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  // Selecting the other option actually changed the derived state
  // downstream, not just a button's own highlight - a real behaviour check,
  // not a pixel one.
  expect(endDateFor417).not.toBe(endDateFor416);
});

test('a plan detail page opens and its ledger renders', async ({ page }) => {
  await page.goto('/ownership');
  await page.locator('table tbody tr').first().locator('a').first().click();
  await expect(page.getByRole('heading', { name: 'Instalment ledger' })).toBeVisible();
  // Role-scoped to the ledger table's own loading cell: the page's separate
  // Contract section has its own independent "Loading…" paragraph (a
  // different fetch, not a race - see OwnershipPlanDetailPage.tsx), which a
  // bare getByText also matches under strict mode. A table cell's implicit
  // ARIA role is 'cell'; a <p> has none, so this can't cross-match it.
  await expect(page.getByRole('cell', { name: 'Loading…' })).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('columnheader', { name: 'Owed' })).toBeVisible();
});

test('the excuse-a-day control is reachable and opens', async ({ page }) => {
  await page.goto('/ownership');
  await page.locator('table tbody tr').first().locator('a').first().click();
  await expect(page.getByRole('heading', { name: 'Instalment ledger' })).toBeVisible();

  await page.getByRole('button', { name: 'Excuse a day' }).click();
  await expect(page.getByRole('heading', { name: 'Excuse a day' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Excuse day' })).toBeVisible();
});
