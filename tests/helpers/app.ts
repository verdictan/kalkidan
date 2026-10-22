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

/** The Preferences sheet (⌘,). It replaced the Settings dialog. */
export const settingsDialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Preferences', exact: true });
export const preferencesDialog = settingsDialog;

/** The Computers page: this computer, the agents and the SSH hosts. */
export const computersPage = (page: Page) =>
  page.getByRole('region', { name: 'Computers', exact: true });

/** Opens an item of the account menu in the sidebar footer, as a user does. */
export async function openAccountMenuItem(page: Page, name: string | RegExp) {
  const footer = sidebar(page).locator('.account-menu');
  // The footer shows "Preferences and help" until the account status loads, then the account
  // button. Try again when the button changes during the click.
  const trigger = footer.getByRole('button', { name: /^(Account: .*|Preferences and help)$/ });
  const item = page.getByRole('menuitem', { name });
  await expect(async () => {
    if (!(await item.isVisible())) await trigger.first().click({ timeout: 2000 });
    await item.click({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
}

/** Opens Preferences from the account menu and returns the sheet. */
export async function openPreferences(page: Page): Promise<Locator> {
  await openAccountMenuItem(page, /^Preferences…/);
  const dialog = settingsDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Opens the Computers page from the sidebar and returns it. */
export async function openComputersPage(page: Page): Promise<Locator> {
  await sidebar(page).getByRole('button', { name: 'Computers', exact: true }).click();
  const region = computersPage(page);
  await expect(region).toBeVisible();
  return region;
}

/**
 * Opens the place that now holds an older Settings section: 'Agents' and 'Computers' open the
 * Computers page, every other section opens Preferences.
 */
export async function openSettings(page: Page, section?: string): Promise<Locator> {
  if (section === 'Agents' || section === 'Computers') return openComputersPage(page);
  return openPreferences(page);
}

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
