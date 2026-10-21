import { test, expect, type Page } from '@playwright/test';

const oldClaude = '/home/linuxbrew/.linuxbrew/bin/claude';
const newClaude = '/home/u/.local/bin/claude';

/** This computer, one connected SSH host, and two hosts that are not connected. */
async function installWorkspace(page: Page) {
  await page.addInitScript(
    ({ oldClaude, newClaude }) => {
      const w = window as any;
      w.choices = [];
      const local = [
        { agent: 'codex', status: 'installed', path: '/usr/local/bin/codex', version: '0.163.0' },
        {
          agent: 'claude',
          status: 'installed',
          path: '/Users/me/.local/bin/claude',
          version: '2.1.306',
          source: 'automatic',
        },
      ];
      w.devbox = [
        { agent: 'codex', status: 'missing', source: 'automatic' },
        {
          agent: 'claude',
          status: 'installed',
          path: oldClaude,
          version: '2.1.287',
          source: 'automatic',
          candidates: [{ path: newClaude, version: '2.1.306' }],
        },
      ];
      const hosts = [
        { id: 'h1', name: 'devbox', target: 'u@devbox', status: 'connected' },
        {
          id: 'h2',
          name: 'buildbox',
          target: 'u@buildbox',
          status: 'disconnected',
          agentCheck: {
            checkedAt: Date.now() - 2 * 60 * 60 * 1000,
            agents: [
              { agent: 'codex', status: 'installed', path: '/opt/codex', version: '0.170.0' },
              { agent: 'claude', status: 'missing' },
            ],
          },
        },
        { id: 'h3', name: 'newbox', target: 'u@newbox', status: 'disconnected' },
      ];
      w.workspace = {
        snapshot: async () => ({
          projects: [],
          groups: [{ id: 'g', name: 'Project', repoIds: [] }],
          sessions: [],
          warnings: [],
          platform: 'darwin',
        }),
        trackerProviders: async () => [],
        remoteHosts: async () => hosts,
        githubCliCheck: async () => ({ status: 'ready' }),
        githubAuthStatus: async () => ({ status: 'idle' }),
        agentInstallations: async (hostId?: string) => (hostId === 'h1' ? w.devbox : local),
        chooseAgentExecutable: async (agent: string, path: string | null, hostId?: string) => {
          w.choices.push([agent, path, hostId]);
          if (path && !path.startsWith('/') && !path.startsWith('~/'))
            throw new Error('Enter the full path of the program.');
          const claude = w.devbox[1];
          w.devbox = [
            w.devbox[0],
            path
              ? {
                  ...claude,
                  path,
                  version: '2.1.306',
                  source: 'chosen',
                  chosenPath: path,
                  candidates: [{ path: oldClaude, version: '2.1.287' }],
                }
              : {
                  ...claude,
                  path: oldClaude,
                  version: '2.1.287',
                  source: 'automatic',
                  chosenPath: undefined,
                  candidates: [{ path: newClaude, version: '2.1.306' }],
                },
          ];
          return w.devbox;
        },
      };
    },
    { oldClaude, newClaude },
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('tab', { name: 'Agents', exact: true }).click();
  return settings;
}

test('Settings › Agents shows the agent programs of each computer', async ({ page }) => {
  const settings = await installWorkspace(page);
  const local = settings.getByRole('region', { name: 'Agents on this computer' });
  await expect(local.getByRole('heading', { name: 'This computer' })).toBeVisible();
  await expect(local.getByRole('listitem', { name: 'Claude Code on this computer' })).toContainText(
    'Meets the minimum',
  );

  // The connected host shows the program that it uses, the version, and the other programs.
  const devbox = settings.getByRole('region', { name: 'Agents on devbox' });
  await expect(devbox).toContainText('u@devbox');
  const claude = devbox.getByRole('listitem', { name: 'Claude Code on devbox' });
  await expect(claude).toContainText('Update required: needs 2.1.300 or later');
  await expect(claude.getByLabel(oldClaude, { exact: true })).toBeVisible();
  await expect(claude).toContainText('Version 2.1.287 · Automatic detection');
  const others = claude.getByRole('list', { name: 'Other Claude Code programs on devbox' });
  await expect(claude).toContainText('Also found:');
  await expect(others.getByLabel(newClaude, { exact: true })).toBeVisible();
  await expect(others).toContainText('2.1.306');
  await expect(claude).toContainText(
    'A different Claude Code program on devbox meets the minimum. Select Use next to it.',
  );
  await expect(devbox.getByRole('listitem', { name: 'Codex on devbox' })).toContainText(
    'Not found',
  );

  // A host that is not connected shows the last result and when Kalkidan checked it.
  const buildbox = settings.getByRole('region', { name: 'Agents on buildbox' });
  await expect(buildbox).toContainText('This host is not connected. This is the last result.');
  await expect(buildbox).toContainText('Last checked 2 hours ago');
  await expect(buildbox.getByRole('listitem', { name: 'Codex on buildbox' })).toContainText(
    'Meets the minimum',
  );
  await expect(buildbox.getByRole('button', { name: 'Choose program…' })).toHaveCount(0);

  // A host without a result asks the user to connect it.
  const newbox = settings.getByRole('region', { name: 'Agents on newbox' });
  await expect(newbox).toContainText('Connect the host to check its agents.');
  await newbox.getByRole('button', { name: 'Open Remote hosts' }).click();
  await expect(settings.getByRole('tab', { name: 'Remote hosts', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('the user chooses the program of an agent on a host and can reset it', async ({ page }) => {
  const settings = await installWorkspace(page);
  const devbox = settings.getByRole('region', { name: 'Agents on devbox' });
  const claude = devbox.getByRole('listitem', { name: 'Claude Code on devbox' });
  await claude.getByRole('button', { name: `Use ${newClaude}` }).click();
  await expect(claude).toContainText('Meets the minimum');
  await expect(claude).toContainText('Version 2.1.306 · Chosen in Settings');
  await expect(claude.getByLabel(newClaude, { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => (window as any).choices)).toEqual([['claude', newClaude, 'h1']]);

  // A path that is not valid shows the reason from the host.
  await claude.getByRole('button', { name: 'Choose program…' }).click();
  const input = claude.getByLabel('Path of the Claude Code program on devbox');
  await input.fill('claude');
  await claude.getByRole('button', { name: 'Use program' }).click();
  await expect(claude.getByRole('alert')).toContainText('Enter the full path of the program.');
  await claude.getByRole('button', { name: 'Cancel' }).click();

  await claude.getByRole('button', { name: 'Use automatic detection' }).click();
  await expect(claude).toContainText('Version 2.1.287 · Automatic detection');
  expect((await page.evaluate(() => (window as any).choices)).at(-1)).toEqual([
    'claude',
    null,
    'h1',
  ]);
});

test('a version refusal opens Settings › Agents at the program of that agent', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any;
    const refused = (agent: string) => ({
      id: 'refused',
      agent,
      sessionId: '',
      status: 'failed',
      messages: [],
      activity: '',
      errorCode: 'managed_launch_blocked',
      error: 'Kalkidan runs agents only through managed Verdictan agents.',
      managedSetup: 'agents',
      managedCode: 'desktop.claude_code_version_unsupported',
      agentVersion: '2.1.287',
      agentPath: '/opt/homebrew/bin/claude',
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
      git: async () => null,
      models: async () => [],
      agentInstallations: async () => [
        { agent: 'codex', status: 'installed', path: '/usr/local/bin/codex', version: '0.163.0' },
        {
          agent: 'claude',
          status: 'installed',
          path: '/opt/homebrew/bin/claude',
          version: '2.1.287',
          source: 'automatic',
        },
      ],
      chatCreate: async (_projectId: string, agent: string) => refused(agent),
      chatStart: async (agent: string) => refused(agent),
      chatStatus: async () => refused('claude'),
    };
  });
  await page.goto('/');
  await page.locator('.repo-select').first().click();
  await page.getByRole('button', { name: 'Choose an agent', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New Claude Code chat', exact: true }).click();
  const composer = page.getByLabel('Message agent');
  await composer.fill('Reply OK.');
  await composer.press('Enter');
  const card = page.locator('.chat-message.user .chat-send-failure');
  await expect(card).toContainText(
    'This computer has Claude Code 2.1.287 at /opt/homebrew/bin/claude.',
  );
  await card.getByRole('button', { name: 'Choose the Claude Code program', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings.getByRole('tab', { name: 'Agents', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    settings.getByRole('listitem', { name: 'Claude Code on this computer' }),
  ).toBeFocused();
});
