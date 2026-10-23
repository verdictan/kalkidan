import { type Locator, type Page } from '@playwright/test';
import {
  test,
  expect,
  openSettingsWindow,
  settingsDialog,
  settingsSection,
  sidebar,
} from './helpers/app';

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

const settings = (page: Page) => settingsDialog(page);

/** Opens Settings with an app event, as other parts of the app do. */
async function openWith(page: Page, detail: { section?: string; anchor?: string }) {
  await page.evaluate(
    (detail) => window.dispatchEvent(new CustomEvent('kalkidan-open-settings', { detail })),
    detail,
  );
}

/** Settings shows at `section`, with General, Computers, Account and the project as tabs. */
async function expectSection(page: Page, section: 'General' | 'Computers' | 'Account') {
  const dialog = settings(page);
  await expect(dialog).toBeVisible();
  const tabs = dialog.getByRole('tablist', { name: 'Settings sections' });
  await expect(tabs.getByRole('tab')).toHaveText(['General', 'Computers', 'Account', 'Project']);
  await expect(settingsSection(page, section)).toHaveAttribute('aria-selected', 'true');
  const panel = dialog.getByRole('tabpanel', { name: section, exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

/** Opens a section of Settings and returns its panel. */
async function openSection(page: Page, section: 'General' | 'Computers' | 'Account') {
  await settingsSection(page, section).click();
  return expectSection(page, section);
}

/** The group of this computer in Settings › Computers. */
const thisComputer = (computers: Locator) =>
  computers.getByRole('region', { name: /^This (Mac|computer)$/ });

/** Closes Settings with Escape. */
async function close(page: Page) {
  await page.keyboard.press('Escape');
  await expect(settings(page)).toHaveCount(0);
}

test('each entry point opens Settings at its section', async ({ page }) => {
  await fixture(page);
  // The account menu in the sidebar footer opens General.
  await openSettingsWindow(page);
  await expectSection(page, 'General');
  // The focus goes to the section title, so no focus ring shows on a row.
  await expect(settings(page).getByRole('heading', { name: 'General', exact: true })).toBeFocused();
  // Escape closes Settings and returns the focus to the account menu.
  await close(page);
  await expect(page.getByRole('button', { name: /^Account: / })).toBeFocused();
  // The menu command, for example Command-comma.
  await page.evaluate(() => (window as any).menuListeners.forEach((l: any) => l('settings')));
  await expectSection(page, 'General');
  await close(page);
  // An event from another part of the app, with an older section name.
  await openWith(page, { section: 'remote' });
  await expectSection(page, 'Computers');
  await close(page);
  // The older account section opens Account.
  await openWith(page, { section: 'accounts' });
  await expectSection(page, 'Account');
  await close(page);
  // Search has one entry for Settings and one for Computers.
  await page.keyboard.press('ControlOrMeta+k');
  const search = page.getByRole('combobox', { name: 'Search or run a command' });
  await search.fill('Settings');
  await page.getByRole('option', { name: /^Settings…/ }).click();
  await expectSection(page, 'General');
  await close(page);
  await page.keyboard.press('ControlOrMeta+k');
  await search.fill('Computers');
  await page.getByRole('option', { name: /^Computers…/ }).click();
  await expectSection(page, 'Computers');
  await close(page);
  await page.keyboard.press('ControlOrMeta+k');
  await search.fill('Connect GitHub');
  await page
    .getByRole('option', { name: /Connect GitHub/ })
    .first()
    .click();
  // Connect GitHub opens the Account section, which has the GitHub row.
  const account = await expectSection(page, 'Account');
  await expect(
    account.getByRole('group', { name: 'GitHub and boards', exact: true }),
  ).toBeVisible();
  await close(page);
  // Kalkidan does not update itself. Search has no command that checks for updates.
  await page.keyboard.press('ControlOrMeta+k');
  await search.fill('Check for updates');
  await expect(page.getByRole('option', { name: /^Check for updates/ })).toHaveCount(0);
});

test('a deep link opens its place', async ({ page }) => {
  await fixture(page);
  // A link opens when the page loads.
  await page.goto('/#settings=accounts');
  await page.reload();
  await expectSection(page, 'Account');
});

test('Settings and the account menu show their content', async ({ page }) => {
  await fixture(page);
  await openSettingsWindow(page);

  // General: the access of new chats, Enter to send, the built-in browser, your data and the
  // version. General is the first section.
  const general = await expectSection(page, 'General');
  const access = general.getByRole('group', { name: 'New chats start as' }).last();
  await expect(access.getByRole('button', { name: 'Read only' })).toBeVisible();
  await expect(access.getByRole('button', { name: 'Can edit files' })).toBeVisible();
  await expect(general.getByRole('switch', { name: 'Enter sends', exact: true })).toBeVisible();
  await expect(general.getByRole('group', { name: 'Built-in browser', exact: true })).toBeVisible();
  await expect(general.getByRole('group', { name: 'Your data' })).toBeVisible();
  await expect(general.getByTestId('settings-version')).toHaveText('Kalkidan 0.1.0');
  const version = general.getByRole('group', { name: 'Kalkidan 0.1.0' });
  // The version row has no build line. The update command is on the release page.
  await expect(version).not.toContainText('Build');
  await expect(version).not.toContainText('brew');
  // Kalkidan does not update itself. "Check for updates" opens the release page.
  await expect(version.getByRole('link', { name: /Check for updates/ })).toHaveAttribute(
    'href',
    'https://github.com/verdictan/packages/releases?q=kalkidan',
  );
  // The support bundle is in Computers › Details, not in General. There is no Advanced fold.
  await expect(general.getByRole('group', { name: 'Diagnostics', exact: true })).toHaveCount(0);
  await expect(settings(page).getByRole('button', { name: 'Advanced', exact: true })).toHaveCount(
    0,
  );

  // Account: the account with Sign out, the region and GitHub. No Renew session button.
  const account = await openSection(page, 'Account');
  await expect(account.getByRole('group', { name: 'Signed in', exact: true })).toContainText(
    'Acme Corp',
  );
  await expect(account.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(account.getByRole('button', { name: 'Renew session' })).toHaveCount(0);
  await expect(account.getByRole('group', { name: 'Region', exact: true })).toContainText(
    'European Union',
  );
  await expect(account.getByRole('button', { name: 'Change the region' })).toBeVisible();
  await expect(
    account.getByRole('group', { name: 'GitHub and boards', exact: true }),
  ).toContainText('Boards not allowed');
  await page.screenshot({ path: 'test-results/settings-account.png', fullPage: true });

  // Computers: one row for each agent of this computer, and a group for each SSH host.
  const computers = await openSection(page, 'Computers');
  const local = thisComputer(computers);
  // A ready Kalkidan service updates by itself, so it has no row.
  await expect(local.getByRole('group', { name: 'Kalkidan service' })).toHaveCount(0);
  const codex = local.getByRole('group', { name: 'Codex', exact: true });
  await expect(codex.getByRole('status')).toHaveText('Ready');
  await expect(codex).toContainText('0.163.0');
  // Only a row that needs the user has a button. Claude Code has no organization setup yet.
  await expect(codex.getByRole('button')).toHaveCount(0);
  const claude = local.getByRole('group', { name: 'Claude Code', exact: true });
  await expect(claude).toContainText('2.1.306');
  await expect(claude.getByRole('button', { name: 'Set up', exact: true })).toBeVisible();
  // The organization setup is a quiet button at the end.
  await expect(computers.getByRole('button', { name: 'Organization setup…' })).toBeVisible();
  // Each host is a group named after the host, with one row named after its SSH target.
  const devbox = computers
    .getByRole('region', { name: 'devbox', exact: true })
    .getByRole('group', { name: 'u@devbox', exact: true });
  await expect(devbox.getByRole('status')).toHaveText('Connected');
  await expect(devbox).toContainText('linux · Node.js v22.3.0');
  // A ready runtime on a host needs no line.
  await expect(devbox).not.toContainText('Managed agents');
  const buildbox = computers
    .getByRole('region', { name: 'buildbox', exact: true })
    .getByRole('group', { name: 'u@buildbox', exact: true });
  await expect(buildbox.getByRole('button', { name: 'Reconnect' })).toBeVisible();
  // "Add SSH host" opens the field in place. Escape closes the field, not Settings.
  await computers.getByRole('button', { name: 'Add SSH host' }).click();
  const add = computers.getByRole('form', { name: 'Add SSH host' });
  await expect(add.getByRole('textbox', { name: 'SSH target' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(add).toHaveCount(0);
  await expect(settings(page)).toBeVisible();
  // The developer details are in one Details fold.
  await computers.getByRole('button', { name: 'Details', exact: true }).click();
  await expect(computers.getByRole('group', { name: 'Helper on devbox' })).toContainText(
    'Version 1.4.0',
  );
  await expect(
    computers
      .getByRole('group', { name: 'Coding agent programs', exact: true })
      .getByRole('button', { name: 'Programs…' }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/settings-computers.png', fullPage: true });
  await close(page);

  // The account menu: the organization and region, Settings, help, and Sign out. Kalkidan is
  // light only, so the menu has no theme items. The menu holds only actions.
  await sidebar(page)
    .getByRole('button', { name: /^Account: / })
    .click();
  const menu = page.getByRole('menu');
  await expect(menu).toContainText('Acme Corp · European Union');
  await expect(menu.getByRole('menuitemradio')).toHaveCount(0);
  await expect(menu).not.toContainText('Theme');
  await expect(menu.getByRole('menuitem', { name: /^Settings…/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Help and feedback/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Sign out/ })).toBeVisible();
  for (const gone of [/Keyboard shortcuts/, /Notifications/, /Diagnostics/, /Get started/])
    await expect(menu.getByRole('menuitem', { name: gone })).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('the menu of a host opens its agent programs', async ({ page }) => {
  await fixture(page);
  const computers = await openSettingsWindow(page, 'Computers');
  await computers
    .getByRole('group', { name: 'u@devbox', exact: true })
    .getByRole('button', { name: 'Actions for devbox' })
    .click();
  await page.getByRole('menuitem', { name: 'Coding agent programs…' }).click();
  const programs = page.getByRole('dialog', { name: 'Coding agent programs on devbox' });
  await expect(
    programs.getByRole('list', { name: 'Coding agents on devbox', exact: true }),
  ).toBeVisible();
  // The dialog has no Done button. Escape closes it and keeps Settings open.
  await expect(programs.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(programs).toHaveCount(0);
  await expect(settings(page)).toBeVisible();
});

test('a link to the runtime opens Computers at this computer', async ({ page }) => {
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
  // A link to the runtime of this computer focuses the Kalkidan service row. The row shows,
  // because the service is not installed.
  await openWith(page, { section: 'managed-agents', anchor: 'verdictan-runtime' });
  const computers = await expectSection(page, 'Computers');
  const local = computers.locator('#computer-local');
  await expect(local).toBeFocused();
  await expect(local).toContainText('Kalkidan service');
  await expect(local).toContainText('Not installed');
});

test('the older Updates section and deep link open Computers', async ({ page }) => {
  await fixture(page);
  await openWith(page, { section: 'updates' });
  const computers = await expectSection(page, 'Computers');
  // A ready runtime has no row, so the group of this computer gets the focus.
  await expect(thisComputer(computers).getByRole('heading')).toBeFocused();
  await close(page);
  await page.goto('/#settings=updates');
  await page.reload();
  await expectSection(page, 'Computers');
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
  // The update link of a host opens Computers at the menu of that host.
  await openWith(page, { anchor: 'helper-update-h1' });
  const computers = await expectSection(page, 'Computers');
  const devbox = computers.getByRole('group', { name: 'u@devbox', exact: true });
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
  await expect(computers.getByRole('group', { name: 'u@buildbox', exact: true })).not.toContainText(
    'Update available',
  );
});

test('a refusal link opens Computers with the row of that agent focused', async ({ page }) => {
  await fixture(page);
  await openWith(page, { section: 'agents', anchor: 'agent-program-local-claude' });
  const computers = await expectSection(page, 'Computers');
  await expect(computers.getByRole('group', { name: 'Claude Code', exact: true })).toBeFocused();
  await close(page);
  // The older account step opens Account while the user is signed in.
  await openWith(page, { section: 'managed-agents', anchor: 'verdictan-account' });
  await expectSection(page, 'Account');
});

test('a managed setup choice saves at once and Undo restores the choice before', async ({
  page,
}) => {
  await fixture(page);
  // A link to the managed setup opens the Organization setup dialog at the agent that needs
  // setup. Here that is Claude Code.
  await openWith(page, { section: 'managed-agents' });
  const dialog = page.getByRole('dialog', { name: 'Organization setup', exact: true });
  await expect(dialog).toBeVisible();
  const agent = dialog.getByRole('group', { name: 'Agent' });
  await expect(agent.getByRole('button', { name: 'Claude Code' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await agent.getByRole('button', { name: 'Codex' }).click();
  const model = dialog.getByRole('combobox', { name: 'Default model' });
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
  // The dialog closes, and Settings › Computers shows. Codex is still ready.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  const computers = await expectSection(page, 'Computers');
  await expect(
    computers.getByRole('group', { name: 'Codex', exact: true }).getByRole('status'),
  ).toHaveText('Ready');
});

test('General shows only the build of a development build', async ({ page }) => {
  await fixture(
    page,
    `return {
      appVersion: async () => ({ version: '0.1.0', build: 'c'.repeat(64), packaged: false }),
    };`,
  );
  // The older About section opens General, which has the version.
  await openWith(page, { section: 'about' });
  const general = await expectSection(page, 'General');
  await expect(general.getByTestId('settings-version')).toHaveText('Kalkidan 0.1.0');
  // The version row has no build line.
  await expect(
    general.getByRole('group', { name: 'Kalkidan 0.1.0' }).locator('.settings-row-help'),
  ).toHaveCount(0);
  // Kalkidan does not update itself. General has no update button and no download.
  await expect(general.getByRole('button', { name: /update|download|restart/i })).toHaveCount(0);
  await expect(general.getByRole('link', { name: /Check for updates/ })).toBeVisible();
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
        return { id, name: 'u@staging', target: 'u@staging', status: 'checked' };
      },
    };`,
  );
  await openWith(page, { section: 'computers' });
  const computers = await expectSection(page, 'Computers');
  await computers.getByRole('button', { name: 'Add SSH host' }).click();
  const form = computers.getByRole('form', { name: 'Add SSH host' });
  // Add is off until the field has a target.
  await expect(form.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
  await form.getByRole('textbox', { name: 'SSH target' }).fill('u@staging');
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  // The new row checks the connection. The helper is missing. The user agrees to install it.
  const row = computers.getByRole('group', { name: 'u@staging', exact: true });
  await expect(row).toBeVisible();
  await expect(computers.getByRole('button', { name: 'Install helper' })).toBeVisible();
  await expect(computers).toContainText('SSH works. Install the Kalkidan helper to connect.');
  expect(await page.evaluate(() => (window as any).calls)).toEqual([
    ['add', 'u@staging', 'u@staging'],
    ['check', 'h9'],
  ]);
  // The field closes after the host is added.
  await expect(form).toHaveCount(0);
  await expect(computers.getByRole('button', { name: 'Add SSH host' })).toBeVisible();
});

/** The size of the content that goes past the right edge of `selector`. */
async function overflowOf(page: Page, selector: string) {
  return page.locator(selector).evaluate((pane) => {
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
}

test('Settings does not overflow horizontally in a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 760 });
  await fixture(page);
  // Below 900px wide, the sidebar starts closed. Open it to reach the account menu.
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  await openSettingsWindow(page);
  // Let the rows read their data.
  await page.waitForTimeout(300);
  for (const section of ['General', 'Account', 'Computers'] as const) {
    const panel = await openSection(page, section);
    if (section === 'Computers') {
      await panel.getByRole('button', { name: 'Details', exact: true }).click();
      await page.waitForTimeout(300);
    }
    expect(await overflowOf(page, '.one-settings'), `Settings › ${section}`).toEqual({
      scroll: 0,
      wide: [],
    });
  }
  // The organization setup is in a dialog.
  await settings(page).getByRole('button', { name: 'Organization setup…' }).click();
  const setup = page.getByRole('dialog', { name: 'Organization setup', exact: true });
  await expect(setup.getByRole('group', { name: 'Agent' })).toBeVisible();
  await page.waitForTimeout(300);
  expect(
    await overflowOf(page, '[data-slot="dialog-content"]:not(.one-settings)'),
    'Organization setup',
  ).toEqual({
    scroll: 0,
    wide: [],
  });
});
