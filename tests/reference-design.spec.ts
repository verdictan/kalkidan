import { test, expect } from '@playwright/test';
import { openTool } from './helpers/tools';
test('dark desktop workflow preserves drafts across resizable tool panes and the launcher', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:5173');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
  await expect(page.locator('html')).toHaveClass('dark');
  await page.screenshot({ animations: 'disabled', path: 'test-results/reference-projects.png' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.screenshot({ animations: 'disabled', path: 'test-results/reference-settings.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('main').getByRole('button', { name: 'New project', exact: true }).click();
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
  // The title bar groups the session tools. Each tool has one button there.
  const sessionTools = page
    .locator('.topbar')
    .getByRole('group', { name: 'Session tools', exact: true });
  await expect(sessionTools.getByRole('button', { name: 'Terminal', exact: true })).toHaveCount(1);
  await expect(sessionTools.getByRole('button', { name: 'Browser', exact: true })).toHaveCount(1);
  // In the composer, the shortcut goes to the text field. Move the focus out first.
  await page.getByLabel('Message agent').blur();
  await page.keyboard.press('ControlOrMeta+t');
  const tools = page.getByRole('region', { name: 'Repository tools', exact: true });
  await expect(tools.getByRole('heading', { name: 'Tools', exact: true })).toBeVisible();
  await expect(page.getByLabel('Message agent')).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: 'test-results/reference-new-tab.png' });
  await page.getByRole('button', { name: 'Hide tools', exact: true }).click();
  await expect(page.getByLabel('Message agent')).toHaveValue(
    'Keep this plan while I inspect the app.',
  );
  await page.keyboard.press('Control+Backquote');
  await expect(page.getByLabel('Interactive terminal')).toBeVisible();
  await expect(tools.getByRole('alert')).toContainText('Open the desktop app');
  await openTool(page, 'Browser');
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
