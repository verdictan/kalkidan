import { type Page } from '@playwright/test';
import { test, expect } from './helpers/app';
import { openCodeFolder } from './helpers/navigation';

const tree = (page: Page) => page.getByRole('navigation', { name: 'Projects and repositories' });
/** Right-clicks the repo row of the tree with this name. */
const openRepoMenu = (page: Page, name: string) =>
  page
    .locator('.tree-row[data-kind="repo"]')
    .filter({ has: page.locator('.tree-label', { hasText: new RegExp(`^${name}$`) }) })
    .locator('.tree-row-button')
    .click({ button: 'right' });

test('explorer context menus rename the clicked item and confirm non-destructive removal', async ({
  page,
}) => {
  await page.goto('/');
  await tree(page).getByRole('button', { name: 'Atlas', exact: true }).click({ button: 'right' });
  // The row menu is the shared project menu: no copies of the project views. The Color
  // swatches and Usage are in the menu. New task and New page are in ⌘K.
  await expect(page.getByRole('menuitem')).toHaveText([
    /^Open in new window/,
    /^New chat in Atlas/,
    'Add repo…',
    'Rename…',
    /^Usage/,
    'Settings…',
    'Remove project…',
  ]);
  await expect(page.getByRole('menu').getByRole('radiogroup', { name: 'Color' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  // Rename opens the "Rename project" dialog with the name field focused. Enter renames.
  const rename = page.getByRole('dialog', { name: 'Rename project', exact: true });
  const name = rename.getByRole('textbox', { name: 'Project name', exact: true });
  await expect(name).toBeFocused();
  await name.fill('Renamed project');
  await name.press('Enter');
  await expect(rename).toHaveCount(0);
  await expect(
    tree(page).getByRole('button', { name: 'Renamed project', exact: true }),
  ).toBeVisible();
  // A repo row has the code folder actions in its right-click menu.
  await openCodeFolder(page, 'design-system');
  await openRepoMenu(page, 'design-system');
  await page.getByRole('menuitem', { name: 'Edit code folder…' }).click();
  await page.getByRole('textbox', { name: 'Repository name', exact: true }).fill('Components');
  await page.getByRole('button', { name: 'Save changes' }).click();
  const components = tree(page).getByRole('button', { name: 'Components', exact: true });
  await expect(components).toBeVisible();
  await openRepoMenu(page, 'Components');
  await page.getByRole('menuitem', { name: 'Edit code folder…' }).click();
  await page.getByRole('button', { name: 'Remove code folder…', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('stay on disk');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(components).toBeVisible();
  await openRepoMenu(page, 'Components');
  await page.getByRole('menuitem', { name: 'Edit code folder…' }).click();
  await page.getByRole('button', { name: 'Remove code folder…', exact: true }).click();
  await page.getByRole('button', { name: 'Remove code folder', exact: true }).click();
  await expect(components).toHaveCount(0);
  await tree(page).getByRole('button', { name: 'Renamed project', exact: true }).click();
  const folders = page.getByRole('region', { name: 'Repos', exact: true });
  await expect(folders.getByRole('button', { name: /^atlas-web/ })).toBeVisible();
  await expect(folders.getByRole('button', { name: /^Components/ })).toHaveCount(0);
});

test('session right-click actions rename, pin and archive without opening a conversation', async ({
  page,
}) => {
  await page.goto('/');
  await openCodeFolder(page, 'atlas-web');
  // A repo shows its recent chats. Pin is in the row menu of a chat.
  await tree(page)
    .getByRole('button', { name: 'Chat: Refine project and repository navigation', exact: true })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
  await tree(page)
    .getByRole('button', { name: 'Chat: Refine project and repository navigation', exact: true })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  await page.getByRole('textbox', { name: 'Chat name', exact: true }).fill('Navigation polish');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  const session = tree(page).getByRole('button', { name: 'Chat: Navigation polish', exact: true });
  await expect(session).toBeVisible();
  await expect(page.getByRole('region', { name: 'Chat', exact: true })).toHaveCount(0);
  await session.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Unpin', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
  await expect(session).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Chat archived' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Chat', exact: true })).toHaveCount(0);
});
