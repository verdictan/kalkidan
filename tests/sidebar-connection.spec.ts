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
  // The footer keeps the Settings and help menu. A dot that needs attention adds text at the end.
  const footer = page
    .getByRole('navigation', { name: 'Projects and repositories' })
    .getByRole('button', { name: /^Settings and help(, .*)?$/ });
  await expect(footer).toBeVisible();
  // Signed out, the menu has the app items only. "Create one" is on the sign-in screens.
  await footer.click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: /^Settings…/ })).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: /Create account|Keyboard shortcuts/ }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
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
