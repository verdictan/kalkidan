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
    };
  });
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const row = page.getByLabel('GitHub CLI status');
  await expect(row).toContainText('Not found');
  await page.evaluate(() => ((window as any).ghState = 'signed-out'));
  await page.getByRole('button', { name: 'Check again', exact: true }).click();
  await expect(row).toContainText('Sign-in required');
  await expect(row).toContainText('gh auth login');
  await page.evaluate(() => ((window as any).ghState = 'ready'));
  await page.getByRole('button', { name: 'Check again', exact: true }).click();
  await expect(row).toContainText('Signed in');
  await page.evaluate(() => ((window as any).ghState = 'error'));
  await page.getByRole('button', { name: 'Check again', exact: true }).click();
  await expect(row).toContainText('Check failed');
  await expect(page.getByRole('dialog')).toContainText('Installed');
});
