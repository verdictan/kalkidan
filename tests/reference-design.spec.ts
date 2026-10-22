import { test, expect, newChat, openSettings, settingsDialog } from './helpers/app';
import { openCodeFolder } from './helpers/navigation';
test('dark desktop workflow preserves drafts across the title bar tools and resizable panes', async ({
  page,
}) => {
  await page.goto('/');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
  await expect(page.locator('html')).toHaveClass('dark');
  await page.screenshot({ animations: 'disabled', path: 'test-results/reference-projects.png' });
  await openSettings(page);
  await page.screenshot({ animations: 'disabled', path: 'test-results/reference-settings.png' });
  // Settings is a dialog above the page. Escape closes it and Projects shows again.
  await page.keyboard.press('Escape');
  await expect(settingsDialog(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
  await page.getByRole('main').getByRole('button', { name: 'New project', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({
    animations: 'disabled',
    path: 'test-results/reference-create-project.png',
  });
  await page.keyboard.press('Escape');
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await page.screenshot({ animations: 'disabled', path: 'test-results/reference-board.png' });
  await openCodeFolder(page);
  await newChat(page);
  await page.getByLabel('Message agent').fill('Keep this plan while I inspect the app.');
  await page.screenshot({
    animations: 'disabled',
    path: 'test-results/reference-conversation.png',
  });
  // The title bar groups the tools. Each tool has one button there.
  const toolButtons = page.locator('.topbar').getByRole('group', { name: 'Tools', exact: true });
  const terminal = toolButtons.getByRole('button', { name: 'Terminal', exact: true });
  const browser = toolButtons.getByRole('button', { name: 'Browser', exact: true });
  await expect(terminal).toHaveCount(1);
  await expect(browser).toHaveCount(1);
  // In the composer, the shortcut goes to the text field. Move the focus out first.
  await page.getByLabel('Message agent').blur();
  await page.keyboard.press('ControlOrMeta+t');
  const tools = page.getByRole('region', { name: 'Repository tools', exact: true });
  await expect(tools).toBeVisible();
  await expect(terminal).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Message agent')).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: 'test-results/reference-new-tab.png' });
  // Select the shown tool again to hide the tools. The draft stays.
  await terminal.click();
  await expect(terminal).toHaveAttribute('aria-pressed', 'false');
  await expect(tools).toBeHidden();
  await expect(page.getByLabel('Message agent')).toHaveValue(
    'Keep this plan while I inspect the app.',
  );
  await page.keyboard.press('Control+Backquote');
  await expect(page.getByLabel('Interactive terminal').first()).toBeVisible();
  await expect(tools.getByRole('alert').first()).toContainText('Open the desktop app');
  await browser.click();
  await expect(browser).toHaveAttribute('aria-pressed', 'true');
  const bounds = await page.getByLabel('Embedded browser').boundingBox();
  expect(bounds!.height).toBeGreaterThan(500);
  await page.screenshot({ animations: 'disabled', path: 'test-results/reference-browser.png' });
  await browser.click();
  await expect(tools).toBeHidden();
  await page.setViewportSize({ width: 961, height: 988 });
  await expect(page.getByLabel('Message agent')).toHaveValue(
    'Keep this plan while I inspect the app.',
  );
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ animations: 'disabled', path: 'test-results/reference-compact.png' });
});
