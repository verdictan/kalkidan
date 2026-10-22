import { test, expect, type Page } from '@playwright/test';

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

const settingsPage = (page: Page) => page.getByRole('region', { name: 'Settings', exact: true });

async function expectTab(page: Page, name: string) {
  const settings = settingsPage(page);
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('tab', { name, exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  // Settings is a page, not a dialog. The breadcrumb names the tab.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(
    `Settings${name}`,
  );
}

test('each entry point opens Settings as a page on the right tab', async ({ page }) => {
  await fixture(page);
  // The sidebar button.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expectTab(page, 'General');
  await expect(page.getByRole('navigation', { name: 'Projects and repositories' })).toBeVisible();
  // The focus moves to the page title.
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(page.locator('#settings-title')).toBeFocused();
  // Go back returns to the page before Settings.
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await expect(settingsPage(page)).toHaveCount(0);
  // The menu command, for example Command-comma.
  await page.evaluate(() => (window as any).menuListeners.forEach((l: any) => l('settings')));
  await expectTab(page, 'General');
  // An event from another part of the app, with an older section name.
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('kalkidan-open-settings', { detail: { section: 'remote' } }),
    ),
  );
  await expectTab(page, 'Computers');
  // The tab list changes the tab. Go back returns to the tab before.
  await settingsPage(page).getByRole('tab', { name: 'Accounts', exact: true }).click();
  await expectTab(page, 'Accounts');
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await expectTab(page, 'Computers');
  // The breadcrumb opens General.
  await page.getByRole('button', { name: 'General settings', exact: true }).click();
  await expectTab(page, 'General');
  // Search.
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByLabel('Search projects and chats').fill('Connect GitHub');
  await page
    .getByRole('option', { name: /Connect GitHub/ })
    .first()
    .click();
  await expectTab(page, 'Accounts');
  // Kalkidan does not update itself. Search has no command that checks for updates.
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByLabel('Search projects and chats').fill('Check for updates');
  await expect(page.getByRole('option', { name: /Check for updates/ })).toHaveCount(0);
});

test('a deep link opens its tab', async ({ page }) => {
  await fixture(page);
  await page.goto('/#settings=accounts');
  await expectTab(page, 'Accounts');
});

