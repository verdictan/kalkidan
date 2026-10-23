import { type Page } from '@playwright/test';
import { test, expect } from './helpers/app';

const tree = (page: Page) => page.getByRole('navigation', { name: 'Projects and repositories' });
const projectRow = (page: Page, name: string) =>
  page
    .locator('.tree-row[data-kind="project"]')
    .filter({ has: page.locator('.tree-label', { hasText: new RegExp(`^${name}$`) }) });
const repoRow = (page: Page, name: string) =>
  page
    .locator('.tree-row[data-kind="repo"]')
    .filter({ has: page.locator('.tree-label', { hasText: new RegExp(`^${name}$`) }) });
/** Opens the ⋯ menu of a tree row. The button shows when the pointer is on the row. */
async function openRowMenu(page: Page, row: ReturnType<typeof projectRow>, name: string) {
  await row.hover();
  await row.getByRole('button', { name, exact: true }).click();
}

test('the tree shows projects, their repos, and the chats of each repo', async ({ page }) => {
  await page.goto('/');
  // The root of the tree opens the Projects page. "New project" is its + button.
  await expect(tree(page).getByRole('button', { name: 'Projects', exact: true })).toBeVisible();
  await expect(tree(page).getByRole('button', { name: 'New project', exact: true })).toHaveCount(1);
  await tree(page).getByRole('button', { name: 'Expand Atlas', exact: true }).click();
  // A project shows its repos (code folders). Each repo row shows its branch.
  for (const name of ['atlas-web', 'design-system', 'api-service'])
    await expect(tree(page).getByRole('button', { name, exact: true })).toBeVisible();
  await expect(repoRow(page, 'atlas-web').locator('.tree-meta')).toHaveText('main');
  const chat = tree(page).getByRole('button', {
    name: 'Chat: Refine project and repository navigation',
    exact: true,
  });
  await expect(chat).toBeVisible();
  // The title gets the full row. The tooltip also names the repo of the chat.
  await expect(chat).toHaveAttribute(
    'title',
    'Refine project and repository navigation · atlas-web',
  );
  // Subagents of a chat show under it.
  await expect(
    tree(page).getByRole('button', { name: 'Subagent: Explore auth module', exact: true }),
  ).toBeVisible();
  // The tree has no Docs, Tasks, Memory, Chats or Waiting rows.
  for (const name of ['Tasks', 'Docs', 'Memory', 'Knowledge', 'Chats', 'Waiting for you'])
    await expect(tree(page).getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(tree(page).getByText('Insights', { exact: true })).toHaveCount(0);
  await expect(tree(page).getByRole('button', { name: /^New chat in / })).toHaveCount(0);
  // For a local project, "Add repo…" opens the folder picker at once, with no dialog. It adds
  // every Git repository in the chosen folder.
  await openRowMenu(page, projectRow(page, 'Atlas'), 'Manage project Atlas');
  await page.getByRole('menuitem', { name: 'Add repo…', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await tree(page).getByRole('button', { name: 'Atlas', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Repos', exact: true }).getByRole('button', {
      name: /^(atlas-web|design-system|api-service)/,
    }),
  ).toHaveCount(6);
  // An open chat shows once, as the current row.
  await chat.click();
  await expect(chat).toHaveAttribute('aria-current', 'page');
  await expect(tree(page).getByText('Open chats', { exact: true })).toHaveCount(0);
  await expect(
    tree(page).locator('.tree-row-button', { hasText: 'Refine project and repository navigation' }),
  ).toHaveCount(1);
});

test('a pinned chat moves to the top of its repo and the chat actions unpin it', async ({
  page,
}) => {
  await page.goto('/');
  await tree(page).getByRole('button', { name: 'Expand Atlas', exact: true }).click();
  const title = 'Review the authentication flow and add integration tests';
  const chats = page
    .locator('.tree-row[data-kind="session"]')
    .getByRole('button', { name: /^Chat: / });
  await expect(chats.first()).toHaveAccessibleName(
    'Chat: Refine project and repository navigation',
  );
  const row = page
    .locator('.tree-row[data-kind="session"]')
    .filter({ has: page.getByRole('button', { name: `Chat: ${title}`, exact: true }) });
  await openRowMenu(page, row, `${title} actions`);
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
  // The pinned chat is first. It shows once: there is no separate Pinned section.
  await expect(chats.first()).toHaveAccessibleName(`Chat: ${title}`);
  await expect(tree(page).getByRole('button', { name: `Chat: ${title}`, exact: true })).toHaveCount(
    1,
  );
  await expect(page.locator('.pinned-sessions')).toHaveCount(0);
  await openRowMenu(page, row, `${title} actions`);
  await page.getByRole('menuitem', { name: 'Unpin', exact: true }).click();
  await expect(chats.first()).toHaveAccessibleName(
    'Chat: Refine project and repository navigation',
  );
});

test('a repo shows its newest chats, then the others on request', async ({ page }) => {
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
  // The Projects page shows the time of the newest chat.
  await expect(
    page
      .getByRole('region', { name: 'Projects', exact: true })
      .getByRole('button', { name: /^Counted, 1 repo/ })
      .locator('time'),
  ).toHaveText('Oct 8');
  await tree(page).getByRole('button', { name: 'Expand Counted', exact: true }).click();
  // The repo with the newest chat of the project opens by default.
  await expect(tree(page).getByRole('button', { name: 'Collapse web', exact: true })).toBeVisible();
  // Seven chats can open: the archived chat does not show. The pinned chat is first, then the
  // newest chats. The repo shows five, then "Show 2 more chats".
  const rows = tree(page).getByRole('button', { name: /^Chat: / });
  await expect(rows).toHaveCount(5);
  await expect(rows).toHaveText(['Chat 1', 'Chat 7', 'Chat 6', 'Chat 5', 'Chat 4']);
  await expect(rows.nth(1)).toHaveAttribute('title', 'Chat 7 · web');
  await tree(page).getByRole('button', { name: 'Show 2 more chats', exact: true }).click();
  await expect(rows).toHaveCount(7);
  await expect(tree(page).getByRole('button', { name: 'Chat: Chat 0', exact: true })).toHaveCount(
    0,
  );
});

test('keyboard moves between project, repo and chat rows, and expands and collapses them', async ({
  page,
}) => {
  await page.goto('/');
  const project = tree(page).getByRole('button', { name: 'Atlas', exact: true });
  const repo = tree(page).getByRole('button', { name: 'atlas-web', exact: true });
  const chat = tree(page).getByRole('button', {
    name: 'Chat: Refine project and repository navigation',
    exact: true,
  });
  await project.focus();
  await expect(repo).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(repo).toBeVisible();
  await expect(chat).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(repo).toBeFocused();
  // ArrowLeft closes an open row, then moves to its parent.
  await page.keyboard.press('ArrowLeft');
  await expect(chat).toHaveCount(0);
  await expect(repo).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(project).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(repo).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await expect(chat).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(chat).toBeFocused();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Pin', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('an SSH project shows the host on its row and offers Reconnect in its menu', async ({
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
  const row = projectRow(page, 'Remote acceptance project');
  await expect(row.locator('.tree-meta')).toHaveText('SSH');
  await expect(row.locator('.tree-row-button')).toHaveAttribute(
    'title',
    /SSH: dev@builder\.example · disconnected/,
  );
  await expect(page.locator('.tree-host')).toHaveCount(0);
  await openRowMenu(page, row, 'Manage project Remote acceptance project');
  await page.getByRole('menuitem', { name: 'Reconnect to Builder', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).connected)).toBe(true);
});
