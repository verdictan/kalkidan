import { test, expect } from '@playwright/test';

test('Settings separates account sign-in from execution readiness and shows update recovery', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = {
      account: { phase: 'missing', executionReady: false } as any,
      update: {
        hostId: 'local',
        component: 'verdictan',
        discovery: 'available',
        stale: false,
        approved: { version: '0.2.1', releaseId: 'release', sha256: 'a'.repeat(64) },
        history: [],
      } as any,
    };
    (window as any).runtimeFixture = state;
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
      agentInstallations: async () => [],
      githubCliCheck: async () => ({ status: 'missing' }),
      githubAuthStatus: async () => ({ status: 'idle' }),
      verdictanStatus: async () => state.account,
      verdictanCheck: async () => (state.account = { phase: 'signed-out', executionReady: false }),
      verdictanAuthorize: async () =>
        (state.account = {
          phase: 'authenticated',
          executionReady: false,
          account: {
            state: 'authenticated',
            userId: 'user',
            organizationId: 'org',
            apiUrl: 'https://api.verdictan.com',
            expiresAt: '2026-11-01T00:00:00Z',
          },
        }),
      verdictanLogout: async () =>
        (state.account = {
          phase: 'signed-out',
          executionReady: false,
          remoteRevocationPending: true,
        }),
      runtimeUpdateStatus: async () => state.update,
      runtimeUpdateCheck: async () => state.update,
      runtimeUpdateInstall: async () =>
        (state.update = {
          ...state.update,
          operation: {
            id: 'operation',
            phase: 'waiting-for-idle',
            receivedBytes: 100,
            totalBytes: 100,
            target: state.update.approved,
          },
        }),
      runtimeUpdateCancel: async () =>
        (state.update = {
          ...state.update,
          operation: { ...state.update.operation, phase: 'canceled' },
        }),
    };
  });
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('tab', { name: 'Accounts', exact: true }).click();
  const account = settings.getByRole('region', { name: 'Verdictan account' });
  await expect(account.getByRole('button', { name: 'Sign in', exact: true })).toBeDisabled();
  await account.getByRole('button', { name: 'Check status' }).click();
  await account.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(account).toContainText(
    'Gateway setup and agent compatibility still need verification',
  );
  await expect(account).toContainText('org');
  await account.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(account).toContainText('Remote access revocation could not be confirmed');
  await settings.getByRole('tab', { name: 'Updates', exact: true }).click();
  const updates = settings.getByRole('region', { name: 'Runtime updates' });
  await expect(updates).toContainText('0.2.1');
  await updates.getByRole('button', { name: 'Install approved update' }).click();
  await expect(updates).toContainText('waiting for idle');
  await updates.getByRole('button', { name: 'Cancel update' }).click();
  await expect(updates).toContainText('canceled');
  await expect(updates).toContainText('Not installed');
});
