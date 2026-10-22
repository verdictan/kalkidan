import { test, expect, openSettings } from './helpers/app';

test('an SSH host without access to the release server gets a copy from this computer', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const release = { version: '0.6.10', releaseId: 'release', sha256: 'a'.repeat(64) };
    const offline =
      'The release server cannot be reached. Check the network connection and the proxy settings, then try again.';
    const state = {
      copies: [] as string[],
      host: {
        hostId: 'host',
        component: 'verdictan',
        discovery: 'failed',
        stale: true,
        error: offline,
        canTransfer: true,
        history: [],
      } as any,
    };
    // As the desktop does, the fixture broadcasts a change, and Settings reads the status again.
    const listeners = new Set<() => void>();
    (window as any).copyFixture = { state, changed: () => listeners.forEach((run) => run()) };
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
      remoteHosts: async () => [
        {
          id: 'host',
          name: 'build-host',
          target: 'dev@build-host',
          status: 'connected',
          version: 'a'.repeat(20),
          platform: 'linux',
        },
      ],
      helperUpdates: async () => [],
      agentInstallations: async () => [],
      githubCliCheck: async () => ({ status: 'missing' }),
      githubAuthStatus: async () => ({ status: 'idle' }),
      verdictanStatus: async () => ({ region: 'eu', phase: 'signed-out', executionReady: false }),
      runtimeUpdateStatus: async (hostId = 'local') =>
        hostId === 'host'
          ? state.host
          : {
              hostId: 'local',
              component: 'verdictan',
              discovery: 'current',
              stale: false,
              installed: release,
              latest: release,
              history: [],
            },
      runtimeUpdateCheck: async () => state.host,
      runtimeUpdateTransfer: async (hostId: string) => {
        state.copies.push(hostId);
        // As the desktop does, the copy reports its progress in the status of the host.
        state.host = {
          ...state.host,
          transfer: { phase: 'copying', bytes: 40, totalBytes: 100 },
        };
        listeners.forEach((run) => run());
        await new Promise<void>((resolve) => ((window as any).copyFixture.finish = resolve));
        return (state.host = {
          hostId,
          component: 'verdictan',
          discovery: 'current',
          stale: false,
          installed: release,
          latest: release,
          history: [],
        });
      },
    };
  });
  await page.goto('/');
  const settings = await openSettings(page, 'Computers');
  const host = settings.getByRole('group', { name: 'build-host' });
  await expect(host).toContainText('Connected');
  await page.evaluate(() => (window as any).copyFixture.changed());
  // The runtime controls of the host show under its row.
  await expect(settings).toContainText('The release server cannot be reached.');
  const copy = settings.getByRole('button', {
    name: 'Copy managed agents from this computer to build-host',
  });
  await expect(copy).toBeVisible();
  await copy.click();
  await expect(settings).toContainText('Copying managed agents to the host · 40%');
  await expect(settings.getByRole('progressbar', { name: 'Managed agents copy' })).toBeVisible();
  await expect(settings).not.toContainText('The release server cannot be reached.');
  await expect(copy).toHaveCount(0);
  await page.evaluate(() => (window as any).copyFixture.finish());
  await expect(settings).not.toContainText('The release server cannot be reached.');
  await expect(copy).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).copyFixture.state.copies)).toEqual(['host']);
});
