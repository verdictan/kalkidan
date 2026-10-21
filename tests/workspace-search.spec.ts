import { test, expect } from '@playwright/test';

test('search finds project, session and message text and opens the conversation', async ({
  page,
}) => {
  await page.goto('/');
  const input = page.getByLabel('Search projects and chats');
  const results = page.getByRole('region', { name: 'Search results' });
  await input.fill('Atlas');
  await expect(results.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  await expect(results.getByRole('option', { name: 'Atlas', exact: true })).toBeVisible();
  await input.fill('authentication');
  await expect(results.getByRole('heading', { name: 'Chats', exact: true })).toBeVisible();
  await input.fill('original messages');
  // A message match shows as an excerpt under its session row.
  await expect(results.getByRole('heading', { name: 'Chats', exact: true })).toBeVisible();
  await expect(results.locator('.history-search-hit')).toHaveCount(2);
  await results.locator('.history-search-hit').first().click();
  await expect(page.getByRole('region', { name: 'Chat', exact: true })).toBeVisible();
  await expect(page.locator('.conversation-toolbar-title')).toContainText('Refine project');
  await input.fill('zzzz-no-result');
  await expect(results.getByText('No matches found.')).toBeVisible();
  await input.fill('');
  await expect(page.getByRole('navigation', { name: 'Projects and repositories' })).toBeVisible();
});

test('search results support arrow keys, Enter, and Escape', async ({ page }) => {
  await page.goto('/');
  const input = page.getByLabel('Search projects and chats');
  const results = page.getByRole('region', { name: 'Search results' });
  await input.fill('Atlas');
  await expect(results.getByRole('status').first()).toContainText(/\d+ match/);
  await input.press('ArrowDown');
  const active = await input.getAttribute('aria-activedescendant');
  expect(active).toBeTruthy();
  await expect(page.locator(`[id="${active}"]`)).toHaveAttribute('aria-selected', 'true');
  await input.press('Escape');
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await input.press('Escape');
  await expect(input).not.toBeFocused();
  await input.fill('Atlas');
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(input).toHaveValue('');
  await input.fill('Atlas');
  await input.press('Enter');
  await expect(page.getByRole('region', { name: 'Project tracker', exact: true })).toBeVisible();
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
  await page.goto('/');
  const input = page.getByLabel('Search projects and chats');
  await input.fill('needle');
  await page.waitForTimeout(350);
  await input.fill('other');
  await expect(
    page.getByRole('region', { name: 'Search results' }).getByRole('alert'),
  ).toContainText('could not be searched');
  await expect(
    page.getByRole('region', { name: 'Search results' }).getByText(/most recent messages/),
  ).toHaveAttribute('role', 'status');
  await expect(page.locator('.history-search-hit')).toHaveCount(0);
});

test('a one-character query shows only the two-character hint', async ({ page }) => {
  await page.goto('/');
  const input = page.getByLabel('Search projects and chats');
  const results = page.getByRole('region', { name: 'Search results' });
  await input.fill('¤');
  await expect(results.getByRole('status').first()).toHaveText(
    'Type at least two characters to search message text.',
  );
  await expect(results.getByText('No matches found.')).toHaveCount(0);
  await expect(results.getByText(/0 matches/)).toHaveCount(0);
});
