import { type Page } from '@playwright/test';
import { test, expect } from './helpers/app';
import { openCodeFolder, openTreeChat } from './helpers/navigation';
import { toolPane, toolTab } from './helpers/tools';

/** Opens the Changes tab of the tool pane with its shortcut. */
async function openChanges(page: Page) {
  await page.getByLabel('Message agent').click();
  await page.keyboard.press('ControlOrMeta+Shift+G');
  await expect(toolTab(page, 'Changes')).toHaveAttribute('aria-selected', 'true');
}

/** Runs a command from the command palette. */
async function runFromPalette(page: Page, name: string) {
  await page.getByRole('button', { name: 'Search or run a command', exact: true }).click();
  const palette = page.getByRole('dialog', { name: 'Search or run a command' });
  await palette.getByRole('combobox').fill(name);
  await palette.getByRole('option', { name, exact: true }).click();
  await expect(palette).toHaveCount(0);
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
  await openTreeChat(page, 'Implement feature');
}

test('Commit is disabled with a reason when there are no changes', async ({ page }) => {
  await openChat(page, '');
  // The chat menu has no Commit. Commit and the pull request are in the Changes footer.
  await expect(page.getByRole('group', { name: 'Tools' })).toBeVisible();
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /^Rename/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /^Commit/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Commit changes in the command palette tells the user why it cannot commit.
  await runFromPalette(page, 'Commit changes…');
  await expect(
    page.getByRole('status').filter({ hasText: 'No changes to commit.' }).first(),
  ).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Commit changes' })).toHaveCount(0);

  await openChanges(page);
  const ship = toolPane(page).getByRole('group', { name: 'Ship changes' });
  await expect(ship.getByRole('status')).toContainText('No changes');
  // Without changes, the footer cannot create a pull request or commit.
  await expect(
    ship.getByRole('button', { name: 'Create pull request', exact: true }),
  ).toBeDisabled();
  await ship.getByRole('button', { name: 'More ways to ship', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Commit only', exact: true })).toBeDisabled();
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
  // Commit changes opens the Changes tab. Its footer commits the staged changes.
  await runFromPalette(page, 'Commit changes…');
  await expect(toolTab(page, 'Changes')).toHaveAttribute('aria-selected', 'true');
  const ship = toolPane(page).getByRole('group', { name: 'Ship changes' });
  await expect(ship.getByRole('status')).toContainText('feature/work → main');
  await expect(
    ship.getByRole('button', { name: 'Create pull request', exact: true }),
  ).toBeEnabled();
  await ship.getByRole('button', { name: 'More ways to ship', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Commit only', exact: true })).toBeEnabled();
  await expect(page.getByRole('dialog', { name: 'Commit changes' })).toHaveCount(0);
});
