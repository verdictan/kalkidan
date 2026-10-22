import { test, expect } from './helpers/app';
test('right click sets matching project folder colors and resets them', async ({ page }) => {
  await page.setViewportSize({ width: 1276, height: 988 });
  await page.goto('/');
  const project = page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true });
  await project.click({ button: 'right' });
  // The colors are in the "Color" submenu.
  await page.getByRole('menuitem', { name: 'Color', exact: true }).click();
  for (const name of ['Red', 'Yellow', 'Blue', 'Green', 'Indigo', 'Violet'])
    await expect(page.getByRole('menuitemradio', { name, exact: true })).toBeVisible();
  await page.getByRole('menuitemradio', { name: 'Violet', exact: true }).click();
  // The folder icon of the project row takes the project color.
  const icon = page.locator('.project-tree .tree-toggle svg').first();
  await expect(icon).toHaveCSS('color', 'rgb(147, 51, 234)');
  await expect(page.locator('.project-symbol')).toHaveCSS('color', 'rgb(147, 51, 234)');
  await project.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Color', exact: true }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Violet', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('menuitemradio', { name: 'Default', exact: true }).click();
  await expect(icon).not.toHaveCSS('color', 'rgb(147, 51, 234)');
  await page.screenshot({ path: 'test-results/project-overview-spacing.png' });
});
