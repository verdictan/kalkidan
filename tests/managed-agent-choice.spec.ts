import { type Locator, type Page } from '@playwright/test';
import { test, expect, openAgentSetup, settingsDialog } from './helpers/app';

const team = '11111111-1111-4111-8111-111111111111';
const team2 = '22222222-2222-4222-8222-222222222222';
const kalkidan = '33333333-3333-4333-8333-333333333333';
const release = '44444444-4444-4444-8444-444444444444';
const spare = '55555555-5555-4555-8555-555555555555';
const cfg = `cfg_${'a'.repeat(32)}`;
const cfgv = `cfgv_${'b'.repeat(32)}`;
const cfg2 = `cfg_${'c'.repeat(32)}`;
const cfgv2 = `cfgv_${'d'.repeat(32)}`;
const ids = { team, team2, kalkidan, release, spare, cfg, cfgv, cfg2, cfgv2 };

/**
 * A desktop API fixture. `extra` is the body of a function of `ids` that returns the API parts
 * of the test. Shared helpers: `agents`, `record` and `setup`.
 */
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
      };
      const helpers = {
        agents: {
          kalkidan: {
            agent_id: ids.kalkidan,
            team_id: ids.team,
            configuration_id: ids.cfg,
            configuration_version_id: ids.cfgv,
            configuration_name: 'Kalkidan default',
            version_name: '1.1.0',
            default: true,
          },
          release: {
            agent_id: ids.release,
            team_id: ids.team2,
            name: 'Release bot',
            configuration_id: ids.cfg2,
            configuration_version_id: ids.cfgv2,
            configuration_name: 'Strict',
            version_name: '2.0.0',
          },
          spare: {
            agent_id: ids.spare,
            team_id: ids.team2,
            configuration_id: ids.cfg2,
            configuration_version_id: ids.cfgv2,
          },
        },
        record: (overrides: Record<string, unknown> = {}) => ({
          status: 'bootstrapped',
          agent_id: ids.kalkidan,
          configuration_status: 'available',
          agent_status: 'available',
          ...overrides,
        }),
        setup: (overrides: Record<string, unknown> = {}) => ({
          status: 'selection_required',
          policyReadiness: 'default_available',
          bootstrapReadiness: 'bootstrapped',
          defaultPolicy: { configuration_id: ids.cfg, configuration_version_id: ids.cfgv },
          providerAccessModes: ['byok'],
          teams: [{ team_id: ids.team }, { team_id: ids.team2, name: 'Platform' }],
          policies: [
            { configuration_id: ids.cfg, configuration_version_id: ids.cfgv, default: true },
          ],
          providerConnections: [{ provider_connection_id: ids.team, provider: 'openai' }],
          selections: {},
          ...overrides,
        }),
      };
      const saved: unknown[] = [];
      (window as any).savedSelections = saved;
      (window as any).workspace = Object.assign(
        base,
        {
          verdictanSelect: async (agent: string, selection: unknown) => {
            saved.push([agent, selection]);
            throw new Error('saved');
          },
        },
        new Function('ids', 'helpers', extra)(ids, helpers),
      );
    },
    { ids, extra },
  );
  await page.goto('/');
}

/** Opens the Codex setup sheet from its row in Settings › Agents. */
const openSetup = (page: Page) => openAgentSetup(page);

/** The visible labels of the options of one choice. The first line is the label. */
async function options(page: Page, setup: Locator, name: string) {
  await setup.getByRole('combobox', { name }).click();
  const texts = await page.getByRole('option').allInnerTexts();
  await page.keyboard.press('Escape');
  return texts.map((text) => text.trim().split('\n')[0].trim());
}

async function expectNoIds(setup: Locator) {
  const text = await setup.innerText();
  for (const id of [...Object.values(ids), 'cfg_', 'cfgv_'])
    expect(text, `visible text must not contain ${id}`).not.toContain(id);
}

