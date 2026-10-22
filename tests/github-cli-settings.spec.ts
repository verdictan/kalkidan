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
  // The agent rows show the agent status. A missing agent opens its program with Install….
  const claude = computers.getByRole('group', { name: 'Claude Code', exact: true });
  await expect(claude).toContainText('Not installed');
  await expect(claude).toContainText('Not found on this computer');
  await claude.getByRole('button', { name: 'Install the Claude Code program' }).click();
  const claudeProgram = page.getByRole('dialog', { name: 'Claude Code on this computer' });
  // A missing agent shows how to install it. The dialog has no Done button.
  await expect(claudeProgram).toContainText('npm i -g @anthropic-ai/claude-code');
  await expect(claudeProgram.getByRole('link', { name: 'How to install' })).toBeVisible();
  await expect(claudeProgram.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(claudeProgram).toHaveCount(0);
  // An installed agent opens its program with Locate….
  await computers
    .getByRole('group', { name: 'Codex', exact: true })
    .getByRole('button', { name: 'Locate the Codex program' })
    .click();
  const codexProgram = page.getByRole('dialog', { name: 'Codex on this computer' });
  await expect(
    codexProgram.getByRole('listitem', { name: 'Codex on this computer' }),
  ).toContainText('Meets the minimum');
  await page.keyboard.press('Escape');
  await expect(codexProgram).toHaveCount(0);
  // The GitHub CLI and the board access are one row in Preferences › Connections.
  const dialog = await openPreferences(page);
  await dialog.getByRole('tab', { name: 'Connections', exact: true }).click();
  const row = dialog.getByRole('group', { name: 'GitHub and boards', exact: true });
  await expect(row.getByRole('status')).toHaveText('Not installed');
  // Settings checks again when the window gets focus. There is no Check again button.
  await expect(dialog.getByRole('button', { name: 'Check again' })).toHaveCount(0);
  // Connect… opens the Connect GitHub dialog with the step that each part needs.
  await row.getByRole('button', { name: 'Connect…', exact: true }).click();
  const connect = page.getByRole('dialog', { name: 'Connect GitHub' });
  const repositories = connect.getByRole('group', { name: 'Repositories', exact: true });
  const boards = connect.getByRole('group', { name: 'Boards', exact: true });
  await expect(repositories).toContainText('Not installed');
  await expect(repositories.getByRole('link', { name: 'How to install' })).toBeVisible();
  await expect(boards.getByRole('button', { name: 'Allow access…' })).toBeVisible();
  const recheck = async (state: string) => {
    await page.evaluate((value) => {
      (window as any).ghState = value;
      window.dispatchEvent(new Event('focus'));
    }, state);
  };
  await page.waitForTimeout(2100);
  await recheck('signed-out');
  await expect(repositories).toContainText('Signed out');
  await expect(repositories).toContainText('gh auth login');
  await page.waitForTimeout(2100);
  await recheck('ready');
  // The CLI works. The boards are still not allowed, so the dialog stays open.
  await expect(repositories).not.toContainText('Signed out');
  await expect(repositories).not.toContainText('gh auth login');
  await expect(repositories.getByRole('status')).toHaveText('Connected');
  await expect(boards.getByRole('button', { name: 'Allow access…' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(connect).toHaveCount(0);
  await expect(row.getByRole('status')).toHaveText('Boards not allowed');
  await page.waitForTimeout(2100);
  await recheck('error');
  await expect(row.getByRole('status')).toHaveText('Check failed');
});

test('closing Preferences keeps a shared approval; closing Connect GitHub cancels its attempt', async ({
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
  const open = async () => {
    const dialog = await openPreferences(page);
    await dialog.getByRole('tab', { name: 'Connections', exact: true }).click();
  };
  const boards = () =>
    preferencesDialog(page).getByRole('group', { name: 'GitHub and boards', exact: true });
  const connect = page.getByRole('dialog', { name: 'Connect GitHub' });
  const cancels = () => page.evaluate(() => (window as any).cancels);
  await open();
  // The GitHub CLI works, so Connect… starts the board approval at once.
  await boards().getByRole('button', { name: 'Connect…', exact: true }).click();
  await expect(connect.getByLabel('GitHub device code')).toHaveValue('ABCD-1234');
  expect(await page.evaluate(() => (window as any).starts)).toBe(1);
  // The dialog has no Cancel button. Closing it cancels its own attempt.
  await expect(connect.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(connect).toHaveCount(0);
  await expect.poll(cancels).toEqual(['attempt-1']);
  await page.keyboard.press('Escape');
  await expect(preferencesDialog(page)).not.toBeVisible();
  // An approval that started in another place is shared. Preferences shows it, and closing
  // Preferences does not cancel it.
  await page.evaluate(() => {
    (window as any).auth = { status: 'waiting', attemptId: 'attempt-2', code: 'WXYZ-9876' };
  });
  await open();
  await expect(boards()).toContainText('Waiting for approval');
  await page.keyboard.press('Escape');
  await expect(preferencesDialog(page)).not.toBeVisible();
  expect(await cancels()).toEqual(['attempt-1']);
  // Connect… shows the shared approval and does not start a new one.
  await open();
  await boards().getByRole('button', { name: 'Connect…', exact: true }).click();
  await expect(connect.getByLabel('GitHub device code')).toHaveValue('WXYZ-9876');
  expect(await page.evaluate(() => (window as any).starts)).toBe(1);
  // Closing the dialog cancels the shared attempt by its ID. Wait for the open animation, so
  // that Escape goes to this dialog and not to Preferences below it.
  await connect.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  await page.keyboard.press('Escape');
  await expect(connect).toHaveCount(0);
  await expect.poll(cancels).toEqual(['attempt-1', 'attempt-2']);
});
