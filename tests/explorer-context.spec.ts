import { test, expect } from '@playwright/test';
import { openCodeFolder } from './helpers/navigation';

test('explorer context menus rename the clicked item and confirm non-destructive removal', async ({
  page,
}) => {
  await page.goto('/');
  const tree = page.getByRole('navigation', { name: 'Projects and repositories' });
  await tree.getByRole('button', { name: 'Atlas', exact: true }).click({ button: 'right' });
  // The row menu has no copies of the project tabs. Removal is in Project settings.
  await expect(page.getByRole('menuitem')).toHaveText([
    'Open project',
    'Project settings…',
    'Add a code folder…',
    'Rename…',
  ]);
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  await expect(page.getByRole('textbox', { name: 'Project name', exact: true })).toBeFocused();
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Renamed project');
  await page.getByRole('button', { name: 'Save project' }).click();
  await expect(tree.getByRole('button', { name: 'Renamed project', exact: true })).toBeVisible();
  // Code folders open from the project overview. Their page has the code folder actions.
  await openCodeFolder(page, 'design-system');
  await page.getByRole('button', { name: 'Repository actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit code folder…' }).click();
  await page.getByRole('textbox', { name: 'Repository name', exact: true }).fill('Components');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: 'Components', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Repository actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit code folder…' }).click();
  await page.getByRole('button', { name: 'Remove from Kalkidan…', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('stay on disk');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Components', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Repository actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit code folder…' }).click();
  await page.getByRole('button', { name: 'Remove from Kalkidan…', exact: true }).click();
  await page.getByRole('button', { name: 'Remove from Kalkidan', exact: true }).click();
  await tree.getByRole('button', { name: 'Renamed project', exact: true }).click();
  const folders = page.getByRole('region', { name: 'Code folders' });
  await expect(folders.getByText('atlas-web', { exact: true })).toBeVisible();
  await expect(folders.getByText('Components', { exact: true })).toHaveCount(0);
});

test('session right-click actions rename, pin and archive without opening a conversation', async ({
  page,
}) => {
  await page.goto('/');
  const tree = page.getByRole('navigation', { name: 'Projects and repositories' });
  // Each project shows its recent chats. The pin button on the row pins a chat.
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
  await expect(page.getByRole('region', { name: 'Chat', exact: true })).toHaveCount(0);
  await session.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Unpin', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
  await expect(session).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Chat archived' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume Navigation polish' })).toHaveCount(0);
});
