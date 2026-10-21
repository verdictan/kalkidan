import { test, expect, type Page } from '@playwright/test';

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
      agentInstallations: async () => [
        {
          agent: 'codex',
          status: 'installed',
          path: '/usr/local/bin/codex',
          version: '0.163.0-alpha.10.2',
        },
        { agent: 'claude', status: 'installed', path: '/usr/local/bin/claude', version: '2.1.296' },
      ],
      chatCreate: async (_projectId: string, agent: string) => refused(agent),
      chatStart: async (agent: string) => refused(agent),
      chatStatus: async () => refused('claude'),
    };
  });
}

test('Settings › Agents shows each version and whether it meets the minimum', async ({ page }) => {
  await installWorkspace(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('tab', { name: 'Agents', exact: true }).click();
  await expect(settings).toContainText('Kalkidan needs Codex 0.160.0 or later');
  await expect(settings).toContainText('Claude Code 2.1.300 or later');
  const agents = settings.getByRole('region', { name: 'Agents on this computer' });
  const codex = agents.getByRole('listitem', { name: 'Codex on this computer' });
  await expect(codex).toContainText('Meets the minimum');
  await expect(agents.getByTestId('agent-version-codex')).toContainText(
    'Version 0.163.0-alpha.10.2',
  );
  const claude = agents.getByRole('listitem', { name: 'Claude Code on this computer' });
  await expect(claude).toContainText('Update required: needs 2.1.300 or later');
  await expect(agents.getByTestId('agent-version-claude')).toContainText('Version 2.1.296');
  await expect(claude).toContainText(
    'Kalkidan needs Claude Code 2.1.300 or later. Update Claude Code, then try again.',
  );
  await expect(claude.getByRole('button', { name: /^Copy npm i -g/ })).toBeVisible();
  await expect(agents.getByRole('status')).toContainText('Codex: Meets the minimum.');
  await expect(agents.getByRole('status')).toContainText(
    'Claude Code: Update required: needs 2.1.300 or later.',
  );
});

test('a Claude Code version below the minimum refuses the send and links to Settings › Agents', async ({
  page,
}) => {
  await installWorkspace(page);
  await page.goto('/');
  await page.locator('.repo-select').first().click();
  await page.getByRole('button', { name: 'Choose an agent', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New Claude Code chat', exact: true }).click();
  const composer = page.getByLabel('Message agent');
  await composer.fill('Reply OK.');
  await composer.press('Enter');
  const message = page.locator('.chat-message.user');
  await expect(message).toContainText(
    'Kalkidan needs Claude Code 2.1.300 or later. Update Claude Code, then try again.',
  );
  await expect(message).not.toContainText('desktop.');
  await message.getByRole('button', { name: 'Open agent settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings.getByRole('tab', { name: 'Agents', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(settings.getByRole('region', { name: 'Agents on this computer' })).toBeFocused();
});
