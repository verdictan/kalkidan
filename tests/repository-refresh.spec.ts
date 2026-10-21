import { test, expect } from '@playwright/test';
import { openCodeFolder } from './helpers/navigation';

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
  await page.goto('/');
  await openCodeFolder(page, 'Test repo');
  await expect(page.locator('.worktree')).toContainText('main');
  const before = await page.evaluate(() => ({ ...(window as any).ioCalls }));
  await page.getByRole('button', { name: 'Refresh branch copies' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).ioCalls.repository))
    .toBe(before.repository + 1);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect
    .poll(() => page.evaluate(() => (window as any).ioCalls.repository))
    .toBe(before.repository + 2);
  const after = await page.evaluate(() => (window as any).ioCalls);
  expect(after.snapshot).toBe(before.snapshot);
  // The project overview reads branches. The code folder page does not call Git again.
  expect(after.git).toBe(before.git);
});

test('switching projects reuses details and keeps cached content after a failed refresh', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const calls: Record<string, number> = {};
    (window as any).detailCalls = calls;
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
      // The project overview reads the branch of each code folder.
      git: async () => null,
      snapshot: async () => ({
        projects,
        groups: [{ id: 'group', name: 'Test project', repoIds: ['Alpha', 'Beta'] }],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      repositorySnapshot: async (id: string) => {
        calls[id] = (calls[id] || 0) + 1;
        if ((window as any).failDetails) throw Error('Host is unavailable');
        return {
          git: { branch: id, changes: 0, worktrees: [{ path: `/tmp/${id}`, branch: id }] },
          sessions: [],
          warnings: [],
        };
      },
    };
  });
  await page.goto('/');
  await openCodeFolder(page, 'Alpha');
  await expect(page.locator('.worktree')).toContainText('Alpha');
  await openCodeFolder(page, 'Beta');
  await expect(page.locator('.worktree')).toContainText('Beta');
  await openCodeFolder(page, 'Alpha');
  await expect(page.locator('.worktree')).toContainText('Alpha');
  expect(await page.evaluate(() => (window as any).detailCalls)).toEqual({ Alpha: 1, Beta: 1 });
  await page.evaluate(() => {
    (window as any).failDetails = true;
    window.dispatchEvent(new Event('focus'));
  });
  await expect(page.getByText('Host is unavailable', { exact: true })).toBeVisible();
  await expect(page.locator('.worktree')).toContainText('Alpha');
  await page.evaluate(() => {
    (window as any).failDetails = false;
    window.dispatchEvent(new Event('focus'));
  });
  await expect(page.getByText('Host is unavailable', { exact: true })).toHaveCount(0);
});
