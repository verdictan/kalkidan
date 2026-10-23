import { test, expect } from '@playwright/test';

/**
 * A signed-out desktop with a saved region and a sign-in that expires before the browser
 * finishes. The sign-in starts from search.
 */
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

/**
 * Starts the sign-in from search. Before the first project there is no sidebar (ST-C2), so
 * the "Sign in" of the sidebar footer is not there.
 */
async function signIn(page: import('@playwright/test').Page) {
  await expect(page.getByRole('textbox', { name: 'Message for a new chat' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search or run a command' }).fill('Sign in');
  await page
    .getByRole('option', { name: /^Sign in/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Sign in to Verdictan' });
  // The region is saved, so one click starts the sign-in. The button shows when it does not.
  const start = dialog.getByRole('button', { name: 'Sign in with Verdictan', exact: true });
  await expect(dialog.getByRole('alert').or(start)).toBeVisible();
  if (await start.isVisible()) await start.click();
  return dialog;
}

test('the sign-in offers a new verification email and account recovery after a failure', async ({
  page,
}) => {
  await signedOut(page);
  // The first window is the composer. No Welcome screen asks for the sign-in.
  await expect(page.getByRole('region', { name: 'Welcome to Kalkidan' })).toHaveCount(0);
  // The account help shows only after a sign-in fails.
  const trouble = page.getByRole('button', { name: 'Trouble signing in?' });
  await expect(trouble).toHaveCount(0);
  await signIn(page);
  await expect(page.getByRole('alert')).toHaveText('The sign-in did not finish');
  await trouble.click();
  await page.getByRole('menuitem', { name: 'Send the verification email again' }).click();
  await expect(
    page.getByRole('status').getByText('Kalkidan opened your browser. Continue there.'),
  ).toBeVisible();
  await trouble.click();
  await page.getByRole('menuitem', { name: 'Recover your account' }).click();
  // Kalkidan sends only the page name. The main process opens the fixed console path.
  await expect
    .poll(() => page.evaluate(() => (window as any).opened))
    .toEqual(['verify', 'recover']);
});

test('an expired sign-in link starts again and keeps the account help', async ({ page }) => {
  await signedOut(page);
  await signIn(page);
  // The title is an alert, so a screen reader reads it at once.
  await expect(page.getByRole('alert')).toHaveText('The sign-in did not finish');
  await expect(page.getByText(/The sign-in link expired after 5 minutes/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Trouble signing in?' })).toBeVisible();
  await page.getByRole('button', { name: 'Start again', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).authorizations)).toBe(2);
});
