import { test, expect, settingsDialog } from './helpers/app';

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
  // The footer keeps the Settings gear. It opens the Settings page.
  const gear = page
    .getByRole('navigation', { name: 'Projects and repositories' })
    .getByRole('button', { name: 'Settings', exact: true });
  await expect(gear).toBeVisible();
  await gear.click();
  await expect(settingsDialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settingsDialog(page)).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).access = 'idle';
    window.dispatchEvent(new Event('focus'));
  });
  await expect(button).toBeVisible();
  // The button opens the board of the project in Settings, not the account part.
  await button.click();
  await expect(settingsDialog(page)).toBeVisible();
  await expect(page.locator('#project-board')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    (window as any).access = 'ready';
    window.dispatchEvent(new Event('focus'));
  });
  await expect(button).toHaveCount(0);
});
