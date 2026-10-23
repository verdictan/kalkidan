import { test, expect, settingsDialog, settingsSection } from './helpers/app';
test('project settings set matching project folder colors and reset them', async ({ page }) => {
  await page.setViewportSize({ width: 1276, height: 988 });
  await page.goto('/');
  const project = page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true });
  // The color is in Settings, in the section of the project.
  await project.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Project settings…', exact: true }).click();
  const settings = settingsDialog(page);
  await expect(settingsSection(page, 'Atlas')).toHaveAttribute('aria-selected', 'true');
  const colors = settings.getByRole('group', { name: 'Color', exact: true });
  for (const name of ['Default', 'Red', 'Yellow', 'Blue', 'Green', 'Indigo', 'Violet'])
    await expect(colors.getByRole('button', { name: `${name} folder`, exact: true })).toBeVisible();
  const violet = colors.getByRole('button', { name: 'Violet folder', exact: true });
  await violet.click();
  await expect(violet).toHaveAttribute('aria-pressed', 'true');
  // The sidebar project row shows a chevron, not a folder. The folder icon of the project in
  // the Settings sections takes the project color.
  const icon = settingsSection(page, 'Atlas').locator('svg').first();
  await expect(icon).toHaveCSS('color', 'rgb(147, 51, 234)');
  await colors.getByRole('button', { name: 'Default folder', exact: true }).click();
  await expect(violet).toHaveAttribute('aria-pressed', 'false');
  await expect(icon).not.toHaveCSS('color', 'rgb(147, 51, 234)');
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await page.screenshot({ path: 'test-results/project-overview-spacing.png' });
});
