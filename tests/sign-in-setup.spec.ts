import { type Page } from '@playwright/test';
import { test, expect, openSettingsWindow, sidebar } from './helpers/app';

const team = '11111111-1111-4111-8111-111111111111';
const ids = { team };

/** A desktop API fixture. `extra` returns the parts that a test checks. */
async function fixture(page: Page, extra: string) {
  await page.addInitScript(
    ({ ids, extra }) => {
      const signedIn = {
        region: 'eu',
        phase: 'authenticated',
        executionReady: false,
        account: {
          state: 'authenticated',
          userId: ids.team,
          organizationId: ids.team,
          apiUrl: 'https://api.eu.verdictan.com',
        },
      };
      (window as any).workspace = Object.assign(
        {
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
          runtimeUpdateStatus: async () => ({
            hostId: 'local',
            component: 'verdictan',
            discovery: 'current',
            stale: false,
            history: [],
          }),
          verdictanStatus: async () => signedIn,
        },
        new Function('ids', 'signedIn', extra)(ids, signedIn),
      );
    },
    { ids, extra },
  );
  await page.goto('/');
}

test('a refused session shows "Sign in again" with its code, not "Signed in"', async ({ page }) => {
  await fixture(
    page,
    `return {
      verdictanStatus: async () => ({
        ...signedIn,
        phase: 'expired',
        error: 'desktop.auth_expired',
        account: { ...signedIn.account, state: 'expired' },
      }),
    };`,
  );
  await expect(
    sidebar(page).getByRole('button', { name: 'Sign in again', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('session-banner')).toContainText(
    'Verdictan did not accept your session. Code: desktop.auth_expired',
  );
  const settings = await openSettingsWindow(page, 'Account');
  const account = settings.getByRole('region', { name: 'Account', exact: true });
  await expect(account.getByRole('heading')).toContainText('Your session ended');
  await expect(account.getByRole('heading')).toContainText('Code: desktop.auth_expired');
  await expect(account.getByRole('button', { name: 'Sign in again', exact: true })).toBeVisible();
  await expect(account.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  await expect(settings).not.toContainText('Signed in');
});

test('the gateway runtime shows only a failure, and Try again repairs it', async ({ page }) => {
  // Kalkidan installs and repairs the gateway runtime by itself after the sign-in. The
  // sidebar shows nothing while it works, and only a failure that the user can act on.
  await fixture(
    page,
    `let state = { state: 'installing' };
    window.retries = 0;
    window.fail = () => {
      state = { state: 'failed', message: 'Agents could not start. Code: desktop.runtime_failed' };
      window.dispatchEvent(new Event('focus'));
    };
    return {
      gatewayRuntime: async () => state,
      gatewayRuntimeRetry: async () => {
        window.retries++;
        return (state = { state: 'ready' });
      },
    };`,
  );
  const failure = sidebar(page).getByRole('alert');
  await expect(sidebar(page).getByRole('button', { name: /^Account: / })).toBeVisible();
  await expect(failure).toHaveCount(0);
  await expect(sidebar(page)).not.toContainText(/Setting up|Install/);
  await page.evaluate(() => (window as any).fail());
  await expect(failure).toContainText('Agents could not start. Code: desktop.runtime_failed');
  await failure.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(failure).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).retries)).toBe(1);
});

test('before the first project, the session banner starts under the title bar', async ({
  page,
}) => {
  await fixture(
    page,
    `return {
      snapshot: async () => ({ projects: [], groups: [], sessions: [], warnings: [], platform: 'darwin' }),
      verdictanStatus: async () => ({
        ...signedIn,
        phase: 'expired',
        error: 'desktop.auth_expired',
        account: { ...signedIn.account, state: 'expired' },
      }),
    };`,
  );
  const banner = page.getByTestId('session-banner');
  await expect(banner).toBeVisible();
  const controls = await page.locator('.titlebar-controls').boundingBox();
  const box = await banner.boundingBox();
  expect(controls && box).toBeTruthy();
  expect(box!.y).toBeGreaterThanOrEqual(controls!.y + controls!.height);
  await banner.getByRole('button', { name: 'Sign in again', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Sign in to Verdictan' })).toBeVisible();
});
