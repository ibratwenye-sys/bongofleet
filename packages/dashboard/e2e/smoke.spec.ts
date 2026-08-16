import { test, expect } from '@playwright/test';
import { AUTH_STATE_FILE } from './auth-state';

/**
 * Stage H2 - the smallest set of tests that would have caught Stage G8's
 * create-plan toggle freeze, Stage G9's dev-cache infinite loop, and Stage
 * H1's End/Days left columns reading blank for every plan - all three
 * shipped on a green build because nothing here opened the real app in a
 * real browser. These run against `vite build` + `vite preview` (see
 * playwright.config.ts), never the dev server.
 *
 * Stage H0d - every test here starts already signed in, from the session
 * saved by e2e/auth.setup.ts. They used to log in individually, which the
 * backend's five-logins-per-email-per-minute limit started rejecting once
 * the suite grew past five tests; see that file for the full reasoning.
 */

// Refresh tokens are single-use and rotate: /auth/refresh deletes the stored
// hash and issues a new pair, so a replayed one is rejected outright ("invalid
// or already used" - auth.service.ts). Each test therefore *consumes* the
// saved token when the dashboard boots and is handed a fresh one, which lives
// only in that test's own context. Writing the rotated state back here passes
// it along to the next test; without this, every test after the first
// presents a spent token and lands back on the login page.
//
// This is a deliberate security property, not an obstacle to route around -
// rotation is what makes a stolen refresh token detectable - so the suite
// chains rather than the limit being loosened.
test.afterEach(async ({ page }) => {
  await page.context().storageState({ path: AUTH_STATE_FILE });
});

test('Ownership page loads and lists plans', async ({ page }) => {
  await page.goto('/ownership');
  await expect(page.getByRole('heading', { name: 'Ownership plans' })).toBeVisible();
  // Scoped to the table's own loading cell. Stage H0e added a card list for
  // narrow screens which carries its own "Loading…", and both presentations
  // stay in the DOM at every width (one is merely CSS-hidden), so a bare
  // getByText matches two elements under strict mode.
  await expect(page.getByRole('cell', { name: 'Loading…' })).not.toBeVisible({ timeout: 15_000 });

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

/**
 * Stage H0d - the create-driver form (the tallest in the app) could not be
 * escaped on a laptop: its buttons fell below the fold, the header's ✕ was
 * pushed above the top, and nothing scrolled it back - the modal sits in a
 * `position: fixed` overlay, so a scroll gesture moved the page behind while
 * the modal stayed put. Reloading was the only way out, discarding whatever
 * had been typed.
 *
 * The viewport height below is the whole point of this block, so do not
 * "tidy" it to a round 1280x720. A 1280x720 laptop *screen* gives a ~551px
 * viewport once Chrome's own toolbars are subtracted; a literal 720px
 * viewport is a window nobody on that laptop has. The unfixed form needed
 * 715px, so at 720 it fit with five pixels to spare and this test would have
 * passed while the bug shipped - measured, not assumed. 600px keeps a
 * margin over the real ~551 while still being a height the trap reproduces
 * at.
 */
test.describe('modals stay escapable at laptop height', () => {
  test.use({ viewport: { width: 1280, height: 600 } });

  test('the create-driver form can be cancelled without scrolling the page', async ({ page }) => {
    await page.goto('/drivers');
    await page.getByRole('button', { name: 'Add driver' }).click();

    const heading = page.getByRole('heading', { name: 'Add driver' });
    await expect(heading).toBeVisible();
    // The ✕ is pinned in a non-scrolling header, so it is the one way out
    // guaranteed at any content height - it used to be off the top edge.
    // ratio: 1 (fully inside), not the default - the default passes on a
    // single visible pixel, and the unfixed header was clipped rather than
    // fully absent, so it slipped through without this.
    await expect(page.getByRole('button', { name: 'Close' })).toBeInViewport({ ratio: 1 });

    const pageScrollBefore = await page.evaluate(() => window.scrollY);

    // Brings Cancel into view by scrolling the modal's own body. On the
    // unfixed component this could not succeed: the panel overflows a fixed
    // overlay, so no ancestor scroll moves it, and the click below then
    // fails its actionability check instead of passing silently.
    const cancel = page.getByRole('button', { name: 'Cancel' });
    await cancel.scrollIntoViewIfNeeded();
    await expect(cancel).toBeInViewport({ ratio: 1 });

    // Reaching Cancel must not have moved the page underneath.
    expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollBefore);

    // click() enforces visible + stable + receives-events, so this is the
    // "and clickable" half of the assertion, not just "is on screen".
    await cancel.click();
    await expect(heading).not.toBeVisible();
  });

  test('Escape closes the create-driver form as a second way out', async ({ page }) => {
    await page.goto('/drivers');
    await page.getByRole('button', { name: 'Add driver' }).click();

    const heading = page.getByRole('heading', { name: 'Add driver' });
    await expect(heading).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(heading).not.toBeVisible();

    // The scroll lock must be released on the way out, or every page behind
    // stays frozen for the rest of the session.
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  });
});

/**
 * Stage H0e - the reading screens on a handset. Scope is deliberately narrow:
 * these cover what actually gets checked away from a desk (who is behind, who
 * paid, a driver's ledger), not the long forms, which stay desktop-first.
 *
 * Both viewports are below the xl breakpoint where the nav row fits, so both
 * get the drawer; 390 additionally gets the card lists in place of the wide
 * tables, and 820 keeps the tables. That difference is the point of running
 * the same assertions at two sizes rather than one.
 */
const READING_VIEWPORTS = [
  { label: 'phone', width: 390, height: 844 },
  { label: 'tablet', width: 820, height: 1180 },
];

// The whole complaint in one assertion. Every page measured 1272px wide
// against a 390px viewport before this stage, so the document - not merely a
// table inside it - scrolled sideways. A tolerance of 1px absorbs subpixel
// rounding without letting a real overflow through.
async function expectNoSidewaysScroll(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, 'document should not scroll sideways').toBeLessThanOrEqual(1);
}

