import { test, expect } from '@playwright/test';

test('sidebar hides verified connections and restores the action when access is lost', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).access = 'ready';
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [],
        sessions: [],
        warnings: [],
        platform: 'darwin',
        groups: [
          {
            id: 'g',
            name: 'Platform',
            repoIds: [],
            github: {
              id: 'p',
              title: 'Roadmap',
              url: 'https://github.com/orgs/example/projects/1',
            },
          },
        ],
      }),
      githubAuthStatus: async () => ({ status: (window as any).access }),
    };
  });
  await page.goto('http://127.0.0.1:5173');
  await expect(page.getByRole('heading', { name: 'Projects', level: 2 })).toBeVisible();
  const button = page.locator('.sidebar-github-connect');
  await expect(button).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await page.evaluate(() => {
    (window as any).access = 'idle';
    window.dispatchEvent(new Event('focus'));
  });
  await expect(button).toBeVisible();
  await page.evaluate(() => {
    (window as any).access = 'ready';
    window.dispatchEvent(new Event('focus'));
  });
  await expect(button).toHaveCount(0);
});
