import { test, expect } from '@playwright/test';
async function openSession(page: any) {
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await page.locator('.repo-select').first().click();
  await page.getByRole('button', { name: 'Resume session', exact: true }).first().click();
}
test('conversation actions rename, pin, fork, and open an independent side chat', async ({
  page,
}) => {
  await openSession(page);
  const menu = () =>
    page.getByRole('button', { name: 'Conversation actions', exact: true }).click();
  await menu();
  await page.screenshot({ animations: 'disabled', path: 'test-results/conversation-actions.png' });
  await page.getByRole('menuitem', { name: /^Rename/ }).click();
  await page.getByLabel('Conversation name').fill('Release review');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.locator('.conversation-toolbar-title')).toContainText('Release review');
  await menu();
  await page.getByRole('menuitem', { name: /^Pin/ }).click();
  await expect(page.getByRole('button', { name: 'Unpin session', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await menu();
  await page.getByRole('menuitem', { name: 'Fork', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'In current checkout' }).click();
  await expect(page.locator('.conversation-toolbar-title:visible')).toContainText(
    'Fork of Release review',
  );
  await menu();
  await page.getByRole('menuitem', { name: /New side chat/ }).click();
  await expect(page.getByLabel('Message agent')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Close side chat' })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: 'test-results/side-chat.png' });
  await page.getByRole('button', { name: 'Close side chat' }).click();
  await expect(page.getByRole('button', { name: 'Close side chat' })).toHaveCount(0);
});
