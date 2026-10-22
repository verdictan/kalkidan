import { type Page } from '@playwright/test';
import { test, expect } from './helpers/app';
import { openCodeFolder } from './helpers/navigation';

/**
 * Opens the Changes tool. The changes row shows Review only when the chat has changes, so the
 * test uses the shortcut, which always works.
 */
async function openChanges(page: Page) {
  await page.getByLabel('Message agent').click();
  await page.keyboard.press('ControlOrMeta+Shift+G');
  const tools = page.getByRole('region', { name: 'Repository tools' });
  await expect(tools.getByRole('heading', { name: 'Changes', exact: true })).toBeVisible();
  await expect(tools.getByRole('button', { name: 'Close Changes', exact: true })).toBeVisible();
}

async function openChat(page: Page, staged: string) {
  await page.addInitScript((stagedDiff) => {
    const session = {
      id: 's',
      agent: 'codex',
      title: 'Implement feature',
      cwd: '/repo',
      updatedAt: '',
    };
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [
          { id: 'r', name: 'Repo', path: '/repo', notes: '', addedAt: '', favorite: false },
        ],
        groups: [{ id: 'g', name: 'Project', repoIds: ['r'] }],
        sessions: [session],
        warnings: [],
        platform: 'darwin',
      }),
      git: async () => null,
      models: async () => [],
      transcript: async () => ({ messages: [], truncated: false }),
      workingStatus: async () => ({
        branch: 'feature/work',
        defaultBranch: 'main',
        changed: stagedDiff ? 1 : 0,
        untracked: 0,
        ahead: 0,
        published: false,
      }),
      workingFiles: async () => (stagedDiff ? [{ path: 'file.ts', status: 'modified' }] : []),
      gitPublishStatus: async () => null,
      repositoryDiff: async () => ({
        unstaged: '',
        staged: stagedDiff,
        untracked: [],
        newFiles: [],
        truncated: false,
      }),
    };
  }, staged);
  await page.goto('/');
  await openCodeFolder(page);
  await page.getByRole('button', { name: 'Resume Implement feature', exact: true }).click();
}

test('Commit is disabled with a reason when there are no changes', async ({ page }) => {
  await openChat(page, '');
  // Without changes, the chat shows no changes row and the chat menu has no Commit.
  await expect(page.getByRole('group', { name: 'Tools' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Changes from this chat' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /^Rename/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /^Commit/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Commit changes in the command palette tells the user why it cannot commit.
  await page.getByRole('button', { name: 'Search or run a command', exact: true }).click();
  const palette = page.getByRole('dialog', { name: 'Search or run a command' });
  await palette.getByRole('combobox').fill('Commit changes');
  await palette.getByRole('option', { name: 'Commit changes…', exact: true }).click();
  await expect(palette).toHaveCount(0);
  await expect(
    page.getByRole('status').filter({ hasText: 'No changes to commit.' }).first(),
  ).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Commit changes' })).toHaveCount(0);

  await openChanges(page);
  const tools = page.getByRole('region', { name: 'Repository tools' });
  await expect(tools).toContainText('No changes');
  // The Changes pane has no commit button. Without changes, the chat shows no changes row, so
  // no control offers a commit.
  await expect(tools.getByRole('button', { name: /^Commit/ })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Changes from this chat' })).toHaveCount(0);

  // A session command, such as one from the menu bar, shows the reason.
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('kalkidan-session-command', { detail: { command: 'session-commit' } }),
    ),
  );
  await expect(page.getByText('No changes to commit.', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Commit changes' })).toHaveCount(0);
});

test('Commit is enabled when only staged changes exist', async ({ page }) => {
  await openChat(page, 'diff --git a/file.ts b/file.ts\n-old\n+new');
  // With changes, the changes row shows the count and Review.
  const row = page.getByRole('group', { name: 'Changes from this chat' });
  await expect(row.getByRole('status')).toContainText('1 file');
  await expect(row.getByRole('button', { name: 'Review', exact: true })).toBeVisible();
  // The chat menu offers the commit when the folder has changes.
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click();
  const commit = page.getByRole('menuitem', { name: 'Commit changes…', exact: true });
  await expect(commit).toBeEnabled();
  await commit.click();
  await expect(page.getByRole('dialog', { name: 'Commit changes' })).toBeVisible();
});
