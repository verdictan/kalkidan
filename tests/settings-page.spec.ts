import { type Page } from '@playwright/test';
import { test, expect, openSettings, settingsDialog, settingsTab } from './helpers/app';

/**
 * A desktop with one connected SSH host and one host that is not connected. The managed
 * account is signed in. `extra` replaces parts of the API.
 */
async function fixture(page: Page, extra = '') {
  await page.addInitScript((extra) => {
    const w = window as any;
    w.menuListeners = [];
    w.selections = [];
    const hosts = [
      {
        id: 'h1',
        name: 'devbox',
        target: 'u@devbox',
        status: 'connected',
        version: '1.4.0',
        installedDigest: 'a'.repeat(64),
        node: 'v22.3.0',
        platform: 'linux',
      },
      { id: 'h2', name: 'buildbox', target: 'u@buildbox', status: 'disconnected' },
    ];
    const runtime = (hostId: string) => ({
      hostId,
      component: 'verdictan',
      discovery: 'current',
      stale: false,
      installed: { version: '0.6.4', sha256: 'b'.repeat(64) },
      latest: { version: '0.6.4', sha256: 'b'.repeat(64) },
      history: [],
    });
    const setup = {
      status: 'ready',
      providerAccessModes: ['byok'],
      teams: [{ team_id: 't1', name: 'Platform' }],
      policies: [{ configuration_id: 'c1', configuration_version_id: 'v1', name: 'Strict' }],
      providerConnections: [
        { provider_connection_id: 'p1', provider: 'openai', name: 'OpenAI' },
        { provider_connection_id: 'p2', provider: 'openai', name: 'OpenAI backup' },
      ],
      selections: {
        codex: {
          teamId: 't1',
          configurationId: 'c1',
          configurationVersionId: 'v1',
          providerConnectionId: 'p1',
          model: 'gpt-5',
        },
      },
    };
    const base: Record<string, unknown> = {
      snapshot: async () => ({
        projects: [],
        groups: [{ id: 'g', name: 'Project', repoIds: [] }],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      trackerProviders: async () => [],
      remoteHosts: async () => hosts,
      githubCliCheck: async () => ({ status: 'ready' }),
      githubAuthStatus: async () => ({ status: 'idle' }),
      agentInstallations: async () => [
        { agent: 'codex', status: 'installed', path: '/usr/local/bin/codex', version: '0.163.0' },
        { agent: 'claude', status: 'installed', path: '/usr/local/bin/claude', version: '2.1.306' },
      ],
      models: async () => [
        { id: 'gpt-5', name: 'GPT-5' },
        { id: 'gpt-5-mini', name: 'GPT-5 mini' },
      ],
      onMenuCommand: (listener: (command: string) => void) => {
        w.menuListeners.push(listener);
        return () => {};
      },
      verdictanStatus: async () => ({
        region: 'eu',
        phase: 'authenticated',
        executionReady: true,
        account: {
          state: 'authenticated',
          userId: 'u1',
          organizationId: 'o1',
          organizationName: 'Acme Corp',
          apiUrl: 'https://api.eu.verdictan.com',
          expiresAt: '2026-11-01T00:00:00Z',
        },
      }),
      verdictanSetup: async () => structuredClone(setup),
      verdictanSelect: async (agent: string, selection: any) => {
        w.selections.push([agent, selection]);
        (setup.selections as any)[agent] = selection;
        return structuredClone(setup);
      },
      runtimeUpdateStatus: async (hostId = 'local') => runtime(hostId),
      appVersion: async () => ({
        version: '0.1.0-build.100.aaaaaaaaaaaa',
        build: 'c'.repeat(64),
        packaged: true,
      }),
      helperUpdates: async () => [
        {
          hostId: 'h1',
          name: 'devbox',
          connected: true,
          installed: 'a'.repeat(64),
          running: 'a'.repeat(64),
          approved: 'a'.repeat(64),
          discovery: 'current',
        },
      ],
    };
    w.workspace = Object.assign(base, new Function(extra)());
  }, extra);
  await page.goto('/');
}

const settingsPage = (page: Page) => settingsDialog(page);

/** Opens Settings with an app event, as other parts of the app do. */
async function openWith(page: Page, detail: { section?: string; anchor?: string }) {
  await page.evaluate(
    (detail) => window.dispatchEvent(new CustomEvent('kalkidan-open-settings', { detail })),
    detail,
  );
}

/** Settings is a dialog. The section list selects `name`, and the title names it. */
async function expectTab(page: Page, name: string) {
  const settings = settingsPage(page);
  await expect(settings).toBeVisible();
  await expect(settingsTab(page, name)).toHaveAttribute('aria-selected', 'true');
  await expect(settings.getByRole('heading', { name, level: 2 })).toBeVisible();
}

/** Closes Settings with Escape. */
async function close(page: Page) {
  await page.keyboard.press('Escape');
  await expect(settingsPage(page)).toHaveCount(0);
}

test('each entry point opens Settings on the right section', async ({ page }) => {
  await fixture(page);
  // The account menu in the sidebar footer.
  await openSettings(page);
  await expectTab(page, 'General');
  expect(
    await settingsPage(page)
      .getByRole('tablist', { name: 'Settings sections' })
      .getByRole('tab')
      .allTextContents(),
  ).toEqual(['General', 'Account', 'Agents', 'Computers', 'Diagnostics', 'About']);
  // The focus moves to the section in the list. Arrow keys move between the sections.
  await expect(settingsTab(page, 'General')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expectTab(page, 'Account');
  await expect(settingsTab(page, 'Account')).toBeFocused();
  // Escape closes Settings and returns the focus to the account menu.
  await close(page);
  await expect(page.getByRole('button', { name: /^Account: / })).toBeFocused();
  // The menu command, for example Command-comma.
  await page.evaluate(() => (window as any).menuListeners.forEach((l: any) => l('settings')));
  await expectTab(page, 'General');
  await close(page);
  // An event from another part of the app, with an older section name.
  await openWith(page, { section: 'remote' });
  await expectTab(page, 'Computers');
  // A request while Settings shows changes the section.
  await openWith(page, { section: 'accounts' });
  await expectTab(page, 'Account');
  await close(page);
  // Search.
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search or run a command' }).fill('Connect GitHub');
  await page
    .getByRole('option', { name: /Connect GitHub/ })
    .first()
    .click();
  await expectTab(page, 'Account');
  await close(page);
  // Kalkidan does not update itself. Search has no command that checks for updates.
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search or run a command' }).fill('Check for updates');
  await expect(page.getByRole('option', { name: /Check for updates/ })).toHaveCount(0);
});

test('a deep link opens its section', async ({ page }) => {
  await fixture(page);
  await page.goto('/#settings=accounts');
  await expectTab(page, 'Account');
});

test('each section shows its content', async ({ page }) => {
  await fixture(page);
  const settings = await openSettings(page);
  const advanced = () => settings.getByRole('button', { name: 'Advanced', exact: true });

  // General: the appearance, the default agent, and the keyboard shortcuts.
  const general = settings.getByRole('list', { name: 'General' });
  await expect(general.getByRole('group', { name: 'Appearance' }).first()).toBeVisible();
  await expect(general.getByRole('button', { name: 'Dark', exact: true })).toBeVisible();
  await expect(general.getByRole('combobox', { name: 'Default agent' })).toBeVisible();
  await expect(general.getByRole('group', { name: 'Keyboard shortcuts' })).toBeVisible();
  // The section list shows the version.
  await expect(settings.getByRole('navigation', { name: 'Settings' })).toContainText(
    'Kalkidan 0.1.0',
  );
  await page.screenshot({ path: 'test-results/settings-general.png', fullPage: true });

  // Account: the Verdictan account, the region, and GitHub.
  await settingsTab(page, 'Account').click();
  const account = settings.getByRole('list', { name: 'Account', exact: true });
  await expect(account).toContainText('Acme Corp');
  await expect(account.getByRole('group', { name: 'Region', exact: true })).toContainText(
    'European Union',
  );
  await expect(account.getByRole('button', { name: 'Sign out' })).toBeVisible();
  // There is no Renew session button. Kalkidan renews the session.
  await expect(settings.getByRole('button', { name: 'Renew session' })).toHaveCount(0);
  const services = settings.getByRole('list', { name: 'Connected services' });
  await expect(services.getByRole('group', { name: 'GitHub', exact: true })).toContainText(
    'Connected',
  );
  await advanced().click();
  await expect(settings.getByRole('group', { name: 'Session ends' })).toContainText(
    'Kalkidan renews it automatically.',
  );
  await expect(settings.getByRole('group', { name: 'Service address' })).toContainText(
    'https://api.eu.verdictan.com',
  );
  await page.screenshot({ path: 'test-results/settings-accounts.png', fullPage: true });

  // Agents: one row for each agent, with its status and one action.
  await settingsTab(page, 'Agents').click();
  const agents = settings.getByRole('list', { name: 'Managed agents' });
  const codex = agents.getByRole('group', { name: 'Codex', exact: true });
  await expect(codex).toContainText('Ready');
  await expect(codex).toContainText('Default model gpt-5');
  await expect(codex.getByRole('button', { name: 'Change Codex' })).toBeVisible();
  const claude = agents.getByRole('group', { name: 'Claude Code', exact: true });
  await expect(claude).toContainText('Not set up');
  await expect(claude.getByRole('button', { name: 'Fix Claude Code' })).toBeVisible();
  // The programs and the team are in the Advanced fold.
  await advanced().click();
  await expect(
    settings.getByRole('group', { name: 'Codex program on this computer' }),
  ).toContainText('/usr/local/bin/codex');
  await expect(settings.getByRole('group', { name: 'Team and policy' })).toContainText('Platform');
  await page.screenshot({ path: 'test-results/settings-agents.png', fullPage: true });

  // Computers: one row for each computer, and Add SSH host.
  await settingsTab(page, 'Computers').click();
  const computers = settings.getByRole('list', { name: 'Computers' });
  const local = computers.getByRole('group', { name: 'This computer' });
  await expect(local).toContainText('Managed agents 0.6.4 · Updates automatically');
  await expect(local).toContainText('Ready');
  const devbox = computers.getByRole('group', { name: 'devbox' });
  await expect(devbox).toContainText('Connected');
  await expect(devbox).toContainText('u@devbox · linux · Node.js v22.3.0');
  // A host checks its managed runtime each time it connects.
  await expect(devbox).toContainText(
    'Managed agents 0.6.4 · Checked for updates when it connected',
  );
  const buildbox = computers.getByRole('group', { name: 'buildbox' });
  await expect(buildbox.getByRole('button', { name: 'Reconnect' })).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Add SSH host', exact: true })).toBeVisible();
  await advanced().click();
  await expect(settings.getByRole('group', { name: 'Helper on devbox' })).toContainText(
    'Version 1.4.0',
  );
  await page.screenshot({ path: 'test-results/settings-computers.png', fullPage: true });

  // About: the app version, the release page, the agent tools, and help.
  await settingsTab(page, 'About').click();
  const about = settings.getByRole('list', { name: 'About' });
  await expect(about.getByTestId('settings-version')).toHaveText('Version 0.1.0 · Build ccccccc');
  // Kalkidan does not update itself. "Check for updates" opens the release page.
  await expect(about.getByRole('link', { name: /Check for updates/ })).toHaveAttribute(
    'href',
    'https://github.com/verdictan/packages/releases?q=kalkidan',
  );
  await expect(about.getByRole('group', { name: 'Update Kalkidan' })).toContainText(
    'brew upgrade --cask kalkidan',
  );
  await expect(about.getByRole('group', { name: 'Agent tools' })).toContainText('Up to date');
  await expect(about.getByRole('link', { name: 'User guide' })).toBeVisible();
  await expect(about.getByRole('link', { name: 'Report an issue' })).toBeVisible();
  await advanced().click();
  await expect(settings.getByRole('group', { name: 'Build' })).toContainText('c'.repeat(64));
  await page.screenshot({ path: 'test-results/settings-about.png', fullPage: true });
});

test('links in Agents and Computers move between the sections', async ({ page }) => {
  await fixture(page);
  const settings = await openSettings(page, 'Computers');
  // The menu of a host opens its agent programs.
  await settings
    .getByRole('group', { name: 'devbox' })
    .getByRole('button', { name: 'Actions for devbox' })
    .click();
  await page.getByRole('menuitem', { name: 'Agent programs…' }).click();
  const programs = page.getByRole('dialog', { name: 'Agent programs on devbox' });
  await expect(programs.getByRole('list', { name: 'Agents on devbox' })).toBeVisible();
  await programs.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(programs).toHaveCount(0);
  // Agents › Advanced links to the hosts in Computers.
  await settingsTab(page, 'Agents').click();
  await settings.getByRole('button', { name: 'Advanced', exact: true }).click();
  await settings
    .getByRole('group', { name: 'Programs on SSH hosts' })
    .getByRole('button', { name: 'Open Computers' })
    .click();
  await expectTab(page, 'Computers');
  await expect(settings.getByRole('group', { name: 'buildbox' })).toBeVisible();
});

test('About opens Computers when the agent tools need attention', async ({ page }) => {
  await fixture(
    page,
    `return {
      runtimeUpdateStatus: async (hostId = 'local') => ({
        hostId,
        component: 'verdictan',
        discovery: 'available',
        stale: false,
        latest: { version: '0.6.5', sha256: 'e'.repeat(64) },
        history: [],
      }),
    };`,
  );
  await openWith(page, { section: 'about' });
  await expectTab(page, 'About');
  const tools = settingsPage(page).getByRole('group', { name: 'Agent tools' });
  await expect(tools).toContainText('Not installed');
  await tools.getByRole('button', { name: 'Open Computers' }).click();
  await expectTab(page, 'Computers');
  await expect(settingsPage(page).getByRole('group', { name: 'This computer' })).toContainText(
    'Not installed',
  );
  // A link to the runtime of this computer focuses its row.
  await close(page);
  await openWith(page, { section: 'managed-agents', anchor: 'verdictan-runtime' });
  await expectTab(page, 'Computers');
  await expect(settingsPage(page).locator('#computer-local')).toBeFocused();
});

test('the older Updates section and deep link open Computers', async ({ page }) => {
  await fixture(page);
  await openWith(page, { section: 'updates' });
  await expectTab(page, 'Computers');
  await expect(settingsTab(page, 'Updates')).toHaveCount(0);
  // The runtime of this computer is in its row, so the row gets the focus.
  await expect(settingsPage(page).locator('#computer-local')).toBeFocused();
  await page.goto('/#settings=updates');
  await expectTab(page, 'Computers');
});

test('a helper update shows on the host row, and its link focuses the host menu', async ({
  page,
}) => {
  await fixture(
    page,
    `const w = window;
    w.installs = [];
    return {
      remoteInstall: async (id) => {
        w.installs.push(id);
        return (await w.workspace.remoteHosts()).find((host) => host.id === id);
      },
      helperUpdates: async () => [
        {
          hostId: 'h1',
          name: 'devbox',
          connected: true,
          installed: 'a'.repeat(64),
          running: 'a'.repeat(64),
          approved: 'd'.repeat(64),
          discovery: 'available',
        },
      ],
    };`,
  );
  // About says that a helper update waits.
  await openWith(page, { section: 'about' });
  const tools = settingsPage(page).getByRole('group', { name: 'Agent tools' });
  await expect(tools).toContainText('Update waiting');
  await expect(tools).toContainText('An SSH helper update waits for active work to stop.');
  await close(page);
  // The update link of a host opens Computers at the menu of that host.
  await openWith(page, { anchor: 'helper-update-h1' });
  await expectTab(page, 'Computers');
  const settings = settingsPage(page);
  const devbox = settings.getByRole('group', { name: 'devbox' });
  await expect(devbox).toContainText('Update available');
  const menu = devbox.getByRole('button', { name: 'Actions for devbox' });
  await expect(menu).toBeFocused();
  await menu.click();
  await page.getByRole('menuitem', { name: 'Update helper (new version)…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Update the helper on devbox?' });
  await expect(confirm).toContainText('The update stops all active work on this host.');
  await confirm.getByRole('button', { name: 'Update helper' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).installs)).toEqual(['h1']);
  // A host without an update does not show the update.
  await expect(settings.getByRole('group', { name: 'buildbox' })).not.toContainText(
    'Update available',
  );
});

test('a refusal link opens Agents with the program of that computer focused', async ({ page }) => {
  await fixture(page);
  await openWith(page, { section: 'agents', anchor: 'agent-program-local-claude' });
  await expectTab(page, 'Agents');
  // The program rows are in the Advanced fold. The link opens it.
  await expect(
    settingsPage(page).getByRole('group', { name: 'Claude Code program on this computer' }),
  ).toBeFocused();
  // The older managed setup steps open their new sections.
  await openWith(page, { section: 'managed-agents', anchor: 'verdictan-account' });
  await expectTab(page, 'Account');
  await expect(settingsPage(page).locator('#verdictan-account')).toBeFocused();
});

test('a managed setup choice saves at once and Undo restores the choice before', async ({
  page,
}) => {
  await fixture(page);
  await openWith(page, { section: 'managed-agents' });
  await expectTab(page, 'Agents');
  const codex = settingsPage(page).getByRole('group', { name: 'Codex', exact: true });
  await expect(codex).toBeFocused();
  await codex.getByRole('button', { name: 'Change Codex' }).click();
  const sheet = page.getByRole('dialog', { name: 'Codex setup' });
  const model = sheet.getByRole('combobox', { name: 'Default model' });
  await expect(model).toContainText('GPT-5');
  await model.click();
  await page.getByRole('option', { name: 'GPT-5 mini' }).click();
  const toast = page.locator('[data-slot="toast"]').filter({ hasText: 'Saved the Codex setup' });
  await expect(toast).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).selections.map((s: any) => s[1].model)))
    .toEqual(['gpt-5-mini']);
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).selections.map((s: any) => s[1].model)))
    .toEqual(['gpt-5-mini', 'gpt-5']);
  await expect(model).toContainText('GPT-5');
  await expect(model).not.toContainText('mini');
});

