import { test, expect } from '@playwright/test';

test('overview refreshes only its repository and keeps cached content while revalidating', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const calls = { snapshot: 0, repository: 0, git: 0 };
    (window as any).ioCalls = calls;
    const project = {
      id: 'repo',
      name: 'Test repo',
      path: '/tmp/repo',
      favorite: false,
      notes: '',
      addedAt: '',
    };
    (window as any).workspace = {
      trackerProviders: async () => [],
      githubAuthCancel: async () => ({ status: 'idle' }),
      snapshot: async () => {
        calls.snapshot++;
        return {
          projects: [project],
          groups: [{ id: 'group', name: 'Test project', repoIds: ['repo'] }],
          sessions: [],
          warnings: [],
          platform: 'darwin',
        };
      },
      git: async () => {
        calls.git++;
        throw Error('Separate Git call should not occur');
      },
      repositorySnapshot: async (id: string) => {
        if (id !== 'repo') throw Error('Wrong repository');
        calls.repository++;
        return {
          git: { branch: 'main', changes: 0, worktrees: [{ path: '/tmp/repo', branch: 'main' }] },
          sessions: [],
          warnings: [],
        };
      },
    };
  });
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Test repo', exact: true }).click();
  await expect(page.locator('.worktree')).toContainText('main');
  const before = await page.evaluate(() => ({ ...(window as any).ioCalls }));
  await page.getByRole('button', { name: 'Refresh worktrees' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).ioCalls.repository))
    .toBe(before.repository + 1);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect
    .poll(() => page.evaluate(() => (window as any).ioCalls.repository))
    .toBe(before.repository + 2);
  const after = await page.evaluate(() => (window as any).ioCalls);
  expect(after.snapshot).toBe(before.snapshot);
  expect(after.git).toBe(0);
});
