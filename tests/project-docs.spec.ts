import { type Page } from '@playwright/test';
import { test, expect } from './helpers/app';
import { openProjectTab } from './helpers/navigation';

/** The save state of the open page. Toasts also use the status role, so look in the editor. */
const saveState = (page: Page) =>
  page.getByRole('region', { name: 'Document editor' }).getByRole('status');

/** Names a page that New page or Add subpage just made. Its title shows "Untitled", selected. */
async function nameNewPage(page: Page, title: string) {
  const input = page.getByLabel('Page title', { exact: true });
  await expect(input).toHaveValue('Untitled');
  await expect(input).toBeFocused();
  await input.fill(title);
  // Enter moves to the text of the page.
  await input.press('Enter');
}

/** Makes a top-level page: New page in the page list, or the first page of an empty project. */
async function newPage(page: Page, title: string) {
  await page
    .getByRole('button', { name: /^(New page|Create your first page)$/ })
    .first()
    .click();
  await nameNewPage(page, title);
}

/** Shows or hides the Markdown source of the open page from the page actions. */
async function markdownSource(page: Page, show: boolean) {
  await page.getByRole('button', { name: 'Page actions', exact: true }).click();
  await page
    .getByRole('menuitem', { name: show ? 'View Markdown' : 'Hide Markdown', exact: true })
    .click();
  await expect(page.getByLabel('Markdown content')).toHaveCount(show ? 1 : 0);
}

/** The page list in the Knowledge rail. */
const pageList = (page: Page) =>
  page
    .getByRole('complementary', { name: 'Knowledge sections' })
    .getByRole('navigation', { name: 'Document structure' });