test('About marks a development build', async ({ page }) => {
  await fixture(
    page,
    `return {
      appVersion: async () => ({ version: '0.1.0', build: 'c'.repeat(64), packaged: false }),
    };`,
  );
  await openWith(page, { section: 'about' });
  await expectTab(page, 'About');
  const settings = settingsPage(page);
  await expect(settings.getByTestId('settings-version')).toHaveText(
    'Version 0.1.0 · Build ccccccc · Development build',
  );
  // Kalkidan does not update itself. Settings has no update button and no download.
  await expect(settings.getByRole('button', { name: /update|download|restart/i })).toHaveCount(0);
  await expect(settings.getByRole('link', { name: /Check for updates/ })).toBeVisible();
});

test('Computers adds a host and checks it at once', async ({ page }) => {
  await fixture(
    page,
    `const w = window;
    w.calls = [];
    return {
      remoteAdd: async (name, target) => {
        w.calls.push(['add', name, target]);
        return { id: 'h9', name, target, status: 'disconnected' };
      },
      remoteCheck: async (id) => {
        w.calls.push(['check', id]);
        return { id, name: 'staging', target: 'u@staging', status: 'checked' };
      },
    };`,
  );
  await openWith(page, { section: 'computers' });
  const settings = settingsPage(page);
  await settings.getByRole('button', { name: 'Add SSH host', exact: true }).click();
  const form = settings.getByRole('form', { name: 'Add host' });
  await form.getByLabel('Host name').fill('staging');
  await form.getByLabel('SSH target').fill('u@staging');
  await form.getByRole('button', { name: 'Save host' }).click();
  const setup = settings.getByRole('region', { name: 'Set up staging' });
  // The helper is missing after the check. The user agrees to install it.
  await expect(
    setup.getByRole('button', { name: 'Install the Kalkidan helper and connect' }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).calls)).toEqual([
    ['add', 'staging', 'u@staging'],
    ['check', 'h9'],
  ]);
});

