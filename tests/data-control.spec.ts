import { type Page } from '@playwright/test';
import { test, expect, openSettingsWindow } from './helpers/app';

/** A signed-in desktop with the local data methods. `extra` replaces parts of the API. */
async function fixture(page: Page, extra = '') {
  await page.addInitScript((extra) => {
    const w = window as any;
    w.calls = [];
    const base: Record<string, unknown> = {
      snapshot: async () => ({
        projects: [],
        groups: [{ id: 'g', name: 'Project', repoIds: [] }],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      trackerProviders: async () => [],
      remoteHosts: async () => [],
      githubCliCheck: async () => ({ status: 'ready' }),
      githubAuthStatus: async () => ({ status: 'idle' }),
      onMenuCommand: () => () => {},
      verdictanStatus: async () => ({
        region: 'eu',
        phase: 'authenticated',
        executionReady: true,
        account: {
          state: 'authenticated',
          userId: 'u1',
          organizationId: 'o1',
          organizationName: 'Acme Corp',
          apiUrl: 'https://api.eu.verdictan.com',
          expiresAt: '2026-11-01T00:00:00Z',
        },
      }),
      localDataUsage: async () => ({
        root: '/Users/dana/.kalkidan',
        total: 1_200_000_000,
        limit: 2_000_000_000,
        categories: [
          { category: 'chat-history', bytes: 900_000_000 },
          { category: 'caches', bytes: 300_000_000 },
          { category: 'logs', bytes: 0 },
        ],
      }),
      localDataExport: async () => {
        w.calls.push(['localDataExport']);
        return { path: '/Users/dana/Desktop/kalkidan-export', files: 12 };
      },
      localDataDelete: async (kind: string) => {
        w.calls.push(['localDataDelete', kind]);
        return { removed: [] };
      },
    };
    w.workspace = Object.assign(base, new Function(extra)());
  }, extra);
  await page.goto('/');
}

/** Opens Your data from "Data · 1.2 GB on this Mac" in the footer of Settings. */
async function openYourData(page: Page) {
  const settings = await openSettingsWindow(page);
  await settings.getByRole('button', { name: /^Manage data/ }).click();
}

test('Settings › Data keeps the disk use, export, and deletion', async ({ page }) => {
  await fixture(page);
  // The footer of Settings shows the disk use of this Mac.
  await expect(
    (await openSettingsWindow(page)).getByRole('button', {
      name: 'Manage data, 1.2 GB on this Mac',
      exact: true,
    }),
  ).toBeVisible();
  await openYourData(page);
  const settings = page.getByRole('dialog', { name: 'Your data' });
  await expect(settings).toContainText('1.2 GB of 2.0 GB in /Users/dana/.kalkidan');
  // The page has no data notice, store, or removal sections.
  for (const name of [
    'Where your data goes',
    'What each store keeps, and for how long',
    'When you remove a host, an account, or the app',
  ])
    await expect(settings.getByRole('button', { name })).toHaveCount(0);
  await settings.getByRole('button', { name: 'Export…' }).click();
  await expect(page.getByRole('status').getByText('Exported 12 files.')).toBeVisible();
  // Delete chat history is in the Danger zone.
  await settings
    .getByRole('list', { name: 'Danger zone' })
    .getByRole('button', { name: 'Delete chat history…' })
    .click();
  const confirm = page.getByRole('dialog', { name: 'Delete chat history?' });
  await expect(confirm).toContainText('Project documents and memory stay.');
  await confirm.getByRole('button', { name: 'Delete chat history' }).click();
  await expect(confirm).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).calls)).toEqual([
    ['localDataExport'],
    ['localDataDelete', 'chat-history'],
  ]);
  await expect(settings).toBeVisible();
});

test('Settings › Data warns when only chat history keeps the folder above the limit', async ({
  page,
}) => {
  await fixture(
    page,
    `     return { localDataUsage: async () => ({ root: '/r', total: 2_500_000_000, limit: 2_000_000_000, categories: [] }) };`,
  );
  await openYourData(page);
  const settings = page.getByRole('dialog', { name: 'Your data' });
  await expect(settings.getByRole('alert')).toContainText(
    'Chat history is never removed automatically',
  );
});
