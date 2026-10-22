import { type Page } from '@playwright/test';
import { test, expect } from './helpers/app';

/** Opens a view of Knowledge › Insights of the Atlas project from the sidebar. */
async function openAtlas(page: Page, view: 'Agent usage' | 'Board') {
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Project page', exact: true })
    .getByRole('button', { name: 'Knowledge', exact: true })
    .click();
  await page
    .getByRole('complementary', { name: 'Knowledge sections' })
    .getByRole('button', { name: view, exact: true })
    .click();
}
/** The usage part of the Agent usage view. */
const usageRegion = (page: Page) =>
  page
    .getByRole('region', { name: 'Agent usage', exact: true })
    .getByRole('region', { name: 'Usage details', exact: true });

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

test('Insights without a board show the managed-agent usage of the project chats', async ({
  page,
}) => {
  await usageWorkspace(page, 'history');
  await page.goto('/');
  await openAtlas(page, 'Agent usage');
  const usage = usageRegion(page);
  const totals = usage.getByRole('definition');
  // The intro uses the same words as the Usage history of a chat.
  await expect(usage).toContainText(
    '“Unknown” shows when Verdictan has no record of a value. The costs come from Verdictan. Your provider sends the bill.',
  );
  await expect(usage).not.toContainText('This is not a bill');
  await expect(usage.getByLabel('Usage totals')).toContainText('Requests3');
  await expect(usage.getByLabel('Usage totals')).toContainText('Allowed2');
  await expect(usage.getByLabel('Usage totals')).toContainText('Refused1');
  await expect(usage.getByLabel('Usage totals')).toContainText('3,000 in · 600 out · 150 cached');
  await expect(usage.getByLabel('Usage totals')).toContainText(
    '0.5 USD · 1 included in your subscription',
  );
  expect(await totals.count()).toBeGreaterThan(4);
  await expect(
    usage.getByRole('listitem').filter({ hasText: 'gpt-5.4 · 2 requests' }),
  ).toBeVisible();
  await expect(usage.getByText('Included in your subscription', { exact: true })).toBeVisible();
  // Each chat shows the computer that runs it.
  await expect(usage.getByRole('list', { name: 'Usage by chat' })).toContainText(
    'Codex · This computer · 2 requests',
  );
  const days = usage.getByRole('list', { name: 'Requests for each day, last 14 days' });
  await expect(days.getByRole('listitem')).toHaveCount(14);
  await expect(
    usage.getByRole('button', { name: 'Review the login flow', exact: true }),
  ).toBeVisible();
  // Only the chats in the code folders of the project go to the backend.
  const calls = await page.evaluate(() => (window as any).usageCalls);
  expect(calls[0]).toEqual([
    'g',
    [
      { agent: 'codex', sessionId: 'metered' },
      { agent: 'claude', sessionId: 'subscription' },
    ],
  ]);
  // Load again reads each chat again, and the old usage stays on the page.
  const before = calls.length;
  expect(calls.every((call: unknown[]) => call.length === 2)).toBe(true);
  await usage.getByRole('button', { name: 'Load again', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).usageCalls.length)).toBe(before + 1);
  expect((await page.evaluate(() => (window as any).usageCalls)).at(-1)[2]).toEqual({
    fresh: true,
  });
  await expect(usage.getByLabel('Usage totals')).toContainText('Requests3');
  // The usage needs no board. The Board view offers to connect one.
  await openAtlas(page, 'Board');
  await expect(page.getByRole('button', { name: 'Connect a board', exact: true })).toBeVisible();
});

test('Insights tell when the usage history is unavailable or empty', async ({ page }) => {
  await usageWorkspace(page, 'unavailable');
  await page.goto('/');
  await openAtlas(page, 'Agent usage');
  const usage = usageRegion(page);
  await expect(
    usage.getByRole('heading', { name: 'Usage history is not available' }),
  ).toBeVisible();
  await expect(usage.getByText('Managed agents are not ready.', { exact: true })).toBeVisible();
  // An error without a managed code offers one action: Try again, which reads each chat again.
  await expect(usage.getByRole('button', { name: 'Open Settings' })).toHaveCount(0);
  const before = await page.evaluate(() => (window as any).usageCalls.length);
  await usage.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).usageCalls.length)).toBe(before + 1);
  expect((await page.evaluate(() => (window as any).usageCalls)).at(-1)[2]).toEqual({
    fresh: true,
  });
});

test('Insights tell when the project chats have no managed requests', async ({ page }) => {
  await usageWorkspace(page, 'empty');
  await page.goto('/');
  await openAtlas(page, 'Agent usage');
  const usage = usageRegion(page);
  await expect(usage.getByRole('heading', { name: 'No managed-agent requests' })).toBeVisible();
  await expect(
    usage.getByText('The chats of this project do not use a managed agent with this account.'),
  ).toBeVisible();
});
