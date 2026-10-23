import { type Page } from '@playwright/test';
import { test, expect } from './helpers/app';
import { openCodeFolder, openTreeChat } from './helpers/navigation';

/** Goes back or forward in the history with ⌘[ and ⌘]. A text field keeps these keys. */
async function go(page: Page, direction: 'back' | 'forward') {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(direction === 'back' ? 'ControlOrMeta+[' : 'ControlOrMeta+]');
}

test('history keys traverse projects, boards and chats, and preserve drafts', async ({ page }) => {
  await page.goto('/');
  // The 48px header has no Back and Forward buttons: ⌘[ and ⌘] (and the Go menu) move in the
  // history.
  await expect(page.getByRole('button', { name: 'Go back', exact: true })).toHaveCount(0);
  const projects = page.getByRole('region', { name: 'Projects', exact: true });
  const overview = page
    .getByRole('main')
    .getByRole('textbox', { name: 'Message for a new chat', exact: true });
  const tracker = page.getByRole('region', { name: 'Project tracker', exact: true });
  const draft = page.getByLabel('Message agent');
  await expect(projects).toBeVisible();
  // At the start of the history, Back does nothing.
  await go(page, 'back');
  await expect(projects).toBeVisible();
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await expect(overview).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Project page' })
    .getByRole('button', { name: 'Tasks', exact: true })
    .click();
  await expect(tracker).toBeVisible();
  // openCodeFolder opens the Overview of the project, then shows the repo in the tree.
  await openCodeFolder(page);
  await openTreeChat(page, 'Refine project and repository navigation');
  await draft.fill('Keep this draft while navigating');
  await go(page, 'back');
  await expect(overview).toBeVisible();
  await go(page, 'back');
  await expect(tracker).toBeVisible();
  await go(page, 'back');
  await expect(overview).toBeVisible();
  await go(page, 'back');
  await expect(projects).toBeVisible();
  for (let step = 0; step < 4; step++) await go(page, 'forward');
  await expect(draft).toHaveValue('Keep this draft while navigating');
  // At the end of the history, Forward does nothing.
  await go(page, 'forward');
  await expect(draft).toHaveValue('Keep this draft while navigating');
  await go(page, 'back');
  await expect(overview).toBeVisible();
  // A new page after Back drops the forward entries.
  await page
    .getByRole('navigation', { name: 'Project page' })
    .getByRole('button', { name: 'Knowledge', exact: true })
    .click();
  await go(page, 'forward');
  await expect(
    page.getByRole('navigation', { name: 'Project page' }).getByRole('button', {
      name: 'Knowledge',
      exact: true,
    }),
  ).toHaveAttribute('aria-current', 'page');
  await page.setViewportSize({ width: 773, height: 988 });
  await expect(page.getByRole('button', { name: 'Toggle sidebar' }).first()).toBeInViewport();
});
