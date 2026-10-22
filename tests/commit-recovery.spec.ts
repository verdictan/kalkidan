import { test, expect } from './helpers/app';
import { openCodeFolder } from './helpers/navigation';
test('a failed pull request keeps the successful commit and retries only the pull request', async ({
  page,
}) => {
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
  await page.goto('/');
  await openCodeFolder(page);
  await page.getByRole('button', { name: 'Resume Implement feature', exact: true }).click();
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Commit changes…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Commit changes' });
  await dialog.getByRole('button', { name: 'Commit and create pull request' }).click();
  await expect(dialog.getByRole('alert')).toContainText('GitHub unavailable');
  await expect(dialog.getByRole('status')).toContainText('Committed abcdef1.');
  // The commit is done, so the retry only creates the pull request.
  await dialog.getByRole('button', { name: 'Create pull request', exact: true }).click();
  await expect(dialog.getByRole('link', { name: 'View pull request #1' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).operations)).toEqual(['commit', 'pr', 'pr']);
});
