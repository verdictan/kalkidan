import { test, expect } from '@playwright/test';

/** A first run with a saved region and a sign-in that expires before the browser finishes. */
async function signedOut(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const apiUrl = 'https://api.eu.verdictan.com';
    (window as any).opened = [];
    (window as any).authorizations = 0;
    (window as any).workspace = {
      trackerProviders: async () => [],
      snapshot: async () => ({
        projects: [],
        groups: [],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      agentInstallations: async () => [],
      firstRunState: async () => ({ welcomeDone: false, everSignedIn: false }),
      setWelcomeDone: async () => ({ welcomeDone: true, everSignedIn: false }),
      verdictanStatus: async () => ({
        region: 'eu',
        phase: 'signed-out',
        account: { state: 'signed-out', apiUrl },
        executionReady: false,
      }),
      verdictanOpenAccountPage: async (page: string) => {
        (window as any).opened.push(page);
      },
      verdictanAuthorize: async () => {
        (window as any).authorizations++;
        throw new Error('desktop.authorization_timeout');
      },
    };
  });
  await page.goto('/');
}

test('the Welcome screen offers a new verification email and account recovery', async ({
  page,
}) => {
  await signedOut(page);
  await expect(page.getByRole('heading', { name: 'Welcome to Kalkidan' })).toBeVisible();
  const help = page.getByRole('group', { name: 'Account help' });
  await expect(help).toContainText('Did not get the verification email?');
  await help.getByRole('button', { name: 'Send it again' }).click();
  await expect(
    page.getByRole('status').getByText('Kalkidan opened your browser. Continue there.'),
  ).toBeVisible();
  await help.getByRole('button', { name: 'Recover your account' }).click();
  // Kalkidan sends only the page name. The main process opens the fixed console path.
  await expect
    .poll(() => page.evaluate(() => (window as any).opened))
    .toEqual(['verify', 'recover']);
});

test('an expired sign-in link starts again and keeps the account help', async ({ page }) => {
  await signedOut(page);
  await page.getByRole('button', { name: 'Continue with Verdictan', exact: true }).click();
  // The title is an alert, so a screen reader reads it at once.
  await expect(page.getByRole('alert')).toHaveText('The sign-in did not finish');
  await expect(page.getByText(/The sign-in link expired after 5 minutes/)).toBeVisible();
  await expect(page.getByRole('group', { name: 'Account help' })).toBeVisible();
  await page.getByRole('button', { name: 'Start again', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).authorizations)).toBe(2);
});
