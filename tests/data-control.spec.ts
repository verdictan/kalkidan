import { type Page } from '@playwright/test';
import { test, expect, openPreferences } from './helpers/app';

/** A signed-in desktop with the local data methods. `extra` replaces parts of the API. */
async function fixture(page: Page, extra = '') {
  await page.addInitScript((extra) => {
    const w = window as any;
    w.calls = [];
    // The main process keeps the state in a file. The fixture keeps it across a reload.
    w.noticeSeen = localStorage.getItem('test-notice-seen') === 'true';
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
      dataNoticeState: async () => ({ seen: w.noticeSeen }),
      setDataNoticeSeen: async () => {
        w.calls.push(['setDataNoticeSeen']);
        w.noticeSeen = true;
        localStorage.setItem('test-notice-seen', 'true');
        return { seen: true };
      },
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

const notice = (page: Page) => page.getByRole('dialog', { name: 'Where your data goes' });

test('the data notice shows once before the first request and names all three places', async ({
  page,
}) => {
  await fixture(page);
  const dialog = notice(page);
  await expect(dialog).toBeVisible();
  for (const name of [
    'Stays on the execution host',
    'Goes to the model provider',
    'Verdictan keeps in your selected region',
  ])
    await expect(dialog.getByRole('heading', { name })).toBeVisible();
  await expect(dialog).toContainText('a hash of the prompt');
  // Escape does not dismiss it. The user must select Continue.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).calls)).toEqual([['setDataNoticeSeen']]);
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Projects and repositories' })).toBeVisible();
  await expect(notice(page)).toHaveCount(0);
});

test('the notice does not show when the user already read it', async ({ page }) => {
  await fixture(page, 'window.noticeSeen = true; return {};');
  await expect(page.getByRole('navigation', { name: 'Projects and repositories' })).toBeVisible();
  await expect(notice(page)).toHaveCount(0);
});

test('Preferences › Your data keeps the notice, the disk use, export, and deletion', async ({
  page,
}) => {
  await fixture(page, 'window.noticeSeen = true; return {};');
  await (await openPreferences(page)).getByRole('button', { name: 'Manage…' }).last().click();
  const settings = page.getByRole('dialog', { name: 'Your data' });
  await expect(settings.getByRole('heading', { name: 'Goes to the model provider' })).toBeVisible();
  await expect(settings).toContainText('1.2 GB of 2.0 GB in /Users/dana/.kalkidan');
  await settings.getByRole('button', { name: 'Export…' }).click();
  await expect(page.getByRole('status').getByText('Exported 12 files.')).toBeVisible();
  await settings.getByRole('button', { name: 'Delete…' }).last().click();
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

test('Preferences › Your data warns when only chat history keeps the folder above the limit', async ({
  page,
}) => {
  await fixture(
    page,
    `window.noticeSeen = true;
     return { localDataUsage: async () => ({ root: '/r', total: 2_500_000_000, limit: 2_000_000_000, categories: [] }) };`,
  );
  await (await openPreferences(page)).getByRole('button', { name: 'Manage…' }).last().click();
  const settings = page.getByRole('dialog', { name: 'Your data' });
  await expect(settings.getByRole('alert')).toContainText(
    'Chat history is never removed automatically',
  );
});
