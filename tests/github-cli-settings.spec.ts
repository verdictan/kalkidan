import { test, expect, openSettingsWindow } from './helpers/app';

test('Settings › Tools checks the GitHub CLI again without hiding the agent status', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.ghState = 'missing';
    const tool = (id: string, name: string, state: string, version?: string) => ({
      tool: id,
      name,
      kind: id === 'gh' ? 'github' : 'agent',
      state,
      installed: state !== 'missing',
      ...(version ? { version } : {}),
      signedIn: state === 'ready' ? 'yes' : state === 'signed-out' ? 'no' : 'unknown',
      access: state === 'ready' ? 'granted' : 'unknown',
      usable: id !== 'gh' && state === 'ready',
      installUrl: `https://example.com/${id}`,
    });
    w.workspace = {
      snapshot: async () => ({
        projects: [],
        groups: [{ id: 'g', name: 'Project', repoIds: [] }],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      trackerProviders: async () => [],
      remoteHosts: async () => [],
      // Each check reads the state of the GitHub CLI at that time.
      computerTools: async () => [
        {
          computer: 'local',
          name: 'This Mac',
          connected: true,
          checkedAt: new Date().toISOString(),
          tools: [
            tool('codex', 'Codex', 'ready', '0.163.0'),
            tool('claude', 'Claude Code', 'missing'),
            tool('gh', 'GitHub CLI', w.ghState, w.ghState === 'missing' ? undefined : '2.62.0'),
          ],
        },
      ],
    };
  });
  await page.goto('/');
  const settings = await openSettingsWindow(page, 'Tools');
  const tools = settings.getByRole('region', { name: 'Tools', exact: true });
  const row = (name: string) => tools.getByRole('listitem').filter({ hasText: name });
  // The agent rows show the agent status. Kalkidan does not install agents: a missing agent
  // links to its official install guide, and no row has a button.
  await expect(row('Codex').getByRole('img')).toHaveAccessibleName('Ready');
  await expect(row('Claude Code').getByRole('img')).toHaveAccessibleName('Not installed');
  await expect(
    row('Claude Code').getByRole('link', {
      name: 'Claude Code install guide (opens in the browser)',
    }),
  ).toBeVisible();
  await expect(tools.getByRole('listitem').getByRole('button')).toHaveCount(0);
  // The GitHub CLI is one row of Tools, with the anchor that other places link to.
  const gh = tools.locator('#settings-github');
  await expect(gh).toContainText('GitHub CLI');
  await expect(gh.getByRole('img')).toHaveAccessibleName('Not installed');
  await expect(
    gh.getByRole('link', { name: 'GitHub CLI install guide (opens in the browser)' }),
  ).toBeVisible();
  // Check again reads the tools again. A signed-out CLI says so and keeps the install guide.
  const recheck = async (state: string) => {
    await page.evaluate((value) => ((window as any).ghState = value), state);
    await tools.getByRole('button', { name: 'Check again', exact: true }).click();
  };
  await recheck('signed-out');
  await expect(gh).toContainText('2.62.0 · not signed in');
  await expect(gh.getByRole('img')).toHaveAccessibleName('Not signed in');
  await recheck('ready');
  await expect(gh.getByRole('img')).toHaveAccessibleName('Ready');
  await expect(gh.getByRole('link')).toHaveCount(0);
  // The agent rows did not change.
  await expect(row('Codex').getByRole('img')).toHaveAccessibleName('Ready');
  await expect(row('Claude Code').getByRole('img')).toHaveAccessibleName('Not installed');
  await recheck('error');
  await expect(gh.getByRole('img')).toHaveAccessibleName('Does not run');
  await expect(gh).toContainText('does not run');
});
