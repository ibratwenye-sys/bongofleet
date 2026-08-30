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
 * Stage UI4a - the More sheet (Admin group + account/theme/logout), the
 * phone-width replacement for that same content in Sidebar.tsx's footer.
 * Reuses the old drawer's open/close contract (backdrop, Escape,
 * close-on-navigate), so this covers the same ground the drawer tests used
 * to, just against the new trigger and content.
 */
test.describe('the More sheet', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('opens on tap, holds the Admin links and account controls, and closes on backdrop click', async ({
    page,
  }) => {
    await page.goto('/');
    const moreTab = page.getByRole('navigation', { name: 'Tab bar' }).getByRole('button', {
      name: 'More',
    });

    await moreTab.click();
    const sheet = page.getByRole('dialog', { name: 'More' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Billing' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Dark theme' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Logout' })).toBeVisible();

    await page.getByRole('button', { name: 'Close more menu' }).click();
    await expect(sheet).not.toBeVisible();
  });

  test('closes on Escape', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'Tab bar' })
      .getByRole('button', { name: 'More' })
      .click();
    const sheet = page.getByRole('dialog', { name: 'More' });
    await expect(sheet).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(sheet).not.toBeVisible();
  });

  test('a link inside navigates and closes the sheet', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'Tab bar' })
      .getByRole('button', { name: 'More' })
      .click();
    const sheet = page.getByRole('dialog', { name: 'More' });

    await sheet.getByRole('link', { name: 'Billing' }).click();
    await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible();
    await expect(sheet).not.toBeVisible();
  });
});

