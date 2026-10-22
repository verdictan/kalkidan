import { test, expect, openComputersPage, openPreferences, preferencesDialog } from './helpers/app';
test('Preferences checks GitHub CLI and retries without hiding agent status', async ({ page }) => {
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
  const computers = await openComputersPage(page);
  // The agent rows show the agent status. A missing agent opens its programs with Choose….
  const claude = computers.getByRole('group', { name: 'Claude Code', exact: true });
  await expect(claude).toContainText('Not installed');
  await expect(claude).toContainText('Not found on this computer');
  await claude.getByRole('button', { name: 'Choose the Claude Code program' }).click();
  const programs = page.getByRole('dialog', { name: 'Coding agent programs on this computer' });
  await expect(programs.getByRole('listitem', { name: 'Codex on this computer' })).toContainText(
    'Meets the minimum',
  );
  // A missing agent shows how to install it.
  await expect(programs).toContainText('npm i -g @anthropic-ai/claude-code');
  await expect(programs.getByRole('link', { name: 'How to install' })).toBeVisible();
  await programs.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(programs).toHaveCount(0);
  // The GitHub CLI and the board access are one row in Preferences.
  const dialog = await openPreferences(page);
  const row = dialog.getByRole('group', { name: 'GitHub and boards', exact: true });
  await expect(row).toContainText('Not installed');
  await expect(row.getByRole('link', { name: 'How to install' })).toBeVisible();
  await expect(row).toContainText('Boards not allowed');
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
  // The CLI works. The row is not "Connected" because the boards are not allowed.
  await expect(row).not.toContainText('Signed out');
  await expect(row).not.toContainText('gh auth login');
  await expect(row).toContainText('Boards not allowed');
  await page.waitForTimeout(2100);
  await recheck('error');
  await expect(row).toContainText('Check failed');
});

test('closing Preferences detaches from shared approval; explicit cancel identifies its attempt', async ({
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
  const open = () => openPreferences(page);
  const boards = () =>
    preferencesDialog(page).getByRole('group', { name: 'GitHub and boards', exact: true });
  const approval = page.getByRole('dialog', { name: 'Allow access to GitHub Projects' });
  await open();
  await boards().getByRole('button', { name: 'Allow access…', exact: true }).click();
  await expect(approval.getByLabel('GitHub device code')).toHaveValue('ABCD-1234');
  // Escape closes the approval sheet, then Preferences. The approval keeps running.
  await page.keyboard.press('Escape');
  await expect(approval).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(preferencesDialog(page)).not.toBeVisible();
  expect(await page.evaluate(() => (window as any).cancels)).toEqual([]);
  await open();
  await expect(boards()).toContainText('Waiting for approval');
  await boards().getByRole('button', { name: 'Continue…', exact: true }).click();
  await expect(approval.getByLabel('GitHub device code')).toHaveValue('ABCD-1234');
  expect(await page.evaluate(() => (window as any).starts)).toBe(1);
  await approval.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(approval).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).cancels)).toEqual(['attempt-1']);
});