test('the first connect bootstraps once and preselects the Kalkidan agent', async ({ page }) => {
  await fixture(
    page,
    `// The desktop runs the bootstrap once, in the first check after sign-in, and keeps the
    // result for the app session. The fixture is that desktop: before the bootstrap, the
    // service reports bootstrap_available; after it, the record and the Kalkidan agent.
    let bootstraps = 0;
    let ran = false;
    window.bootstraps = () => bootstraps;
    return {
      verdictanSetup: async () => {
        if (!ran) {
          bootstraps++;
          ran = true;
        }
        return helpers.setup({
          bootstrap: helpers.record(),
          agents: [helpers.agents.kalkidan, helpers.agents.release],
          bootstrapped: 'bootstrapped',
        });
      },
    };`,
  );
  const setup = await openSetup(page);
  await expect(setup.getByRole('note')).toContainText(
    'Kalkidan set up the Kalkidan agent for your organization.',
  );
  const agent = setup.getByRole('combobox', { name: 'Agent' });
  await expect(agent).toHaveText('Kalkidan agent');
  // The agent sets the team and the policy. There is no team or policy choice.
  await expect(setup.getByRole('combobox', { name: 'Team' })).toHaveCount(0);
  await expect(setup.getByRole('combobox', { name: 'Policy' })).toHaveCount(0);
  await expect(setup).toContainText('Policy: Kalkidan default · 1.1.0.');
  // The sheet loads the choices again when it opens again. The bootstrap does not run again.
  await setup.getByRole('button', { name: 'Done', exact: true }).click();
  await settingsDialog(page)
    .getByRole('group', { name: 'Codex', exact: true })
    .getByRole('button', { name: 'Fix Codex', exact: true })
    .click();
  await expect(agent).toHaveText('Kalkidan agent');
  expect(await page.evaluate(() => (window as any).bootstraps())).toBe(1);
  await expectNoIds(setup);
});

test('a member sees a calm note to ask an administrator to finish setup', async ({ page }) => {
  await fixture(
    page,
    `return {
      verdictanSetup: async () => helpers.setup({
        bootstrapReadiness: 'bootstrap_requires_admin',
        policyReadiness: 'default_configuration_required',
        defaultPolicy: undefined,
        policies: [],
        agents: [],
      }),
    };`,
  );
  const setup = await openSetup(page);
  const note = setup.getByRole('note').filter({ hasText: 'organization administrator' });
  await expect(note).toHaveCount(1);
  await expect(note).toHaveText('Ask an organization administrator to finish Kalkidan setup.');
  // A note, not an error.
  await expect(note).not.toHaveClass(/destructive/);
  await expect(setup.getByRole('alert')).toHaveCount(0);
  await expect(setup.getByRole('button', { name: 'Use this setup' })).toHaveCount(0);
});

test('the agent choice shows service names and generic labels, and saves the agent', async ({
  page,
}) => {
  await fixture(
    page,
    `return {
      verdictanSetup: async () => helpers.setup({
        bootstrap: helpers.record(),
        agents: [helpers.agents.kalkidan, helpers.agents.release, helpers.agents.spare],
      }),
    };`,
  );
  const setup = await openSetup(page);
  await expect
    .poll(() => options(page, setup, 'Agent'))
    .toEqual(['Choose an agent', 'Kalkidan agent', 'Release bot', 'Agent 1']);
  // The configuration of each agent is the secondary text.
  await setup.getByRole('combobox', { name: 'Agent' }).click();
  await expect(page.getByRole('option', { name: /Release bot/ })).toContainText('Strict · 2.0.0');
  await page.getByRole('option', { name: /Release bot/ }).click();
  await expect(setup.getByRole('combobox', { name: 'Agent' })).toHaveText('Release bot');
  await expect(setup).toContainText('Policy: Strict · 2.0.0.');
  // The selection is complete when the model name is entered. It saves at once.
  await setup.getByRole('textbox', { name: 'Default model' }).fill('gpt-5');
  await setup.getByRole('textbox', { name: 'Default model' }).press('Enter');
  await expect.poll(() => page.evaluate(() => (window as any).savedSelections.length)).toBe(1);
  const [[agent, selection]] = await page.evaluate(() => (window as any).savedSelections);
  expect(agent).toBe('codex');
  expect(selection).toMatchObject({
    agentId: release,
    teamId: team2,
    configurationId: '',
    configurationVersionId: '',
    providerConnectionId: team,
    model: 'gpt-5',
  });
  await expectNoIds(setup);
});

test('a removed default shows a calm note and needs another agent', async ({ page }) => {
  await fixture(
    page,
    `const chosen = {
      teamId: ids.team, agentId: ids.kalkidan, configurationId: '', configurationVersionId: '',
      providerConnectionId: ids.team, model: 'gpt-5',
    };
    return {
      verdictanSetup: async () => helpers.setup({
        policyReadiness: 'default_removed',
        defaultPolicy: undefined,
        policies: [],
        bootstrap: helpers.record({ configuration_status: 'deleted', agent_status: 'deleted' }),
        agents: [helpers.agents.release],
        selections: { codex: chosen },
      }),
    };`,
  );
  const setup = await openSetup(page);
  const note = setup.getByRole('note').filter({ hasText: 'removed the default' });
  await expect(note).toHaveText(
    'An administrator removed the default Kalkidan setup. Choose another agent.',
  );
  await expect(note).not.toHaveClass(/destructive/);
  // The saved Kalkidan agent is gone. Nothing is preselected and the setup is not ready.
  const agent = setup.getByRole('combobox', { name: 'Agent' });
  await expect(agent).toHaveText('Choose an agent');
  await expect(setup.getByText('Codex is ready.')).toHaveCount(0);
  await expect(setup.getByRole('button', { name: 'Use this setup' })).toHaveCount(0);
  expect(await options(page, setup, 'Agent')).toEqual(['Choose an agent', 'Release bot']);
  // The other agent completes the selection. It saves at once.
  await agent.click();
  await page.getByRole('option', { name: /Release bot/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).savedSelections.length)).toBe(1);
  const [[, selection]] = await page.evaluate(() => (window as any).savedSelections);
  expect(selection).toMatchObject({ agentId: release, teamId: team2, model: 'gpt-5' });
  await expectNoIds(setup);
});

