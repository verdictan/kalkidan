import { test, expect } from './helpers/app';

test('every project tab shows one header and the tab bar does not move', async ({ page }) => {
  await page.goto('/');
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  const tabs = page.getByRole('navigation', { name: 'Project page' });
  await expect(tabs).toBeVisible();
  const first = await tabs.boundingBox();
  for (const name of ['Tasks', 'Chats', 'Docs', 'Memory', 'Insights', 'Overview']) {
    const tab = tabs.getByRole('button', { name, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-current', 'page');
    // One fixed project header on each tab: the name, the counts, New chat, the project menu
    // and settings.
    const header = page.locator('.project-header');
    await expect(header).toHaveCount(1);
    await expect(header.getByRole('heading', { name: 'Atlas', exact: true })).toBeVisible();
    await expect(header).toContainText('3 code folders · 2 chats');
    await expect(header.getByRole('button', { name: 'New chat', exact: true })).toBeVisible();
    await expect(header.getByRole('button', { name: 'Project actions' })).toBeVisible();
    await expect(header.getByRole('button', { name: 'Project settings' })).toBeVisible();
    await expect(page.getByRole('main').locator('.page-header')).toHaveCount(1);
    const box = await tabs.boundingBox();
    expect(box).toEqual(first);
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
