import { type Page } from '@playwright/test';
import { test, expect, newChat } from './helpers/app';
import { openCodeFolder, openAddCodeFolders, openCloneFromGitHub } from './helpers/navigation';

/** Opens the sidebar when it is closed. Below 900px wide, the sidebar starts closed. */
async function openSidebar(page: Page) {
  const toggle = page.getByRole('button', { name: 'Toggle sidebar', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', /true|false/);
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

test('repository dialog contains long names, scrolls results, and keeps actions visible on compact windows', async ({
  page,
}) => {
  await page.setViewportSize({ width: 980, height: 680 });
  await page.addInitScript(() => {
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [],
        sessions: [],
        groups: [
          {
            id: 'g',
            name: 'Customer platform and shared infrastructure across multiple repositories',
            repoIds: [],
          },
        ],
        warnings: [],
        platform: 'darwin',
      }),
      githubAuthStart: async () => ({ status: 'ready' }),
      githubCliCheck: async () => ({ status: 'ready' }),
      githubAuthCancel: async () => ({}),
      githubOwners: async () => [],
      githubRepositories: async () =>
        Array.from({ length: 40 }, (_, i) => ({
          nameWithOwner:
            'example-organization/shared-infrastructure-and-customer-platform-repository-' + i,
          description:
            'A repository with a longer description to check wrapping and alignment next to visibility badges.',
          isPrivate: true,
          isArchived: false,
        })),
    };
  });
  await page.goto('/');
  await openSidebar(page);
  const name = 'Customer platform and shared infrastructure across multiple repositories';
  await openCloneFromGitHub(page, name);
  const dialog = page.getByRole('dialog', { name: 'Clone from GitHub', exact: true });
  // The dialog knows the project. Its description wraps the long project name.
  await expect(dialog.locator('[data-slot="dialog-description"]')).toHaveText(name);
  const last = dialog.getByRole('radio', { name: /repository-39/ });
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(dialog.getByRole('button', { name: 'Clone', exact: true })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/repository-dialog-spacing.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  // This build has no native folder picker, so "Add code folder…" opens the dialog. Its action
  // stays visible too.
  await openAddCodeFolders(page, name);
  const add = page.getByRole('dialog', { name: 'Add code folder', exact: true });
  await expect(add.getByRole('button', { name: 'Choose folder…', exact: true })).toBeInViewport();
});

test('notifications and a long draft do not push the composer outside the window', async ({
  page,
}) => {
  await page.setViewportSize({ width: 980, height: 680 });
  await page.goto('/');
  await openSidebar(page);
  await openCodeFolder(page, 'atlas-web');
  // Edit code folder is in the right-click menu of the repo row.
  await page
    .locator('.tree-row[data-kind="repo"]')
    .filter({ has: page.locator('.tree-label', { hasText: /^atlas-web$/ }) })
    .locator('.tree-row-button')
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit code folder…', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Code folder updated.' })).toBeVisible();
  await newChat(page);
  await page
    .getByLabel('Message agent')
    .fill('Review the repository and explain the next steps.\n'.repeat(20));
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeInViewport({
    ratio: 1,
  });
  // The composer stays inside the chat column.
  expect(
    await page
      .getByLabel('Message agent')
      .evaluate(
        (el) =>
          el.closest('.conversation-composer')!.getBoundingClientRect().bottom <=
          el.closest('.conversation-panel')!.getBoundingClientRect().bottom + 1,
      ),
  ).toBe(true);
  expect(
    await page
      .getByRole('region', { name: 'Chats', exact: true })
      .evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/compact-composer-spacing.png', fullPage: true });
});

test('the title bar keeps one row at the minimum window width with tools open', async ({
  page,
}) => {
  await page.setViewportSize({ width: 980, height: 680 });
  await page.goto('/');
  await openSidebar(page);
  await openCodeFolder(page);
  await newChat(page);
  await page.getByLabel('Message agent').blur();
  // The header has one Tools button. ⌘T opens the Terminal tab of the tool pane.
  await page.keyboard.press('ControlOrMeta+t');
  await expect(
    page
      .getByRole('tablist', { name: 'Tools', exact: true })
      .getByRole('tab', { name: 'Terminal', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(
    page
      .getByRole('group', { name: 'Tools', exact: true })
      .getByRole('button', { name: 'Tools', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  const header = await page.locator('.conversation-header').boundingBox();
  expect(header?.height).toBeLessThanOrEqual(48);
  for (const id of [
    'conversation-titlebar-heading',
    'conversation-titlebar-tabs',
    'conversation-titlebar-actions',
  ]) {
    const box = await page.locator('#' + id).boundingBox();
    expect(box && box.y + box.height).toBeLessThanOrEqual(48);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(980);
});
