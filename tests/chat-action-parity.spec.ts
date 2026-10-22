import { type Page } from '@playwright/test';
import { test, expect } from './helpers/app';
import { openCodeFolder } from './helpers/navigation';

/** The actions of the open menu, in order, with "---" for a separator. */
async function menuActions(page: Page) {
  const menu = page.getByRole('menu').last();
  await expect(menu).toBeVisible();
  return menu.evaluate((element) =>
    [...element.children].map((child) =>
      child.getAttribute('role') === 'separator' ? '---' : child.getAttribute('data-action'),
    ),
  );
}

const title = 'Refine project and repository navigation';
// The row menu shows its items in two levels. A click on the row opens the chat, so the menu
// has no Open. "Fork chat…" is the one way to copy a chat, so "Duplicate chat" does not show.
// The demo project has no board, so "Link task" does not show. Commit and the pull request are
// in the changes row of the chat, not here.
const rowActions = [
  'rename',
  'pin',
  'notes',
  '---',
  'fork',
  'open-beside',
  'open-in',
  '---',
  'export',
  'usage-history',
  '---',
  'archive',
];
const submenus = {
  'Open in': ['show-folder', 'open-vscode', 'open-cursor', 'open-window'],
  Export: ['export-markdown', 'export-html', 'copy-markdown', 'save-to-docs'],
};

/**
 * Opens each submenu of a chat menu and returns the actions of each one. `open` opens the menu.
 * The menu opens again for each submenu, so the open submenu of the item before cannot show.
 * The menu is closed at the end.
 */
async function submenuActions(page: Page, open: () => Promise<unknown>) {
  const result: Record<string, (string | null)[]> = {};
  for (const name of Object.keys(submenus)) {
    await open();
    await page.getByRole('menuitem', { name, exact: true }).hover();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('menu')).toHaveCount(2);
    result[name] = await menuActions(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  }
  return result;
}

/** Opens Notes of a chat from its row menu. */
async function openNotes(page: Page) {
  await page.getByRole('menuitem', { name: 'Notes…', exact: true }).click();
}

test('chat rows, the sidebar and the chat header show one action list', async ({ page }) => {
  await page.goto('/');
  await openCodeFolder(page);
  const list = page.locator('.session-list');

  // The All chats row menu.
  const rowMenu = () => list.getByRole('button', { name: `${title} actions`, exact: true }).click();
  await rowMenu();
  const row = await menuActions(page);
  expect(row).toEqual(rowActions);
  await page.keyboard.press('Escape');
  const more = await submenuActions(page, rowMenu);
  expect(more).toEqual(submenus);

  // The right-click menu of the same row.
  await list
    .getByRole('button', { name: `Resume ${title}`, exact: true })
    .click({ button: 'right' });
  expect(await menuActions(page)).toEqual(row);
  await page.keyboard.press('Escape');

  // The sidebar row menu and right-click menu of the same chat.
  const tree = page.getByRole('navigation', { name: 'Projects and repositories' });
  const treeRow = tree.getByRole('button', { name: `Chat: ${title}`, exact: true });
  await treeRow.hover();
  await tree.getByRole('button', { name: `${title} actions`, exact: true }).click();
  expect(await menuActions(page)).toEqual(row);
  await page.keyboard.press('Escape');
  await treeRow.click({ button: 'right' });
  expect(await menuActions(page)).toEqual(row);
  await page.keyboard.press('Escape');
  expect(await submenuActions(page, () => treeRow.click({ button: 'right' }))).toEqual(more);

  // The chat header menu has the same actions.
  await list.getByRole('button', { name: `Resume ${title}`, exact: true }).click();
  const headerMenu = () => page.getByRole('button', { name: 'Chat actions', exact: true }).click();
  await headerMenu();
  expect(await menuActions(page)).toEqual(row);
  await page.keyboard.press('Escape');
  expect(await submenuActions(page, headerMenu)).toEqual(more);
  await headerMenu();
  // The header and the rows show the same shortcut.
  const rename = page.getByRole('menuitem', { name: 'Rename…', exact: true });
  const shortcut = await rename.getAttribute('aria-keyshortcuts');
  expect(shortcut).toMatch(/\+(R|E)$/);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await list.getByRole('button', { name: `${title} actions`, exact: true }).click();
  await expect(rename).toHaveAttribute('aria-keyshortcuts', shortcut!);
});

test('Notes from a chat row show in the chat header', async ({ page }) => {
  await page.goto('/');
  await openCodeFolder(page);
  const list = page.locator('.session-list');
  await list.getByRole('button', { name: `${title} actions`, exact: true }).click();
  await openNotes(page);
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Check the tree keys');
  await page.getByRole('button', { name: 'Save notes', exact: true }).click();
  // The row shows the note after the chat details.
  await expect(list.getByTitle('Check the tree keys', { exact: true })).toBeVisible();
  await list.getByRole('button', { name: `Resume ${title}`, exact: true }).click();
  const note = page.getByRole('button', { name: 'Notes: Check the tree keys', exact: true });
  await expect(note).toBeVisible();
  // The header note opens the same Notes dialog.
  await note.click();
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue(
    'Check the tree keys',
  );
});
