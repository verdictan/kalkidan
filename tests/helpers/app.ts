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

/** The Settings dialog. */
export const settingsDialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Settings', exact: true });

/** A section tab of the Settings dialog: General, Account, Agents, Computers or About. */
export const settingsTab = (page: Page, name: string) =>
  settingsDialog(page)
    .getByRole('tablist', { name: 'Settings sections' })
    .getByRole('tab', { name, exact: true });

/**
 * Opens Settings from the account menu in the sidebar footer, as a user does. With `section`,
 * it then selects that section. Returns the dialog.
 */
export async function openSettings(page: Page, section?: string): Promise<Locator> {
  const footer = sidebar(page).locator('.account-menu');
  // The footer shows "Settings and help" until the account status loads, then the account
  // button. Both menus have Settings. Try again when the button changes during the click.
  const trigger = footer.getByRole('button', { name: /^(Account: .*|Settings and help)$/ });
  const item = page.getByRole('menuitem', { name: /^Settings/ });
  await expect(async () => {
    if (!(await item.isVisible())) await trigger.first().click({ timeout: 2000 });
    await item.click({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  const dialog = settingsDialog(page);
  await expect(dialog).toBeVisible();
  if (section) {
    await settingsTab(page, section).click();
    await expect(settingsTab(page, section)).toHaveAttribute('aria-selected', 'true');
  }
  return dialog;
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

/**
 * Opens the setup sheet of a managed agent from its row in Settings › Agents ("Fix…" or
 * "Change…"). Returns the sheet, for example the dialog "Codex setup".
 */
export async function openAgentSetup(page: Page, agent: 'Codex' | 'Claude Code' = 'Codex') {
  const settings = await openSettings(page, 'Agents');
  await settings
    .getByRole('group', { name: agent, exact: true })
    .getByRole('button', { name: new RegExp(`^(Fix|Change) ${agent}$`) })
    .click();
  const sheet = page.getByRole('dialog', { name: `${agent} setup`, exact: true });
  await expect(sheet).toBeVisible();
  return sheet;
}
