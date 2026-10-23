import { type Page } from '@playwright/test';
import { test, expect, computersPage, newChat, openComputersPage } from './helpers/app';
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

test('the Computers page shows each version and whether it meets the minimum', async ({ page }) => {
  await installWorkspace(page);
  await page.goto('/');
  const settings = await openComputersPage(page);
  // The row of each agent shows the version. A program that is too old needs an update, and
  // only that row has a button.
  const claudeRow = settings.getByRole('group', { name: 'Claude Code', exact: true });
  await expect(claudeRow).toContainText('2.1.296 · needs 2.1.300');
  const codexRow = settings.getByRole('group', { name: 'Codex', exact: true });
  await expect(codexRow).toBeVisible();
  await expect(codexRow).not.toContainText('needs');
  await expect(codexRow.getByRole('button', { name: 'Update Codex' })).toHaveCount(0);
  // Details › Programs… opens the programs of this computer, with the minimum of each agent.
  await settings.getByRole('button', { name: 'Details', exact: true }).click();
  await settings.getByRole('button', { name: 'Programs…', exact: true }).click();
  const allPrograms = page.getByRole('dialog', {
    name: 'Coding agent programs on this computer',
    exact: true,
  });
  await expect(allPrograms).toContainText('Kalkidan needs Codex 0.160.0 or later');
  const codex = allPrograms
    .getByRole('list', { name: 'Coding agents on this computer' })
    .getByRole('listitem', { name: 'Codex on this computer' });
  await expect(codex).toContainText('Meets the minimum');
  await expect(allPrograms.getByTestId('agent-version-codex')).toContainText(
    'Version 0.163.0-alpha.10.2',
  );
  await page.keyboard.press('Escape');
  await expect(allPrograms).toHaveCount(0);
  // "Update Claude Code" on the Claude Code row opens the Claude Code program, with the command.
  await claudeRow.getByRole('button', { name: 'Update Claude Code', exact: true }).click();
  const programs = page.getByRole('dialog', { name: 'Claude Code on this computer', exact: true });
  await expect(programs).toContainText('Kalkidan needs Claude Code 2.1.300 or later');
  const agents = programs.getByRole('list', { name: 'Coding agents on this computer' });
  await expect(agents.getByRole('listitem')).toHaveCount(1);
  const claude = agents.getByRole('listitem', { name: 'Claude Code on this computer' });
  await expect(claude).toContainText('Update required: needs 2.1.300 or later');
  await expect(agents.getByTestId('agent-version-claude')).toContainText('Version 2.1.296');
  await expect(claude.getByRole('button', { name: /^Copy npm i -g/ })).toBeVisible();
  await expect(programs.getByRole('status').filter({ hasText: 'Checked' })).toBeVisible();
});

test('a Claude Code version below the minimum refuses the send and links to the Computers page', async ({
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
  await message.getByRole('button', { name: 'Open agent settings', exact: true }).click();
  // The Computers page opens with the agent rows.
  const settings = computersPage(page);
  await expect(settings).toBeVisible();
  const claude = settings.getByRole('group', { name: 'Claude Code', exact: true });
  await expect(
    claude.getByRole('button', { name: 'Update Claude Code', exact: true }),
  ).toBeVisible();
  // The focus moves to the row of the agent in the message.
  await expect(page.locator('#agent-program-local-claude')).toBeFocused();
});