for (const vp of READING_VIEWPORTS) {
  test.describe(`reading screens at ${vp.label} (${vp.width}x${vp.height})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('the dashboard shows its key figures without scrolling sideways', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByText("Today's revenue")).toBeVisible();
      await expect(page.getByText('Fleet size')).toBeVisible();
      await expectNoSidewaysScroll(page);
    });

    test('the Ownership list is readable without scrolling sideways', async ({ page }) => {
      await page.goto('/ownership');
      await expect(page.getByRole('heading', { name: 'Ownership plans' })).toBeVisible();

      // Both presentations (cards below md, table at and above it) are always
      // in the DOM, so everything here filters to the visible one rather than
      // taking .first() - at 820 the cards come first in document order and
      // are the hidden ones.
      await expect(page.getByText('Amina Hassan').filter({ visible: true }).first()).toBeVisible({
        timeout: 15_000,
      });
      await expectNoSidewaysScroll(page);
    });

    test('the nav collapses, opens, and reaches another page', async ({ page }) => {
      await page.goto('/');

      // The row is hidden below xl, so the links must not be reachable until
      // the menu is opened - otherwise "collapsed" is only a visual claim.
      await expect(page.getByRole('link', { name: 'Payments' })).toBeHidden();

      const menu = page.getByRole('button', { name: 'Open menu' });
      await expect(menu).toBeVisible();

      // Thumb-sized, not cursor-sized.
      const box = await menu.boundingBox();
      expect(box, 'menu button should be laid out').not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);

      await menu.click();
      const paymentsLink = page.getByRole('link', { name: 'Payments' });
      await expect(paymentsLink).toBeVisible();

      const linkBox = await paymentsLink.boundingBox();
      expect(linkBox!.height).toBeGreaterThanOrEqual(44);

      await paymentsLink.click();
      await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible();
      // Navigating must close the drawer, or the destination renders beneath it.
      await expect(paymentsLink).toBeHidden();
      await expectNoSidewaysScroll(page);
    });

    test('a plan detail and its ledger open', async ({ page }) => {
      await page.goto('/ownership');

      await page
        .getByRole('link', { name: /Amina Hassan/ })
        .filter({ visible: true })
        .first()
        .click();
      await expect(page.getByRole('heading', { name: 'Instalment ledger' })).toBeVisible();
      await expect(page.getByRole('cell', { name: 'Loading…' })).not.toBeVisible({
        timeout: 15_000,
      });
      await expectNoSidewaysScroll(page);
    });

    test('the create-driver form is still escapable at this width', async ({ page }) => {
      // Stage H0d fixed the modal trap at laptop height; Part 3 of this stage
      // is only to confirm it still holds on a phone, where the form is
      // taller relative to the window than anywhere it was tested before.
      await page.goto('/drivers');
      const openMenu = page.getByRole('button', { name: 'Open menu' });
      if (await openMenu.isVisible()) {
        // 'Add driver' is a page action, not a nav item - no menu needed, but
        // make sure an open drawer is not covering it.
        await expect(openMenu).toBeVisible();
      }
      await page.getByRole('button', { name: 'Add driver' }).click();

      const heading = page.getByRole('heading', { name: 'Add driver' });
      await expect(heading).toBeVisible();
      await expect(page.getByRole('button', { name: 'Close' })).toBeInViewport({ ratio: 1 });

      const cancel = page.getByRole('button', { name: 'Cancel' });
      await cancel.scrollIntoViewIfNeeded();
      await expect(cancel).toBeInViewport({ ratio: 1 });
      await cancel.click();
      await expect(heading).not.toBeVisible();
    });
  });
}