test('no Settings section overflows horizontally in a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 760 });
  await fixture(page);
  // Below 900px wide, the sidebar starts closed. Open it to reach the account menu.
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  const settings = await openSettings(page);
  for (const name of ['General', 'Account', 'Agents', 'Computers', 'Diagnostics', 'About']) {
    await settingsTab(page, name).click();
    await expect(settingsTab(page, name)).toHaveAttribute('aria-selected', 'true');
    // Let the section read its data, and open its Advanced fold.
    await page.waitForTimeout(300);
    const fold = settings.getByRole('button', { name: 'Advanced', exact: true });
    if ((await fold.count()) && (await fold.getAttribute('aria-expanded')) !== 'true')
      await fold.click();
    for (const selector of ['.settings-dialog', '.settings-scroll']) {
      const overflow = await page.locator(selector).evaluate((pane) => {
        const right = pane.getBoundingClientRect().right;
        const wide = [...pane.querySelectorAll<HTMLElement>('*')].filter((node) => {
          const box = node.getBoundingClientRect();
          return box.width > 0 && box.right > right + 1;
        });
        return {
          scroll: pane.scrollWidth - pane.clientWidth,
          wide: wide.slice(0, 3).map((node) => node.outerHTML.slice(0, 120)),
        };
      });
      expect(overflow, `${name} ${selector}`).toEqual({ scroll: 0, wide: [] });
    }
  }
});
