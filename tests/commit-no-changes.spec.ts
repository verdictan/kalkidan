import { type Page } from '@playwright/test';
import { test, expect } from './helpers/app';
import { openCodeFolder } from './helpers/navigation';

/**
 * Opens the Changes tool. The title bar shows Changes only when the chat has changes, so the
 * test uses the shortcut, which always works.
 */
async function openChanges(page: Page) {
  await page.getByLabel('Message agent').click();
  await page.keyboard.press('ControlOrMeta+Shift+G');
  await expect(page.getByRole('button', { name: /^Changes/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
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
  // Without changes, the title bar does not show Changes.
  await expect(page.getByRole('group', { name: 'Tools' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Changes/ })).toHaveCount(0);

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
  await expect(tools).toContainText('No changes here');
  await expect(tools).toContainText('This folder has no uncommitted changes.');
  const commit = tools.getByRole('button', { name: 'Commit…', exact: true });
  await expect(commit).toBeDisabled();
  await expect(commit.locator('..')).toHaveAccessibleDescription('No changes to commit.');

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
  // With changes, the title bar shows Changes and its count.
  await page.getByRole('button', { name: 'Changes, 1 file changed in this chat' }).click();
  const tools = page.getByRole('region', { name: 'Repository tools' });
  await expect(tools.getByRole('button', { name: 'Commit…', exact: true })).toBeEnabled();
});
