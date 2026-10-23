import { test, expect, newChat, openSettings, settingsDialog } from './helpers/app';
import { openCodeFolder } from './helpers/navigation';
test('desktop workflow preserves drafts across the title bar tools and resizable panes', async ({
  page,
}) => {
  await page.goto('/');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
  // Kalkidan is light only.
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await page.screenshot({ animations: 'disabled', path: 'test-results/reference-projects.png' });
  await openSettings(page);
  await page.screenshot({ animations: 'disabled', path: 'test-results/reference-settings.png' });
  // Settings is a page. Escape goes back, and Projects shows again.
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
  // The chat header has one Tools button. The tool pane has the tabs Changes, Code, Terminal
  // and Browser.
  const toolsButton = page
    .getByRole('main')
    .getByRole('group', { name: 'Tools', exact: true })
    .getByRole('button', { name: 'Tools', exact: true });
  await expect(toolsButton).toHaveCount(1);
  const tabs = page.getByRole('tablist', { name: 'Tools', exact: true });
  const terminal = tabs.getByRole('tab', { name: 'Terminal', exact: true });
  const browser = tabs.getByRole('tab', { name: 'Browser', exact: true });
  // In the composer, the shortcut goes to the text field. Move the focus out first.
  await page.getByLabel('Message agent').blur();
  await page.keyboard.press('ControlOrMeta+t');
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole('tab')).toHaveText(['Changes', 'Code', 'Terminal', 'Browser']);
  await expect(terminal).toHaveAttribute('aria-selected', 'true');
  await expect(toolsButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Message agent')).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: 'test-results/reference-new-tab.png' });
  // The Tools button hides the pane again. The draft stays.
  await toolsButton.click();
  await expect(toolsButton).toHaveAttribute('aria-pressed', 'false');
  await expect(tabs).toBeHidden();
  await expect(page.getByLabel('Message agent')).toHaveValue(
    'Keep this plan while I inspect the app.',
  );
  await page.keyboard.press('Control+Backquote');
  // Control+` opens the terminal. The demo has no shell, so the pane shows why in place of
  // the terminal.
  await expect(terminal).toHaveAttribute('aria-selected', 'true');
  await expect(
    page.getByRole('tabpanel', { name: 'Terminal' }).getByRole('alert').first(),
  ).toContainText('Open the desktop app');
  await browser.click();
  await expect(browser).toHaveAttribute('aria-selected', 'true');
  const bounds = await page.getByLabel('Embedded browser').boundingBox();
  expect(bounds!.height).toBeGreaterThan(500);
  await page.screenshot({ animations: 'disabled', path: 'test-results/reference-browser.png' });
  await page.getByRole('button', { name: 'Close tools', exact: true }).click();
  await expect(tabs).toBeHidden();
  await page.setViewportSize({ width: 961, height: 988 });
  await expect(page.getByLabel('Message agent')).toHaveValue(
    'Keep this plan while I inspect the app.',
  );
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ animations: 'disabled', path: 'test-results/reference-compact.png' });
});
