import { test, expect } from '@playwright/test';

test('explorer context menus rename the clicked item and confirm non-destructive removal', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:5173');
  const tree = page.getByRole('navigation', { name: 'Projects and repositories' });
  await tree.getByRole('button', { name: 'Atlas', exact: true }).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Remove project from Kalkidan…' })).toBeEnabled();
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Renamed project');
  await page.getByRole('button', { name: 'Save project' }).click();
  await expect(tree.getByRole('button', { name: 'Renamed project', exact: true })).toBeVisible();
  const repo = tree.getByRole('button', { name: 'design-system', exact: true });
  await repo.focus();
  await repo.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Edit code folder…' }).click();
  await page.getByRole('textbox', { name: 'Repository name', exact: true }).fill('Components');
  await page.getByRole('button', { name: 'Save changes' }).click();
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
  const tree = page.getByRole('navigation', { name: 'Projects and repositories' });
  // Each code folder shows its recent chats. The pin button on the row pins a chat.
  await tree
    .getByRole('button', { name: 'Chat: Refine project and repository navigation', exact: true })
    .hover();
  await tree
    .getByRole('button', { name: 'Pin Refine project and repository navigation', exact: true })
    .click();
  const pinned = tree.getByRole('button', {
    name: 'Resume pinned Refine project and repository navigation',
  });
  await pinned.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  await page.getByRole('textbox', { name: 'Session name', exact: true }).fill('Navigation polish');
  await page.getByRole('button', { name: 'Save name' }).click();
  const session = tree.getByRole('button', { name: 'Resume pinned Navigation polish' });
  await expect(session).toBeVisible();
  await expect(page.getByRole('region', { name: 'Session', exact: true })).toHaveCount(0);
  await session.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Unpin', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
  await expect(session).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Chat archived' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume Navigation polish' })).toHaveCount(0);
});
