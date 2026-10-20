import { test, expect } from '@playwright/test';
import { openTool } from './helpers/tools';
test('tool pane resizes, keeps the composer visible, and preserves independent tabs', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:5173');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.repo-select').first().click();
  await page.getByRole('button', { name: 'New Codex session', exact: true }).click();
  await page.getByLabel('Message agent').fill('Keep this draft');
  // The title bar shows the session tools with their names.
  const sessionTools = page.getByRole('group', { name: 'Session tools', exact: true });
  for (const name of ['Terminal', 'Browser'])
    await expect(sessionTools.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(sessionTools.getByRole('button', { name: /^Changes/ })).toBeVisible();
  await openTool(page, 'Terminal');
  await expect(page.getByLabel('Message agent')).toBeVisible();
  const divider = page.getByRole('separator', { name: 'Resize session and tools' });
  const before = await page.locator('.conversation-chat-column').boundingBox();
  const box = (await divider.boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x - 80, box.y + 100, { steps: 10 });
  await page.mouse.up();
  expect((await page.locator('.conversation-chat-column').boundingBox())!.width).toBeLessThan(
    before!.width - 50,
  );
  await divider.focus();
  await page.keyboard.press('ArrowRight');
  await openTool(page, 'Browser');
  await expect(page.getByRole('tab', { name: 'Terminal', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Browser', exact: true })).toBeVisible();
  await page.getByLabel('Preview URL').fill('http://localhost:5000');
  await page.getByRole('tab', { name: 'Terminal', exact: true }).click();
  await page.getByRole('tab', { name: 'Browser', exact: true }).click();
  await expect(page.getByLabel('Preview URL')).toHaveValue('http://localhost:5000');
  await expect(page.getByLabel('Message agent')).toHaveValue('Keep this draft');
  await page.screenshot({ path: 'test-results/resizable-tools.png', animations: 'disabled' });
  await openTool(page, 'Terminal');
  await expect(page.getByRole('tab', { name: 'Terminal', exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Close Terminal', exact: true }).last().click();
  await page.getByRole('button', { name: 'Close terminal', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Terminal', exact: true })).toHaveCount(1);
  await page.setViewportSize({ width: 961, height: 988 });
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('browser menu exposes working find, device, history, settings, and data controls', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const repo = {
      id: 'r',
      name: 'web',
      path: '/tmp/web',
      notes: '',
      favorite: false,
      addedAt: '',
    };
    (window as any).actions = [];
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [repo],
        groups: [{ id: 'g', name: 'App', repoIds: ['r'] }],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      git: async () => null,
      models: async () => [],
      browserOpen: async () => {},
      browserLayout: async () => {},
      browserClose: async () => {},
      browserState: async () => ({
        url: 'https://example.com/',
        title: 'Example',
        canGoBack: true,
        canGoForward: false,
        loading: false,
        zoom: 1,
        find: { matches: 2, activeMatchOrdinal: 1 },
      }),
      browserAction: async (id: string, action: string, value: any) => {
        (window as any).actions.push({ action, value });
        if (action === 'profile')
          return {
            history: [
              { url: 'https://example.com/', title: 'Example page', at: new Date().toISOString() },
            ],
            downloads: [],
            credentials: [],
            settings: { home: 'http://localhost:3000', rememberHistory: true },
          };
      },
    };
  });
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.repo-select').click();
  await page.getByRole('button', { name: 'New Codex session' }).click();
  await openTool(page, 'Browser');
  await page.getByRole('button', { name: 'Open preview' }).click();
  const menu = () => page.getByRole('button', { name: 'Browser menu' }).click();
  await menu();
  await page.getByRole('menuitem', { name: 'Find in page' }).click();
  await page.getByRole('textbox', { name: 'Find in page' }).fill('example');
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).actions.some((a: any) => a.action === 'find' && a.value.text === 'example'),
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Close find' }).click();
  await menu();
  await page.getByRole('menuitem', { name: 'Device toolbar' }).click();
  await page.getByLabel('Device width').fill('412');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).actions.some((a: any) => a.action === 'device' && a.value.width === 412),
      ),
    )
    .toBe(true);
  await menu();
  await page.screenshot({ path: 'test-results/browser-feature-menu.png', animations: 'disabled' });
  await page.getByRole('menuitem', { name: 'History', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Example page');
  await page.keyboard.press('Escape');
  await menu();
  await page.getByRole('menuitem', { name: 'Browser settings' }).click();
  await page.getByLabel('Home page').fill('https://example.com/');
  await page.getByRole('button', { name: 'Save browser settings' }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).actions.some(
          (a: any) => a.action === 'settings' && a.value.home === 'https://example.com/',
        ),
      ),
    )
    .toBe(true);
  await page.keyboard.press('Escape');
  await menu();
  await page.getByRole('menuitem', { name: 'Clear browsing data' }).click();
  await page.getByRole('button', { name: 'Clear cached files…' }).click();
  await page.getByRole('button', { name: 'Clear cached files', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('cleared');
});
