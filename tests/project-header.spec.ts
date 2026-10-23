import { test, expect } from './helpers/app';

test('every project view shows one title bar, a title and the tabs in one place', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  const tabs = page.getByRole('navigation', { name: 'Project page' });
  await expect(tabs).toBeVisible();
  const first = (await tabs.boundingBox())!;
  // The project views are Overview, Tasks and Knowledge. Chats is not a view.
  await expect(tabs.getByRole('button')).toHaveText(['Overview', 'Tasks', 'Knowledge']);
  for (const name of ['Tasks', 'Knowledge', 'Overview']) {
    const tab = tabs.getByRole('button', { name, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-current', 'page');
    // One 40px title bar on each view, with the project crumb. Overview and Tasks have the
    // title row (the name and the project menu) under it; Knowledge has the tabs right under
    // the title bar, and the crumb is the heading. There is no New chat button.
    const header = page.locator('.project-header');
    await expect(header).toHaveCount(1);
    await expect(header).toContainText('Atlas');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Atlas', exact: true, level: 1 })).toBeVisible();
    await expect(main.getByRole('button', { name: 'New chat', exact: true })).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Project actions' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Project settings' })).toHaveCount(0);
    await expect(main.locator('.page-header:visible')).toHaveCount(1);
    expect((await header.boundingBox())!.height).toBe(40);
    // Overview and Tasks keep the tabs in one place, so they never move between the two.
    if (name !== 'Knowledge') {
      const box = (await tabs.boundingBox())!;
      expect([box.x, box.y, box.height]).toEqual([first.x, first.y, first.height]);
    }
  }
  await page.screenshot({ path: 'test-results/project-header.png' });
});

test('an SSH project header shows the host and its connection state', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).workspace = {
      trackerProviders: async () => [],
      snapshot: async () => ({
        projects: [],
        groups: [{ id: 'g', name: 'Remote', repoIds: [], hostId: 'h' }],
        hosts: [{ id: 'h', name: 'Builder', target: 'dev@builder.example', status: 'connected' }],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
    };
  });
  await page.goto('/');
  await page.locator('.project-tree').getByRole('button', { name: 'Remote', exact: true }).click();
  const host = page.locator('.project-header-host');
  await expect(host).toContainText('SSH · Builder · connected');
  await expect(host).toHaveAttribute('title', 'dev@builder.example');
});
