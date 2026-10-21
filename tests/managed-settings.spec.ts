import { test, expect, type Page } from '@playwright/test';

const team = '11111111-1111-4111-8111-111111111111';
const team2 = '22222222-2222-4222-8222-222222222222';
const cfg = `cfg_${'a'.repeat(32)}`;
const cfgv = `cfgv_${'b'.repeat(32)}`;
const cfgv2 = `cfgv_${'c'.repeat(32)}`;

/** A desktop API fixture. Each test replaces the parts that it checks. */
async function fixture(page: Page, extra: string) {
  await page.addInitScript(
    ({ ids, extra }) => {
      const base: Record<string, unknown> = {
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
        runtimeUpdateStatus: async () => ({
          hostId: 'local',
          component: 'verdictan',
          discovery: 'current',
          stale: false,
          history: [],
        }),
      };
      (window as any).ids = ids;
      (window as any).workspace = Object.assign(base, new Function('ids', extra)(ids));
    },
    { ids: { team, team2, cfg, cfgv, cfgv2 }, extra },
  );
  await page.goto('/');
}

test('managed agent setup shows names or numbered generic labels, never IDs', async ({ page }) => {
  await fixture(
    page,
    `return {
      verdictanStatus: async () => ({
        region: 'eu',
        phase: 'authenticated',
        executionReady: false,
        account: {
          state: 'authenticated',
          userId: ids.team2,
          organizationId: ids.team,
          organizationName: 'Acme Corp',
          apiUrl: 'https://api.eu.verdictan.com',
        },
      }),
      verdictanSetup: async () => ({
        status: 'ready',
        providerAccessModes: ['byok'],
        teams: [{ team_id: ids.team }, { team_id: ids.team2, name: 'Platform' }],
        policies: [
          { configuration_id: ids.cfg, configuration_version_id: ids.cfgv },
          { configuration_id: ids.cfg, configuration_version_id: ids.cfgv2 },
        ],
        providerConnections: [{ provider_connection_id: ids.team, provider: 'openai' }],
        selections: {},
      }),
    };`,
  );
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('tab', { name: 'Managed agents', exact: true }).click();
  const managed = settings.getByRole('region', { name: 'Managed agents' });
  await expect(managed.getByRole('region', { name: 'Sign in', exact: true })).toContainText(
    'Acme Corp',
  );
  const setup = managed.getByRole('region', { name: 'Choose setup' });
  /** The visible option labels of one choice. IDs stay in the option values. */
  async function options(name: string) {
    await setup.getByRole('combobox', { name }).click();
    const labels = await page.getByRole('option').allInnerTexts();
    await page.keyboard.press('Escape');
    return labels.map((label) => label.trim());
  }
  await expect.poll(() => options('Team')).toEqual(['Choose a team', 'Team 1', 'Platform']);
  expect(await options('Policy')).toEqual(['Choose a policy', 'Policy 1', 'Policy 2']);
  expect(await options('Connection')).toEqual(['Choose a connection', 'OpenAI connection']);
  await setup.getByRole('combobox', { name: 'Team' }).click();
  await page.getByRole('option', { name: 'Platform' }).click();
  await expect(setup.getByRole('combobox', { name: 'Team' })).toContainText('Platform');
  const text = await settings.innerText();
  for (const id of [team2, 'cfg_', 'cfgv_', '11111111-1111'])
    expect(text, `visible text must not contain ${id}`).not.toContain(id);
});

test('a launch block link opens Settings at the exact managed setup step', async ({ page }) => {
  await fixture(
    page,
    `return {
      verdictanStatus: async () => ({
        region: 'eu',
        phase: 'authenticated',
        executionReady: false,
        account: {
          state: 'authenticated',
          userId: ids.team2,
          organizationId: ids.team,
          apiUrl: 'https://api.eu.verdictan.com',
        },
      }),
    };`,
  );
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('kalkidan-open-settings', {
        detail: { section: 'managed-agents', anchor: 'managed-agent-setup' },
      }),
    ),
  );
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings.getByRole('tab', { name: 'Managed agents', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  // The setup step gets the focus.
  await expect(settings.locator('#managed-agent-setup')).toBeFocused();
  await expect(settings.locator('#managed-agent-setup')).toContainText('Choose setup');
  // Without a service name the account has a generic label. IDs never show.
  const account = settings.getByRole('region', { name: 'Sign in', exact: true });
  await expect(account).toContainText('Your account');
  await expect(account).not.toContainText('11111111-1111');
});

