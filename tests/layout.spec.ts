import { type Page } from '@playwright/test';
import { test, expect, newChat } from './helpers/app';
import { openCodeFolder, openAddCodeFolders } from './helpers/navigation';

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
  await openAddCodeFolders(
    page,
    'Customer platform and shared infrastructure across multiple repositories',
  );
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Add to project' }).click();
  await page
    .getByRole('option', {
      name: 'Customer platform and shared infrastructure across multiple repositories',
    })
    .click();
  await dialog.getByRole('button', { name: 'Clone from GitHub', exact: true }).click();
  const last = dialog.getByRole('radio', { name: /repository-39/ });
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(
    dialog.getByRole('button', { name: 'Clone into project', exact: true }),
  ).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/repository-dialog-spacing.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Create a new project', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'New project', exact: true });
  await create.getByLabel('Project name', { exact: true }).fill('New project');
  await expect(create.getByRole('button', { name: 'Create project', exact: true })).toBeEnabled();
  await create.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Clone into project', exact: true }),
  ).toBeInViewport();
  await dialog.getByRole('button', { name: 'Local folder', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Choose folder', exact: true })).toBeInViewport();
});

test('notifications and a long draft do not push the composer outside the window', async ({
  page,
}) => {
  await page.setViewportSize({ width: 980, height: 680 });
  await page.goto('/');
  await openSidebar(page);
  await openCodeFolder(page);
  await page.getByRole('button', { name: 'Repository actions', exact: true }).click();
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
  const welcome = page.getByRole('heading', { name: 'What are we working on?', exact: true });
  expect(
    await welcome.evaluate(
      (el) =>
        el.getBoundingClientRect().top >=
        el.closest('.conversation-messages')!.getBoundingClientRect().top,
    ),
  ).toBe(true);
  // The welcome stays above the composer. A draft hides the starter prompts.
  expect(
    await page
      .locator('.conversation-welcome')
      .evaluate(
        (el) =>
          el.getBoundingClientRect().bottom + 16 <=
          el
            .closest('.conversation-panel')!
            .querySelector('.conversation-composer')!
            .getBoundingClientRect().top,
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
  await page.keyboard.press('ControlOrMeta+t');
  await page.keyboard.press('ControlOrMeta+Shift+g');
  await expect(
    page
      .getByRole('group', { name: 'Tools', exact: true })
      .getByRole('button', { name: /^Changes/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  const topbar = await page.locator('.topbar').boundingBox();
  expect(topbar?.height).toBeLessThanOrEqual(48);
  for (const id of ['conversation-titlebar-heading', 'conversation-titlebar-tabs']) {
    const box = await page.locator('#' + id).boundingBox();
    expect(box && box.y + box.height).toBeLessThanOrEqual(48);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(980);
});
