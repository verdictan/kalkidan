import { type Page } from '@playwright/test';
import { test, expect } from './helpers/app';

/** Opens the Usage card of the Atlas project: "Usage" in the "Project actions" menu. */
async function openAtlasUsage(page: Page) {
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await page.getByRole('main').getByRole('button', { name: 'Project actions' }).click();
  await page.getByRole('menuitem', { name: /^Usage/ }).click();
}
/** The Usage card beside the project menu. */
const usageRegion = (page: Page) =>
  page.getByRole('region', { name: 'Usage of Atlas', exact: true });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kalkidan:onboarding:v1', 'dismissed'));
});

async function usageWorkspace(page: Page, usage: 'history' | 'unavailable' | 'empty') {
  await page.addInitScript((mode) => {
    const now = new Date();
    now.setHours(12, 0, 0, 0);
    const day = (offset: number) => new Date(now.getTime() - offset * 86400000).toISOString();
    const request = (values: Record<string, unknown>) => ({
      time: day(0),
      decision: 'allow',
      reason: 'allowed',
      review: null,
      provider: 'openai',
      model: 'gpt-5.4',
      agent: 'codex',
      inputTokens: '1000',
      outputTokens: '200',
      cachedInputTokens: '50',
      totalTokens: '1200',
      cost: '0.25',
      currency: 'USD',
      settlement: 'completed',
      corrected: false,
      releasedAt: null,
      settledAt: null,
      startedAt: null,
      completedAt: null,
      latencyMs: null,
      audited: true,
      ...values,
    });
    const calls: unknown[] = [];
    (window as any).usageCalls = calls;
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [{ id: 'r', name: 'web', path: '/work/web', notes: '', favorite: false }],
        groups: [{ id: 'g', name: 'Atlas', repoIds: ['r'] }],
        sessions: [
          {
            id: 'metered',
            agent: 'codex',
            cwd: '/work/web',
            title: 'Fix the build',
            updatedAt: day(0),
          },
          {
            id: 'subscription',
            agent: 'claude',
            cwd: '/work/web/app',
            title: 'Review the login flow',
            updatedAt: day(1),
          },
          { id: 'other', agent: 'codex', cwd: '/elsewhere', title: 'Other', updatedAt: day(0) },
        ],
        warnings: [],
        platform: 'darwin',
      }),
      git: async () => ({ branch: 'main' }),
      projectUsage: async (groupId: string, chats: unknown, options?: unknown) => {
        calls.push(options ? [groupId, chats, options] : [groupId, chats]);
        if (mode === 'unavailable')
          throw new Error(
            "Error invoking remote method 'project-usage': Error: Managed agents are not ready.",
          );
        if (mode === 'empty')
          return { chats: [], unmanaged: 2, failed: 0, skipped: 0, observedAt: day(0) };
        return {
          observedAt: new Date().toISOString(),
          unmanaged: 0,
          failed: 0,
          skipped: 0,
          chats: [
            {
              agent: 'codex',
              sessionId: 'metered',
              billing: 'metered',
              complete: true,
              entries: [
                request({}),
                request({ time: day(2), decision: 'deny', reason: 'policy_denied' }),
              ],
            },
            {
              agent: 'claude',
              sessionId: 'subscription',
              billing: 'subscription',
              complete: true,
              entries: [request({ model: 'claude-opus-4', cost: null, currency: null })],
            },
          ],
        };
      },
    };
  }, usage);
}

test('the Usage card without a board shows the managed-agent usage of the project chats', async ({
  page,
}) => {
  await usageWorkspace(page, 'history');
  await page.goto('/');
  await openAtlasUsage(page);
  const usage = usageRegion(page);
  await expect(usage).toContainText('Atlas · last 14 days');
  // The subscription request is included, so the cost is the cost of the metered requests.
  await expect(usage).toContainText('$0.50');
  await expect(usage).toContainText('3 requests · 1 refused');
  // The menu row shows the same cost.
  await expect(page.getByRole('menuitem', { name: /^Usage/ })).toContainText('$0.50');
  const days = usage.getByRole('list', { name: 'Requests for each day' });
  await expect(days.getByRole('listitem')).toHaveCount(14);
  // The sessions by cost. A session row opens the chat.
  const sessions = usage.getByRole('list', { name: 'Usage by session' });
  await expect(sessions.getByRole('listitem')).toHaveCount(2);
  await expect(sessions.getByRole('listitem').first()).toContainText('Fix the build');
  await expect(sessions.getByRole('listitem').first()).toContainText('$0.50');
  await expect(sessions.getByRole('button', { name: /^Review the login flow/ })).toContainText(
    'Included',
  );
  // Only the chats in the code folders of the project go to the backend.
  const calls = await page.evaluate(() => (window as any).usageCalls);
  expect(calls[0]).toEqual([
    'g',
    [
      { agent: 'codex', sessionId: 'metered' },
      { agent: 'claude', sessionId: 'subscription' },
    ],
  ]);
  // The usage needs no board: Atlas has none. Escape closes the menu and the card.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(usage).toHaveCount(0);
});

test('the Usage card tells when the usage history is unavailable', async ({ page }) => {
  await usageWorkspace(page, 'unavailable');
  await page.goto('/');
  await openAtlasUsage(page);
  const usage = usageRegion(page);
  await expect(usage).toContainText('Managed agents are not ready.');
  // An error without a managed code offers one action: Try again, which reads each chat again.
  await expect(usage.getByRole('button', { name: 'Open Settings' })).toHaveCount(0);
  const before = await page.evaluate(() => (window as any).usageCalls.length);
  await usage.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).usageCalls.length))
    .toBeGreaterThan(before);
  expect((await page.evaluate(() => (window as any).usageCalls)).at(-1)[2]).toEqual({
    fresh: true,
  });
});

test('the Usage card tells when the project chats have no managed requests', async ({ page }) => {
  await usageWorkspace(page, 'empty');
  await page.goto('/');
  await openAtlasUsage(page);
  const usage = usageRegion(page);
  await expect(usage).toContainText('0 requests · 0 refused');
  await expect(usage.getByRole('list', { name: 'Usage by session' })).toHaveCount(0);
});