/**
 * Stage H0e - the reading screens on a handset. Scope is deliberately narrow:
 * these cover what actually gets checked away from a desk (who is behind, who
 * paid, a driver's ledger), not the long forms, which stay desktop-first.
 *
 * Stage UI1 - the two viewports used to both sit below the old xl breakpoint
 * (both got the drawer); AppShell.tsx's sidebar/drawer split moved to md
 * (768px) with the new sidebar chassis, so 390 (phone) still gets the
 * drawer but 820 (tablet) now shows the persistent 236px sidebar directly -
 * see the nav test below, which branches on that. 390 additionally gets the
 * card lists in place of the wide tables, and 820 keeps the tables - that
 * difference is still the point of running the same assertions at two sizes.
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

    test('the Operations Center shows its key figures without scrolling sideways', async ({
      page,
    }) => {
      await page.goto('/');
      // Stage UI1 - DashboardPage.tsx's four client-computed tiles were
      // replaced by six real, server-computed KPIs (dashboard.service.ts) -
      // these two are the ones every seeded tenant will show regardless of
      // today's activity (a fleet always has a size; a plan count is
      // always >= 0), so they're the stable ones to assert on here.
      await expect(page.getByText('On the road')).toBeVisible();
      await expect(page.getByText('Ownership plans')).toBeVisible();
      await expectNoSidewaysScroll(page);

      // Stage UI4b - card list (phone) vs table (md+) for the "Today's
      // outstanding assignments" card, folded into this same boot rather
      // than its own test/goto() for the same REFRESH_THROTTLE reason the
      // theming block below already documents. The empty-state message
      // ("Every assignment due today has been paid in full.") renders
      // identically at every width and has neither presentation in the
      // DOM, so only assert the split when there's at least one row.
      {
        const outstandingCard = page.locator('div.rounded-lg', {
          has: page.getByRole('heading', { name: "Today's outstanding assignments" }),
        });
        await expect(outstandingCard).toBeVisible();
        const table = outstandingCard.locator('table');
        const cardList = outstandingCard.locator('.md\\:hidden');
        const rowCount = await table.locator('tbody tr').count();
        if (rowCount > 0) {
          if (vp.width < 768) {
            await expect(table).toBeHidden();
            await expect(cardList).toBeVisible();
          } else {
            await expect(table).toBeVisible();
            await expect(cardList).toBeHidden();
          }
        }
      }

      // Stage UI1 - theme toggle + chassis-consistency, folded into this
      // existing boot rather than a separate spec file's own goto(): this
      // suite's REFRESH_THROTTLE budget (20/minute, shared by every real
      // page boot in the run) was already landing exactly on the ceiling
      // before this stage (see tracking-map.spec.ts's own top comment) -
      // a standalone theming.spec.ts with even one extra goto() made the
      // always-last-to-run tracking-map.spec.ts fail on a throttled
      // refresh, measured directly. Gated to the tablet run only (one pass
      // is enough - this isn't viewport-dependent behaviour), so the
      // phone run of this same test stays exactly as cheap as before.
      if (vp.label === 'tablet') {
        // Force a known starting state rather than assuming it: this
        // suite reuses one seeded account across runs (AUTH_STATE_FILE),
        // so a previous failed run could have left it on light.
        await page.getByRole('button', { name: 'Dark theme' }).click();
        await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'light');

        const navLinksOnOps = await page.locator('[aria-label="Main"] a').allTextContents();
        // The sidebar's own bg-side background lives on Sidebar.tsx's root
        // div, not the <nav> landmark - .bg-side is the reliable target
        // for both the width measurement and the colour checks below.
        const sidebarWidthOnOps = await page
          .locator('.bg-side')
          .first()
          .evaluate((el) => el.getBoundingClientRect().width);
        const mainOffsetOnOps = await page
          .getByRole('heading', { name: 'Operations Center' })
          .evaluate((el) => el.getBoundingClientRect().left);
        const sidebarBgDark = await page
          .locator('.bg-side')
          .first()
          .evaluate((el) => getComputedStyle(el).backgroundColor);
        const kpiTextDark = await page
          .locator('text=On the road')
          .first()
          .evaluate((el) => getComputedStyle(el).color);

        // "Light theme" is the toggle's accessible name regardless of
        // which state is current (ThemeToggle.tsx).
        await page.getByRole('button', { name: 'Light theme' }).click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
        const sidebarBgLight = await page
          .locator('.bg-side')
          .first()
          .evaluate((el) => getComputedStyle(el).backgroundColor);
        const kpiTextLight = await page
          .locator('text=On the road')
          .first()
          .evaluate((el) => getComputedStyle(el).color);
        expect(sidebarBgLight, 'sidebar background should repaint on toggle').not.toBe(
          sidebarBgDark,
        );
        expect(kpiTextLight, 'KPI label colour should repaint on toggle').not.toBe(kpiTextDark);

        // Client-side nav (no page boot, no refresh spent) to a page that
        // has not rendered a single pixel yet this session - proves the
        // CSS variable cascade applies to freshly-mounted content, not
        // just what was already painted when the toggle fired. Also the
        // chassis-consistency comparison page.
        await page.getByRole('link', { name: 'Live Map' }).click();
        await expect(page.getByRole('heading', { name: 'Live map' })).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
        const freshPageSidebarBg = await page
          .locator('.bg-side')
          .first()
          .evaluate((el) => getComputedStyle(el).backgroundColor);
        expect(freshPageSidebarBg).toBe(sidebarBgLight);

        const navLinksOnMap = await page.locator('[aria-label="Main"] a').allTextContents();
        const sidebarWidthOnMap = await page
          .locator('.bg-side')
          .first()
          .evaluate((el) => el.getBoundingClientRect().width);
        const mainOffsetOnMap = await page
          .getByRole('heading', { name: 'Live map' })
          .evaluate((el) => el.getBoundingClientRect().left);

        // Same nav config (nav-config.ts), same component (Sidebar.tsx),
        // rendered once by AppShell.tsx - not two different sidebars that
        // happen to look similar.
        expect(navLinksOnMap).toEqual(navLinksOnOps);
        expect(sidebarWidthOnMap).toBe(sidebarWidthOnOps);
        // Both page titles start at the identical x-offset - proof the
        // two pages share one grid/content-area definition
        // (PageChassis.tsx), not two independently-tuned layouts that
        // happen to line up by luck.
        expect(mainOffsetOnMap).toBe(mainOffsetOnOps);
        await expect(page.locator('text=/LIVE ·/').first()).toBeVisible();

        // Leave the seeded demo account back on the default for every
        // other spec in this suite that boots against it.
        await page.getByRole('button', { name: 'Dark theme' }).click();
        await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'light');
      }

      // Stage UI4b - the Fleet page's own card-vs-table split, reached by
      // client-side nav (no page boot, no refresh spent - same reasoning as
      // the Live Map hop above) rather than its own test/goto(). Works from
      // wherever the test above left off: '/' on the phone run, Live Map on
      // the tablet run - Fleet is reachable from both the tab bar and the
      // persistent sidebar.
      if (vp.width < 768) {
        await page
          .getByRole('navigation', { name: 'Tab bar' })
          .getByRole('link', { name: /^Fleet/ })
          .click();
      } else {
        await page.getByRole('link', { name: 'Fleet', exact: true }).click();
      }
      await expect(page.getByRole('heading', { name: 'Fleet', exact: true })).toBeVisible();

      const vehiclesCard = page.locator('div.rounded-lg', {
        has: page.getByRole('heading', { name: 'All vehicles' }),
      });
      const table = vehiclesCard.locator('table');
      const cardList = vehiclesCard.locator('.md\\:hidden');

      // DEMO-OWN-A is a seeded demo vehicle (prisma/seed.ts) - stable across
      // runs, unlike this suite's own generated data.
      const knownVehicle = cardList.getByText('DEMO-OWN-A').or(table.getByText('DEMO-OWN-A'));
      await expect(knownVehicle.filter({ visible: true }).first()).toBeVisible({
        timeout: 15_000,
      });

      if (vp.width < 768) {
        await expect(table).toBeHidden();
        await expect(cardList).toBeVisible();
      } else {
        await expect(table).toBeVisible();
        await expect(cardList).toBeHidden();
      }
      await expectNoSidewaysScroll(page);

      // Stage UI4c - continue via client-side nav from Fleet to Drivers
      // (same no-goto() reasoning as the Fleet hop above): the Fleet tab's
      // own MobileSubNav pill on phone, the persistent sidebar's Drivers
      // link at tablet width.
      if (vp.width < 768) {
        await page
          .getByRole('navigation', { name: 'Fleet sections' })
          .getByRole('link', { name: 'Drivers' })
          .click();
      } else {
        await page.getByRole('link', { name: 'Drivers', exact: true }).click();
      }
      await expect(page.getByRole('heading', { name: 'Drivers', exact: true })).toBeVisible();

      // Amina Hassan is a seeded demo driver (prisma/seed.ts) with
      // assignment history, so she appears in both the scored "Driver
      // performance" table below and "Manage drivers" further down -
      // stable across runs, unlike this suite's own generated data.
      const performanceCard = page.locator('div.rounded-lg', {
        has: page.getByRole('heading', { name: 'Driver performance' }),
      });
      const perfTable = performanceCard.locator('table');
      const perfCardList = performanceCard.locator('.md\\:hidden');
      const knownDriverInPerf = perfCardList
        .getByText('Amina Hassan')
        .or(perfTable.getByText('Amina Hassan'));
      await expect(knownDriverInPerf.filter({ visible: true }).first()).toBeVisible({
        timeout: 15_000,
      });
      if (vp.width < 768) {
        await expect(perfTable).toBeHidden();
        await expect(perfCardList).toBeVisible();
      } else {
        await expect(perfTable).toBeVisible();
        await expect(perfCardList).toBeHidden();
      }

      const manageCard = page.locator('div.rounded-lg', {
        has: page.getByRole('heading', { name: 'Manage drivers' }),
      });
      const manageTable = manageCard.locator('table');
      const manageCardList = manageCard.locator('.md\\:hidden');
      const knownDriverInManage = manageCardList
        .getByText('Amina Hassan')
        .or(manageTable.getByText('Amina Hassan'));
      await expect(knownDriverInManage.filter({ visible: true }).first()).toBeVisible({
        timeout: 15_000,
      });
      if (vp.width < 768) {
        await expect(manageTable).toBeHidden();
        await expect(manageCardList).toBeVisible();
      } else {
        await expect(manageTable).toBeVisible();
        await expect(manageCardList).toBeHidden();
      }

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

    if (vp.width < 768) {
      test('the bottom tab bar reaches another page and highlights the active tab', async ({
        page,
      }) => {
        await page.goto('/');

        // Below md, the sidebar's links are not directly reachable - only
        // through a tab (Home/Fleet/Money) or the More sheet.
        await expect(page.getByRole('link', { name: 'Payments' })).toBeHidden();

        const tabBar = page.getByRole('navigation', { name: 'Tab bar' });
        await expect(tabBar).toBeVisible();
        const homeTab = tabBar.getByRole('link', { name: /^Home/ });
        const moneyTab = tabBar.getByRole('link', { name: /^Money/ });
        const moreTab = tabBar.getByRole('button', { name: 'More' });

        // Thumb-sized, not cursor-sized - every tab, not just one.
        for (const tab of [homeTab, moneyTab, moreTab]) {
          const box = await tab.boundingBox();
          expect(box, 'tab should be laid out').not.toBeNull();
          expect(box!.height).toBeGreaterThanOrEqual(44);
        }

        // Home ('/') is the landing route, so it starts active.
        await expect(homeTab).toHaveClass(/bg-panel-2/);
        await expect(moneyTab).not.toHaveClass(/bg-panel-2/);

        await moneyTab.click();
        // exact: true - Stage UI3's PaymentsPage also has an "All payments"
        // card heading, which a loose match cross-matches under strict mode.
        await expect(page.getByRole('heading', { name: 'Payments', exact: true })).toBeVisible();
        await expect(moneyTab).toHaveClass(/bg-panel-2/);
        await expect(homeTab).not.toHaveClass(/bg-panel-2/);

        // Money has more than one destination, so its pill row appears once
        // Money is the active tab.
        const subNav = page.getByRole('navigation', { name: 'Money sections' });
        await expect(subNav).toBeVisible();
        const ownershipPill = subNav.getByRole('link', { name: 'Ownership' });
        await ownershipPill.click();
        await expect(page.getByRole('heading', { name: 'Ownership plans' })).toBeVisible();

        await expectNoSidewaysScroll(page);
      });
    } else {
      test('the sidebar is persistent (no tab bar needed) and reaches another page', async ({
        page,
      }) => {
        await page.goto('/');

        // Stage UI1 - >= md (768px), the 236px sidebar shows directly; a
        // tablet has no reason to hide it behind a menu the way the old
        // 13-item flat row did at this width. Stage UI4a's tab bar is
        // md:hidden, so it must not render here either.
        await expect(page.getByRole('navigation', { name: 'Tab bar' })).toBeHidden();
        const paymentsLink = page.getByRole('link', { name: 'Payments' });
        await expect(paymentsLink).toBeVisible();

        await paymentsLink.click();
        // exact: true - Stage UI3's PaymentsPage also has an "All payments"
        // card heading, which a loose match cross-matches under strict mode.
        await expect(page.getByRole('heading', { name: 'Payments', exact: true })).toBeVisible();
        // Still visible after navigating - there is no drawer to close.
        await expect(paymentsLink).toBeVisible();
        await expectNoSidewaysScroll(page);
      });
    }

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
      // 'Add driver' is a page action, not a nav item - reachable directly,
      // with no menu or sheet in the way.
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
