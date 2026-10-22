import { type Locator, type Page } from '@playwright/test';
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

/** Shows one view of a chat list, such as "Failed (1)", from its Filter chats menu. */
async function showView(list: Locator, view: string) {
  await list.getByRole('button', { name: 'Filter chats', exact: true }).click();
  await list.page().getByRole('menuitemradio', { name: view, exact: true }).click();
}

const failedWords = 'The last run failed. The managed gateway stopped this turn after a refusal.';
const refusedWords = 'Managed agents did not start the last run. Sign in to managed agents.';

test('sidebar chats show failed and refused dots with the reason', async ({ page }) => {
  await withOutcomes(page);
  const row = (title: string) => tree(page).getByRole('button', { name: `Chat: ${title}` });
  const failed = row('Failed chat').locator('.activity-dot');
  await expect(failed).toHaveAttribute('data-state', 'failed');
  await expect(failed).toHaveAttribute('title', failedWords);
  await expect(row('Failed chat').getByRole('img', { name: failedWords })).toBeVisible();
  const refused = row('Refused chat').locator('.activity-dot');
  await expect(refused).toHaveAttribute('data-state', 'refused');
  await expect(refused).toHaveAttribute('aria-label', refusedWords);
  // A completed run and a chat without an outcome show no dot.
  await expect(row('Completed chat').locator('.activity-dot')).toHaveCount(0);
  await expect(row('Plain chat').locator('.activity-dot')).toHaveCount(0);
  // Opening the chat does not remove the failed dot. Only a new run changes it.
  await row('Failed chat').click();
  await expect(row('Failed chat')).toHaveAttribute('aria-current', 'page');
  await expect(failed).toHaveAttribute('data-state', 'failed');
});

test('All chats and the project Chats tab filter failed and refused chats', async ({ page }) => {
  await withOutcomes(page);
  await tree(page).getByRole('button', { name: 'All chats', exact: true }).click();
  const all = page.getByRole('region', { name: 'All chats' });
  await expect(all.getByRole('button', { name: /^Resume / })).toHaveCount(4);
  await expect(
    all.getByRole('button', { name: 'Resume Failed chat' }).locator('.activity-dot'),
  ).toHaveAttribute('data-state', 'failed');
  await showView(all, 'Failed (1)');
  await expect(all.getByRole('button', { name: /^Resume / })).toHaveCount(1);
  await expect(all.getByRole('button', { name: 'Resume Failed chat' })).toBeVisible();
  await showView(all, 'Refused (1)');
  await expect(all.getByRole('button', { name: /^Resume / })).toHaveCount(1);
  await expect(all.getByRole('button', { name: 'Resume Refused chat' })).toBeVisible();

  await tree(page).getByRole('button', { name: 'Outcomes', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Project page' })
    .getByRole('button', { name: 'Chats' })
    .click();
  const chats = page.getByRole('region', { name: 'Project chats' });
  await expect(chats.getByRole('button', { name: /^Resume / })).toHaveCount(4);
  await showView(chats, 'Refused (1)');
  await expect(chats.getByRole('button', { name: /^Resume / })).toHaveCount(1);
  await expect(chats.getByRole('img', { name: refusedWords })).toBeVisible();
  await showView(chats, 'Failed (1)');
  await expect(chats.getByRole('button', { name: 'Resume Failed chat' })).toBeVisible();
});

test('the command palette shows the failed dot of a chat', async ({ page }) => {
  await withOutcomes(page);
  await page.getByRole('button', { name: 'Search or run a command', exact: true }).click();
  const palette = page.getByRole('dialog', { name: 'Search or run a command' });
  await palette.getByRole('combobox').fill('Failed chat');
  await expect(palette.getByRole('img', { name: failedWords })).toBeVisible();
});

test('a refused new chat stays a draft and shows the refused dot', async ({ page }) => {
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
  await expect(page.locator('.chat-message.user .chat-send-failure')).toBeVisible();
  const dot = tree(page).locator('.session-row .activity-dot[data-state="refused"]');
  await expect(dot).toHaveCount(1);
  await expect(dot).toHaveAttribute('title', refusedWords);
});
