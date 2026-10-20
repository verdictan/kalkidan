import { test, expect } from '@playwright/test';
async function openSession(page: any) {
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await page.locator('.repo-select').first().click();
  await page
    .getByRole('button', { name: /^Resume / })
    .first()
    .click();
}
test('session actions rename, pin, fork, and open an independent side session', async ({
  page,
}) => {
  await openSession(page);
  const menu = () => page.getByRole('button', { name: 'Session actions', exact: true }).click();
  await menu();
  await page.screenshot({ animations: 'disabled', path: 'test-results/conversation-actions.png' });
  await page.getByRole('menuitem', { name: /^Rename/ }).click();
  await page.getByLabel('Session name').fill('Release review');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.locator('.conversation-toolbar-title')).toContainText('Release review');
  await menu();
  await page.getByRole('menuitem', { name: /^Pin/ }).click();
  await expect(
    page
      .getByRole('navigation', { name: 'Projects and repositories' })
      .getByRole('button', { name: 'Resume pinned Release review', exact: true }),
  ).toBeVisible();
  await menu();
  await expect(page.getByRole('menuitem', { name: /^Unpin/ })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Duplicate chat', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'Continue here' }).click();
  await expect(page.locator('.conversation-toolbar-title:visible')).toContainText(
    'Fork of Release review',
  );
  await menu();
  await page.getByRole('menuitem', { name: /Open a second chat beside this one/ }).click();
  await expect(page.getByLabel('Message agent')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Close side session' })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: 'test-results/side-session.png' });
  await page.getByRole('button', { name: 'Close side session' }).click();
  await expect(page.getByRole('button', { name: 'Close side session' })).toHaveCount(0);
});
test('archive closes the session at once and the toast can undo it', async ({ page }) => {
  await openSession(page);
  const title = await page.locator('.conversation-toolbar-title').innerText();
  await page.getByRole('button', { name: 'Session actions', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Archive/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Chat archived' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Session', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Chat restored' })).toBeVisible();
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
});
