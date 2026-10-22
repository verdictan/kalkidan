import { test, expect, openSettings } from './helpers/app';

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
    // As the desktop does, the fixture broadcasts each account change.
    const listeners = new Set<() => void>();
    const changed = <T>(value: T) => {
      setTimeout(() => listeners.forEach((listener) => listener()));
      return value;
    };
    (window as any).workspace = {
      onVerdictanChanged: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
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
        changed(
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
        ),
      verdictanLogout: async () =>
        changed(
          (state.account = {
            region: 'eu',
            phase: 'signed-out',
            executionReady: false,
            remoteRevocationPending: true,
          }),
        ),
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
  const settings = await openSettings(page, 'Account');
  const account = settings.getByRole('list', { name: 'Account', exact: true });
  // The account row offers the sign-in. The sign-in flow installs the runtime when needed.
  await expect(account).toContainText('Sign in to Verdictan');
  await expect(account.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  // The account status and its check are in the Advanced fold.
  await settings.getByRole('button', { name: 'Advanced', exact: true }).click();
  const accountStatus = settings.getByRole('group', { name: 'Account status' });
  await expect(accountStatus).toContainText('Managed agents are not installed on this computer.');
  await accountStatus.getByRole('button', { name: 'Check status' }).click();
  await expect(accountStatus).toContainText('Signed out.');
  await account.getByRole('button', { name: 'Sign in', exact: true }).click();
  const signIn = page.getByRole('dialog', { name: 'Sign in to Verdictan' });
  await expect(signIn.getByRole('heading', { name: 'Setting up Kalkidan' })).toBeVisible();
  await signIn.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(signIn).toHaveCount(0);
  await expect(accountStatus).toContainText('Signed in.');
  // Without a service name the account has a generic label. IDs never show.
  await expect(account).toContainText('Your account');
  await expect(settings).not.toContainText('11111111-1111');
  await expect(settings).not.toContainText('22222222-2222');
  // Sign-in alone does not make the agents ready. The setup is still open.
  await settings.getByRole('tab', { name: 'Agents', exact: true }).click();
  const readiness = settings.getByRole('list', { name: 'Managed agents' });
  await expect(readiness.getByRole('group', { name: 'Codex', exact: true })).toContainText(
    'Not set up',
  );
  await expect(readiness.getByRole('group', { name: 'Claude Code', exact: true })).toContainText(
    'Not set up',
  );
  await settings.getByRole('tab', { name: 'Account', exact: true }).click();
  await account.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(settings).toContainText('could not confirm that the service removed the access');
  // The runtime of each computer is in Computers.
  await settings.getByRole('tab', { name: 'Computers', exact: true }).click();
  const runtime = settings.getByRole('group', { name: 'This computer' });
  await expect(runtime).toContainText('Not installed');
  await runtime.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(runtime).toContainText('Waiting');
  await expect(settings).toContainText('Stop the agents that run now. Then select Finish install.');
  await expect(runtime.getByRole('button', { name: 'Finish install' })).toBeVisible();
  await runtime.getByRole('button', { name: 'Cancel the install on this computer' }).click();
  await expect(runtime).toContainText('Not installed');
  await expect(runtime.getByRole('button', { name: 'Install', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).runtimeFixture.update.operation.phase)).toBe(
    'canceled',
  );
  // Updates are in About, with one Check for updates button.
  await settings.getByRole('tab', { name: 'About', exact: true }).click();
  await expect(
    settings
      .getByRole('tabpanel', { name: 'About' })
      .getByRole('button', { name: 'Check for updates' }),
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
  const settings = await openSettings(page, 'Account');
  const account = settings.getByRole('list', { name: 'Account', exact: true });
  const regionRow = account.getByRole('group', { name: 'Region', exact: true });
  // No region is selected. The sign-in asks for the region first.
  await expect(regionRow).toContainText('Not chosen');
  await expect(account).toContainText('Sign in to Verdictan');
  // A missing region is not an error in Settings.
  await expect(settings.getByRole('alert')).toHaveCount(0);
  await regionRow.getByRole('button', { name: 'Choose…', exact: true }).click();
  const choose = page.getByRole('dialog', { name: 'Choose a region' });
  // There is no Global choice, and no region is selected.
  await expect(choose.getByRole('radio')).toHaveCount(2);
  await expect(choose.getByRole('radio', { name: /Global/ })).toHaveCount(0);
  await expect(choose.getByRole('button', { name: 'Use this region' })).toBeDisabled();
  // The first choice applies at once. Nothing runs that a region change can stop.
  await choose.getByRole('radio', { name: 'United States' }).check();
  await expect(choose.getByRole('note')).toHaveCount(0);
  await choose.getByRole('button', { name: 'Use this region' }).click();
  await expect(choose).toHaveCount(0);
  await expect(regionRow).toContainText('United States');
  await expect(account.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).regionFixture.regions)).toEqual(['us']);
  // A later change asks first, because it stops the agents that run.
  await regionRow.getByRole('button', { name: 'Change…', exact: true }).click();
  const change = page.getByRole('dialog', { name: 'Change region' });
  await change.getByRole('radio', { name: 'European Union' }).check();
  await expect(change.getByRole('note')).toContainText('Changing the region stops running agents');
  await change.getByRole('button', { name: 'Stop work and change' }).click();
  await expect(change).toHaveCount(0);
  await expect(regionRow).toContainText('European Union');
  expect(await page.evaluate(() => (window as any).regionFixture.regions)).toEqual(['us', 'eu']);
});
