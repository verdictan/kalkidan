import { test, expect } from './helpers/app';

test('saved accounts switch independently, and Add account opens a separate sign-in', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const listeners = new Set<() => void>();
    const profiles: Record<string, any> = {
      a: { id: 'a', region: 'eu', userName: 'Dana', organizationName: 'Acme' },
      b: { id: 'b', region: 'us', userName: 'Riley', organizationName: 'Beta' },
    };
    let activeId = 'a';
    const status = () => ({
      region: profiles[activeId].region,
      phase: activeId === 'new' ? 'signed-out' : 'authenticated',
      activeAccountId: activeId,
      savedAccounts: Object.values(profiles),
      executionReady: false,
      account: {
        state: activeId === 'new' ? 'signed-out' : 'authenticated',
        ...profiles[activeId],
        apiUrl: 'https://api.eu.verdictan.com',
      },
    });
    (window as any).accountCalls = [];
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
      agentInstallations: async () => [],
      firstRunState: async () => ({ welcomeDone: true, everSignedIn: true }),
      verdictanStatus: async () => status(),
      onVerdictanChanged: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      verdictanSwitchAccount: async (id: string) => {
        (window as any).accountCalls.push(['switch', id]);
        activeId = id;
        listeners.forEach((listener) => listener());
        return status();
      },
      verdictanAddAccount: async () => {
        (window as any).accountCalls.push(['add']);
        profiles.new = { id: 'new' };
        activeId = 'new';
        listeners.forEach((listener) => listener());
        return status();
      },
      verdictanLogout: async () => {
        throw new Error('Switch must not sign out');
      },
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Account: Dana/ }).click();
  await expect(page.getByRole('menuitem', { name: /Dana/ })).toBeDisabled();
  await page.getByRole('menuitem', { name: /Riley/ }).click();
  await page.getByRole('button', { name: /^Account: Riley/ }).click();
  await page.getByRole('menuitem', { name: /Dana/ }).click();
  await page.getByRole('button', { name: /^Account: Dana/ }).click();
  await page.getByRole('menuitem', { name: 'Add account', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Sign in to Verdictan', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).accountCalls)).toEqual([
    ['switch', 'b'],
    ['switch', 'a'],
    ['add'],
  ]);
});

test('demo keeps a previous sign-in after adding an account and reloading', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^Account: Dana/ }).click();
  await page.getByRole('menuitem', { name: 'Add account', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sign in to Verdictan', exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Saved accounts', exact: true }).click();
  await page.getByRole('menuitem', { name: /Dana Kim/ }).click();
  await expect(page.getByRole('button', { name: /^Account: Dana Kim/ })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /^Account: Dana Kim/ }).click();
  await expect(page.getByRole('menuitem', { name: /Account awaiting sign-in/ })).toBeVisible();
});