const release = `{
  version: '0.1.0-build.200.bbbbbbbbbbbb',
  id: '9',
  url: 'https://github.com/verdictan/packages/releases/tag/kalkidan-v0.1.0-build.200.bbbbbbbbbbbb',
  sha256: '${'a'.repeat(64)}',
  publishedAt: '2026-10-21T00:00:00Z',
}`;

test('the desktop app downloads, verifies, and offers Restart to update', async ({ page }) => {
  await fixture(
    page,
    `const desktop = {
      installedVersion: '0.1.0-build.100.aaaaaaaaaaaa',
      runningVersion: '0.1.0-build.100.aaaaaaaaaaaa',
      runningBuild: 'b'.repeat(64),
      discovery: 'available',
      stale: false,
      release: ${release},
      install: { kind: 'mac-app', selfUpdate: true },
    };
    const calls = [];
    window.updateCalls = calls;
    let reads = 0;
    return {
      componentUpdates: async () => {
        if (desktop.update?.phase === 'downloading' && ++reads > 1)
          desktop.update = { ...desktop.update, phase: 'staged', receivedBytes: 100 };
        return { desktop: structuredClone(desktop), helpers: [] };
      },
      desktopUpdateDownload: async () => {
        calls.push('download');
        desktop.update = {
          phase: 'downloading',
          version: desktop.release.version,
          receivedBytes: 40,
          totalBytes: 100,
        };
        return structuredClone(desktop);
      },
      desktopUpdateRestart: async () => {
        calls.push('restart');
        desktop.update = { ...desktop.update, phase: 'restarting' };
        return structuredClone(desktop);
      },
    };`,
  );
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('tab', { name: 'Updates', exact: true }).click();
  const update = settings.getByRole('group', { name: 'Kalkidan', exact: true });
  // Nothing downloads or restarts without a user action.
  await expect(update.getByRole('button', { name: 'Restart to update' })).toHaveCount(0);
  await expect(update.getByRole('link')).toHaveCount(0);
  await update.getByRole('button', { name: 'Download 0.1.0', exact: true }).click();
  await expect(update.getByRole('progressbar', { name: 'Desktop update download' })).toBeVisible();
  await expect(update.getByRole('button', { name: 'Cancel download' })).toBeVisible();
  await expect(update).toContainText('is verified and ready');
  await update.getByRole('button', { name: 'Restart to update' }).click();
  await expect(update).toContainText('Restarting');
  expect(await page.evaluate(() => (window as any).updateCalls)).toEqual(['download', 'restart']);
});

test('a copy that cannot update itself explains why and links to the release page', async ({
  page,
}) => {
  await fixture(
    page,
    `return {
      componentUpdates: async () => ({
        desktop: {
          installedVersion: '0.1.0-build.100.aaaaaaaaaaaa',
          runningVersion: '0.1.0-build.100.aaaaaaaaaaaa',
          runningBuild: 'b'.repeat(64),
          discovery: 'available',
          stale: false,
          release: ${release},
          install: {
            kind: 'deb',
            selfUpdate: false,
            reason: 'Kalkidan was installed from a DEB package. Download the new DEB file and install it with your package manager.',
          },
        },
        helpers: [],
      }),
    };`,
  );
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('tab', { name: 'Updates', exact: true }).click();
  const update = settings.getByRole('group', { name: 'Kalkidan', exact: true });
  await expect(update).toContainText('installed from a DEB package');
  await expect(update.getByRole('link', { name: /Download 0\.1\.0/ })).toHaveAttribute(
    'href',
    /verdictan\/packages\/releases\/tag\/kalkidan-v/,
  );
  // This copy cannot download, stage, or restart itself.
  await expect(
    update.getByRole('button', { name: /Download|Cancel download|Restart to update/ }),
  ).toHaveCount(0);
});
