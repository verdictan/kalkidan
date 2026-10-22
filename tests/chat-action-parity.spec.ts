import { type Page } from '@playwright/test';
import { test, expect, openMoreChatActions } from './helpers/app';
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
// The row menu shows the frequent actions. The other actions are in the "More" submenu.
const rowActions = [
  'open',
  '---',
  'rename',
  'pin',
  'link-task',
  '---',
  'commit',
  'create-pull-request',
  '---',
  'more',
  '---',
  'archive',
];
const moreActions = [
  'open-beside',
  'open-window',
  '---',
  'notes',
  '---',
  'duplicate',
  'show-folder',
  '---',
  'share',
  'copy-markdown',
  'usage-history',
  '---',
  'developer',
];

/** Opens the "More" submenu of the open menu and returns its actions. */
async function moreMenuActions(page: Page) {
  await openMoreChatActions(page);
  return menuActions(page);
}

/** Opens Notes of a chat from its row menu, in the "More" submenu. */
async function openNotes(page: Page) {
  await openMoreChatActions(page);
  await page.getByRole('menuitem', { name: 'Notes…', exact: true }).click();
}

test('chat rows, the sidebar and the chat header show one action list', async ({ page }) => {
  await page.goto('/');
  await openCodeFolder(page);
  const list = page.locator('.session-list');

  // The All chats row menu.
  await list.getByRole('button', { name: `${title} actions`, exact: true }).click();
  const row = await menuActions(page);
  expect(row).toEqual(rowActions);
  const more = await moreMenuActions(page);
  expect(more).toEqual(moreActions);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

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
  expect(await moreMenuActions(page)).toEqual(more);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // The chat header menu has the same actions. Open does not show, because the chat is open.
  await list.getByRole('button', { name: `Resume ${title}`, exact: true }).click();
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click();
  expect(await menuActions(page)).toEqual(row.slice(row.indexOf('open') + 2));
  expect(await moreMenuActions(page)).toEqual(more);
  await page.keyboard.press('Escape');
  // The header and the rows show the same shortcut.
  const rename = page.getByRole('menuitem', { name: 'Rename…', exact: true });
  const shortcut = await rename.getAttribute('aria-keyshortcuts');
  expect(shortcut).toMatch(/\+(R|E)$/);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Back to / }).click();
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
  await expect(list.getByText('Check the tree keys', { exact: true })).toBeVisible();
  await list.getByRole('button', { name: `Resume ${title}`, exact: true }).click();
  const note = page.getByRole('button', { name: 'Notes: Check the tree keys', exact: true });
  await expect(note).toBeVisible();
  // The header note opens the same Notes dialog.
  await note.click();
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue(
    'Check the tree keys',
  );
});
