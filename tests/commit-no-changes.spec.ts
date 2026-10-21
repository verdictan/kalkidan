import { test, expect, type Page } from '@playwright/test';
import { openTool } from './helpers/tools';

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
  await page.locator('.repo-select').click();
  await page.getByRole('button', { name: 'Resume Implement feature', exact: true }).click();
}

test('Commit is disabled with a reason when there are no changes', async ({ page }) => {
  await openChat(page, '');
  await openTool(page, 'Changes');
  const tools = page.getByRole('region', { name: 'Repository tools' });
  await expect(tools).toContainText('No changes in this scope');
  const commit = tools.getByRole('button', { name: 'Commit…', exact: true });
  await expect(commit).toBeDisabled();
  await expect(commit.locator('..')).toHaveAccessibleDescription('No changes to commit.');

  // The chat menu disables Commit changes and tells the user why.
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click();
  const item = page.getByRole('menuitem', { name: /^Commit changes…/ });
  await expect(item).toBeDisabled();
  await expect(item).toContainText('No changes to commit.');
  await page.keyboard.press('Escape');
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
  await openTool(page, 'Changes');
  const tools = page.getByRole('region', { name: 'Repository tools' });
  await expect(tools.getByRole('button', { name: 'Commit…', exact: true })).toBeEnabled();
});