/** Opens the right-click menu of a page row in the rail and selects an item. */
async function rowMenu(page: Page, title: string, item: string) {
  await pageList(page).getByRole('button', { name: title, exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

test('project Board and Docs pages support live Markdown, subpages and persistence', async ({
  page,
}) => {
  await page.goto('/');
  await openProjectTab(page, 'Docs');
  // A project without pages shows no page list, only the first-page action.
  await expect(page.getByRole('heading', { name: 'No pages yet' })).toBeVisible();
  await expect(pageList(page)).toHaveCount(0);
  await newPage(page, 'Engineering handbook');
  await expect(pageList(page)).toBeVisible();
  await markdownSource(page, true);
  await page
    .getByLabel('Markdown content')
    .fill('# Getting started\n\nUse **Markdown** for docs.\n\n- Install\n- Run');
  await markdownSource(page, false);
  await expect(page.getByRole('heading', { name: 'Getting started' })).toBeVisible();
  await expect(saveState(page)).toHaveText('Saved');
  await page.getByRole('button', { name: 'Page actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add subpage' }).click();
  await nameNewPage(page, 'Setup');
  await expect(page.getByRole('navigation', { name: 'Document breadcrumb' })).toContainText(
    'Engineering handbook',
  );
  await markdownSource(page, true);
  await page.getByLabel('Markdown content').fill('Child documentation');
  await expect(saveState(page)).toHaveText('Saved');
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  const tabs = page.getByRole('navigation', { name: 'Project page' });
  await expect(tabs.getByRole('button', { name: 'Overview', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await tabs.getByRole('button', { name: 'Knowledge', exact: true }).click();
  await pageList(page).getByRole('button', { name: 'Setup', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Document content' })).toContainText(
    'Child documentation',
  );
  await page.reload();
  await openProjectTab(page, 'Docs');
  await pageList(page).getByRole('button', { name: 'Engineering handbook', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Getting started' })).toBeVisible();
  await page.getByLabel('Page title', { exact: true }).fill('Team handbook');
  await expect(saveState(page)).toHaveText('Saved');
  await pageList(page).getByRole('button', { name: 'Setup', exact: true }).click();
  await page.getByRole('button', { name: 'Page actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Move page…', exact: true }).click();
  await page.getByRole('combobox', { name: 'Parent page' }).click();
  await page.getByRole('option', { name: 'Top-level page', exact: true }).click();
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(saveState(page)).toHaveText('Saved');
  // The page is top-level now, so the page has no breadcrumb.
  await expect(page.getByRole('navigation', { name: 'Document breadcrumb' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Page actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete page', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete page', exact: true }).click();
  await expect(pageList(page).getByRole('button', { name: 'Setup', exact: true })).toHaveCount(0);
  await pageList(page).getByRole('button', { name: 'Team handbook', exact: true }).click();
  await page.setViewportSize({ width: 900, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/project-docs.png', fullPage: true });
});

test('rich editor formats in place, supports slash blocks, and saves Markdown', async ({
  page,
}) => {
  await page.goto('/');
  await openProjectTab(page, 'Docs');
  await newPage(page, 'Project guide');
  const editor = page.getByRole('textbox', { name: 'Document content' });
  await editor.click();
  await editor.pressSequentially('# Welcome');
  await editor.press('Enter');
  await expect(editor.locator('h1')).toHaveText('Welcome');
  await editor.pressSequentially('A focused place to write.');
  await editor.press('Enter');
  await editor.pressSequentially('/check');
  await expect(page.getByRole('listbox', { name: 'Insert block' })).toBeVisible();
  await editor.press('Enter');
  await editor.pressSequentially('Ship the first release');
  await expect(editor.locator('input[type="checkbox"]')).toHaveCount(1);
  // The list shortcut in a list item does not put a second list in the item.
  await editor.press('Enter');
  await editor.press('Enter');
  await editor.pressSequentially('- First step');
  await editor.press('Enter');
  await editor.pressSequentially('- Second step');
  await expect(editor.locator('li ul')).toHaveCount(0);
  await expect(editor.locator('ul:not([data-type="taskList"]) > li')).toHaveCount(2);
  // The marker is not kept as text, so the list does not load again as a nested list.
  await expect(editor.locator('ul:not([data-type="taskList"]) > li').nth(1)).toHaveText(
    'Second step',
  );
  await expect(saveState(page)).toHaveText('Saved');
  await markdownSource(page, true);
  await expect(page.getByLabel('Markdown content')).toHaveValue(
    /# Welcome[\s\S]*- \[ \] Ship the first release/,
  );
  await markdownSource(page, false);
  // There is one live editor. Hide Markdown goes back to it.
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await page.setViewportSize({ width: 1262, height: 988 });
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/wiki-editor-desktop.png', fullPage: true });
});

test('rich editor preserves tables, links, code, and formatting through save and reload', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'kalkidan-demo-docs',
      JSON.stringify({
        atlas: [
          {
            id: 'roundtrip',
            title: 'Release guide',
            parentId: null,
            revision: '1',
            markdown:
              '# Release plan\n\n## Before shipping\n\nA useful paragraph.\n\n[Documentation](https://example.com)\n\n| Step | Owner |\n| --- | --- |\n| Build | Team |\n\n```js\nconst ready = true;\n```\n\n- [ ] Review release',
          },
        ],
      }),
    ),
  );
  await page.goto('/');
  await openProjectTab(page, 'Docs');
  const editor = page.getByRole('textbox', { name: 'Document content' });
  await expect(editor.locator('table')).toContainText('Build');
  await expect(editor.locator('pre')).toContainText('const ready = true');
  await expect(editor.getByRole('link', { name: 'Documentation' })).toHaveAttribute(
    'href',
    'https://example.com',
  );
  await editor.locator('p').filter({ hasText: 'A useful paragraph.' }).click();
  await editor
    .locator('p')
    .filter({ hasText: 'A useful paragraph.' })
    .evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(editor.locator('strong')).toHaveText('A useful paragraph.');
  await editor.locator('input[type="checkbox"]').check();
  await expect(saveState(page)).toHaveText('Saved');
  await markdownSource(page, true);
  await expect(page.getByLabel('Markdown content')).toHaveValue(/\*\*A useful paragraph\.\*\*/);
  await expect(page.getByLabel('Markdown content')).toHaveValue(/- \[x\] Review release/);
  await expect(page.getByLabel('Markdown content')).toHaveValue(/\| Build\s*\| Team/);
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Project page' })
    .getByRole('button', { name: 'Knowledge', exact: true })
    .click();
  await expect(editor.locator('strong')).toHaveText('A useful paragraph.');
  await expect(editor.locator('input[type="checkbox"]')).toBeChecked();
});

test('document context menu preserves selection and supports keyboard block editing', async ({
  page,
}) => {
  await page.goto('/');
  await openProjectTab(page, 'Docs');
  await newPage(page, 'Editing menu');
  const editor = page.getByRole('textbox', { name: 'Document content' });
  await editor.fill('Selected words');
  await editor.press('ControlOrMeta+a');
  await editor.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Document editing' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitemcheckbox', { name: 'Bold', exact: true }).click();
  await expect(editor.locator('strong')).toHaveText('Selected words');
  await editor.press('Shift+F10');
  await menu.getByRole('menuitem', { name: 'Undo', exact: true }).click();
  await expect(editor.locator('strong')).toHaveCount(0);
  await editor.press('Shift+F10');
  await menu.getByRole('menuitem', { name: 'Redo', exact: true }).click();
  await expect(editor.locator('strong')).toHaveText('Selected words');
  await editor.press('Shift+F10');
  await menu.getByRole('menuitem', { name: 'Blocks', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'Heading 2', exact: true }).click();
  await expect(editor.locator('h2')).toHaveText('Selected words');
  await expect(saveState(page)).toHaveText('Saved');
  await expect(
    page.locator('.wiki-page-icon, .wiki-page-meta, .wiki-collection, .wiki-library-search'),
  ).toHaveCount(0);
  await page.screenshot({ path: 'test-results/wiki-context-menu-layout.png', fullPage: true });
});

test('sidebar organizes nested pages and reveals a newly created child', async ({ page }) => {
  await page.goto('/');
  await openProjectTab(page, 'Docs');
  await newPage(page, 'Handbook');
  const sidebar = pageList(page);
  await rowMenu(page, 'Handbook', 'Add subpage');
  await nameNewPage(page, 'Setup guide');
  await expect(sidebar.locator('.wiki-tree-children')).toContainText('Setup guide');
  await sidebar.getByRole('button', { name: 'Toggle Handbook subpages' }).click();
  await expect(sidebar.getByRole('button', { name: 'Setup guide', exact: true })).toHaveCount(0);
  await rowMenu(page, 'Handbook', 'Add subpage');
  await nameNewPage(page, 'Contributing');
  await expect(sidebar.getByRole('button', { name: 'Contributing', exact: true })).toBeVisible();
  await rowMenu(page, 'Contributing', 'Move page…');
  await page.getByRole('combobox', { name: 'Parent page' }).click();
  await page.getByRole('option', { name: 'Top-level page' }).click();
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(saveState(page)).toHaveText('Saved');
  await expect(sidebar.locator('.wiki-tree-children')).not.toContainText('Contributing');
  // A page is renamed in its title. The page list shows the new title.
  await page.getByLabel('Page title', { exact: true }).fill('Contributing guide');
  await expect(
    sidebar.getByRole('button', { name: 'Contributing guide', exact: true }),
  ).toBeVisible();
});

test('link dialog links to another doc page, and the link opens that page', async ({ page }) => {
  await page.goto('/');
  await openProjectTab(page, 'Docs');
  await newPage(page, 'Release checklist');
  await newPage(page, 'Launch plan');
  const editor = page.getByRole('textbox', { name: 'Document content' });
  await editor.click();
  await editor.pressSequentially('See the checklist');
  await editor.press('ControlOrMeta+a');
  // Mod+K always opens the app search, also with selected text.
  await editor.press('ControlOrMeta+k');
  const search = page.getByRole('dialog', { name: 'Search or run a command' });
  await expect(search).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Add link', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(search).toHaveCount(0);
  // With selected text, Mod+L adds a link.
  await editor.click();
  await editor.press('ControlOrMeta+a');
  await editor.press('ControlOrMeta+l');
  await expect(page.getByRole('dialog', { name: 'Add link', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Link a page…' }).click();
  const picker = page.getByRole('dialog', { name: 'Link a page' });
  await expect(page.getByRole('dialog', { name: 'Add link', exact: true })).toHaveCount(0);
  await expect(picker.getByLabel('Search doc pages')).toBeFocused();
  await picker.getByLabel('Search doc pages').fill('release');
  await expect(
    picker.getByRole('option', { name: 'Release checklist', exact: true }),
  ).toBeVisible();
  await picker.getByLabel('Search doc pages').press('Enter');
  await expect(picker).toHaveCount(0);
  const link = editor.getByRole('link').first();
  await expect(link).toHaveAttribute('href', /^\.\/[\w-]+\.md$/);
  await expect(saveState(page)).toHaveText('Saved');
  await link.click();
  await expect(page.getByLabel('Page title', { exact: true })).toHaveValue('Release checklist');
});
