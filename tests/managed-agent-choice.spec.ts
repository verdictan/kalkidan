import { type Locator, type Page } from '@playwright/test';
import { test, expect, computersPage, openComputersPage } from './helpers/app';

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
      const computerAgents: unknown[] = [];
      (window as any).savedSelections = saved;
      (window as any).computerAgents = computerAgents;
      (window as any).workspace = Object.assign(
        base,
        {
          verdictanSelect: async (agent: string, selection: unknown) => {
            saved.push([agent, selection]);
            throw new Error('saved');
          },
          verdictanSetComputerAgent: async (computer: string, agentId: string) => {
            computerAgents.push([computer, agentId]);
            const setup = await (window as any).workspace.verdictanSetup();
            return { ...setup, computerAgents: { [computer]: agentId } };
          },
        },
        new Function('ids', 'helpers', extra)(ids, helpers),
      );
    },
    { ids, extra },
  );
  await page.goto('/');
}

const hideSetup = (page: Page) =>
  page.getByRole('button', { name: 'Hide the organization setup of Codex', exact: true });

/**
 * Opens the organization setup of Codex in place under its row on the Computers page. Returns
 * the part under the row that holds the setup form.
 */
async function openSetup(page: Page) {
  const computers = await openComputersPage(page);
  await computers
    .getByRole('button', { name: 'Change the organization setup of Codex', exact: true })
    .click();
  await expect(hideSetup(page)).toBeVisible();
  return computers.locator('.settings-row-extra').filter({ has: hideSetup(page) });
}

/** The agent row of this computer on the Computers page. */
const agentRow = (page: Page) => computersPage(page).getByRole('group', { name: /^Agent: / });

/** The status of the Codex row on the Computers page, for example "Ready". */
const codexStatus = (page: Page) =>
  computersPage(page).getByRole('group', { name: 'Codex', exact: true }).getByRole('status');

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
  // This computer uses the Kalkidan agent for Codex and Claude Code. Its policy shows.
  await expect(agentRow(page)).toHaveAccessibleName('Agent: Kalkidan agent');
  await expect(agentRow(page)).toContainText(
    'Kalkidan default · 1.1.0 · Codex and Claude Code on this computer use it for new chats.',
  );
  // The coding agent form has no agent, team or policy choice.
  await expect(setup.getByRole('combobox', { name: 'Agent' })).toHaveCount(0);
  await expect(setup.getByRole('combobox', { name: 'Team' })).toHaveCount(0);
  await expect(setup.getByRole('combobox', { name: 'Policy' })).toHaveCount(0);
  // The form loads the choices again when it opens again. The bootstrap does not run again.
  await hideSetup(page).click();
  await computersPage(page)
    .getByRole('button', { name: 'Change the organization setup of Codex', exact: true })
    .click();
  await expect(hideSetup(page)).toBeVisible();
  expect(await page.evaluate(() => (window as any).bootstraps())).toBe(1);
  await expectNoIds(computersPage(page));
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
  await expect(setup.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
});

