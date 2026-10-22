import { test, expect } from './helpers/app';

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
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
  const button = page.locator('.sidebar-github-connect');
  await expect(button).toHaveCount(0);
  // The footer keeps the Preferences and help menu.
  await expect(
    page
      .getByRole('navigation', { name: 'Projects and repositories' })
      .getByRole('button', { name: 'Preferences and help', exact: true }),
  ).toBeVisible();
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
