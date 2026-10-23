import { test, expect, settingsDialog } from './helpers/app';
test('project settings set the project color in the tree and reset it', async ({ page }) => {
  await page.setViewportSize({ width: 1276, height: 988 });
  await page.goto('/');
  const project = page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true });
  // The color is in Settings, in the part of the project.
  await project.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Settings…', exact: true }).click();
  const settings = settingsDialog(page);
  const part = settings.getByRole('region', { name: 'Atlas', exact: true });
  await expect(part.getByRole('heading', { name: 'Atlas', exact: true })).toBeVisible();
  // The mark and the name of the project open its menu, with the Color swatches.
  const actions = part.getByRole('button', { name: 'Actions for Atlas', exact: true });
  await actions.click();
  const colors = page.getByRole('menu').getByRole('radiogroup', {
    name: 'Color of Atlas',
    exact: true,
  });
  for (const name of ['Blue', 'Indigo', 'Violet', 'Plum', 'Pink', 'Cyan', 'Teal', 'Slate'])
    await expect(colors.getByRole('radio', { name, exact: true })).toBeVisible();
  // The mark of the project row in the tree takes the project color.
  const mark = page.locator('.tree-row[data-kind="project"]').first().locator('.identity-mark');
  const violet = colors.getByRole('radio', { name: 'Violet', exact: true });
  await violet.click();
  await expect(violet).toBeChecked();
  await expect(mark).toHaveAttribute('style', /--id-violet/);
  // "Automatic color" in the same menu removes the chosen color. The demo chose Indigo for
  // Atlas, so the automatic color can differ from the first color.
  await page.getByRole('menuitem', { name: 'Automatic color', exact: true }).click();
  await expect(mark).not.toHaveAttribute('style', /--id-violet/);
  await actions.click();
  await expect(violet).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  // Escape leaves the Settings sheet.
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await page.screenshot({ path: 'test-results/project-overview-spacing.png' });
});
