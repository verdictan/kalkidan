import { type Page } from '@playwright/test';
import { test, expect } from './helpers/app';
import { openCodeFolder, openTreeChat } from './helpers/navigation';
import { toolPane } from './helpers/tools';

/** A chat with one changed file. The first pull request fails, and the next one opens. */
async function stubPublish(page: Page) {
  await page.addInitScript(() => {
    let committed = false;
    (window as any).operations = [];
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
      // The chat saves the link to the new pull request.
      updateSession: async () => {},
      transcript: async () => ({ messages: [], truncated: false }),
      workingStatus: async () => ({
        branch: 'feature/work',
        defaultBranch: 'main',
        changed: committed ? 0 : 1,
        untracked: 0,
        ahead: committed ? 1 : 0,
        published: false,
      }),
      workingFiles: async () => (committed ? [] : [{ path: 'file.ts', status: 'modified' }]),
      gitPublishStatus: async () => null,
      gitPublish: async (_id: string, request: any) => {
        ((window as any).requests ||= []).push(request);
        if (!committed) {
          (window as any).operations.push('commit');
          committed = true;
        }
        if (request.pullRequest) {
          (window as any).operations.push('pr');
          if ((window as any).operations.filter((op: string) => op === 'pr').length === 1)
            return {
              id: request.id,
              phase: 'committed',
              branch: 'feature/work',
              before: 'before',
              commit: 'abcdef123456',
              updatedAt: 0,
              error: 'GitHub unavailable',
            };
        }
        return {
          id: request.id,
          phase: 'completed',
          branch: 'feature/work',
          before: 'before',
          commit: 'abcdef123456',
          url: 'https://github.com/verdictan/kalkidan/pull/1',
          updatedAt: 0,
        };
      },
      gitCommit: async () => {
        (window as any).operations.push('commit');
        committed = true;
        return { commit: 'abcdef123456' };
      },
      gitPullRequest: async () => {
        (window as any).operations.push('pr');
        if ((window as any).operations.filter((op: string) => op === 'pr').length === 1)
          throw Error('GitHub unavailable');
        return { url: 'https://github.com/verdictan/kalkidan/pull/1' };
      },
    };
  });
}

/** Opens the chat and the Changes tab, and returns the footer that ships the changes. */
async function openShipFooter(page: Page) {
  await page.goto('/');
  await openCodeFolder(page);
  await openTreeChat(page, 'Implement feature');
  await page.getByLabel('Message agent').click();
  await page.keyboard.press('ControlOrMeta+Shift+G');
  const ship = toolPane(page).getByRole('group', { name: 'Ship changes' });
  await expect(ship.getByRole('status')).toContainText('feature/work → main');
  return ship;
}

test('a failed pull request keeps the successful commit and retries only the pull request', async ({
  page,
}) => {
  await stubPublish(page);
  // The Changes footer commits the changes and creates the pull request in one step.
  const ship = await openShipFooter(page);
  const create = ship.getByRole('button', { name: 'Create pull request', exact: true });
  await create.click();
  const alert = ship.getByRole('alert');
  await expect(alert).toContainText('Committed abcdef1. The pull request did not open.');
  await expect(alert).toContainText('GitHub unavailable');
  // The commit is done, so Try again only creates the pull request.
  await alert.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(
    page.getByText(/Committed abcdef1 and created pull request #1\./).first(),
  ).toBeVisible();
  await expect(ship.getByRole('alert')).toHaveCount(0);
  const row = page.getByRole('group', { name: 'Pull request', exact: true });
  await expect(row).toContainText('#1');
  await expect(row.getByRole('button', { name: 'Open on GitHub', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).operations)).toEqual(['commit', 'pr', 'pr']);
  const requests = await page.evaluate(() => (window as any).requests);
  expect(requests.map((request: any) => !!request.commit)).toEqual([true, false]);
});

test('a pull request can open as a draft', async ({ page }) => {
  await stubPublish(page);
  const ship = await openShipFooter(page);
  const more = ship.getByRole('button', { name: 'More ways to ship', exact: true });
  const draft = page.getByRole('menuitem', { name: 'Create draft pull request', exact: true });
  await more.click();
  await draft.click();
  await expect(ship.getByRole('alert')).toContainText('GitHub unavailable');
  // Try again keeps the draft choice.
  await ship.getByRole('button', { name: 'Try again', exact: true }).click();
  const requests = await page.evaluate(() => (window as any).requests);
  expect(requests.map((request: any) => request.pullRequest?.draft)).toEqual([true, true]);
  await expect(page.getByText(/created draft pull request #1/).first()).toBeVisible();
  await expect(page.getByRole('group', { name: 'Pull request', exact: true })).toContainText(
    'Draft',
  );
});