test('a removed default without another agent tells the user to ask an administrator', async ({
  page,
}) => {
  await fixture(
    page,
    `return {
      verdictanSetup: async () => helpers.setup({
        policyReadiness: 'default_removed',
        defaultPolicy: undefined,
        policies: [],
        bootstrap: helpers.record({ agent_status: 'deleted' }),
        agents: [],
      }),
    };`,
  );
  const setup = await openSetup(page);
  await expect(setup.getByRole('note').filter({ hasText: 'removed the default' })).toHaveText(
    'An administrator removed the default Kalkidan setup, and you have no other agent. Ask an organization administrator to give you access to an agent.',
  );
  await expect(setup.getByRole('button', { name: 'Use this setup' })).toHaveCount(0);
});

for (const [name, agentId] of [
  ['with the Kalkidan agent', 'agentId: ids.kalkidan,'],
  ['saved before the agent choice', ''],
] as const)
  test(`a saved Codex subscription setup ${name} shows as saved`, async ({ page }) => {
    await fixture(
      page,
      `return {
        models: async () => [{ id: 'gpt-6-astra', name: 'GPT-6-Astra' }],
        verdictanSetup: async () => helpers.setup({
          status: 'ready',
          providerAccessModes: ['byok', 'codex_subscription'],
          bootstrap: helpers.record(),
          agents: [helpers.agents.kalkidan, helpers.agents.release],
          selections: {
            codex: {
              teamId: ids.team,
              ${agentId}
              configurationId: '',
              configurationVersionId: '',
              providerConnectionId: '',
              providerAccessMode: 'codex_subscription',
              model: 'gpt-6-astra',
            },
          },
        }),
      };`,
    );
    const setup = await openSetup(page);
    await expect(setup.getByRole('combobox', { name: 'Agent' })).toHaveText('Kalkidan agent');
    await expect(setup.getByRole('combobox', { name: 'Model access' })).toHaveText(
      'Codex subscription on the computer',
    );
    // The only model is chosen. Its list does not show.
    await expect(setup).toContainText('Default model: GPT-6-Astra');
    await expect(setup.getByText('Codex is ready.', { exact: true })).toBeVisible();
    await expect(setup.getByRole('button', { name: 'Use this setup' })).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).savedSelections)).toEqual([]);
  });

test('a complete setup that Kalkidan chose, but did not save, shows Use this setup', async ({
  page,
}) => {
  await fixture(
    page,
    `return {
      models: async () => [{ id: 'gpt-6-astra', name: 'GPT-6-Astra' }],
      verdictanSetup: async () => helpers.setup({
        bootstrap: helpers.record(),
        agents: [helpers.agents.kalkidan],
        selections: {
          codex: {
            teamId: ids.team2,
            configurationId: '',
            configurationVersionId: '',
            providerConnectionId: ids.team,
            model: 'gpt-6-astra',
          },
        },
      }),
    };`,
  );
  const setup = await openSetup(page);
  // The saved setup uses another team than the Kalkidan agent. It is a change.
  // The only agent is chosen, so its list does not show. Its policy shows.
  await expect(setup.getByRole('combobox', { name: 'Agent' })).toHaveCount(0);
  await expect(setup).toContainText('Policy: Kalkidan default · 1.1.0.');
  await expect(setup.getByRole('button', { name: 'Use this setup' })).toBeVisible();
  // The form is a change, so the sheet does not say that Codex is ready.
  await expect(setup.getByText('Codex is ready.', { exact: true })).toHaveCount(0);
  await setup.getByRole('button', { name: 'Use this setup' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).savedSelections.length)).toBe(1);
  const [[, selection]] = await page.evaluate(() => (window as any).savedSelections);
  expect(selection).toMatchObject({ agentId: kalkidan, teamId: team, model: 'gpt-6-astra' });
});
