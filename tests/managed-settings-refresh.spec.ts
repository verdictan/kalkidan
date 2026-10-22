import { type Locator, type Page } from '@playwright/test';
import { test, expect, openAgentSetup, openSettings, settingsTab } from './helpers/app';

const team = '11111111-1111-4111-8111-111111111111';
const cfg = `cfg_${'a'.repeat(32)}`;
const cfgv = `cfgv_${'b'.repeat(32)}`;
const cfgv2 = `cfgv_${'c'.repeat(32)}`;
const sha = 'a'.repeat(64);

/** A desktop API fixture. `extra` replaces the parts that a test checks. */
async function fixture(page: Page, extra: string) {
  await page.addInitScript(
    ({ ids, extra }) => {
      const listeners = new Set<() => void>();
      (window as any).emitChanged = () => listeners.forEach((listener) => listener());
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
        onVerdictanChanged: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
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
    { ids: { team, cfg, cfgv, cfgv2, sha }, extra },
  );
  await page.goto('/');
}

/** Opens Settings on one section and returns the Settings dialog. */
async function openTab(page: Page, tab: 'Account' | 'Agents' | 'Computers') {
  return openSettings(page, tab);
}

/** The row of this computer in Settings › Computers, with the managed agents runtime. */
const localRuntime = (settings: Locator) =>
  settings.getByRole('group', { name: 'This computer', exact: true });

test('the runtime step shows the install and its result without a manual refresh', async ({
  page,
}) => {
  await fixture(
    page,
    `const release = { version: '0.6.4', releaseId: '1:' + ids.sha, sha256: ids.sha };
    // The install finishes on the host after the third status read. No change event comes.
    let reads = -1;
    const base = () => ({
      hostId: 'local', component: 'verdictan', discovery: 'available', stale: false,
      latest: release, history: [], lastSuccessAt: 1,
    });
    window.statusReads = () => reads;
    return {
      verdictanStatus: async () => ({ phase: 'missing', region: 'eu', executionReady: false }),
      runtimeUpdateStatus: async () => {
        if (reads < 0) return { ...base(), canInstall: true };
        reads++;
        if (reads < 3)
          return { ...base(), installing: true, canInstall: false,
            reason: 'An install or check is in progress. Wait for it to finish.' };
        return { ...base(), discovery: 'current', installed: release, canInstall: false,
          reason: 'Version 0.6.4 is installed.',
          operation: { id: 'op', generation: 1, sequence: 9, hostId: 'local',
            component: 'verdictan', phase: 'completed', target: release, receivedBytes: 1,
            totalBytes: 1, startedAt: 1, updatedAt: 2 } };
      },
      // Like the desktop: the install starts and the call returns before the first journal entry.
      runtimeUpdateInstall: async () => {
        reads = 0;
        return { ...base(), installing: true, canInstall: false,
          reason: 'An install or check is in progress. Wait for it to finish.' };
      },
      verdictanCheck: async () => ({ phase: 'signed-out', region: 'eu', executionReady: false }),
    };`,
  );
  const settings = await openTab(page, 'Computers');
  const runtime = localRuntime(settings);
  await expect(runtime.getByRole('status').first()).toHaveText('Not installed');
  await runtime.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(runtime.getByRole('status').first()).toHaveText('Installing…');
  await expect(runtime).toContainText('Starting the install of version 0.6.4');
  await expect(runtime.getByRole('button', { name: 'Install', exact: true })).toHaveCount(0);
  await expect(settings).not.toContainText('An install or check is in progress');
  // The poll reads the result. Nobody presses a refresh button.
  await expect(runtime.getByRole('status').first()).toHaveText('Ready', { timeout: 10000 });
  await expect(runtime).toContainText('Managed agents 0.6.4 · Updates automatically');
  expect(await page.evaluate(() => (window as any).statusReads())).toBeGreaterThanOrEqual(3);
});

test('a region change shows its progress and no errors, then clears them', async ({ page }) => {
  await fixture(
    page,
    `let region;
    let changing = false;
    let finish;
    const changeError = (name) =>
      new Error("Error invoking remote method '" + name + "': Error: Account is changing. Wait for the switch to finish.");
    window.finishSwitch = () => finish();
    return {
      verdictanStatus: async () => {
        if (changing) throw changeError('verdictan-status');
        return region
          ? { phase: 'authenticated', region, executionReady: false,
              account: { state: 'authenticated', userId: ids.team, organizationId: ids.team,
                apiUrl: 'https://api.eu.verdictan.com' } }
          : { phase: 'signed-out', executionReady: false };
      },
      runtimeUpdateStatus: async () => {
        if (changing) throw changeError('runtime-update-status');
        return { hostId: 'local', component: 'verdictan', discovery: 'current', stale: false,
          history: [], installed: { version: '0.6.4', releaseId: '1', sha256: ids.sha } };
      },
      verdictanSetup: async () => ({ status: 'ready', teams: [], policies: [],
        providerConnections: [], selections: {} }),
      verdictanSetRegion: async (next) => {
        changing = true;
        // The desktop tells the windows about the change while it runs. Their reads fail.
        window.emitChanged();
        await new Promise((resolve) => (finish = resolve));
        region = next;
        changing = false;
        window.emitChanged();
        return { phase: 'authenticated', region, executionReady: false,
          account: { state: 'authenticated', userId: ids.team, organizationId: ids.team,
            apiUrl: 'https://api.eu.verdictan.com' } };
      },
    };`,
  );
  const managed = await openTab(page, 'Account');
  const region = managed.getByRole('group', { name: 'Region', exact: true });
  await expect(region).toContainText('Not chosen');
  await region.getByRole('button', { name: 'Choose…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose a region' });
  await dialog.getByRole('radio', { name: 'European Union' }).check();
  await dialog.getByRole('button', { name: 'Use this region', exact: true }).click();
  // The change runs. The region dialog shows its progress until the change finishes.
  await expect(dialog.getByRole('button', { name: 'Changing…' })).toBeDisabled();
  // Give the failed reads time to arrive. They must not show as errors.
  await page.waitForTimeout(1500);
  const body = page.locator('body');
  await expect(body).not.toContainText('Could not read the account status');
  await expect(body).not.toContainText('This computer is not available');
  await expect(body).not.toContainText('Error invoking remote method');
  await expect(dialog.getByRole('button', { name: 'Changing…' })).toBeDisabled();
  await page.evaluate(() => (window as any).finishSwitch());
  await expect(dialog).toHaveCount(0);
  await expect(region).toContainText('European Union');
  await expect(managed.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  // The runtime of this computer is in Computers. It reads again after the change.
  await settingsTab(page, 'Computers').click();
  await expect(localRuntime(managed).getByRole('status').first()).toHaveText('Ready');
  await expect(managed).not.toContainText('Could not read');
  await expect(managed).not.toContainText('not available');
});

test('a stale account read error goes away after a read that works', async ({ page }) => {
  await fixture(
    page,
    `let fail = true;
    window.recover = () => { fail = false; window.emitChanged(); };
    return {
      verdictanStatus: async () => {
        if (fail) throw new Error('Transport lost');
        return { phase: 'signed-out', region: 'eu', executionReady: false };
      },
    };`,
  );
  const settings = await openTab(page, 'Account');
  await expect(settings).toContainText('Could not read the account status.');
  await page.evaluate(() => (window as any).recover());
  await expect(settings.getByRole('group', { name: 'Sign in to Verdictan' })).toBeVisible();
  await expect(settings).not.toContainText('Could not read the account status.');
});

const signedIn = `verdictanStatus: async () => ({
  region: 'eu',
  phase: 'authenticated',
  executionReady: false,
  account: {
    state: 'authenticated',
    userId: ids.team,
    organizationId: ids.team,
    apiUrl: 'https://api.eu.verdictan.com',
  },
}),`;

test('setup keeps the existing policies when the default cannot be made', async ({ page }) => {
  await fixture(
    page,
    `let loads = 0;
    window.loads = () => loads;
    window.saved = [];
    const setup = () => ({
      status: 'selection_required',
      policyReadiness: 'default_creatable',
      defaultUnavailable: true,
      providerAccessModes: ['byok'],
      teams: [{ team_id: ids.team }],
      policies: [
        { configuration_id: ids.cfg, configuration_version_id: ids.cfgv },
        { configuration_id: ids.cfg, configuration_version_id: ids.cfgv2 },
      ],
      providerConnections: [{ provider_connection_id: ids.team, provider: 'openai' }],
      selections: {},
    });
    return {
      ${signedIn}
      verdictanSetup: async () => {
        loads++;
        return setup();
      },
      verdictanSelect: async (agent, selection) => {
        window.saved.push([agent, selection]);
        return { ...setup(), selections: { [agent]: selection } };
      },
    };`,
  );
  const setup = await openAgentSetup(page);
  await expect(setup.getByRole('note').first()).toContainText(
    'Kalkidan could not make the Kalkidan default policy now. Choose another policy',
  );
  await expect(setup).not.toContainText('Could not load the choices');
  await setup.getByRole('combobox', { name: 'Policy' }).click();
  await expect(page.getByRole('option')).toHaveText(['Choose a policy', 'Policy 1', 'Policy 2']);
  await page.getByRole('option', { name: 'Policy 2' }).click();
  // The only OpenAI connection is chosen at once, so the sheet does not ask for it.
  await expect(setup.getByRole('combobox', { name: 'Connection' })).toHaveCount(0);
  // The model name completes the selection. It saves at once.
  await setup.getByRole('textbox', { name: 'Default model' }).fill('gpt-5');
  await setup.getByRole('textbox', { name: 'Default model' }).press('Enter');
  await expect(setup.getByRole('status').last()).toHaveText('Codex is ready.');
  const saved = await page.evaluate(() => (window as any).saved);
  expect(saved[0][1]).toMatchObject({
    configurationId: cfg,
    configurationVersionId: cfgv2,
    providerConnectionId: team,
  });
  // A change in the desktop loads the choices again, which retries the default.
  const before = await page.evaluate(() => (window as any).loads());
  await page.evaluate(() => (window as any).emitChanged());
  await expect.poll(() => page.evaluate(() => (window as any).loads())).toBeGreaterThan(before);
});

test('a permission failure for the default shows the administrator recovery and the policies', async ({
  page,
}) => {
  await fixture(
    page,
    `return {
      ${signedIn}
      verdictanSetup: async () => ({
        status: 'selection_required',
        policyReadiness: 'default_configuration_required',
        providerAccessModes: ['byok'],
        teams: [{ team_id: ids.team }],
        policies: [{ configuration_id: ids.cfg, configuration_version_id: ids.cfgv }],
        providerConnections: [{ provider_connection_id: ids.team, provider: 'openai' }],
        selections: {},
      }),
    };`,
  );
  const setup = await openAgentSetup(page);
  await expect(setup.getByRole('note').first()).toContainText(
    'Ask an organization administrator to connect Kalkidan once.',
  );
  await expect(setup.getByRole('note').first()).toContainText('Until then, choose another policy.');
  // The only policy is chosen at once, so the sheet does not ask for it.
  await expect(setup.getByRole('combobox', { name: 'Policy' })).toHaveCount(0);
  await expect(setup.getByRole('textbox', { name: 'Default model' })).toBeVisible();
  await expect(setup).not.toContainText('Could not load the choices');
});
