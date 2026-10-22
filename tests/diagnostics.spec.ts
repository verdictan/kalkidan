import { test, expect, openSettings } from './helpers/app';

test('Diagnostics shows versions and a redacted bundle preview before export', async ({ page }) => {
  await page.goto('/');
  const settings = await openSettings(page, 'Diagnostics');
  await expect(settings.getByTestId('diagnostics-runtime-local')).toContainText('Version 0.6.9');
  // The demo host runs 0.6.6, which the support window deprecates.
  await expect(settings.getByTestId('diagnostics-runtime-demo-host')).toContainText(
    /0\.6\.6 .*(deprecated|stopped)/,
  );
  await expect(settings.getByRole('group', { name: 'Telemetry is off' })).toBeVisible();
  const exportButton = settings.getByRole('button', { name: 'Export…' });
  await expect(exportButton).toBeDisabled();
  await settings.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = settings.getByTestId('support-bundle-preview');
  await expect(preview).toContainText('"kind": "kalkidan.support_bundle"');
  await expect(preview).toContainText('"telemetry": "off"');
  await expect(preview).toContainText('11111111-1111-4111-8111-111111111111');
  await expect(settings.getByTestId('support-bundle-summary')).toContainText('values removed');
  await expect(exportButton).toBeEnabled();
  // The preview wraps long lines, so the row and its buttons stay inside the dialog.
  const scroll = page.locator('.settings-scroll');
  expect(await scroll.evaluate((pane) => pane.scrollWidth - pane.clientWidth)).toBe(0);
  const pane = await scroll.boundingBox();
  const button = await exportButton.boundingBox();
  expect(button!.x + button!.width).toBeLessThanOrEqual(pane!.x + pane!.width);
});
