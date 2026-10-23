import { type Page } from '@playwright/test';
import { test, expect } from './helpers/app';
import { openProjectTab } from './helpers/navigation';

const sidebar = (page: Page) => page.locator('nav.library-panel');
const palette = (page: Page) => page.getByRole('dialog', { name: 'Search or run a command' });

/** Opens the command palette from the sidebar trigger and returns its field. */
async function openPalette(page: Page) {
  await page.getByRole('button', { name: 'Search or run a command', exact: true }).click();
  const input = page.getByRole('combobox', { name: 'Search or run a command' });
  await expect(input).toBeFocused();
  return input;
}

test('search finds project, session and message text and opens the conversation', async ({
  page,
}) => {
  await page.goto('/');
  const input = await openPalette(page);
  const results = page.getByRole('region', { name: 'Search results' });
  await input.fill('Atlas');
  await expect(results.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  await expect(results.getByRole('option', { name: 'Atlas', exact: true })).toBeVisible();
  await input.fill('authentication');
  await expect(results.getByRole('heading', { name: 'Chats', exact: true })).toBeVisible();
  await input.fill('original messages');
  // A message match shows its excerpt in the session row.
  await expect(results.getByRole('heading', { name: 'Chats', exact: true })).toBeVisible();
  await expect(results.locator('.history-search-hit')).toHaveCount(2);
  await results.locator('.history-search-hit').first().click();
  await expect(palette(page)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Chat', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(
    'Refine project',
  );
  await openPalette(page);
  await input.fill('zzzz-no-result');
  await expect(results.getByText('No matches found.')).toBeVisible();
});

test('the palette is a centered modal dialog and the sidebar keeps its navigation', async ({
  page,
}) => {
  await page.goto('/');
  await expect(sidebar(page).locator('.project-tree')).toBeVisible();
  const input = await openPalette(page);
  const dialog = palette(page);
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(input).toHaveAttribute('role', 'combobox');
  await expect(dialog.getByRole('listbox', { name: 'Recent and actions' })).toBeVisible();
  // The palette shows over the window, not in the sidebar.
  const box = (await dialog.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2);
  expect(box.width).toBeGreaterThan(560);
  expect(box.width).toBeLessThanOrEqual(640);
  expect(box.height).toBeLessThanOrEqual(viewport.height * 0.6 + 1);
  // The sidebar keeps the project tree under the palette.
  await input.fill('Atlas');
  await expect(sidebar(page).locator('.project-tree')).toBeVisible();
  await expect(sidebar(page).locator('.project-tree')).toContainText('Atlas');
  // Each result has one line.
  const option = dialog.getByRole('option').first();
  const height = (await option.boundingBox())!.height;
  // A result row is 36px high.
  expect(height).toBeLessThanOrEqual(36);
  await page.screenshot({ path: 'test-results/command-palette.png', animations: 'disabled' });
});

test('Mod+K opens the palette, Escape closes it and returns the focus', async ({ page }) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Search or run a command', exact: true });
  await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
  await trigger.focus();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('combobox', { name: 'Search or run a command' })).toBeFocused();
  // The dialog hides the rest of the window from assistive technology while it is open.
  await expect(page.locator('.search-trigger')).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(palette(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();
  // Mod+K again closes the open palette.
  await page.keyboard.press('ControlOrMeta+k');
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(palette(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();
  // A click outside the palette closes it. The dialog starts to listen for outside clicks in a
  // timer after it opens. A timer that starts later runs after it.
  await openPalette(page);
  // The dialog listens for outside clicks a moment after it opens. Click an empty area: the
  // sidebar Settings button sits at the bottom left.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  const { width, height } = page.viewportSize()!;
  await page.mouse.click(width - 10, height - 10);
  await expect(palette(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('the palette keeps the focus in the dialog', async ({ page }) => {
  await page.goto('/');
  const input = await openPalette(page);
  await input.fill('Atlas');
  const clear = page.getByRole('button', { name: 'Clear search', exact: true });
  await page.keyboard.press('Tab');
  await expect(clear).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(input).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(clear).toBeFocused();
});

test('search results support arrow keys, Enter, and Escape', async ({ page }) => {
  await page.goto('/');
  const input = await openPalette(page);
  const results = page.getByRole('region', { name: 'Search results' });
  await input.fill('Atlas');
  await expect(results.getByRole('option').first()).toBeVisible();
  await input.press('ArrowDown');
  const first = await input.getAttribute('aria-activedescendant');
  expect(first).toBeTruthy();
  await expect(page.locator(`[id="${first}"]`)).toHaveAttribute('aria-selected', 'true');
  await input.press('ArrowDown');
  const second = await input.getAttribute('aria-activedescendant');
  expect(second).not.toBe(first);
  await input.press('ArrowUp');
  await expect(input).toHaveAttribute('aria-activedescendant', first!);
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await input.press('Escape');
  await expect(palette(page)).toHaveCount(0);
  // The palette starts with an empty query each time.
  await openPalette(page);
  await expect(input).toHaveValue('');
  await input.fill('Atlas');
  // Chats come first. Enter opens the first result, a chat of the Atlas project.
  await expect(results.getByRole('option').first()).toHaveAccessibleName(
    'Refine project and repository navigation',
  );
  await input.press('Enter');
  await expect(palette(page)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Chat', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(
    'Refine project',
  );
});

test('an empty query shows Recent and Actions with arrow keys', async ({ page }) => {
  await page.goto('/');
  const input = await openPalette(page);
  const start = page.getByRole('listbox', { name: 'Recent and actions' });
  await expect(start.getByRole('heading', { name: 'Recent', exact: true })).toBeVisible();
  await expect(start.getByRole('heading', { name: 'Actions', exact: true })).toBeVisible();
  await input.press('ArrowDown');
  const active = await input.getAttribute('aria-activedescendant');
  expect(active).toBeTruthy();
  await expect(start.locator(`[id="${active}"]`)).toHaveAttribute('aria-selected', 'true');
});

test('search discards stale results and reports inaccessible or truncated transcripts', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [],
        groups: [],
        sessions: [
          { id: 'one', agent: 'codex', title: 'Long chat', cwd: '/work', updatedAt: '' },
          { id: 'two', agent: 'claude', title: 'Unavailable chat', cwd: '/work', updatedAt: '' },
        ],
        warnings: [],
        platform: 'darwin',
      }),
      transcript: async (_agent: string, id: string) => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        if (id === 'two') throw Error('Host unavailable');
        return {
          messages: [{ id: 'm', role: 'assistant', text: 'needle in history' }],
          truncated: true,
        };
      },
    };
  });
  await page.goto('/');
  // The workspace shows after the first-run check. Then Mod+K opens the palette.
  await expect(page.getByRole('button', { name: 'Search or run a command' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  const input = page.getByRole('combobox', { name: 'Search or run a command' });
  await input.fill('needle');
  await page.waitForTimeout(350);
  await input.fill('other');
  await expect(
    page.getByRole('region', { name: 'Search results' }).getByRole('alert'),
  ).toContainText('could not be searched');
  await expect(
    page.getByRole('region', { name: 'Search results' }).getByText(/most recent messages/),
  ).toHaveAttribute('role', 'status');
  await expect(page.locator('.history-search-hit')).toHaveCount(0);
});

test('a one-character query shows only the two-character hint', async ({ page }) => {
  await page.goto('/');
  const input = await openPalette(page);
  const results = page.getByRole('region', { name: 'Search results' });
  await input.fill('¤');
  await expect(results.getByRole('status').first()).toHaveText(
    'Type at least two characters to search message text.',
  );
  await expect(results.getByText('No matches found.')).toHaveCount(0);
  await expect(results.getByText(/0 matches/)).toHaveCount(0);
});

test('the palette has the Knowledge actions of the project in view', async ({ page }) => {
  await page.goto('/');
  await openProjectTab(page, 'Overview', 'Atlas');
  const input = await openPalette(page);
  const results = page.getByRole('region', { name: 'Search results' });
  await input.fill('Find in knowledge');
  const find = results.getByRole('option', { name: 'Find in knowledge', exact: true });
  await expect(find).toContainText(/⌘F|Ctrl\+F/);
  await find.click();
  await expect(page.getByRole('searchbox', { name: 'Find in knowledge' })).toBeFocused();
  // New page has ⌥⌘N. "Ask agent about this page" shows only while a page is open.
  await openPalette(page);
  await input.fill('New page');
  await expect(results.getByRole('option', { name: 'New page', exact: true })).toContainText(
    /⌥⌘N|Ctrl\+Alt\+N|Alt\+Ctrl\+N/,
  );
  await input.fill('Recently deleted');
  await results.getByRole('option', { name: 'Recently deleted…', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Recently deleted' })).toBeVisible();
});
