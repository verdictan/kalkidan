import { test, expect } from '@playwright/test';
test('dark desktop workflow preserves drafts across resizable tool panes and the launcher', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:5173');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByRole('heading', { name: 'Your projects' })).toBeVisible();
  await expect(page.locator('html')).toHaveClass('dark');
  await page.screenshot({ animations: 'disabled', path: 'test-results/reference-projects.png' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.screenshot({ animations: 'disabled', path: 'test-results/reference-settings.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({
    animations: 'disabled',
    path: 'test-results/reference-create-project.png',
  });
  await page.keyboard.press('Escape');
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await page.screenshot({ animations: 'disabled', path: 'test-results/reference-board.png' });
  await page.locator('.repo-select').first().click();
  await page.getByRole('button', { name: 'New Codex session', exact: true }).click();
  await page.getByLabel('Message agent').fill('Keep this plan while I inspect the app.');
  await page.screenshot({
    animations: 'disabled',
    path: 'test-results/reference-conversation.png',
  });
  const titleTools = page
    .locator('.topbar')
    .getByRole('group', { name: 'Conversation tools', exact: true });
  await expect(titleTools.getByRole('button', { name: 'Terminal', exact: true })).toBeVisible();
  await expect(
    page.locator('.conversation-tools').getByRole('button', { name: 'Terminal', exact: true }),
  ).toHaveCount(0);
  await titleTools.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(titleTools.getByRole('button', { name: 'Terminal', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await titleTools.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(page.getByLabel('Message agent')).toHaveValue(
    'Keep this plan while I inspect the app.',
  );
  await page.keyboard.press('Meta+t');
  await expect(page.getByRole('heading', { name: 'New tab' })).toBeVisible();
  await expect(page.getByLabel('Message agent')).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: 'test-results/reference-new-tab.png' });
  await page.getByRole('button', { name: 'Return to conversation', exact: true }).click();
  await expect(page.getByLabel('Message agent')).toHaveValue(
    'Keep this plan while I inspect the app.',
  );
  await page.keyboard.press('Meta+`');
  await expect(page.getByLabel('Interactive terminal')).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Repository tools' }).getByRole('alert'),
  ).toContainText('Open the desktop app');
  await page.getByRole('button', { name: 'Browser', exact: true }).click();
  const bounds = await page.getByLabel('Embedded browser').boundingBox();
  expect(bounds!.height).toBeGreaterThan(500);
  await page.screenshot({ animations: 'disabled', path: 'test-results/reference-browser.png' });
  await page.getByRole('button', { name: 'Hide tools', exact: true }).click();
  await page.setViewportSize({ width: 961, height: 988 });
  await expect(page.getByLabel('Message agent')).toHaveValue(
    'Keep this plan while I inspect the app.',
  );
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ animations: 'disabled', path: 'test-results/reference-compact.png' });
});
