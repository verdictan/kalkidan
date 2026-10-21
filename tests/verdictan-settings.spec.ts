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
        latest: { version: '0.2.1', releaseId: 'release', sha256: 'a'.repeat(64) },
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
            target: state.update.latest,
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
  const settings = page.getByRole('region', { name: 'Settings', exact: true });
  await settings.getByRole('tab', { name: 'Accounts', exact: true }).click();
  const account = settings.getByRole('region', { name: 'Verdictan account' });
  // Without the runtime, the user cannot sign in.
  await expect(account.getByRole('button', { name: 'Sign in', exact: true })).toBeDisabled();
  await expect(account).toContainText('Install the managed agents runtime first.');
  await account.getByRole('button', { name: 'Check status' }).click();
  await account.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(account).toContainText('Signed in');
  // Without a service name the account has a generic label. IDs never show.
  await expect(account).toContainText('Your account');
  await expect(account).not.toContainText('11111111-1111');
  await expect(account).not.toContainText('22222222-2222');
  // Sign-in alone does not make the agents ready. The setup is still open.
  await settings.getByRole('tab', { name: 'Agents', exact: true }).click();
  const readiness = settings.getByRole('list', { name: 'Agent readiness' });
  await expect(readiness).toContainText('Codex not set up');
  await expect(readiness).toContainText('Claude Code not set up');
  await settings.getByRole('tab', { name: 'Accounts', exact: true }).click();
  await account.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(account).toContainText('could not confirm that the service removed the access');
  // The runtime of each computer is in Computers.
  await settings.getByRole('tab', { name: 'Computers', exact: true }).click();
  const runtime = settings
    .getByRole('group', { name: 'This computer' })
    .getByRole('region', { name: 'Managed agents runtime' });
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
  const settings = page.getByRole('region', { name: 'Settings', exact: true });
  await settings.getByRole('tab', { name: 'Accounts', exact: true }).click();
  const account = settings.getByRole('region', { name: 'Verdictan account' });
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