test('each tab shows its content', async ({ page }) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = settingsPage(page);
  expect(await settings.getByRole('tab').allTextContents()).toEqual([
    'General',
    'Accounts',
    'Agents',
    'Computers',
  ]);
  // General: the appearance and About with the version and the build.
  await expect(settings.getByRole('group', { name: 'Appearance' })).toBeVisible();
  const about = settings.getByRole('region', { name: 'About' });
  await expect(about.getByTestId('settings-version')).toHaveText('Version 0.1.0 · Build ccccccc');
  await expect(about.getByRole('link', { name: 'User guide' })).toBeVisible();
  await expect(about.getByRole('link', { name: 'Report an issue' })).toBeVisible();
  await page.screenshot({ path: 'test-results/settings-general.png', fullPage: true });

  // Accounts: GitHub and Verdictan.
  await settings.getByRole('tab', { name: 'Accounts', exact: true }).click();
  await expect(settings.getByRole('region', { name: 'GitHub account' })).toBeVisible();
  const verdictan = settings.getByRole('region', { name: 'Verdictan account' });
  await expect(verdictan).toContainText('Acme Corp');
  await expect(verdictan).toContainText('Session ends');
  await expect(verdictan).toContainText('https://api.eu.verdictan.com');
  await expect(verdictan.getByRole('combobox', { name: 'Account region' })).toContainText(
    'European Union',
  );
  await expect(verdictan.getByRole('button', { name: 'Renew session' })).toBeVisible();
  await expect(verdictan.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.screenshot({ path: 'test-results/settings-accounts.png', fullPage: true });

  // Agents: the default agent, the managed setup, and the agent programs.
  await settings.getByRole('tab', { name: 'Agents', exact: true }).click();
  await expect(settings.getByRole('combobox', { name: 'Default agent' })).toBeVisible();
  const managed = settings.getByRole('region', { name: 'Managed setup' });
  await expect(managed.getByRole('combobox', { name: 'Model' })).toContainText('GPT-5');
  await expect(managed).toContainText('Ready for Codex');
  await expect(managed.getByRole('button', { name: /^Save/ })).toHaveCount(0);
  await expect(managed.getByText('Before each run, the service checks')).toBeHidden();
  await managed.getByRole('button', { name: 'How managed setup works' }).click();
  await expect(managed.getByText('Before each run, the service checks')).toBeVisible();
  // Each disclosure has its own name. No two say "How this works".
  await expect(settings.getByRole('button', { name: 'How this works' })).toHaveCount(0);
  const programs = settings.getByRole('region', { name: 'Agent programs' });
  await programs.getByRole('button', { name: 'How agent programs are chosen' }).click();
  await expect(programs.getByText('Kalkidan does not start them directly.')).toBeVisible();
  await expect(settings.getByRole('region', { name: 'Agents on this computer' })).toBeVisible();
  await expect(settings.getByRole('region', { name: 'Agents on devbox' })).toBeVisible();
  await page.screenshot({ path: 'test-results/settings-agents.png', fullPage: true });

  // Computers: one card for each computer, and Add host.
  await settings.getByRole('tab', { name: 'Computers', exact: true }).click();
  const computers = settings.getByRole('list', { name: 'Computers' });
  const local = computers.getByRole('group', { name: 'This computer' });
  await expect(local.getByRole('region', { name: 'Managed agents runtime' })).toContainText(
    'Installed 0.6.4',
  );
  const devbox = computers.getByRole('group', { name: 'devbox' });
  await expect(devbox).toContainText('Connected');
  await expect(devbox.getByRole('region', { name: 'Connection' })).toContainText('Disconnect');
  await expect(devbox.getByRole('region', { name: 'Managed agents runtime' })).toContainText(
    'Installed 0.6.4',
  );
  await expect(devbox.getByRole('region', { name: 'Kalkidan helper' })).toContainText('1.4.0');
  const buildbox = computers.getByRole('group', { name: 'buildbox' });
  await expect(buildbox).toContainText('Connect the host to see and install its runtime.');
  await expect(buildbox.getByRole('button', { name: 'Check connection' })).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Add host', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/settings-computers.png', fullPage: true });
});

test('Agents › links and Computers › links move between the tabs', async ({ page }) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = settingsPage(page);
  await settings.getByRole('tab', { name: 'Computers', exact: true }).click();
  await settings
    .getByRole('group', { name: 'devbox' })
    .getByRole('button', { name: 'Agent programs' })
    .click();
  await expectTab(page, 'Agents');
  await expect(settings.getByRole('region', { name: 'Agents on devbox' })).toBeFocused();
  await settings
    .getByRole('region', { name: 'Agents on buildbox' })
    .getByRole('button', { name: 'Open in Computers' })
    .click();
  await expectTab(page, 'Computers');
  await expect(settings.getByRole('group', { name: 'buildbox' })).toBeFocused();
});

test('the older Updates section and deep link open Computers', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('kalkidan-open-settings', { detail: { section: 'updates' } }),
    ),
  );
  await expectTab(page, 'Computers');
  await expect(settingsPage(page).getByRole('tab', { name: 'Updates' })).toHaveCount(0);
  await expect(settingsPage(page).locator('#runtime-local')).toBeFocused();
  await page.goto('/#settings=updates');
  await expectTab(page, 'Computers');
});

test('a helper update shows on the host card and on the Settings button', async ({ page }) => {
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
  // The Settings button shows a dot for the helper update and opens Computers.
  const button = page.getByRole('button', { name: 'Settings', exact: true });
  await expect(button).toHaveAttribute('aria-description', 'Update available');
  await button.click();
  await expectTab(page, 'Computers');
  // A link to the update button of the host moves the focus to it.
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('kalkidan-open-settings', {
        detail: { section: 'computers', anchor: 'helper-update-h1' },
      }),
    ),
  );
  const settings = settingsPage(page);
  const devbox = settings.getByRole('group', { name: 'devbox' });
  const helper = devbox.getByRole('region', { name: 'Kalkidan helper' });
  const update = helper.getByRole('button', { name: 'Update Kalkidan helper' });
  await expect(update).toBeFocused();
  await expect(helper).toContainText('Update available');
  // One copy of the button. The manual setup details do not show a second one.
  await expect(devbox.getByRole('button', { name: 'Update Kalkidan helper' })).toHaveCount(1);
  await update.click();
  const confirm = page.getByRole('dialog', { name: 'Update the Kalkidan helper on devbox?' });
  await expect(confirm).toContainText('The update stops all active work on this host.');
  await confirm.getByRole('button', { name: 'Update Kalkidan helper' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).installs)).toEqual(['h1']);
  // A host without an update shows the button as a secondary action, without the badge.
  await expect(
    settings
      .getByRole('group', { name: 'buildbox' })
      .getByRole('region', { name: 'Kalkidan helper' }),
  ).not.toContainText('Update available');
});

