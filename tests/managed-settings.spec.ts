import { type Page } from '@playwright/test';
import {
  test,
  expect,
  openAgentSetup,
  openSettings,
  settingsDialog,
  settingsTab,
} from './helpers/app';

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
  const settings = await openSettings(page, 'Account');
  await expect(settings.getByRole('group', { name: 'Organization', exact: true })).toContainText(
    'Acme Corp',
  );
  await page.keyboard.press('Escape');
  const setup = await openAgentSetup(page);
  /** The visible option labels of one choice. IDs stay in the option values. */
  async function options(name: string) {
    await setup.getByRole('combobox', { name }).click();
    const labels = await page.getByRole('option').allInnerTexts();
    await page.keyboard.press('Escape');
    return labels.map((label) => label.trim());
  }
  await expect.poll(() => options('Team')).toEqual(['Choose a team', 'Team 1', 'Platform']);
  expect(await options('Policy')).toEqual(['Choose a policy', 'Policy 1', 'Policy 2']);
  // The only OpenAI connection is chosen at once. Its list does not show.
  await expect(setup.getByRole('combobox', { name: 'Connection' })).toHaveCount(0);
  await setup.getByRole('combobox', { name: 'Team' }).click();
  await page.getByRole('option', { name: 'Platform' }).click();
  await expect(setup.getByRole('combobox', { name: 'Team' })).toContainText('Platform');
  const text = await setup.innerText();
  for (const id of [team2, 'cfg_', 'cfgv_', '11111111-1111'])
    expect(text, `visible text must not contain ${id}`).not.toContain(id);
});

const signedIn = `verdictanStatus: async () => ({
  region: 'eu',
  phase: 'authenticated',
  executionReady: false,
  account: {
    state: 'authenticated',
    userId: ids.team2,
    organizationId: ids.team,
    apiUrl: 'https://api.eu.verdictan.com',
  },
}),`;
const openSetup = (page: Page) => openAgentSetup(page);

test('the Kalkidan default policy is preselected and saves without policy IDs', async ({
  page,
}) => {
  await fixture(
    page,
    `const saved = [];
    window.savedSelections = saved;
    return {
      ${signedIn}
      verdictanSetup: async () => ({
        status: 'ready',
        policyReadiness: 'default_available',
        defaultPolicy: { configuration_id: ids.cfg, configuration_version_id: ids.cfgv },
        defaultEnsured: 'created',
        providerAccessModes: ['byok'],
        teams: [{ team_id: ids.team }],
        policies: [
          { configuration_id: ids.cfg, configuration_version_id: ids.cfgv, default: true },
          { configuration_id: ids.cfg, configuration_version_id: ids.cfgv2, name: 'Strict' },
        ],
        providerConnections: [{ provider_connection_id: ids.team, provider: 'openai' }],
        selections: {},
      }),
      verdictanSelect: async (agent, selection) => {
        saved.push([agent, selection]);
        throw new Error('saved');
      },
    };`,
  );
  const setup = await openSetup(page);
  const policy = setup.getByRole('combobox', { name: 'Policy' });
  await expect(policy).toContainText('Kalkidan default');
  await expect(setup).toContainText('Kalkidan made the Kalkidan default policy');
  await policy.click();
  const labels = (await page.getByRole('option').allInnerTexts()).map((label) => label.trim());
  expect(labels).toEqual(['Kalkidan default', 'Strict']);
  await page.keyboard.press('Escape');
  // A complete selection saves when the model name is entered.
  await setup.getByRole('textbox', { name: 'Default model' }).fill('gpt-5');
  await setup.getByRole('textbox', { name: 'Default model' }).press('Enter');
  await expect.poll(() => page.evaluate(() => (window as any).savedSelections.length)).toBe(1);
  const [[agent, selection]] = await page.evaluate(() => (window as any).savedSelections);
  expect(agent).toBe('codex');
  expect(selection).toMatchObject({ configurationId: '', configurationVersionId: '' });
  const text = await setup.innerText();
  for (const id of ['cfg_', 'cfgv_', '11111111-1111']) expect(text).not.toContain(id);
});

test('a member without the default gets the administrator recovery in setup', async ({ page }) => {
  await fixture(
    page,
    `return {
      ${signedIn}
      verdictanSetup: async () => ({
        status: 'ready',
        policyReadiness: 'default_configuration_required',
        providerAccessModes: ['byok'],
        teams: [{ team_id: ids.team }],
        policies: [],
        providerConnections: [{ provider_connection_id: ids.team, provider: 'openai' }],
        selections: {},
      }),
    };`,
  );
  const setup = await openSetup(page);
  await expect(setup.getByRole('note').first()).toContainText(
    'Ask an organization administrator to connect Kalkidan once.',
  );
  await expect(setup.getByRole('combobox', { name: 'Policy' })).toContainText('Choose a policy');
  await expect(setup.getByRole('button', { name: 'Use this setup' })).toHaveCount(0);
  await expect(setup).toContainText('Make all the choices.');
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
  const settings = settingsDialog(page);
  await expect(settings.getByRole('tab', { name: 'Agents', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  // The managed setup row of Codex, at the top of the section, gets the focus.
  await expect(settings.locator('#managed-agent-setup')).toBeFocused();
  await expect(settings.locator('#managed-agent-setup')).toContainText('Codex');
  // Without a service name the account has a generic label. IDs never show.
  await settingsTab(page, 'Account').click();
  const account = settings.getByRole('group', { name: 'Organization', exact: true });
  await expect(account).toContainText('Your account');
  await expect(settings).not.toContainText('11111111-1111');
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
  const settings = await openSettings(page, 'About');
  const update = settings.getByRole('region', { name: 'Kalkidan update', exact: true });
  await expect(update).toContainText('Kalkidan 0.1.0 is available');
  // Nothing downloads or restarts without a user action.
  await expect(update.getByRole('button', { name: 'Restart' })).toHaveCount(0);
  await expect(update.getByRole('link')).toHaveCount(0);
  await update.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(update.getByRole('progressbar', { name: 'Kalkidan update download' })).toBeVisible();
  await expect(update.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await expect(update).toContainText('Kalkidan 0.1.0 is ready');
  await update.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(update).toContainText('Restarting Kalkidan 0.1.0');
  await expect(update.getByRole('button')).toHaveCount(0);
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
  const settings = await openSettings(page, 'About');
  const update = settings.getByRole('region', { name: 'Kalkidan update', exact: true });
  await expect(update).toContainText('Kalkidan 0.1.0 is available');
  await expect(update).toContainText('installed from a DEB package');
  await expect(update.getByRole('link', { name: /Download/ })).toHaveAttribute(
    'href',
    /verdictan\/packages\/releases\/tag\/kalkidan-v/,
  );
  // This copy cannot download, stage, or restart itself.
  await expect(update.getByRole('button', { name: /Download|Cancel|Restart/ })).toHaveCount(0);
});
