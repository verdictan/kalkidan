import { type Page } from '@playwright/test';
import { test, expect, openSettingsWindow, settingsDialog, sidebar } from './helpers/app';

/**
 * A desktop with one connected SSH host and one host that is not connected. The managed
 * account is signed in. Kalkidan finds Codex, Claude Code and the GitHub CLI on this Mac, and
 * Codex on devbox. `extra` replaces parts of the API.
 */
async function fixture(page: Page, extra = '') {
  await page.addInitScript((extra) => {
    const w = window as any;
    w.menuListeners = [];
    w.calls = [];
    const hosts = [
      { id: 'h1', name: 'devbox', target: 'u@devbox', status: 'connected' },
      { id: 'h2', name: 'buildbox', target: 'u@buildbox', status: 'disconnected' },
    ];
    const tool = (id: string, name: string, version?: string, extra = {}) => ({
      tool: id,
      name,
      kind: id === 'gh' ? 'github' : 'agent',
      state: version ? 'ready' : 'missing',
      installed: !!version,
      ...(version ? { version, path: `/usr/local/bin/${id}` } : {}),
      signedIn: version ? 'yes' : 'unknown',
      access: version ? 'granted' : 'unknown',
      usable: id !== 'gh' && !!version,
      installUrl: `https://example.com/${id}`,
      ...extra,
    });
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
      remoteConnect: async (id: string) => {
        w.calls.push(['connect', id]);
        return hosts.find((host) => host.id === id);
      },
      remoteDisconnect: async (id: string) => {
        w.calls.push(['disconnect', id]);
        return hosts.find((host) => host.id === id);
      },
      remoteRemove: async (id: string) => {
        w.calls.push(['remove', id]);
      },
      githubCliCheck: async () => ({ status: 'ready' }),
      githubAuthStatus: async () => ({ status: 'idle' }),
      computerTools: async (options?: { fresh?: boolean }) => {
        if (options?.fresh) w.calls.push(['check-tools']);
        return [
          {
            computer: 'local',
            name: 'This Mac',
            connected: true,
            checkedAt: new Date().toISOString(),
            tools: [
              tool('codex', 'Codex', '0.163.0'),
              tool('claude', 'Claude Code', '2.1.306'),
              tool('gh', 'GitHub CLI', '2.62.0', { account: 'dana-kim' }),
            ],
          },
          {
            computer: 'h1',
            name: 'devbox',
            connected: true,
            checkedAt: new Date().toISOString(),
            tools: [tool('codex', 'Codex', '0.160.0'), tool('claude', 'Claude Code')],
          },
        ];
      },
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
      verdictanOpenConsole: async () => {},
      appVersion: async () => ({
        version: '0.1.0-build.100.aaaaaaaaaaaa',
        build: 'c'.repeat(64),
        packaged: true,
      }),
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

/** The parts of the one Settings page. */
const parts = {
  account: 'Account',
  tools: 'Tools',
  preferences: 'Preferences',
} as const;

/** Settings shows, and the part `part` has the focus. Returns the part. */
async function expectPart(page: Page, part: keyof typeof parts) {
  await expect(settings(page)).toBeVisible();
  const region = settings(page).getByRole('region', { name: parts[part], exact: true });
  await expect(region).toBeFocused();
  return region;
}

/** Closes Settings with Escape. */
async function close(page: Page) {
  await page.keyboard.press('Escape');
  await expect(settings(page)).toHaveCount(0);
}

test('each entry point opens Settings at its part', async ({ page }) => {
  await fixture(page);
  // Settings… in the account menu of the sidebar footer opens the top of the one Settings
  // page. It has no section nav.
  await openSettingsWindow(page);
  await expect(settings(page).getByRole('tablist')).toHaveCount(0);
  await expect(settings(page).getByRole('region', { name: 'Account', exact: true })).toBeVisible();
  await close(page);
  // The menu command, for example Command-comma.
  await page.evaluate(() => (window as any).menuListeners.forEach((l: any) => l('settings')));
  await expect(settings(page)).toBeVisible();
  await close(page);
  // An event from another part of the app, with an older section name.
  await openWith(page, { section: 'remote' });
  await expectPart(page, 'tools');
  await close(page);
  // The older account section opens the account.
  await openWith(page, { section: 'accounts' });
  await expectPart(page, 'account');
  await close(page);
  // Search has one entry for Settings and one for Tools.
  await page.keyboard.press('ControlOrMeta+k');
  const search = page.getByRole('combobox', { name: 'Search or run a command' });
  await search.fill('Settings');
  await page.getByRole('option', { name: /^Settings…/ }).click();
  await expect(settings(page)).toBeVisible();
  await close(page);
  await page.keyboard.press('ControlOrMeta+k');
  await search.fill('Tools');
  await page.getByRole('option', { name: /^Tools…/ }).click();
  await expectPart(page, 'tools');
  await close(page);
  // Connect GitHub opens the GitHub CLI row of Tools.
  await page.keyboard.press('ControlOrMeta+k');
  await search.fill('Connect GitHub');
  await page.getByRole('option', { name: /^Connect GitHub/ }).click();
  await expect(settings(page).locator('#settings-github')).toBeFocused();
  await expect(settings(page).locator('#settings-github')).toContainText('GitHub CLI');
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
  await expectPart(page, 'account');
});

test('Settings and the account menu show their content', async ({ page }) => {
  await fixture(page);
  await openSettingsWindow(page);

  // The account is the head of the sheet: the name, the organization and the region, and Sign
  // out. Manage account is in the last line. No Renew session button, and no region change
  // while an account is signed in.
  const account = settings(page).getByRole('region', { name: 'Account', exact: true });
  await expect(account.getByRole('heading')).toContainText('Acme Corp · European Union');
  await expect(account.getByRole('button', { name: /^Manage/ })).toHaveCount(0);
  await expect(settings(page).getByRole('button', { name: /^Manage account/ })).toBeVisible();
  await expect(account.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(account.getByRole('button', { name: 'Renew session' })).toHaveCount(0);
  await expect(account.getByRole('button', { name: /region/i })).toHaveCount(0);

  // Tools: the CLIs that Kalkidan finds on this Mac, and the tools of each SSH host.
  // Kalkidan does not install, update, or set up agents, so no row has a setup button.
  const tools = settings(page).getByRole('region', { name: 'Tools', exact: true });
  const local = tools.getByRole('list', { name: 'This Mac', exact: true });
  await expect(local.getByRole('listitem')).toHaveCount(3);
  await expect(local.getByRole('listitem').nth(0)).toContainText('Codex0.163.0 · signed in');
  await expect(local.getByRole('listitem').nth(1)).toContainText('Claude Code2.1.306');
  await expect(local.getByRole('listitem').nth(2)).toContainText('GitHub CLI2.62.0 · @dana-kim');
  await expect(local.getByRole('img', { name: 'Ready' })).toHaveCount(3);
  await expect(local.getByRole('button')).toHaveCount(0);
  await expect(tools).toContainText('Through Verdictan · EU');
  await expect(tools).toContainText('Installed something? Restart Kalkidan to find it.');
  for (const gone of [/Organization setup/, /Programs/, /Runs as/, /Kalkidan service/])
    await expect(settings(page)).not.toContainText(gone);
  // The SSH hosts are a part of their own, under the project. A connected host lists its
  // tools. A tool that is not there links to its install guide.
  const hosts = settings(page).getByRole('region', { name: 'SSH hosts', exact: true });
  const devbox = hosts.getByRole('list', { name: 'devbox', exact: true });
  await expect(devbox.getByRole('listitem').nth(0)).toContainText('0.160.0');
  await expect(devbox.getByRole('img', { name: 'Not installed' })).toBeVisible();
  await expect(
    devbox.getByRole('link', { name: 'Claude Code install guide (opens in the browser)' }),
  ).toBeVisible();
  await expect(hosts.locator('#computer-h2')).toContainText('Not connected');
  // "Add SSH host" opens the field in place. Escape closes the field, not Settings.
  await hosts.getByRole('button', { name: 'Add SSH host', exact: true }).click();
  const add = hosts.getByRole('form', { name: 'Add SSH host' });
  await expect(add.getByRole('textbox', { name: 'SSH target' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(add).toHaveCount(0);
  await expect(settings(page)).toBeVisible();

  // Preferences: one switch for each preference.
  const preferences = settings(page).getByRole('region', { name: 'Preferences', exact: true });
  for (const name of ['New chats can edit files', 'Enter sends'])
    await expect(preferences.getByRole('switch', { name, exact: true })).toBeVisible();

  // The quiet footer: the version links to the release page. Kalkidan does not update itself.
  await expect(settings(page).getByTestId('settings-version')).toHaveText('Kalkidan 0.1.0');
  await expect(settings(page).getByTestId('settings-version')).toHaveAttribute(
    'href',
    'https://github.com/verdictan/packages/releases?q=kalkidan',
  );
  await expect(settings(page).getByRole('button', { name: /^Manage data/ })).toBeVisible();
  await expect(settings(page).getByRole('button', { name: 'Clear browsing data…' })).toBeVisible();
  await page.screenshot({ path: 'test-results/settings-page.png', fullPage: true });
  await close(page);

  // The account menu: the organization and region, Settings…, Manage account, help, and Sign
  // out. Kalkidan is light only, so the menu has no theme items.
  await sidebar(page)
    .getByRole('button', { name: /^Account: / })
    .click();
  const menu = page.getByRole('menu');
  await expect(menu).toContainText('Acme Corp · European Union');
  await expect(menu.getByRole('menuitemradio')).toHaveCount(0);
  await expect(menu).not.toContainText('Theme');
  await expect(menu.getByRole('menuitem', { name: /^Settings…/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /^Manage account/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Help and feedback/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Sign out/ })).toBeVisible();
  for (const gone of [/Keyboard shortcuts/, /Notifications/, /Diagnostics/, /Get started/])
    await expect(menu.getByRole('menuitem', { name: gone })).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('Check again reads the tools again', async ({ page }) => {
  await fixture(page);
  const tools = (await openSettingsWindow(page, 'Tools')).getByRole('region', {
    name: 'Tools',
    exact: true,
  });
  await tools.getByRole('button', { name: 'Check again', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).calls)).toEqual([['check-tools']]);
  await expect(tools.getByRole('button', { name: 'Check again', exact: true })).toBeEnabled();
});

test('the menu of a host connects it and removes it', async ({ page }) => {
  await fixture(page);
  const tools = (await openSettingsWindow(page, 'Tools')).getByRole('region', {
    name: 'SSH hosts',
    exact: true,
  });
  // A connected host disconnects. A host that is not connected connects.
  await tools.getByRole('button', { name: 'Actions for devbox' }).click();
  await page.getByRole('menuitem', { name: 'Disconnect', exact: true }).click();
  await tools.getByRole('button', { name: 'Actions for buildbox' }).click();
  await page.getByRole('menuitem', { name: 'Connect', exact: true }).click();
  // Remove asks first. The project folders on the host stay.
  await tools.getByRole('button', { name: 'Actions for buildbox' }).click();
  await page.getByRole('menuitem', { name: 'Remove host…', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Remove buildbox?' });
  await expect(confirm).toContainText('Project folders on the host stay.');
  await confirm.getByRole('button', { name: 'Remove host', exact: true }).click();
  await expect(tools.locator('#computer-h2')).toHaveCount(0);
  await expect(settings(page)).toBeVisible();
  expect(await page.evaluate(() => (window as any).calls)).toEqual([
    ['disconnect', 'h1'],
    ['connect', 'h2'],
    ['remove', 'h2'],
  ]);
});

test('the older sections and links open the part that holds them now', async ({ page }) => {
  await fixture(page);
  // Updates, the agent rows, the managed runtime and the helper of a host are in Tools now.
  for (const detail of [
    { section: 'updates' },
    { section: 'agents', anchor: 'agent-program-local-claude' },
    { section: 'managed-agents', anchor: 'verdictan-runtime' },
    { anchor: 'helper-update-h1' },
  ]) {
    await openWith(page, detail);
    await expectPart(page, 'tools');
    await close(page);
  }
  // The older account step opens the account while the user is signed in.
  await openWith(page, { section: 'managed-agents', anchor: 'verdictan-account' });
  await expect(settings(page).locator('#verdictan-account')).toBeFocused();
  await close(page);
  await page.goto('/#settings=updates');
  await page.reload();
  await expectPart(page, 'tools');
});

test('the footer shows only the version of a development build', async ({ page }) => {
  await fixture(
    page,
    `return {
      appVersion: async () => ({ version: '0.1.0', build: 'c'.repeat(64), packaged: false }),
    };`,
  );
  // The older About section opens Preferences, above the footer with the version.
  await openWith(page, { section: 'about' });
  await expectPart(page, 'preferences');
  await expect(settings(page).getByTestId('settings-version')).toHaveText('Kalkidan 0.1.0');
  await expect(settings(page)).not.toContainText('c'.repeat(12));
  // Kalkidan does not update itself. Settings has no update button and no download.
  await expect(settings(page).getByRole('button', { name: /update|download/i })).toHaveCount(0);
});

test('Tools adds a host and connects it at once', async ({ page }) => {
  await fixture(
    page,
    `const w = window;
    return {
      remoteAdd: async (name, target) => {
        w.calls.push(['add', name, target]);
        return { id: 'h9', name, target, status: 'disconnected' };
      },
    };`,
  );
  await openWith(page, { section: 'computers' });
  await expectPart(page, 'tools');
  const tools = settings(page).getByRole('region', { name: 'SSH hosts', exact: true });
  await tools.getByRole('button', { name: 'Add SSH host', exact: true }).click();
  const form = tools.getByRole('form', { name: 'Add SSH host' });
  // Add is off until the field has a target.
  await expect(form.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
  await form.getByRole('textbox', { name: 'SSH target' }).fill('u@staging');
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  // The new host shows at once, and Kalkidan connects it.
  await expect(tools.locator('#computer-h9')).toContainText('u@staging');
  await expect
    .poll(() => page.evaluate(() => (window as any).calls))
    .toEqual([
      ['add', 'u@staging', 'u@staging'],
      ['connect', 'h9'],
    ]);
  // The field closes after the host is added.
  await expect(form).toHaveCount(0);
  await expect(tools.getByRole('button', { name: 'Add SSH host', exact: true })).toBeVisible();
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
  await expect(settings(page).getByRole('list', { name: 'devbox', exact: true })).toBeVisible();
  // The sheet scrolls under its head. A row action can bleed into the padding of the sheet,
  // but nothing goes past its edge.
  expect(await overflowOf(page, '.st-sheet-body')).toEqual({
    scroll: 0,
    wide: [],
  });
});
