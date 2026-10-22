import { type Page } from '@playwright/test';
import {
  test,
  expect,
  computersPage,
  openComputersPage,
  openPreferences,
  preferencesDialog,
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

const preferences = (page: Page) => preferencesDialog(page);

/** Opens Settings with an app event, as other parts of the app do. */
async function openWith(page: Page, detail: { section?: string; anchor?: string }) {
  await page.evaluate(
    (detail) => window.dispatchEvent(new CustomEvent('kalkidan-open-settings', { detail })),
    detail,
  );
}

/** Preferences shows, with its three groups. */
async function expectPreferences(page: Page) {
  const dialog = preferences(page);
  await expect(dialog).toBeVisible();
  for (const group of ['Chats', 'Connections', 'This app'])
    await expect(dialog.getByRole('region', { name: group, exact: true })).toBeVisible();
}

/** The Computers page shows, and Preferences does not. */
async function expectComputers(page: Page) {
  await expect(computersPage(page)).toBeVisible();
  await expect(preferences(page)).toHaveCount(0);
}

/** Closes Preferences with Escape. */
async function close(page: Page) {
  await page.keyboard.press('Escape');
  await expect(preferences(page)).toHaveCount(0);
}

test('each entry point opens Preferences or the Computers page', async ({ page }) => {
  await fixture(page);
  // The account menu in the sidebar footer.
  await openPreferences(page);
  await expectPreferences(page);
  // The focus goes to the title, so no focus ring shows on a row.
  await expect(preferences(page).getByRole('heading', { name: 'Preferences' })).toBeFocused();
  // Escape closes Preferences and returns the focus to the account menu.
  await close(page);
  await expect(page.getByRole('button', { name: /^Account: / })).toBeFocused();
  // The menu command, for example Command-comma.
  await page.evaluate(() => (window as any).menuListeners.forEach((l: any) => l('settings')));
  await expectPreferences(page);
  await close(page);
  // An event from another part of the app, with an older section name.
  await openWith(page, { section: 'remote' });
  await expectComputers(page);
  // The older account section opens Preferences.
  await openWith(page, { section: 'accounts' });
  await expectPreferences(page);
  await close(page);
  // Search has one entry for Preferences and one for Computers.
  await page.keyboard.press('ControlOrMeta+k');
  const search = page.getByRole('combobox', { name: 'Search or run a command' });
  await search.fill('Preferences');
  await page.getByRole('option', { name: 'Preferences', exact: true }).click();
  await expectPreferences(page);
  await close(page);
  await page.keyboard.press('ControlOrMeta+k');
  await search.fill('Connect GitHub');
  await page
    .getByRole('option', { name: /Connect GitHub/ })
    .first()
    .click();
  await expectPreferences(page);
  await expect(
    preferences(page).getByRole('group', { name: 'GitHub and boards', exact: true }),
  ).toBeVisible();
  await close(page);
  // Kalkidan does not update itself. Search has no command that checks for updates.
  await page.keyboard.press('ControlOrMeta+k');
  await search.fill('Check for updates');
  await expect(page.getByRole('option', { name: /^Check for updates/ })).toHaveCount(0);
});

test('a deep link opens its place', async ({ page }) => {
  await fixture(page);
  await page.goto('/#settings=accounts');
  await expectPreferences(page);
});

test('Preferences, the account menu and the Computers page show their content', async ({
  page,
}) => {
  await fixture(page);
  const settings = await openPreferences(page);

  // Chats: the access of new chats and Enter to send.
  const chats = settings.getByRole('region', { name: 'Chats', exact: true });
  const access = chats.getByRole('group', { name: 'New chats start as' }).last();
  await expect(access.getByRole('button', { name: 'Read only' })).toBeVisible();
  await expect(access.getByRole('button', { name: 'Can edit files' })).toBeVisible();
  await expect(chats.getByRole('switch', { name: 'Enter sends the message' })).toBeVisible();
  // Connections: the region and GitHub.
  const connections = settings.getByRole('region', { name: 'Connections', exact: true });
  await expect(connections.getByRole('group', { name: 'Region', exact: true })).toContainText(
    'European Union',
  );
  await expect(connections.getByRole('button', { name: 'Change the region' })).toBeVisible();
  await expect(
    connections.getByRole('group', { name: 'GitHub and boards', exact: true }),
  ).toContainText('Boards not allowed');
  // This app: the built-in browser and the version.
  const app = settings.getByRole('region', { name: 'This app', exact: true });
  await expect(app.getByRole('group', { name: 'Built-in browser data' })).toBeVisible();
  await expect(app.getByTestId('settings-version')).toHaveText('Kalkidan 0.1.0');
  const version = app.getByRole('group', { name: 'Kalkidan 0.1.0' });
  await expect(version).toContainText('Build ccccccc');
  await expect(version).toContainText('brew upgrade --cask kalkidan');
  // Kalkidan does not update itself. "Check for updates" opens the release page.
  await expect(version.getByRole('link', { name: /Check for updates/ })).toHaveAttribute(
    'href',
    'https://github.com/verdictan/packages/releases?q=kalkidan',
  );
  // The account is in the account menu. There is no Renew session button and no Advanced fold.
  await expect(settings.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  await expect(settings.getByRole('button', { name: 'Renew session' })).toHaveCount(0);
  await expect(settings.getByRole('button', { name: 'Advanced', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/settings-preferences.png', fullPage: true });
  await close(page);

  // The account menu: the organization and region, help, and Sign out. Kalkidan is light only,
  // so the menu has no theme items.
  await sidebar(page)
    .getByRole('button', { name: /^Account: / })
    .click();
  const menu = page.getByRole('menu');
  await expect(menu).toContainText('Acme Corp · European Union');
  await expect(menu.getByRole('menuitemradio')).toHaveCount(0);
  await expect(menu).not.toContainText('Theme');
  await expect(menu.getByRole('menuitem', { name: /Help and feedback/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Sign out/ })).toBeVisible();
  // Keyboard shortcuts open with ⌘/ and from ⌘K, not from the account menu.
  await expect(menu.getByRole('menuitem', { name: /Keyboard shortcuts/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Computers: this computer, one row for each agent, and the SSH hosts.
  const computers = await openComputersPage(page);
  const local = computers.getByRole('group', { name: 'This computer', exact: true });
  await expect(local).toContainText('Managed agents 0.6.4 · Updates automatically');
  await expect(local).toContainText('Ready');
  const codex = computers.getByRole('group', { name: 'Codex', exact: true });
  await expect(codex.getByRole('status')).toHaveText('Ready');
  await expect(codex).toContainText('Version 0.163.0 · gpt-5');
  await expect(codex.getByRole('button', { name: 'Choose the Codex program' })).toBeVisible();
  await expect(
    computers.getByRole('button', { name: 'Change the organization setup of Codex' }),
  ).toBeVisible();
  await expect(computers).toContainText('Platform · Strict');
  const claude = computers.getByRole('group', { name: 'Claude Code', exact: true });
  await expect(claude.getByRole('status')).toHaveText('Needs setup');
  const devbox = computers.getByRole('group', { name: 'devbox', exact: true });
  await expect(devbox).toContainText('Connected');
  await expect(devbox).toContainText('u@devbox · linux · Node.js v22.3.0');
  // A host checks its managed runtime each time it connects.
  await expect(devbox).toContainText(
    'Managed agents 0.6.4 · Checked for updates when it connected',
  );
  const buildbox = computers.getByRole('group', { name: 'buildbox', exact: true });
  await expect(buildbox.getByRole('button', { name: 'Reconnect' })).toBeVisible();
  // The field that adds a host always shows.
  const add = computers.getByRole('form', { name: 'Add host' });
  await expect(add.getByRole('textbox', { name: 'SSH target' })).toBeVisible();
  // The developer details are in one Details fold.
  await computers.getByRole('button', { name: 'Details', exact: true }).click();
  await expect(computers.getByRole('group', { name: 'Helper on devbox' })).toContainText(
    'Version 1.4.0',
  );
  await page.screenshot({ path: 'test-results/settings-computers.png', fullPage: true });
});

test('the menu of a host opens its agent programs', async ({ page }) => {
  await fixture(page);
  const computers = await openComputersPage(page);
  await computers
    .getByRole('group', { name: 'devbox', exact: true })
    .getByRole('button', { name: 'Actions for devbox' })
    .click();
  await page.getByRole('menuitem', { name: 'Coding agent programs…' }).click();
  const programs = page.getByRole('dialog', { name: 'Coding agent programs on devbox' });
  await expect(programs.getByRole('list', { name: 'Agents on devbox' })).toBeVisible();
  await programs.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(programs).toHaveCount(0);
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
  // A link to the runtime of this computer focuses its row.
  await openWith(page, { section: 'managed-agents', anchor: 'verdictan-runtime' });
  await expectComputers(page);
  const local = computersPage(page).locator('#computer-local');
  await expect(local).toBeFocused();
  await expect(local).toContainText('Not installed');
});

test('the older Updates section and deep link open Computers', async ({ page }) => {
  await fixture(page);
  await openWith(page, { section: 'updates' });
  await expectComputers(page);
  // The runtime of this computer is in its row, so the row gets the focus.
  await expect(computersPage(page).locator('#computer-local')).toBeFocused();
  await page.goto('/#settings=updates');
  await expectComputers(page);
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
  await expectComputers(page);
  const computers = computersPage(page);
  const devbox = computers.getByRole('group', { name: 'devbox', exact: true });
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
  await expect(computers.getByRole('group', { name: 'buildbox', exact: true })).not.toContainText(
    'Update available',
  );
});

test('a refusal link opens Computers with the row of that agent focused', async ({ page }) => {
  await fixture(page);
  await openWith(page, { section: 'agents', anchor: 'agent-program-local-claude' });
  await expectComputers(page);
  await expect(
    computersPage(page).getByRole('group', { name: 'Claude Code', exact: true }),
  ).toBeFocused();
  // The older account step opens Preferences while the user is signed in.
  await openWith(page, { section: 'managed-agents', anchor: 'verdictan-account' });
  await expectPreferences(page);
});

test('a managed setup choice saves at once and Undo restores the choice before', async ({
  page,
}) => {
  await fixture(page);
  await openWith(page, { section: 'managed-agents' });
  await expectComputers(page);
  const computers = computersPage(page);
  const codex = computers.getByRole('group', { name: 'Codex', exact: true });
  await expect(codex).toBeFocused();
  await computers
    .getByRole('button', { name: 'Change the organization setup of Codex', exact: true })
    .click();
  const model = computers.getByRole('combobox', { name: 'Default model' });
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

test('Preferences marks a development build', async ({ page }) => {
  await fixture(
    page,
    `return {
      appVersion: async () => ({ version: '0.1.0', build: 'c'.repeat(64), packaged: false }),
    };`,
  );
  await openWith(page, { section: 'about' });
  await expectPreferences(page);
  const settings = preferences(page);
  await expect(settings.getByTestId('settings-version')).toHaveText('Kalkidan 0.1.0');
  await expect(settings.getByRole('group', { name: 'Kalkidan 0.1.0' })).toContainText(
    'Build ccccccc · Development build',
  );
  // Kalkidan does not update itself. Preferences has no update button and no download.
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
        return { id, name: 'u@staging', target: 'u@staging', status: 'checked' };
      },
    };`,
  );
  await openWith(page, { section: 'computers' });
  const computers = computersPage(page);
  const form = computers.getByRole('form', { name: 'Add host' });
  await form.getByRole('textbox', { name: 'SSH target' }).fill('u@staging');
  await form.getByRole('button', { name: 'Add host' }).click();
  // The new row checks the connection. The helper is missing. The user agrees to install it.
  const row = computers.getByRole('group', { name: 'u@staging', exact: true });
  await expect(row).toBeVisible();
  await expect(computers.getByRole('button', { name: 'Install helper' })).toBeVisible();
  await expect(computers).toContainText('SSH works. Install the Kalkidan helper to connect.');
  expect(await page.evaluate(() => (window as any).calls)).toEqual([
    ['add', 'u@staging', 'u@staging'],
    ['check', 'h9'],
  ]);
  await expect(form.getByRole('textbox', { name: 'SSH target' })).toHaveValue('');
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

test('Preferences and Computers do not overflow horizontally in a narrow window', async ({
  page,
}) => {
  await page.setViewportSize({ width: 820, height: 760 });
  await fixture(page);
  // Below 900px wide, the sidebar starts closed. Open it to reach the account menu.
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  await openPreferences(page);
  // Let the rows read their data.
  await page.waitForTimeout(300);
  expect(await overflowOf(page, '.preferences-dialog'), 'Preferences').toEqual({
    scroll: 0,
    wide: [],
  });
  await close(page);
  const computers = await openComputersPage(page);
  await computers
    .getByRole('button', { name: 'Change the organization setup of Codex', exact: true })
    .click();
  await computers.getByRole('button', { name: 'Details', exact: true }).click();
  await page.waitForTimeout(300);
  expect(await overflowOf(page, '.computers-page'), 'Computers').toEqual({ scroll: 0, wide: [] });
});
