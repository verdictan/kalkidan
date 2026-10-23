import { type Page } from '@playwright/test';
import { test, expect, newChat } from './helpers/app';
import { openCodeFolder } from './helpers/navigation';

const tree = (page: Page) => page.getByRole('navigation', { name: 'Projects and repositories' });
const at = (day: number) => new Date(Date.UTC(2026, 9, day)).toISOString();

/** A project with a failed chat, a refused chat, a completed chat and a chat without an outcome. */
async function withOutcomes(page: Page) {
  await page.addInitScript(
    ({ sessions }) => {
      (window as any).workspace = {
        trackerProviders: async () => [],
        git: async () => null,
        models: async () => [],
        transcript: async () => ({ messages: [], truncated: false }),
        snapshot: async () => ({
          projects: [
            { id: 'r', name: 'web', path: '/tmp/web', favorite: false, notes: '', addedAt: '' },
          ],
          groups: [{ id: 'g', name: 'Outcomes', repoIds: ['r'] }],
          sessions,
          warnings: [],
          platform: 'darwin',
        }),
      };
    },
    {
      sessions: [
        {
          id: 'failed',
          agent: 'codex',
          cwd: '/tmp/web',
          title: 'Failed chat',
          updatedAt: at(4),
          outcome: { outcome: 'failed', reason: 'gateway_refused', at: at(4) },
        },
        {
          id: 'refused',
          agent: 'claude',
          cwd: '/tmp/web',
          title: 'Refused chat',
          updatedAt: at(3),
          outcome: { outcome: 'refused', reason: 'desktop.auth_required', at: at(3) },
        },
        {
          id: 'completed',
          agent: 'codex',
          cwd: '/tmp/web',
          title: 'Completed chat',
          updatedAt: at(2),
          outcome: { outcome: 'completed', at: at(2) },
        },
        { id: 'plain', agent: 'codex', cwd: '/tmp/web', title: 'Plain chat', updatedAt: at(1) },
      ],
    },
  );
  await page.goto('/');
}

const failedWords = 'The last run failed. The Verdictan gateway stopped this turn after a refusal.';
const refusedWords = 'Verdictan did not start the last run. Sign in to Verdictan.';

/** The status glyph of a chat row in the sidebar tree. */
const glyph = (page: Page, title: string) =>
  tree(page)
    .locator('.tree-row')
    .filter({ has: page.getByRole('button', { name: `Chat: ${title}`, exact: true }) })
    .locator('.status-glyph');

test('sidebar chats show failed and refused glyphs with the reason', async ({ page }) => {
  await withOutcomes(page);
  await openCodeFolder(page);
  const failed = glyph(page, 'Failed chat');
  await expect(failed).toHaveAttribute('data-status', 'failed');
  await expect(tree(page).getByRole('img', { name: failedWords })).toBeVisible();
  // A refused run shows the failed glyph with the refusal words.
  const refused = glyph(page, 'Refused chat');
  await expect(refused).toHaveAttribute('data-status', 'failed');
  await expect(refused).toHaveAttribute('aria-label', refusedWords);
  // A completed run and a chat without an outcome show no glyph.
  await expect(glyph(page, 'Completed chat')).toHaveCount(0);
  await expect(glyph(page, 'Plain chat')).toHaveCount(0);
  // Opening the chat does not remove the failed glyph. Only a new run changes it.
  const row = tree(page).getByRole('button', { name: 'Chat: Failed chat', exact: true });
  await row.click();
  await expect(row).toHaveAttribute('aria-current', 'page');
  await expect(failed).toHaveAttribute('data-status', 'failed');
});

test('the command palette shows the failed dot of a chat', async ({ page }) => {
  await withOutcomes(page);
  await page.getByRole('button', { name: 'Search or run a command', exact: true }).click();
  const palette = page.getByRole('dialog', { name: 'Search or run a command' });
  await palette.getByRole('combobox').fill('Failed chat');
  await expect(palette.getByRole('img', { name: failedWords })).toBeVisible();
});

test('a refused new chat stays a draft and shows the refusal glyph', async ({ page }) => {
  await page.addInitScript(() => {
    const refused = (agent: string) => ({
      id: 'refused-run',
      agent,
      sessionId: '',
      status: 'failed',
      messages: [],
      activity: '',
      errorCode: 'managed_launch_blocked',
      error: 'Kalkidan runs agents only through managed Verdictan agents. Sign in to Verdictan.',
      managedSetup: 'sign-in',
      managedCode: 'desktop.auth_required',
    });
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [
          { id: 'p1', name: 'web', path: '/tmp/web', favorite: false, notes: '', addedAt: '' },
        ],
        groups: [{ id: 'g1', name: 'Atlas', repoIds: ['p1'] }],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      remoteHosts: async () => [],
      git: async () => null,
      models: async () => [],
      chatCreate: async (_projectId: string, agent: string) => refused(agent),
      chatStatus: async () => refused('codex'),
    };
  });
  await page.goto('/');
  await openCodeFolder(page);
  await newChat(page);
  const composer = page.getByLabel('Message agent');
  await composer.fill('Reply OK.');
  await composer.press('Enter');
  // This build has no accounts, so the card keeps its Sign in button (no sign-in card).
  await expect(page.locator('.chat-message.user + .chat-card')).toBeVisible();
  const dot = tree(page).getByRole('img', { name: refusedWords });
  await expect(dot).toHaveCount(1);
  await expect(dot).toHaveAttribute('data-status', 'failed');
});
