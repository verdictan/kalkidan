import {
  test,
  expect,
  openAccountMenuItem,
  openComputersPage,
  openSettings,
  settingsDialog,
  settingsSection,
  sidebar,
} from './helpers/app';

test('the Computers page separates account sign-in from execution readiness and shows update recovery', async ({
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
      verdictanSetup: async () => ({
        status: 'selection_required',
        providerAccessModes: ['byok'],
        teams: [],
        policies: [],
        providerConnections: [],
        selections: {},
      }),
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
  const computers = await openComputersPage(page);
  // Each agent row that needs the user has one button. Signed out, it is "Sign in".
  const codex = computers.getByRole('group', { name: 'Codex', exact: true });
  const claude = computers.getByRole('group', { name: 'Claude Code', exact: true });
  await expect(codex.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(claude.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  // The sidebar footer also has the sign-in: the first item of its menu.
  const footer = sidebar(page).locator('.account-menu');
  const signedOut = footer.getByRole('button', {
    name: /^Sign in, Settings and help/,
  });
  await page.keyboard.press('Escape');
  await expect(computers).toHaveCount(0);
  await expect(signedOut).toBeVisible();
  await openAccountMenuItem(page, /^Sign in$/);
  // The region is saved, so the sign-in starts at once and the sheet closes when it is done.
  const signIn = page.getByRole('dialog', { name: 'Sign in to Verdictan' });
  await expect(signIn).toHaveCount(0);
  await expect(footer.getByRole('button', { name: /^Account: / })).toBeVisible();
  // Without a service name the account has a generic label. IDs never show.
  await expect(footer).toContainText('Verdictan');
  for (const id of ['11111111-1111', '22222222-2222']) await expect(footer).not.toContainText(id);
  await openComputersPage(page);
  await expect(codex).toBeVisible();
  for (const id of ['11111111-1111', '22222222-2222'])
    await expect(computers).not.toContainText(id);
  // Sign-in alone does not make the agents ready. The setup is still open.
  await expect(codex.getByRole('button', { name: 'Set up', exact: true })).toBeVisible();
  await expect(claude.getByRole('button', { name: 'Set up', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(computers).toHaveCount(0);
  // Sign out is in the account menu.
  await openAccountMenuItem(page, /Sign out/);
  // The service did not confirm that it removed the access, so the toast says so.
  await expect(
    page.locator('[data-slot="toast"]').filter({
      hasText: 'Kalkidan could not confirm that the service removed the access.',
    }),
  ).toBeVisible();
  await expect(signedOut).toBeVisible();
  await openComputersPage(page);
  await expect(codex.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  // The runtime of this computer is in its "Kalkidan service" row in Settings › Computers. The
  // row shows because the service needs the user.
  const runtime = computers.getByRole('group', { name: 'Kalkidan service', exact: true });
  await expect(runtime).toContainText('Not installed');
  await runtime.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(runtime).toContainText('Waiting');
  await expect(computers).toContainText(
    'Stop the coding agents that run now. Then select Finish install.',
  );
  await expect(runtime.getByRole('button', { name: 'Finish install' })).toBeVisible();
  await runtime.getByRole('button', { name: 'Cancel the install on this computer' }).click();
  await expect(runtime).toContainText('Not installed');
  await expect(runtime.getByRole('button', { name: 'Install', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).runtimeFixture.update.operation.phase)).toBe(
    'canceled',
  );
  // Kalkidan does not update itself. Settings › General links to the release page.
  await settingsSection(page, 'General').click();
  await expect(computers.getByRole('link', { name: /Check for updates/ })).toHaveAttribute(
    'href',
    /verdictan\/packages\/releases/,
  );
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
  // The sidebar footer offers the sign-in.
  await expect(
    sidebar(page)
      .locator('.account-menu')
      .getByRole('button', { name: /^Sign in, Settings and help/ }),
  ).toBeVisible();
  // The region is in Settings › Account.
  const settings = await openSettings(page, 'Account');
  const regionRow = settings.getByRole('group', { name: 'Region', exact: true });
  // No region is selected.
  await expect(regionRow).toContainText('Not chosen');
  // A missing region is not an error in Settings.
  await expect(settings.getByRole('alert')).toHaveCount(0);
  await regionRow.getByRole('button', { name: 'Change the region', exact: true }).click();
  const choose = page.getByRole('dialog', { name: 'Choose a region' });
  // There is no Global choice, and no region is selected.
  await expect(choose.getByRole('radio')).toHaveCount(2);
  await expect(choose.getByRole('radio', { name: /Global/ })).toHaveCount(0);
  await expect(choose.getByRole('button', { name: 'Choose region', exact: true })).toBeDisabled();
  // The first choice applies at once. Nothing runs that a region change can stop.
  await choose.getByRole('radio', { name: 'United States' }).check();
  await expect(choose.getByRole('note')).toHaveCount(0);
  await choose.getByRole('button', { name: 'Choose region', exact: true }).click();
  await expect(choose).toHaveCount(0);
  await expect(regionRow).toContainText('United States');
  expect(await page.evaluate(() => (window as any).regionFixture.regions)).toEqual(['us']);
  // A later change asks first, because it stops the agents that run.
  await regionRow.getByRole('button', { name: 'Change the region', exact: true }).click();
  const change = page.getByRole('dialog', { name: 'Change region' });
  await change.getByRole('radio', { name: 'European Union' }).check();
  await expect(change.getByRole('note')).toContainText('Changing the region stops running agents');
  await change.getByRole('button', { name: 'Change region', exact: true }).click();
  await expect(change).toHaveCount(0);
  await expect(regionRow).toContainText('European Union');
  expect(await page.evaluate(() => (window as any).regionFixture.regions)).toEqual(['us', 'eu']);
  await page.keyboard.press('Escape');
  await expect(settingsDialog(page)).toHaveCount(0);
});
