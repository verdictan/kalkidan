import { test, expect } from '@playwright/test';

test('Settings separates account sign-in from execution readiness and shows update recovery', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = {
      account: { region: 'eu', phase: 'missing', executionReady: false } as any,
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
      verdictanCheck: async () =>
        (state.account = { region: 'eu', phase: 'signed-out', executionReady: false }),
      verdictanAuthorize: async () =>
        (state.account = {
          region: 'eu',
          phase: 'authenticated',
          executionReady: false,
          account: {
            state: 'authenticated',
            userId: '22222222-2222-4222-8222-222222222222',
            organizationId: '11111111-1111-4111-8111-111111111111',
            apiUrl: 'https://api.eu.verdictan.com',
            expiresAt: '2026-11-01T00:00:00Z',
          },
        }),
      verdictanLogout: async () =>
        (state.account = {
          region: 'eu',
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
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('tab', { name: 'Managed agents', exact: true }).click();
  const managed = settings.getByRole('region', { name: 'Managed agents' });
  const account = managed.getByRole('region', { name: 'Sign in', exact: true });
  // Without the runtime, the user cannot sign in.
  await expect(account.getByRole('button', { name: 'Sign in', exact: true })).toBeDisabled();
  await expect(account).toContainText('Install the runtime in step 1 first.');
  await account.getByRole('button', { name: 'Check status' }).click();
  await account.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(account).toContainText('Signed in');
  // Without a service name the account has a generic label. IDs never show.
  await expect(account).toContainText('Your account');
  await expect(account).not.toContainText('11111111-1111');
  await expect(account).not.toContainText('22222222-2222');
  // Sign-in alone does not make the agents ready. The setup step is still open.
  const readiness = managed.getByRole('list', { name: 'Agent readiness' });
  await expect(readiness).toContainText('Codex not set up');
  await expect(readiness).toContainText('Claude Code not set up');
  await account.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(account).toContainText('could not confirm that the service removed the access');
  const runtime = managed.getByRole('region', { name: 'Install runtime' });
  await expect(runtime).toContainText('Not installed');
  await runtime.getByRole('button', { name: 'Install version 0.2.1' }).click();
  await expect(runtime).toContainText('Waiting for active work to stop');
  await expect(runtime.getByRole('button', { name: 'Finish install' })).toBeVisible();
  await runtime.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(runtime).toContainText('Not installed');
  await expect(runtime.getByRole('button', { name: 'Install version 0.2.1' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).runtimeFixture.update.operation.phase)).toBe(
    'canceled',
  );
  await settings.getByRole('tab', { name: 'Updates', exact: true }).click();
  await expect(
    settings
      .getByRole('region', { name: 'Updates' })
      .getByRole('button', { name: 'Check for updates' })
      .first(),
  ).toBeVisible();
});

test('Settings requires an explicit EU or US region before sign-in', async ({ page }) => {
  await page.addInitScript(() => {
    const state = {
      account: { phase: 'error', error: 'desktop.region_required', executionReady: false } as any,
      regions: [] as string[],
    };
    (window as any).regionFixture = state;
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
      verdictanSetRegion: async (region: string) => {
        state.regions.push(region);
        return (state.account = { region, phase: 'signed-out', executionReady: false });
      },
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('tab', { name: 'Managed agents', exact: true }).click();
  const account = settings
    .getByRole('region', { name: 'Managed agents' })
    .getByRole('region', { name: 'Sign in', exact: true });
  const region = account.getByRole('combobox', { name: 'Account region' });
  // No region is selected, and there is no Global choice.
  await expect(region).toHaveText('Select a region');
  await expect(account).toContainText('Region not selected');
  await expect(account).toContainText('Select the region of your organization');
  await expect(account.getByRole('button', { name: 'Sign in', exact: true })).toBeDisabled();
  await expect(account.getByRole('button', { name: 'Create account' })).toBeDisabled();
  await region.click();
  await expect(page.getByRole('option', { name: 'Global' })).toHaveCount(0);
  // The first choice applies at once. Nothing runs that a region change can stop.
  await page.getByRole('option', { name: 'United States' }).click();
  await expect(region).toHaveText('United States');
  await expect(account.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  await expect(account).not.toContainText('Select the region of your organization');
  expect(await page.evaluate(() => (window as any).regionFixture.regions)).toEqual(['us']);
  // A later change asks first, because it stops the agents that run.
  await region.click();
  await page.getByRole('option', { name: 'European Union' }).click();
  await account.getByRole('button', { name: 'Stop work and change region' }).click();
  await expect(region).toHaveText('European Union');
  expect(await page.evaluate(() => (window as any).regionFixture.regions)).toEqual(['us', 'eu']);
});
