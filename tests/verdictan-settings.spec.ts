import { test, expect, openSettings, settingsDialog, sidebar } from './helpers/app';

test('the sign-in asks for an EU or US region and saves it only on a choice', async ({ page }) => {
  await page.addInitScript(() => {
    const state = {
      account: { phase: 'error', error: 'desktop.region_required', executionReady: false } as any,
      regions: [] as string[],
    };
    (window as any).regionFixture = state;
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [],
        groups: [{ id: 'g', name: 'Project', repoIds: [] }],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      trackerProviders: async () => [],
      remoteHosts: async () => [],
      githubCliCheck: async () => ({ status: 'missing' }),
      githubAuthStatus: async () => ({ status: 'idle' }),
      verdictanStatus: async () => state.account,
      verdictanSetRegion: async (region: string) => {
        state.regions.push(region);
        return (state.account = { region, phase: 'signed-out', executionReady: false });
      },
    };
  });
  await page.goto('/');
  // The sidebar footer offers the sign-in. Settings opens with Mod+,.
  await expect(sidebar(page).getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  // The account at the top of Settings is not signed in. A missing region is not an error.
  const settings = await openSettings(page, 'Account');
  const account = settings.getByRole('region', { name: 'Account', exact: true });
  await expect(account.getByRole('heading')).toHaveText('Not signed in');
  await expect(settings.getByRole('alert')).toHaveCount(0);
  await account.getByRole('button', { name: 'Sign in', exact: true }).click();
  // The sign-in shows the region as an inline menu. Nothing is saved before a choice.
  const dialog = page.getByRole('dialog', { name: 'Sign in to Verdictan' });
  const region = dialog.getByRole('button', { name: /^Region: / });
  await region.click();
  // There is no Global choice: only the European Union and the United States.
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitemradio')).toHaveCount(2);
  await expect(menu.getByRole('menuitemradio', { name: /Global/ })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).regionFixture.regions)).toEqual([]);
  // The choice applies at once. Nobody is signed in, so it stops nothing that runs.
  await menu.getByRole('menuitemradio', { name: /United States/ }).click();
  await expect(region).toHaveAccessibleName('Region: United States');
  await expect
    .poll(() => page.evaluate(() => (window as any).regionFixture.regions))
    .toEqual(['us']);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(settingsDialog(page)).toBeVisible();
});