test('Change agent shows service names and saves the agent of this computer', async ({ page }) => {
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
  await agentRow(page)
    .getByRole('button', { name: 'Change agent for this computer', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Change the agent for this computer' });
  // Existing chats keep their agent.
  await expect(dialog).toContainText(
    'New chats use the new agent. Existing chats keep their agent.',
  );
  await expect
    .poll(() => options(page, dialog, 'Agent'))
    .toEqual(['Kalkidan agent', 'Release bot', 'Agent 1']);
  // The configuration of each agent is the secondary text.
  await dialog.getByRole('combobox', { name: 'Agent' }).click();
  await expect(page.getByRole('option', { name: /Release bot/ })).toContainText('Strict · 2.0.0');
  await page.getByRole('option', { name: /Release bot/ }).click();
  await dialog.getByRole('button', { name: 'Change agent', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).computerAgents)).toEqual([['local', release]]);
  await expect(agentRow(page)).toHaveAccessibleName('Agent: Release bot');
  // The coding agent selection saves the model access only. The agent is not in it.
  await setup.getByRole('textbox', { name: 'Default model' }).fill('gpt-5');
  await setup.getByRole('textbox', { name: 'Default model' }).press('Enter');
  await expect.poll(() => page.evaluate(() => (window as any).savedSelections.length)).toBe(1);
  const [[agent, selection]] = await page.evaluate(() => (window as any).savedSelections);
  expect(agent).toBe('codex');
  expect(selection).toMatchObject({ providerConnectionId: team, model: 'gpt-5' });
  expect(selection.agentId).toBeUndefined();
  await expectNoIds(computersPage(page));
});

test('a removed default shows a calm note and needs another agent', async ({ page }) => {
  await fixture(
    page,
    `const chosen = {
      teamId: '', configurationId: '', configurationVersionId: '',
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
  // The Kalkidan agent is gone. This computer has no agent and Codex is not ready.
  await expect(agentRow(page)).toHaveAccessibleName('Agent: No agent');
  await expect(agentRow(page)).toContainText('removed the default Kalkidan setup');
  await expect(codexStatus(page)).toHaveText('Needs setup');
  await agentRow(page)
    .getByRole('button', { name: 'Change agent for this computer', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Change the agent for this computer' });
  expect(await options(page, dialog, 'Agent')).toEqual(['Choose an agent', 'Release bot']);
  await dialog.getByRole('combobox', { name: 'Agent' }).click();
  await page.getByRole('option', { name: /Release bot/ }).click();
  await dialog.getByRole('button', { name: 'Change agent', exact: true }).click();
  expect(await page.evaluate(() => (window as any).computerAgents)).toEqual([['local', release]]);
  await expect(agentRow(page)).toHaveAccessibleName('Agent: Release bot');
  await expectNoIds(computersPage(page));
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
  await expect(setup.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
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
    await expect(agentRow(page)).toHaveAccessibleName('Agent: Kalkidan agent');
    await expect(setup.getByRole('combobox', { name: 'Model access' })).toHaveText(
      'Codex subscription on the computer',
    );
    // The only model is chosen. Its list does not show.
    await expect(setup).toContainText('Default model: GPT-6-Astra');
    await expect(codexStatus(page)).toHaveText('Ready');
    await expect(setup.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).savedSelections)).toEqual([]);
  });

test('a complete setup that Kalkidan chose, but did not save, shows Save', async ({ page }) => {
  await fixture(
    page,
    `return {
      models: async () => [{ id: 'gpt-6-astra', name: 'GPT-6-Astra' }],
      verdictanSetup: async () => helpers.setup({
        bootstrap: helpers.record(),
        agents: [helpers.agents.kalkidan],
        selections: {
          codex: {
            teamId: '',
            configurationId: '',
            configurationVersionId: '',
            providerConnectionId: ids.team,
            model: '',
          },
        },
      }),
    };`,
  );
  const setup = await openSetup(page);
  // The only agent is the agent of this computer. There is nothing to change.
  await expect(agentRow(page)).toHaveAccessibleName('Agent: Kalkidan agent');
  await expect(
    agentRow(page).getByRole('button', { name: 'Change agent for this computer' }),
  ).toHaveCount(0);
  // Kalkidan chose the only model. The form is a change, so the user confirms it with Save.
  await expect(setup).toContainText('Default model: GPT-6-Astra');
  await expect(setup.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  await setup.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).savedSelections.length)).toBe(1);
  const [[, selection]] = await page.evaluate(() => (window as any).savedSelections);
  expect(selection).toMatchObject({ providerConnectionId: team, model: 'gpt-6-astra' });
});

test('each SSH host has its own agent', async ({ page }) => {
  await fixture(
    page,
    `return {
      remoteHosts: async () => [
        { id: 'host-1', name: 'devbox', target: 'me@devbox', status: 'disconnected' },
      ],
      verdictanSetup: async () => helpers.setup({
        bootstrap: helpers.record(),
        agents: [helpers.agents.kalkidan, helpers.agents.release],
        computerAgents: { 'host-1': ids.release },
      }),
    };`,
  );
  const computers = await openComputersPage(page);
  // This computer keeps the Kalkidan agent. The host has the agent that the user chose for it.
  await expect(agentRow(page)).toHaveCount(2);
  await expect(computers.getByRole('group', { name: 'Agent: Kalkidan agent' })).toContainText(
    'on this computer',
  );
  const host = computers.getByRole('group', { name: 'Agent: Release bot' });
  await expect(host).toContainText('Codex and Claude Code on devbox use it for new chats.');
  await host.getByRole('button', { name: 'Change agent for devbox', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Change the agent for devbox' });
  await dialog.getByRole('combobox', { name: 'Agent' }).click();
  await page.getByRole('option', { name: /Kalkidan agent/ }).click();
  await dialog.getByRole('button', { name: 'Change agent', exact: true }).click();
  expect(await page.evaluate(() => (window as any).computerAgents)).toEqual([['host-1', kalkidan]]);
});
