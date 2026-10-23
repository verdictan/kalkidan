import { test, expect, openPalette, palette } from './helpers/app';

test('Diagnostics opens from search and shows a redacted bundle preview before export', async ({
  page,
}) => {
  await page.goto('/');
  // The support bundle opens from search (⌘K). Settings and the account menu have no
  // Diagnostics item.
  await (await openPalette(page)).fill('Support bundle');
  await palette(page)
    .getByRole('option', { name: /^Support bundle…/ })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Diagnostics', exact: true });
  // The versions are on the rows of Settings › Tools, so Diagnostics has no version list and
  // no connection list.
  await expect(dialog.getByRole('group', { name: 'Telemetry is off' })).toBeVisible();
  await expect(dialog.getByRole('region', { name: /Versions|Connection/ })).toHaveCount(0);
  const exportButton = dialog.getByRole('button', { name: 'Export…' });
  await expect(exportButton).toBeDisabled();
  await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = dialog.getByTestId('support-bundle-preview');
  await expect(preview).toContainText('"kind": "kalkidan.support_bundle"');
  await expect(preview).toContainText('"telemetry": "off"');
  await expect(preview).toContainText('11111111-1111-4111-8111-111111111111');
  await expect(dialog.getByTestId('support-bundle-summary')).toContainText('values removed');
  await expect(exportButton).toBeEnabled();
  // The preview wraps long lines, so the row and its buttons stay inside the dialog.
  const box = await dialog.boundingBox();
  const button = await exportButton.boundingBox();
  expect(button!.x + button!.width).toBeLessThanOrEqual(box!.x + box!.width);
  expect(await dialog.evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
});
