import { type Page } from '@playwright/test';
import { test, expect, computersPage, openComputersPage, sidebar } from './helpers/app';

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

/** The "Organization setup" dialog of the Computers page. */
const setupDialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Organization setup', exact: true });

/**
 * Opens the organization setup dialog from its row on the Computers page and shows the setup of
 * one agent. Returns the dialog.
 */
async function openSetup(page: Page, agent: 'Codex' | 'Claude Code' = 'Codex') {
  const computers = await openComputersPage(page);
  await computers
    .getByRole('group', { name: 'Organization setup', exact: true })
    .getByRole('button', { name: /^(Set up|Change)…$/ })
    .click();
  const dialog = setupDialog(page);
  await expect(dialog).toBeVisible();
  const tab = dialog.getByRole('button', { name: agent, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-pressed', 'true');
  return dialog;
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
  // The account row in the sidebar shows the organization name.
  await expect(sidebar(page).locator('.account-menu')).toContainText('Acme Corp');
  const setup = await openSetup(page);
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
  // The setup is not complete, so there is nothing to save.
  await expect(setup.getByRole('button', { name: 'Save' })).toHaveCount(0);
});

test('a launch block link opens the Computers page at the exact managed setup step', async ({
  page,
}) => {
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
      verdictanSetup: async () => ({
        status: 'selection_required',
        providerAccessModes: ['byok'],
        teams: [{ team_id: ids.team }],
        policies: [{ configuration_id: ids.cfg, configuration_version_id: ids.cfgv }],
        providerConnections: [{ provider_connection_id: ids.team, provider: 'openai' }],
        selections: {},
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
  // The link opens the organization setup dialog at Codex, the first agent that needs setup.
  const dialog = setupDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Codex', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(dialog.getByRole('textbox', { name: 'Default model' })).toBeVisible();
  await expect(dialog).not.toContainText('11111111-1111');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  // The dialog opens from the one "Organization setup" row, which holds the link anchor.
  const settings = computersPage(page);
  const row = settings.locator('#managed-agent-setup');
  await expect(row).toHaveAccessibleName('Organization setup');
  await expect(row).toContainText('Needs setup');
  await expect(row).toContainText('Codex: Not chosen');
  // Without a service name the account has a generic label. IDs never show.
  const account = sidebar(page).locator('.account-menu');
  await expect(account).toContainText('Verdictan');
  await expect(account).not.toContainText('11111111-1111');
  await expect(settings).not.toContainText('11111111-1111');
});
