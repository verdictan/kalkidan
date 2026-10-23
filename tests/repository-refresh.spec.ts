import { test, expect } from './helpers/app';
import { type Page } from '@playwright/test';
import { openCodeFolder } from './helpers/navigation';

/** The muted branch text after the name of a repo row in the tree. */
const branchOf = (page: Page, name: string) =>
  page
    .locator('.tree-row[data-kind="repo"]')
    .filter({ has: page.locator('.tree-label', { hasText: new RegExp(`^${name}$`) }) })
    .locator('.tree-meta');

test('the tree shows the branch of each repo and keeps it while the user moves', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const calls: Record<string, number> = { snapshot: 0, git: 0, repository: 0 };
    (window as any).ioCalls = calls;
    const projects = ['Alpha', 'Beta'].map((name) => ({
      id: name,
      name,
      path: `/tmp/${name}`,
      favorite: false,
      notes: '',
      addedAt: '',
    }));
    (window as any).workspace = {
      trackerProviders: async () => [],
      githubAuthCancel: async () => ({ status: 'idle' }),
      snapshot: async () => {
        calls.snapshot++;
        return {
          projects,
          groups: [
            { id: 'one', name: 'First project', repoIds: ['Alpha'] },
            { id: 'two', name: 'Second project', repoIds: ['Beta'] },
          ],
          sessions: [],
          warnings: [],
          platform: 'darwin',
        };
      },
      git: async () => {
        calls.git++;
        throw Error('Separate Git call should not occur');
      },
      repositorySnapshot: async () => {
        calls.repository++;
        throw Error('The tree does not read repository details');
      },
      workingStatus: async (id: string) => {
        calls[id] = (calls[id] || 0) + 1;
        return { branch: `${id.toLowerCase()}-branch`, files: [], changes: 0 };
      },
    };
  });
  await page.goto('/');
  await openCodeFolder(page, 'Alpha');
  await expect(branchOf(page, 'Alpha')).toHaveText('alpha-branch');
  await openCodeFolder(page, 'Beta');
  await expect(branchOf(page, 'Beta')).toHaveText('beta-branch');
  const before = await page.evaluate(() => ({ ...(window as any).ioCalls }));
  // The tree keeps the branches while the user moves between projects.
  await openCodeFolder(page, 'Alpha');
  await expect(branchOf(page, 'Alpha')).toHaveText('alpha-branch');
  await openCodeFolder(page, 'Beta');
  await expect(branchOf(page, 'Beta')).toHaveText('beta-branch');
  const after = await page.evaluate(() => (window as any).ioCalls);
  // Moving between projects does not reload the workspace snapshot.
  expect(after.snapshot).toBe(before.snapshot);
  expect(after.git).toBe(0);
  expect(after.repository).toBe(0);
});
