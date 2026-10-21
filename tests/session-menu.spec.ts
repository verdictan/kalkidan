import { test, expect } from '@playwright/test';
import { openCodeFolder } from './helpers/navigation';
async function openSession(page: any) {
  await page.goto('/');
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await openCodeFolder(page);
  await page
    .getByRole('button', { name: /^Resume / })
    .first()
    .click();
}
test('session actions rename, pin, fork, and open an independent side session', async ({
  page,
}) => {
  await openSession(page);
  const menu = () => page.getByRole('button', { name: 'Chat actions', exact: true }).click();
  await menu();
  await page.screenshot({ animations: 'disabled', path: 'test-results/conversation-actions.png' });
  await page.getByRole('menuitem', { name: /^Rename/ }).click();
  await page.getByLabel('Session name').fill('Release review');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.locator('.conversation-toolbar-title')).toContainText('Release review');
  await menu();
  await page.getByRole('menuitem', { name: /^Pin/ }).click();
  await expect(
    page
      .getByRole('navigation', { name: 'Projects and repositories' })
      .getByRole('button', { name: 'Resume pinned Release review', exact: true }),
  ).toBeVisible();
  await menu();
  await expect(page.getByRole('menuitem', { name: /^Unpin/ })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Duplicate chat', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'Continue here' }).click();
  await expect(page.locator('.conversation-toolbar-title:visible')).toContainText(
    'Fork of Release review',
  );
  await menu();
  await page.getByRole('menuitem', { name: /Open a second chat beside this one/ }).click();
  await expect(page.getByLabel('Message agent')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Close side chat' })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: 'test-results/side-session.png' });
  await page.getByRole('button', { name: 'Close side chat' }).click();
  await expect(page.getByRole('button', { name: 'Close side chat' })).toHaveCount(0);
});
test('archive closes the session at once and the toast can undo it', async ({ page }) => {
  await openSession(page);
  const title = await page.locator('.conversation-toolbar-title').innerText();
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Archive/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Chat archived' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Chat', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Chat restored' })).toBeVisible();
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
});
test('chat actions open the managed agent usage history of the chat', async ({ page }) => {
  await openSession(page);
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Usage history…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Usage history' });
  await expect(dialog).toContainText('Verdictan keeps one history for chats and tasks.');
  await expect(dialog).toContainText('No requests. Verdictan may not have them yet.');
  await dialog.getByRole('button', { name: 'Load again', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Next page' })).toHaveCount(0);
});
test('usage history loads on open and shows duration and subscription cost', async ({ page }) => {
  await page.addInitScript(() => {
    const session = { id: 's', agent: 'claude', title: 'Review', cwd: '/repo', updatedAt: '' };
    (window as any).historyCalls = 0;
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [
          { id: 'r', name: 'Repo', path: '/repo', notes: '', addedAt: '', favorite: false },
        ],
        groups: [{ id: 'g', name: 'Project', repoIds: ['r'] }],
        sessions: [session],
        warnings: [],
        platform: 'darwin',
      }),
      git: async () => null,
      models: async () => [],
      transcript: async () => ({ messages: [], truncated: false }),
      managedHistory: async () => {
        (window as any).historyCalls++;
        return {
          entries: [
            {
              time: '2026-10-21T10:37:57.000Z',
              decision: 'allow',
              reason: null,
              review: null,
              provider: 'anthropic',
              model: 'claude-sonnet',
              agent: 'claude_code',
              inputTokens: '10',
              outputTokens: '5',
              cachedInputTokens: null,
              totalTokens: '15',
              cost: null,
              currency: null,
              settlement: 'completed',
              corrected: false,
              releasedAt: null,
              settledAt: null,
              startedAt: '2026-10-21T10:37:57.000Z',
              completedAt: '2026-10-21T10:38:00.000Z',
              latencyMs: null,
              audited: true,
              subscription: 'claude',
            },
          ],
          cursor: null,
          asOf: '2026-10-21T10:40:00.000Z',
          observedAt: '2026-10-21T10:40:00.000Z',
        };
      },
    };
  });
  await page.goto('/');
  await openCodeFolder(page);
  await page.getByRole('button', { name: 'Resume Review', exact: true }).click();
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Usage history…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Usage history' });
  // The history loads without a button press.
  await expect(dialog).toContainText('Request 1');
  await expect(dialog).toContainText('Included in your Claude subscription');
  await expect(dialog).toContainText('3 s');
  await expect(dialog).not.toContainText('This is not a bill');
  expect(await page.evaluate(() => (window as any).historyCalls)).toBe(1);
  await dialog.getByRole('button', { name: 'Load again', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).historyCalls)).toBe(2);
});
