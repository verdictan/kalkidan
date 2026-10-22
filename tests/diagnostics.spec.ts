import { test, expect, openAccountMenuItem } from './helpers/app';

test('Diagnostics shows versions and a redacted bundle preview before export', async ({ page }) => {
  await page.goto('/');
  await openAccountMenuItem(page, 'Diagnostics');
  const dialog = page.getByRole('dialog', { name: 'Diagnostics', exact: true });
  await expect(dialog.getByTestId('diagnostics-runtime-local')).toContainText('Version 0.6.9');
  // The demo host runs 0.6.6, which is older than the support window.
  await expect(dialog.getByTestId('diagnostics-runtime-demo-host')).toContainText(
    /0\.6\.6 .*(deprecated|stopped)/,
  );
  await expect(dialog.getByRole('group', { name: 'Telemetry is off' })).toBeVisible();
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
