import { type Page } from '@playwright/test';
import { test, expect } from './helpers/app';

const tree = (page: Page) => page.getByRole('navigation', { name: 'Projects and repositories' });
const projectGroup = (page: Page, name: string) =>
  page
    .locator('.project-group')
    .filter({ has: page.locator('.project-select', { hasText: new RegExp(`^${name}`) }) });

test('a project row shows its recent chats and a collapsed Docs row, not code folders', async ({
  page,
}) => {
  await page.goto('/');
  const atlas = projectGroup(page, 'Atlas');
  const chat = atlas.getByRole('button', {
    name: 'Chat: Refine project and repository navigation',
    exact: true,
  });
  await expect(chat).toBeVisible();
  // The title gets the full row. Atlas has three code folders, so the tooltip names the code
  // folder of the chat.
  await expect(chat.locator('.tree-secondary')).toHaveCount(0);
  await expect(chat).toHaveAttribute(
    'title',
    'Refine project and repository navigation · atlas-web',
  );
  // Docs shows under the project, collapsed: no page rows until the user expands it.
  const docs = atlas.getByRole('button', { name: 'Docs of Atlas', exact: true });
  await expect(docs).toHaveAttribute('aria-expanded', 'false');
  await expect(atlas.locator('.tree-doc-row')).toHaveCount(0);
  for (const name of ['atlas-web', 'design-system', 'api-service', 'Tasks', 'Docs', 'Memory'])
    await expect(tree(page).getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(tree(page).getByText('Insights', { exact: true })).toHaveCount(0);
  // The two add buttons are gone: New project has its own icon, and the project row menu adds
  // a code folder.
  await expect(tree(page).getByRole('button', { name: /^Add code folders to / })).toHaveCount(0);
  await expect(tree(page).getByRole('button', { name: 'New project', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Manage project Atlas', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add a code folder…', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add code folders', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  // An open chat does not show a second time in an "Open chats" section.
  await chat.click();
  await expect(chat).toHaveAttribute('aria-current', 'page');
  await expect(tree(page).getByText('Open chats', { exact: true })).toHaveCount(0);
  await expect(
    tree(page).locator('.tree-row-button', { hasText: 'Refine project and repository navigation' }),
  ).toHaveCount(1);
});

test('Pinned shows pinned chats once and the chat actions unpin them', async ({ page }) => {
  await page.goto('/');
  const title = 'Review the authentication flow and add integration tests';
  await page.getByRole('button', { name: `${title} actions`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
  const pinned = page.locator('.pinned-sessions');
  await expect(pinned.getByRole('heading', { name: 'Pinned' })).toBeVisible();
  await expect(pinned.getByRole('button', { name: `Resume pinned ${title}` })).toBeVisible();
  // The project does not list the pinned chat again.
  await expect(
    projectGroup(page, 'Atlas').getByRole('button', { name: `Chat: ${title}`, exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: `${title} actions`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Unpin', exact: true }).click();
  await expect(pinned).toHaveCount(0);
  await expect(
    projectGroup(page, 'Atlas').getByRole('button', { name: `Chat: ${title}`, exact: true }),
  ).toBeVisible();
});

test('the sidebar, All chats and the overview count the same chats', async ({ page }) => {
  await page.addInitScript(() => {
    const repo = {
      id: 'r',
      name: 'web',
      path: '/tmp/web',
      favorite: false,
      notes: '',
      addedAt: '',
    };
    const sessions = Array.from({ length: 8 }, (_, index) => ({
      id: `s${index}`,
      agent: 'codex',
      cwd: '/tmp/web',
      title: `Chat ${index}`,
      updatedAt: new Date(Date.UTC(2026, 9, 1 + index)).toISOString(),
      // One chat is archived. One chat is pinned.
      organization: index === 0 ? { archived: true } : index === 1 ? { pinned: true } : undefined,
    }));
    (window as any).workspace = {
      trackerProviders: async () => [],
      git: async () => null,
      snapshot: async () => ({
        projects: [repo],
        groups: [{ id: 'g', name: 'Counted', repoIds: ['r'] }],
        sessions,
        warnings: [],
        platform: 'darwin',
      }),
    };
  });
  await page.goto('/');
  const group = projectGroup(page, 'Counted');
  // Seven chats can open: the archived chat does not count. The pinned chat shows in Pinned.
  const rows = group.getByRole('button', { name: /^Chat: / });
  await expect(rows).toHaveCount(5);
  // The newest chat is first. A project with one code folder shows no folder name.
  await expect(rows.first()).toContainText('Chat 7');
  await expect(rows.first()).toHaveAttribute('title', 'Chat 7');
  await expect(group.getByRole('button', { name: 'Show all 7 chats', exact: true })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Project overview' }).getByText('7 chats', { exact: true }),
  ).toBeVisible();
  await tree(page).getByRole('button', { name: 'All chats', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'All chats' }).getByRole('button', { name: /^Resume / }),
  ).toHaveCount(7);
  // "Show all" opens the Chats tab of the project, with the same count.
  await group.getByRole('button', { name: 'Show all 7 chats', exact: true }).click();
  await expect(
    page.getByRole('navigation', { name: 'Project page' }).getByRole('button', { name: 'Chats' }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.project-header')).toContainText('7 chats');
  const chats = page.getByRole('region', { name: 'Project chats' });
  await expect(chats.getByRole('button', { name: /^Resume / })).toHaveCount(7);
  await page.getByLabel('Filter chats').fill('Chat 3');
  await expect(chats.getByRole('button', { name: /^Resume / })).toHaveCount(1);
  await chats.getByRole('button', { name: 'Archived', exact: true }).click();
  await page.getByLabel('Filter chats').fill('');
  await expect(chats.getByRole('button', { name: /^Resume / })).toHaveCount(1);
});

test('keyboard moves between project and chat rows, and expands and collapses projects', async ({
  page,
}) => {
  await page.goto('/');
  const project = tree(page).getByRole('button', { name: 'Atlas', exact: true });
  const chat = tree(page).getByRole('button', {
    name: 'Chat: Refine project and repository navigation',
    exact: true,
  });
  await project.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(chat).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(chat).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(chat).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(project).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Pin', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('an SSH project shows the host in its badge and offers Reconnect in its menu', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).workspace = {
      trackerProviders: async () => [],
      snapshot: async () => ({
        projects: [],
        groups: [{ id: 'g', name: 'Remote acceptance project', repoIds: [], hostId: 'h' }],
        hosts: [
          { id: 'h', name: 'Builder', target: 'dev@builder.example', status: 'disconnected' },
        ],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      remoteConnect: async () => {
        (window as any).connected = true;
      },
    };
  });
  await page.goto('/');
  const badge = projectGroup(page, 'Remote acceptance project').locator('.project-host-badge');
  await expect(badge).toHaveText('SSH');
  await expect(badge).toHaveAttribute('title', /dev@builder\.example · disconnected/);
  await expect(page.locator('.tree-host')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Manage project Remote acceptance project', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Reconnect to Builder', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).connected)).toBe(true);
});
