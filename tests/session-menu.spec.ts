import { type Page } from '@playwright/test';
import { test, expect, openPalette, palette } from './helpers/app';
import { openCodeFolder } from './helpers/navigation';
/** Runs an action of the open chat from the command palette. */
async function runFromPalette(page: Page, name: RegExp) {
  const input = await openPalette(page);
  await input.fill(name.source.replace(/^\^/, '').replace(/…$/, ''));
  await palette(page).getByRole('option', { name }).click();
}
async function openSession(page: Page) {
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
  await page.getByLabel('Chat name').fill('Release review');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
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
  // "Fork chat…" is the one way to copy a chat. Its dialog forks to this folder first.
  await page.getByRole('menuitem', { name: 'Fork chat…', exact: true }).click();
  const fork = page.getByRole('dialog', { name: 'Fork chat', exact: true });
  await expect(fork.getByRole('button', { name: 'This folder', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await fork.getByRole('button', { name: 'Fork chat', exact: true }).click();
  await expect(fork).toHaveCount(0);
  await expect(page.locator('.conversation-toolbar-title:visible')).toContainText(
    'Release review (fork)',
  );
  // "Open side chat" is in ⌘K, not in the chat menu.
  await menu();
  await expect(page.getByRole('menuitem', { name: /^Open side chat/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await runFromPalette(page, /^Open side chat/);
  await expect(page.getByLabel('Message agent')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Close side chat' })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: 'test-results/side-session.png' });
  // The new side chat takes the focus, so no tooltip covers its close button.
  await expect(page.locator('.agent-pane[data-side] textarea')).toBeFocused();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
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
test('the command palette opens the managed agent usage history of the chat', async ({ page }) => {
  await openSession(page);
  await runFromPalette(page, /^Usage history…/);
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
  await runFromPalette(page, /^Usage history…/);
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
