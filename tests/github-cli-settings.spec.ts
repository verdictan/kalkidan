import { test, expect, openSettings, settingsDialog } from './helpers/app';
test('Settings checks GitHub CLI and retries without hiding agent status', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).ghState = 'missing';
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [],
        groups: [{ id: 'g', name: 'Project', repoIds: [] }],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      trackerProviders: async () => [],
      remoteHosts: async () => [],
      agentInstallations: async () => [
        { agent: 'codex', status: 'installed', version: '0.163.0-alpha.10.2' },
        { agent: 'claude', status: 'missing' },
      ],
      githubCliCheck: async () => ({ status: (window as any).ghState }),
      githubAuthStatus: async () => ({ status: 'idle' }),
    };
  });
  await page.goto('/');
  const dialog = await openSettings(page, 'Agents');
  // The Agents rows show the agent status. A missing agent opens its programs with Fix.
  const agents = dialog.getByRole('list', { name: 'Managed agents' });
  const claude = agents.getByRole('group', { name: 'Claude Code', exact: true });
  await expect(claude).toContainText('Claude Code is not installed on this computer.');
  await claude.getByRole('button', { name: 'Fix Claude Code' }).click();
  const programs = page.getByRole('dialog', { name: 'Agent programs on this computer' });
  await expect(programs.getByRole('listitem', { name: 'Codex on this computer' })).toContainText(
    'Meets the minimum',
  );
  // A missing agent shows how to install it.
  await expect(programs).toContainText('npm i -g @anthropic-ai/claude-code');
  await expect(programs.getByRole('link', { name: 'How to install' })).toBeVisible();
  await programs.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(programs).toHaveCount(0);
  // The GitHub CLI and the board access are connected services in Account.
  await dialog.getByRole('tab', { name: 'Account', exact: true }).click();
  const services = dialog.getByRole('list', { name: 'Connected services' });
  const row = services.getByRole('group', { name: 'GitHub', exact: true });
  await expect(row).toContainText('Not installed');
  await expect(row.getByRole('link', { name: 'How to install' })).toBeVisible();
  await expect(
    services.getByRole('group', { name: 'GitHub Projects boards', exact: true }),
  ).toContainText('Not allowed');
  // Settings checks again when the window gets focus. There is no Check again button.
  await expect(dialog.getByRole('button', { name: 'Check again' })).toHaveCount(0);
  const recheck = async (state: string) => {
    await page.evaluate((value) => {
      (window as any).ghState = value;
      window.dispatchEvent(new Event('focus'));
    }, state);
  };
  await page.waitForTimeout(2100);
  await recheck('signed-out');
  await expect(row).toContainText('Signed out');
  await expect(row).toContainText('gh auth login');
  await page.waitForTimeout(2100);
  await recheck('ready');
  await expect(row).toContainText('Connected');
  await page.waitForTimeout(2100);
  await recheck('error');
  await expect(row).toContainText('Check failed');
});

test('closing Settings detaches from shared approval; explicit cancel identifies its attempt', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const fixture = window as any;
    fixture.auth = { status: 'signed-out' };
    fixture.cancels = [];
    fixture.starts = 0;
    fixture.workspace = {
      snapshot: async () => ({
        projects: [],
        groups: [{ id: 'g', name: 'Project', repoIds: [] }],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      trackerProviders: async () => [],
      remoteHosts: async () => [],
      agentInstallations: async () => [],
      githubCliCheck: async () => ({ status: 'ready' }),
      githubAuthStatus: async () => fixture.auth,
      githubAuthStart: async () => {
        fixture.starts++;
        return (fixture.auth = { status: 'waiting', attemptId: 'attempt-1', code: 'ABCD-1234' });
      },
      githubAuthCancel: async (attemptId: string) => {
        fixture.cancels.push(attemptId);
        return (fixture.auth = { status: 'canceled', attemptId });
      },
    };
  });
  await page.goto('/');
  const open = () => openSettings(page, 'Account');
  const boards = () =>
    settingsDialog(page)
      .getByRole('list', { name: 'Connected services' })
      .getByRole('group', { name: 'GitHub Projects boards', exact: true });
  const approval = page.getByRole('dialog', { name: 'Allow access to GitHub Projects' });
  await open();
  await boards().getByRole('button', { name: 'Allow access…', exact: true }).click();
  await expect(approval.getByLabel('GitHub device code')).toHaveValue('ABCD-1234');
  // Escape closes the approval sheet, then Settings. The approval keeps running.
  await page.keyboard.press('Escape');
  await expect(approval).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(settingsDialog(page)).not.toBeVisible();
  expect(await page.evaluate(() => (window as any).cancels)).toEqual([]);
  await open();
  await expect(boards()).toContainText('Waiting…');
  await boards().getByRole('button', { name: 'Continue…', exact: true }).click();
  await expect(approval.getByLabel('GitHub device code')).toHaveValue('ABCD-1234');
  expect(await page.evaluate(() => (window as any).starts)).toBe(1);
  await approval.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(approval).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).cancels)).toEqual(['attempt-1']);
});