test('a refusal link opens Agents with the program of that computer focused', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('kalkidan-open-settings', {
        detail: { section: 'agents', anchor: 'agent-program-h1-claude' },
      }),
    ),
  );
  await expectTab(page, 'Agents');
  await expect(
    settingsPage(page).getByRole('listitem', { name: 'Claude Code on devbox' }),
  ).toBeFocused();
  // The older managed setup steps open their new tabs.
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('kalkidan-open-settings', {
        detail: { section: 'managed-agents', anchor: 'verdictan-account' },
      }),
    ),
  );
  await expectTab(page, 'Accounts');
  await expect(settingsPage(page).locator('#verdictan-account')).toBeFocused();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('kalkidan-open-settings', {
        detail: { section: 'managed-agents', anchor: 'verdictan-runtime' },
      }),
    ),
  );
  await expectTab(page, 'Computers');
  await expect(settingsPage(page).locator('#runtime-local')).toBeFocused();
});

test('a managed setup choice saves at once and Undo restores the choice before', async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('kalkidan-open-settings', { detail: { section: 'managed-agents' } }),
    ),
  );
  const managed = settingsPage(page).getByRole('region', { name: 'Managed setup' });
  await expect(managed).toBeFocused();
  await managed.getByRole('combobox', { name: 'Model' }).click();
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
  await expect(managed.getByRole('combobox', { name: 'Model' })).toContainText('GPT-5');
  await expect(managed.getByRole('combobox', { name: 'Model' })).not.toContainText('mini');
});

test('About marks a development build', async ({ page }) => {
  await fixture(
    page,
    `return {
      appVersion: async () => ({ version: '0.1.0', build: 'c'.repeat(64), packaged: false }),
    };`,
  );
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const about = settingsPage(page).getByRole('region', { name: 'About' });
  await expect(about.getByTestId('settings-version')).toHaveText(
    'Version 0.1.0 · Build ccccccc · Development build',
  );
  // Kalkidan does not update itself. Settings has no update action.
  await expect(settingsPage(page).getByRole('button', { name: /update/i })).toHaveCount(0);
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
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('kalkidan-open-settings', { detail: { section: 'computers' } }),
    ),
  );
  const settings = settingsPage(page);
  await settings.getByRole('button', { name: 'Add host', exact: true }).click();
  const form = settings.getByRole('form', { name: 'Add host' });
  await form.getByLabel('Host name').fill('staging');
  await form.getByLabel('SSH target').fill('u@staging');
  await form.getByRole('button', { name: 'Save host' }).click();
  const card = settings.getByRole('group', { name: 'staging' });
  // The helper is missing after the check. The user agrees to install it.
  await expect(
    card.getByRole('button', { name: 'Install the Kalkidan helper and connect' }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).calls)).toEqual([
    ['add', 'staging', 'u@staging'],
    ['check', 'h9'],
  ]);
});

test('no Settings tab overflows horizontally in a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 760 });
  await fixture(page);
  // Below 1100px wide, the sidebar starts closed. Open it to make the page narrow.
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = settingsPage(page);
  for (const name of ['General', 'Accounts', 'Agents', 'Computers']) {
    await settings.getByRole('tab', { name, exact: true }).click();
    await expect(settings.getByRole('tab', { name, exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // Let the tab read its data.
    await page.waitForTimeout(300);
    const overflow = await page.locator('.management-pane').evaluate((pane) => {
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
    expect(overflow, name).toEqual({ scroll: 0, wide: [] });
  }
});
