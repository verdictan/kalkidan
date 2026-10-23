import { test as base, expect, type Locator, type Page } from '@playwright/test';

/**
 * The browser demo keeps its account and first-run state in these localStorage keys
 * (src/demo.ts). A fresh demo is a first run: no region, no account.
 */
export const demoKeys = {
  account: 'kalkidan-demo-account',
  firstRun: 'kalkidan-demo-first-run',
  runtime: 'kalkidan-demo-runtime',
} as const;

/**
 * Makes the demo a returning, signed-in user (Dana Kim, EU region) before the page loads. A
 * key that the page already wrote stays, so a sign-out or a region change in a test survives
 * a reload. Specs that test the first run do not call it.
 */
export async function seedReturningUser(page: Page) {
  await page.addInitScript((keys) => {
    const seed: Record<string, unknown> = {
      [keys.account]: { region: 'eu', signedIn: true },
      [keys.firstRun]: { welcomeDone: true, everSignedIn: true },
      [keys.runtime]: { at: 1 },
    };
    try {
      for (const [key, value] of Object.entries(seed))
        if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // A page without storage starts as a first run.
    }
  }, demoKeys);
}

/** The Playwright `test` with a page that opens as a returning, signed-in demo user. */
export const test = base.extend({
  page: async ({ page }, run) => {
    await seedReturningUser(page);
    await run(page);
  },
});
export { expect };

/** The sidebar of the workspace. */
export const sidebar = (page: Page) =>
  page.getByRole('navigation', { name: 'Projects and repositories' });

/** The one Settings page (⌘,): account, Tools, preferences and the current project. */
export const settingsDialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Settings', exact: true });
/** @deprecated Preferences is a part of the Settings page now. */
export const preferencesDialog = settingsDialog;

/** The heading of a part of the Settings page. Old section names map to the new parts. */
const settingsParts: Record<string, string> = {
  General: 'Preferences',
  Preferences: 'Preferences',
  Computers: 'Tools',
  Agents: 'Tools',
  Tools: 'Tools',
};
export const settingsSection = (page: Page, name: string) =>
  settingsDialog(page).getByRole('heading', { name: settingsParts[name] || name });

/** The Tools part of Settings: the detected agent CLIs, the GitHub CLI and the SSH hosts. */
export const computersPage = settingsDialog;

/** Opens an item of the account menu in the sidebar footer (signed in only). */
export async function openAccountMenuItem(page: Page, name: string | RegExp) {
  const trigger = sidebar(page).getByRole('button', { name: /^Account: / });
  const item = page.getByRole('menuitem', { name });
  await expect(async () => {
    if (!(await item.isVisible())) await trigger.first().click({ timeout: 2000 });
    await item.click({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
}

/**
 * Opens the Settings page, at a part, and returns it. Signed in, it uses "Settings…" in the
 * account menu of the sidebar footer; signed out, it uses ⌘, (Ctrl+, on other systems).
 */
export async function openSettingsWindow(page: Page, section?: string): Promise<Locator> {
  const settings = settingsDialog(page);
  // Settings is a sheet over the window. While it is open, the sidebar is behind it.
  if (!(await settings.isVisible())) {
    const account = sidebar(page).getByRole('button', { name: /^Account: / });
    if (await account.isVisible()) await openAccountMenuItem(page, /^Settings…/);
    else
      // A dialog that is still closing takes no shortcut. Press again until Settings shows.
      await expect(async () => {
        if (!(await settings.isVisible())) await page.keyboard.press('ControlOrMeta+Comma');
        await expect(settings).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 10000 });
  }
  await expect(settings).toBeVisible();
  if (section && section !== 'Account')
    await settingsSection(page, section).scrollIntoViewIfNeeded();
  return settings;
}

/** @deprecated Preferences is a part of the Settings page. */
export const openPreferences = (page: Page) => openSettingsWindow(page, 'Preferences');

/** Opens Settings at Tools (the Computers page is the Tools part of Settings now). */
export const openComputersPage = (page: Page) => openSettingsWindow(page, 'Tools');

/** Opens the Settings page at the part that now holds an older place. */
export const openSettings = (page: Page, section?: string): Promise<Locator> =>
  openSettingsWindow(page, section);

/** The command palette dialog. */
export const palette = (page: Page) =>
  page.getByRole('dialog', { name: 'Search or run a command', exact: true });

/** Opens the command palette from the sidebar trigger and returns its field. */
export async function openPalette(page: Page) {
  await page.getByRole('button', { name: 'Search or run a command', exact: true }).click();
  const input = palette(page).getByRole('combobox', { name: 'Search or run a command' });
  await expect(input).toBeFocused();
  return input;
}

const agentNames = { codex: 'Codex', claude: 'Claude Code' } as const;

/**
 * Starts a new chat with an agent in the code folder of the page, from the command palette
 * ("New Codex chat", "New Claude Code chat"). The palette action also makes the agent the
 * preferred agent, as the "New chat" menus do.
 */
export async function newChat(page: Page, agent: keyof typeof agentNames = 'codex') {
  const input = await openPalette(page);
  const label = `New ${agentNames[agent]} chat`;
  await input.fill(label);
  await palette(page).getByRole('option', { name: label, exact: true }).click();
  await expect(palette(page)).toHaveCount(0);
}

/**
 * Opens the "More" submenu of the open chat menu (chat row menu or Chat actions). The menus
 * show the frequent actions at the top level and the other actions in "More".
 */
export async function openMoreChatActions(page: Page) {
  await page.getByRole('menuitem', { name: 'More', exact: true }).hover();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menu')).toHaveCount(2);
}
