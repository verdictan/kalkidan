import { type Page } from '@playwright/test';
import { test, expect } from './helpers/app';

const titlebarHeight = 48;

async function expectInsideWindow(page: Page) {
  const menu = page.getByRole('menu').first();
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  // The menu stays below the title bar and the macOS window controls.
  expect(box!.y).toBeGreaterThanOrEqual(titlebarHeight);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
  // A menu that is taller than the space scrolls in the menu.
  const scroll = await menu.evaluate((node) => ({
    overflow: getComputedStyle(node).overflowY,
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight,
  }));
  if (scroll.scrollHeight > scroll.clientHeight) expect(scroll.overflow).toBe('auto');
}

test('project menu stays inside a short window and scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 1276, height: 460 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage project Atlas', exact: true }).click();
  await expectInsideWindow(page);
  // The folder colors are in a submenu. It also stays inside the window.
  await page.getByRole('menuitem', { name: 'Folder color', exact: true }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Default', exact: true })).toBeVisible();
  const submenu = page.getByRole('menu').last();
  const box = await submenu.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(titlebarHeight);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  const project = page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true });
  await project.click({ button: 'right' });
  await expectInsideWindow(page);
});
