import { test, expect } from '@playwright/test';

test('search finds project, session and message text and opens the conversation', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:5173');
  const input = page.getByLabel('Search projects or sessions');
  const results = page.getByRole('region', { name: 'Search results' });
  await input.fill('Atlas');
  await expect(results.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  await expect(results.getByRole('button', { name: 'Atlas', exact: true })).toBeVisible();
  await input.fill('authentication');
  await expect(results.getByRole('heading', { name: 'Sessions', exact: true })).toBeVisible();
  await input.fill('original messages');
  await expect(results.getByRole('heading', { name: 'Chat history', exact: true })).toBeVisible();
  await expect(results.locator('.history-search-hit')).toHaveCount(2);
  await results.locator('.history-search-hit').first().click();
  await expect(page.getByRole('region', { name: 'Conversation', exact: true })).toBeVisible();
  await expect(page.locator('.conversation-toolbar-title')).toContainText('Refine project');
  await input.fill('zzzz-no-result');
  await expect(results.getByText('No matches found.')).toBeVisible();
  await input.fill('');
  await expect(page.getByRole('region', { name: 'Projects and repositories' })).toBeVisible();
});

test('search discards stale results and reports inaccessible or truncated transcripts', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [],
        groups: [],
        sessions: [
          { id: 'one', agent: 'codex', title: 'Long chat', cwd: '/work', updatedAt: '' },
          { id: 'two', agent: 'claude', title: 'Unavailable chat', cwd: '/work', updatedAt: '' },
        ],
        warnings: [],
        platform: 'darwin',
      }),
      transcript: async (_agent: string, id: string) => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        if (id === 'two') throw Error('Host unavailable');
        return {
          messages: [{ id: 'm', role: 'assistant', text: 'needle in history' }],
          truncated: true,
        };
      },
    };
  });
  await page.goto('http://127.0.0.1:5173');
  const input = page.getByLabel('Search projects or sessions');
  await input.fill('needle');
  await page.waitForTimeout(350);
  await input.fill('other');
  await expect(
    page.getByRole('region', { name: 'Search results' }).getByRole('alert'),
  ).toContainText('could not be searched');
  await expect(
    page.getByRole('region', { name: 'Search results' }).getByRole('alert'),
  ).toContainText('most recent messages');
  await expect(page.locator('.history-search-hit')).toHaveCount(0);
});
