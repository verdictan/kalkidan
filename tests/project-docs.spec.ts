import { test, expect, type Page } from '@playwright/test';

/** The save state of the open page. Toasts also use the status role, so look in the editor. */
const saveState = (page: Page) =>
  page.getByRole('region', { name: 'Document editor' }).getByRole('status');

test('project Board and Docs pages support live Markdown, subpages and persistence', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Docs', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Document pages' })).toBeVisible();
  await page.getByRole('button', { name: 'New page', exact: true }).click();
  await page.getByLabel('New page title').fill('Engineering handbook');
  await page.getByRole('button', { name: 'Create page', exact: true }).click();
  await page.getByRole('button', { name: 'Document actions' }).click();
  await page.getByRole('menuitem', { name: 'Markdown source', exact: true }).click();
  await page
    .getByLabel('Markdown content')
    .fill('# Getting started\n\nUse **Markdown** for docs.\n\n- Install\n- Run');
  if (await page.getByLabel('Markdown content').count()) {
    await page.getByRole('button', { name: 'Document actions' }).click();
    await page.getByRole('menuitem', { name: 'Rich text editor', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Getting started' })).toBeVisible();
  await expect(saveState(page)).toHaveText('Saved');
  await page.getByRole('button', { name: 'Document actions' }).click();
  await page.getByRole('menuitem', { name: 'Add subpage' }).click();
  await page.getByLabel('New page title').fill('Setup');
  await page.getByRole('button', { name: 'Create page', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Document breadcrumb' })).toContainText(
    'Engineering handbook',
  );
  await page.getByRole('button', { name: 'Document actions' }).click();
  await page.getByRole('menuitem', { name: 'Markdown source', exact: true }).click();
  await page.getByLabel('Markdown content').fill('Child documentation');
  await expect(saveState(page)).toHaveText('Saved');
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Project tracker', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Docs', exact: true }).click();
  await page.getByRole('button', { name: 'Setup', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Document content' })).toContainText(
    'Child documentation',
  );
  await page.reload();
  await page.getByRole('button', { name: 'Docs', exact: true }).click();
  await page
    .getByRole('complementary', { name: 'Document pages' })
    .getByRole('button', { name: 'Engineering handbook', exact: true })
    .click();
  if (await page.getByLabel('Markdown content').count()) {
    await page.getByRole('button', { name: 'Document actions' }).click();
    await page.getByRole('menuitem', { name: 'Rich text editor', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Getting started' })).toBeVisible();
  await page.getByLabel('Page title', { exact: true }).fill('Team handbook');
  await expect(saveState(page)).toHaveText('Saved');
  await page.getByRole('button', { name: 'Setup', exact: true }).click();
  await page.getByRole('button', { name: 'Document actions' }).click();
  await page.getByRole('menuitem', { name: 'Move page', exact: true }).click();
  await page.getByRole('combobox', { name: 'Parent page' }).click();
  await page.getByRole('option', { name: 'Top-level page', exact: true }).click();
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(saveState(page)).toHaveText('Saved');
  await page.getByRole('button', { name: 'Document actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete page', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete page', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Setup', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Team handbook', exact: true }).click();
  await page.setViewportSize({ width: 900, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/project-docs.png', fullPage: true });
});

test('rich editor formats in place, supports slash blocks, and saves Markdown', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Docs', exact: true }).click();
  await page.getByRole('button', { name: 'New page', exact: true }).click();
  await page.getByLabel('New page title').fill('Project guide');
  await page.getByRole('button', { name: 'Create page', exact: true }).click();
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
  await page.getByRole('button', { name: 'Document actions' }).click();
  await page.getByRole('menuitem', { name: 'Markdown source', exact: true }).click();
  await expect(page.getByLabel('Markdown content')).toHaveValue(
    /# Welcome[\s\S]*- \[ \] Ship the first release/,
  );
  await page.getByRole('button', { name: 'Document actions' }).click();
  await page.getByRole('menuitem', { name: 'Rich text editor', exact: true }).click();
  await page.setViewportSize({ width: 1262, height: 988 });
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/wiki-editor-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(editor).toHaveAttribute('contenteditable', 'false');
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
  await page.getByRole('button', { name: 'Docs', exact: true }).click();
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
  await page.getByRole('button', { name: 'Document actions' }).click();
  await page.getByRole('menuitem', { name: 'Markdown source', exact: true }).click();
  await expect(page.getByLabel('Markdown content')).toHaveValue(/\*\*A useful paragraph\.\*\*/);
  await expect(page.getByLabel('Markdown content')).toHaveValue(/- \[x\] Review release/);
  await expect(page.getByLabel('Markdown content')).toHaveValue(/\| Build\s*\| Team/);
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await page.getByRole('button', { name: 'Docs', exact: true }).click();
  await expect(editor.locator('strong')).toHaveText('A useful paragraph.');
  await expect(editor.locator('input[type="checkbox"]')).toBeChecked();
});

test('document context menu preserves selection and supports keyboard block editing', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Docs', exact: true }).click();
  await page.getByRole('button', { name: 'New page', exact: true }).click();
  await page.getByLabel('New page title').fill('Editing menu');
  await page.getByRole('button', { name: 'Create page', exact: true }).click();
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
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await editor.click({ button: 'right' });
  await expect(menu).toHaveCount(0);
});

test('sidebar organizes nested pages and reveals a newly created child', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Docs', exact: true }).click();
  await page.getByRole('button', { name: 'New page', exact: true }).click();
  await page.getByLabel('New page title').fill('Handbook');
  await page.getByRole('button', { name: 'Create page', exact: true }).click();
  const sidebar = page.getByRole('complementary', { name: 'Document pages' });
  await sidebar.getByRole('button', { name: 'Actions for Handbook' }).click();
  await page.getByRole('menuitem', { name: 'Add subpage', exact: true }).click();
  await page.getByLabel('New page title').fill('Setup guide');
  await page.getByRole('button', { name: 'Create page', exact: true }).click();
  await expect(sidebar.locator('.wiki-tree-children')).toContainText('Setup guide');
  await sidebar.getByRole('button', { name: 'Toggle Handbook subpages' }).click();
  await expect(sidebar.getByRole('button', { name: 'Setup guide', exact: true })).toHaveCount(0);
  await sidebar.getByRole('button', { name: 'Actions for Handbook' }).click();
  await page.getByRole('menuitem', { name: 'Add subpage', exact: true }).click();
  await page.getByLabel('New page title').fill('Contributing');
  await page.getByRole('button', { name: 'Create page', exact: true }).click();
  await expect(sidebar.getByRole('button', { name: 'Contributing', exact: true })).toBeVisible();
  await sidebar.getByRole('button', { name: 'Actions for Contributing' }).click();
  await page.getByRole('menuitem', { name: 'Move page', exact: true }).click();
  await page.getByRole('combobox', { name: 'Parent page' }).click();
  await page.getByRole('option', { name: 'Top-level page' }).click();
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(saveState(page)).toHaveText('Saved');
  await expect(sidebar.locator('.wiki-tree-children')).not.toContainText('Contributing');
  await sidebar.getByRole('button', { name: 'Actions for Contributing' }).click();
  await page.getByRole('menuitem', { name: 'Rename page', exact: true }).click();
  await expect(page.getByLabel('Page title', { exact: true })).toBeFocused();
});

test('link dialog links to another doc page, and the link opens that page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Docs', exact: true }).click();
  await page.getByRole('button', { name: 'New page', exact: true }).click();
  await page.getByLabel('New page title').fill('Release checklist');
  await page.getByRole('button', { name: 'Create page', exact: true }).click();
  await page.getByRole('button', { name: 'New page', exact: true }).click();
  await page.getByLabel('New page title').fill('Launch plan');
  await page.getByRole('button', { name: 'Create page', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Document content' });
  await editor.click();
  await editor.press('ControlOrMeta+k');
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
  const link = editor.getByRole('link', { name: 'Release checklist' });
  await expect(link).toHaveAttribute('href', /^\.\/[\w-]+\.md$/);
  await expect(saveState(page)).toHaveText('Saved');
  await link.click();
  await expect(page.getByLabel('Page title', { exact: true })).toHaveValue('Release checklist');
});
