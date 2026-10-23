import { type Page } from '@playwright/test';
import {
  test,
  expect,
  computersPage,
  openComputersPage,
  openSettingsWindow,
  sidebar,
} from './helpers/app';

const team = '11111111-1111-4111-8111-111111111111';
const agent = '33333333-3333-4333-8333-333333333333';
const ids = { team, agent };

/** A desktop API fixture. `extra` returns the parts that a test checks. */
async function fixture(page: Page, extra: string) {
  await page.addInitScript(
    ({ ids, extra }) => {
      const signedIn = {
        region: 'eu',
        phase: 'authenticated',
        executionReady: false,
        account: {
          state: 'authenticated',
          userId: ids.team,
          organizationId: ids.team,
          apiUrl: 'https://api.eu.verdictan.com',
        },
      };
      const setup = (overrides: Record<string, unknown> = {}) => ({
        status: 'ready',
        bootstrapReadiness: 'bootstrapped',
        providerAccessModes: ['byok'],
        teams: [{ team_id: ids.team }],
        policies: [],
        providerConnections: [],
        agents: [
          {
            agent_id: ids.agent,
            team_id: ids.team,
            configuration_id: `cfg_${'a'.repeat(32)}`,
            configuration_version_id: `cfgv_${'b'.repeat(32)}`,
            default: true,
          },
        ],
        selections: {},
        ...overrides,
      });
      (window as any).refreshes = 0;
      (window as any).workspace = Object.assign(
        {
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
          verdictanStatus: async () => signedIn,
        },
        new Function('ids', 'signedIn', 'setup', extra)(ids, signedIn, setup),
      );
    },
    { ids, extra },
  );
  await page.goto('/');
}

test('a refused session shows "Sign in again" with its code, not "Signed in"', async ({ page }) => {
  await fixture(
    page,
    `return {
      verdictanStatus: async () => ({
        ...signedIn,
        phase: 'expired',
        error: 'desktop.auth_expired',
        account: { ...signedIn.account, state: 'expired' },
      }),
    };`,
  );
  const account = sidebar(page).locator('.account-menu');
  await expect(
    account.getByRole('button', { name: /^Sign in again, Settings and help/ }),
  ).toBeVisible();
  await expect(page.getByTestId('session-banner')).toContainText(
    'Verdictan did not accept your session. Code: desktop.auth_expired',
  );
  const settings = await openSettingsWindow(page, 'Account');
  const row = settings.locator('#verdictan-account');
  await expect(row).toContainText('Sign in again');
  await expect(row).toContainText('Code: desktop.auth_expired');
  await expect(row.getByRole('button', { name: 'Sign in again', exact: true })).toBeVisible();
  await expect(settings).not.toContainText('Signed in');
});

test('a setup that Settings cannot read shows the code in the agent rows', async ({ page }) => {
  await fixture(
    page,
    `return {
      verdictanSetup: async () => {
        throw new Error('The setup of your organization is not valid. [desktop.setup_invalid]');
      },
    };`,
  );
  await openComputersPage(page);
  const codex = computersPage(page).getByRole('group', { name: 'Codex', exact: true });
  await expect(codex).toContainText(
    'Kalkidan could not read the setup of your organization. Code: desktop.setup_invalid',
  );
});

test('Details shows the setup of this computer, and Refresh runs it again', async ({ page }) => {
  await fixture(
    page,
    `let gateway = { status: 'failed', code: 'desktop.resource_conflict' };
    return {
      verdictanSetup: async () => setup({ computerGateway: gateway }),
      verdictanSetupRefresh: async () => {
        window.refreshes++;
        gateway = { status: 'created' };
        return setup({ computerGateway: gateway });
      },
    };`,
  );
  const settings = await openComputersPage(page);
  await settings.getByRole('button', { name: 'Details', exact: true }).click();
  const row = settings.getByRole('group', { name: 'Setup of this computer', exact: true });
  await expect(row).toContainText(
    'Kalkidan could not make the gateway of this computer. Code: desktop.resource_conflict',
  );
  await row.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(row).toContainText('The gateway of this computer is ready.');
  expect(await page.evaluate(() => (window as any).refreshes)).toBe(1);
});

test('Details keeps the clear words when an administrator must connect Kalkidan', async ({
  page,
}) => {
  await fixture(
    page,
    `return {
      verdictanSetup: async () =>
        setup({ bootstrapReadiness: 'bootstrap_requires_admin', agents: [], computerGateway: { status: 'skipped' } }),
      verdictanSetupRefresh: async () => setup(),
    };`,
  );
  const settings = await openComputersPage(page);
  await settings.getByRole('button', { name: 'Details', exact: true }).click();
  await expect(
    settings.getByRole('group', { name: 'Setup of this computer', exact: true }),
  ).toContainText('Ask an organization administrator to finish Kalkidan setup.');
});
