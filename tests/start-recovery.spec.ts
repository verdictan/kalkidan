import { type Page } from '@playwright/test';
import { test, expect, newChat } from './helpers/app';
import { openCodeFolder } from './helpers/navigation';

/** A workspace with one project. Each send is refused because another operation runs. */
async function installWorkspace(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.calls = 0;
    const refused = (agent: string) => ({
      id: 'refused-' + ++w.calls,
      agent,
      sessionId: '',
      status: 'failed',
      messages: [],
      activity: '',
      error: 'The gateway is busy. Code: desktop.operation_in_progress',
    });
    w.workspace = {
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
      trackerProviders: async () => [],
      git: async () => null,
      githubCliCheck: async () => ({ status: 'missing' }),
      githubAuthStatus: async () => ({ status: 'idle' }),
      computerTools: async () => [
        {
          computer: 'local',
          name: 'This Mac',
          connected: true,
          checkedAt: new Date().toISOString(),
          tools: [
            {
              tool: 'codex',
              name: 'Codex',
              kind: 'agent',
              state: 'ready',
              installed: true,
              version: '0.163.0',
              signedIn: 'yes',
              access: 'granted',
              usable: true,
              installUrl: 'https://example.com/codex',
            },
            {
              tool: 'claude',
              name: 'Claude Code',
              kind: 'agent',
              state: 'ready',
              installed: true,
              version: '2.1.296',
              signedIn: 'yes',
              access: 'granted',
              usable: true,
              installUrl: 'https://example.com/claude',
            },
          ],
        },
      ],
      chatCreate: async (_projectId: string, agent: string) => refused(agent),
      chatStart: async (agent: string) => refused(agent),
      chatStatus: async () => refused('claude'),
    };
  });
}

test('a start refused by a short gateway wait sends again by itself', async ({ page }) => {
  await installWorkspace(page);
  await page.goto('/');
  await openCodeFolder(page);
  await newChat(page, 'codex');
  const composer = page.getByLabel('Message agent');
  await composer.fill('Reply OK.');
  await composer.press('Enter');
  const card = page.locator('.chat-card').filter({
    has: page.getByRole('heading', { name: 'Codex could not start', exact: true }),
  });
  await expect(card).toContainText('Kalkidan tries again in 3 seconds.');
  // The first automatic try sends the same message again, without a click.
  await expect.poll(() => page.evaluate(() => (window as any).calls), { timeout: 8000 }).toBe(2);
  await expect(card).toContainText('Kalkidan tries again in 6 seconds.');
});
