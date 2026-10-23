import { type Page } from '@playwright/test';
import { test, expect, newChat, settingsDialog } from './helpers/app';
import { openCodeFolder } from './helpers/navigation';

/** A workspace with one project. Each send is refused because Claude Code is too old. */
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
      errorCode: 'managed_launch_blocked',
      // The text that the desktop sends for desktop.claude_code_version_unsupported.
      error:
        'Kalkidan runs agents only through managed Verdictan agents. It does not start a local agent CLI directly. Kalkidan needs Claude Code 2.1.300 or later. Update Claude Code, then try again.',
      managedSetup: 'agents',
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

test('a Claude Code version below the minimum refuses the send and links to Settings › Tools', async ({
  page,
}) => {
  await installWorkspace(page);
  await page.goto('/');
  await openCodeFolder(page);
  await newChat(page, 'claude');
  const composer = page.getByLabel('Message agent');
  await composer.fill('Reply OK.');
  await composer.press('Enter');
  // The send failure is a card after the message.
  const message = page.locator('.chat-card').filter({
    has: page.getByRole('heading', { name: 'Claude Code could not start', exact: true }),
  });
  await expect(message).toContainText(
    'Kalkidan needs Claude Code 2.1.300 or later. Update Claude Code, then try again.',
  );
  await expect(message).not.toContainText('desktop.');
  await expect(message.getByRole('button', { name: 'Install guide', exact: true })).toBeVisible();
  await message.getByRole('button', { name: 'Tools…', exact: true }).click();
  // Settings opens at Tools, which shows the version that Kalkidan found. Kalkidan does not
  // update the agent CLIs, so the row has no update button.
  const tools = settingsDialog(page).getByRole('region', { name: 'Tools', exact: true });
  await expect(tools).toBeFocused();
  const claude = tools.getByRole('listitem').filter({ hasText: 'Claude Code' });
  await expect(claude).toContainText('2.1.296');
  await expect(claude.getByRole('button')).toHaveCount(0);
});
