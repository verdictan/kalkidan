import { test, expect } from '@playwright/test';
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
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('region', { name: 'Settings', exact: true });
  await dialog.getByRole('tab', { name: 'Agents', exact: true }).click();
  await expect(dialog).toContainText('Meets the minimum');
  // A missing agent shows how to install it.
  await expect(dialog).toContainText('npm i -g @anthropic-ai/claude-code');
  await expect(dialog.getByRole('link', { name: 'How to install' })).toBeVisible();
  await dialog.getByRole('tab', { name: 'Accounts', exact: true }).click();
  const row = dialog.getByLabel('GitHub CLI status');
  await expect(row).toContainText('Not found');
  await expect(dialog.getByLabel('GitHub Projects board access')).toContainText('Not allowed');
  await page.evaluate(() => ((window as any).ghState = 'signed-out'));
  await dialog.getByRole('button', { name: 'Check again', exact: true }).click();
  await expect(row).toContainText('Sign-in required');
  await expect(row).toContainText('gh auth login');
  await page.evaluate(() => ((window as any).ghState = 'ready'));
  await dialog.getByRole('button', { name: 'Check again', exact: true }).click();
  await expect(row).toContainText('Signed in');
  await page.evaluate(() => ((window as any).ghState = 'error'));
  await dialog.getByRole('button', { name: 'Check again', exact: true }).click();
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
  const open = async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Accounts', exact: true }).click();
  };
  await open();
  await page.getByRole('button', { name: 'Allow access', exact: true }).click();
  await expect(page.getByLabel('GitHub device code')).toHaveValue('ABCD-1234');
  // Go back leaves the Settings page.
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Settings', exact: true })).not.toBeVisible();
  expect(await page.evaluate(() => (window as any).cancels)).toEqual([]);
  await open();
  await expect(page.getByLabel('GitHub device code')).toHaveValue('ABCD-1234');
  expect(await page.evaluate(() => (window as any).starts)).toBe(1);
  await page.getByRole('button', { name: 'Cancel approval', exact: true }).click();
  await expect(page.getByLabel('GitHub device code')).not.toBeVisible();
  expect(await page.evaluate(() => (window as any).cancels)).toEqual(['attempt-1']);
});
