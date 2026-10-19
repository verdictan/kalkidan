import { test, expect } from '@playwright/test';

test('explorer context menus rename the clicked item and confirm non-destructive removal', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:5173');
  const tree = page.getByRole('region', { name: 'Projects and repositories' });
  await tree.getByRole('button', { name: 'Atlas', exact: true }).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Remove empty project…' })).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Renamed project');
  await page.getByRole('button', { name: 'Save project' }).click();
  await expect(tree.getByRole('button', { name: 'Renamed project', exact: true })).toBeVisible();
  const repo = tree.getByRole('button', { name: 'design-system', exact: true });
  await repo.focus();
  await repo.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Components');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(tree.getByRole('button', { name: 'Components', exact: true })).toBeVisible();
  await expect(tree.getByRole('button', { name: 'atlas-web', exact: true })).toBeVisible();
  await tree.getByRole('button', { name: 'Components', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Remove from Kalkidan…' }).click();
  await expect(page.getByRole('dialog')).toContainText('stay on disk');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(tree.getByRole('button', { name: 'Components', exact: true })).toBeVisible();
  await tree.getByRole('button', { name: 'Components', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Remove from Kalkidan…' }).click();
  await page.getByRole('button', { name: 'Remove from Kalkidan', exact: true }).click();
  await expect(tree.getByRole('button', { name: 'Components', exact: true })).toHaveCount(0);
});

test('session right-click actions rename, pin and archive without opening a conversation', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:5173');
  const tree = page.getByRole('region', { name: 'Projects and repositories' });
  await tree.getByRole('button', { name: 'Expand atlas-web sessions' }).click();
  await tree
    .getByRole('button', { name: 'Refine project and repository navigation', exact: true })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Navigation polish');
  await page.getByRole('button', { name: 'Save name' }).click();
  const session = tree.getByRole('button', { name: 'Navigation polish', exact: true });
  await session.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
  await expect(tree.getByRole('button', { name: 'Resume pinned Navigation polish' })).toBeVisible();
  await session.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Archive…' }).click();
  await page.getByRole('button', { name: 'Archive session', exact: true }).click();
  await expect(session).toHaveCount(0);
  await expect(tree.getByRole('button', { name: 'Resume pinned Navigation polish' })).toHaveCount(
    0,
  );
});
