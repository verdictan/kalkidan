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
        { agent: 'codex', status: 'installed' },
        { agent: 'claude', status: 'missing' },
      ],
      githubCliCheck: async () => ({ status: (window as any).ghState }),
      githubAuthStatus: async () => ({ status: 'idle' }),
    };
  });
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('tab', { name: 'Agents', exact: true }).click();
  await expect(dialog).toContainText('Installed');
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
