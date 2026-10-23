import { type Page } from '@playwright/test';
import { test, expect, settingsDialog, sidebar } from './helpers/app';

const settings = (page: Page) => settingsDialog(page);
/** The part of one project in Settings. Its title is the project name. */
const project = (page: Page, name: string) =>
  settings(page).getByRole('region', { name, exact: true });
/** The row of a project in the sidebar tree. */
const treeRow = (page: Page, name: string) =>
  sidebar(page).getByRole('button', { name, exact: true });

/** Opens the project part of Settings from the right-click menu of the project in the tree. */
async function openFromTree(page: Page, name: string) {
  await treeRow(page, name).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Settings…', exact: true }).click();
  await expect(project(page, name)).toBeVisible();
}

test('the project part of Settings has the name, color, repos, board and Remove', async ({
  page,
}) => {
  await page.goto('/');
  await openFromTree(page, 'Atlas');
  const atlas = project(page, 'Atlas');

  // The color: 8 swatches and Automatic. A swatch saves at once. Automatic goes back to the
  // color that Kalkidan chose: Automatic is checked, and the automatic swatch shows as current
  // without a check.
  const colors = atlas.getByRole('radiogroup', { name: 'Color of Atlas' });
  await expect(colors.getByRole('radio')).toHaveCount(9);
  const automatic = colors.getByRole('radio', { name: 'Automatic', exact: true });
  // The demo gives Atlas a chosen color.
  await expect(colors.getByRole('radio', { name: 'Indigo' })).toBeChecked();
  await expect(automatic).not.toBeChecked();
  await automatic.click();
  await expect(automatic).toBeChecked();
  await expect(colors.locator('[data-current]')).toHaveCount(1);
  await expect(colors.locator('[data-current]')).not.toBeChecked();
  await colors.getByRole('radio', { name: 'Teal' }).click();
  await expect(colors.getByRole('radio', { name: 'Teal' })).toBeChecked();
  await expect(automatic).not.toBeChecked();
  await expect(colors.locator('[data-current]')).toHaveCount(0);
  await atlas.getByRole('button', { name: 'Actions for Atlas' }).click();
  await page.getByRole('menuitem', { name: 'Automatic color', exact: true }).click();
  await expect(colors.getByRole('radio', { name: 'Teal' })).not.toBeChecked();
  await expect(automatic).toBeChecked();
  await colors.getByRole('radio', { name: 'Teal' }).click();
  await automatic.click();
  await expect(automatic).toBeChecked();

  // Rename… asks for the new name. The title and the tree follow it.
  await atlas.getByRole('button', { name: 'Actions for Atlas' }).click();
  await page.getByRole('menuitem', { name: 'Rename…', exact: true }).click();
  const rename = page.getByRole('dialog', { name: 'Rename project' });
  await rename.getByRole('textbox', { name: 'Project name' }).fill('Atlas web');
  await rename.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(rename).toHaveCount(0);
  const web = project(page, 'Atlas web');
  await expect(web).toBeVisible();
  await expect(treeRow(page, 'Atlas web')).toBeVisible();

  // Repos: one chip for each repo, "+" Add repo…, and × removes a repo with a confirmation.
  const repos = web.getByRole('list', { name: 'Repos of Atlas web' });
  await expect(repos.getByRole('listitem')).toHaveCount(4);
  await expect(repos.getByRole('button', { name: 'Add repo…', exact: true })).toBeVisible();
  // The × shows when the pointer is on the chip.
  await repos.getByRole('listitem').filter({ hasText: 'api-service' }).hover();
  await repos.getByRole('button', { name: 'Remove api-service from Atlas web…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Remove api-service from Atlas web?' });
  await expect(confirm).toContainText('stay on disk');
  await confirm.getByRole('button', { name: 'Remove repo', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(settings(page)).toBeVisible();
  await expect(repos.getByRole('listitem')).toHaveCount(3);

  // Board: no board is connected, so the board chip says "Connect board". It opens the board
  // settings in place.
  const board = web.getByRole('button', { name: 'Connect board', exact: true });
  await expect(board).toHaveAttribute('aria-expanded', 'false');
  await board.click();
  await expect(board).toHaveAttribute('aria-expanded', 'true');
  await expect(web.locator('.st-board')).toBeVisible();

  // Remove project… is in the ⋯ menu, with its confirmation. There is no Danger zone.
  await expect(web).not.toContainText('Danger zone');
  await web.getByRole('button', { name: 'Actions for Atlas web' }).click();
  await page.getByRole('menuitem', { name: 'Remove project…', exact: true }).click();
  const remove = page.getByRole('dialog', { name: 'Remove Atlas web?', exact: true });
  await expect(remove).toContainText('All files stay on disk.');
  await remove.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(remove).toHaveCount(0);
  await expect(treeRow(page, 'Atlas web')).toBeVisible();
  await web.getByRole('button', { name: 'Actions for Atlas web' }).click();
  await page.getByRole('menuitem', { name: 'Remove project…', exact: true }).click();
  await remove.getByRole('button', { name: 'Remove project', exact: true }).click();
  await expect(treeRow(page, 'Atlas web')).toHaveCount(0);
  // The part of a removed project goes away.
  await expect(project(page, 'Atlas web')).toHaveCount(0);
});
