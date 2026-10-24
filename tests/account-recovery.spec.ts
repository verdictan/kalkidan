import { test, expect } from '@playwright/test';

/** A signed-out desktop with a saved region and a failed sign-in. */
async function signedOut(
  page: import('@playwright/test').Page,
  error = 'desktop.authorization_timeout',
) {
  await page.addInitScript((error) => {
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
        throw new Error(error);
      },
    };
  }, error);
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

for (const outcome of ['success', 'cancel', 'failure'] as const) {
  test(`account mismatch supports explicit sign-out: ${outcome}`, async ({ page }) => {
    await signedOut(page, 'desktop.identity_mismatch');
    await page.evaluate((outcome) => {
      (window as any).logouts = 0;
      (window as any).workspace.verdictanLogout = async () => {
        (window as any).logouts++;
        if (outcome === 'failure') throw new Error('offline');
        return {
          region: 'eu',
          phase: outcome === 'success' ? 'signed-out' : 'authenticated',
          account: { state: outcome === 'success' ? 'signed-out' : 'authenticated' },
          executionReady: false,
        };
      };
    }, outcome);
    const start = page.getByRole('button', { name: 'Sign in with Verdictan', exact: true });
    await signIn(page);
    await expect(page.getByRole('alert')).toHaveText('The account or organization does not match');
    await expect(page.getByText(/Choose the saved account and organization/)).toBeVisible();
    await page.getByRole('button', { name: 'Retry with saved account' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).authorizations)).toBe(2);
    expect(await page.evaluate(() => (window as any).logouts)).toBe(0);
    await page.getByRole('button', { name: 'Sign out of saved account' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).logouts)).toBe(1);
    if (outcome === 'success') {
      await expect(start).toBeVisible();
      expect(await page.evaluate(() => (window as any).authorizations)).toBe(2);
      await start.click();
      await expect.poll(() => page.evaluate(() => (window as any).authorizations)).toBe(3);
    } else {
      await expect(
        page.getByRole('alert').filter({ hasText: 'The account or organization does not match' }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign out of saved account' })).toBeEnabled();
      await expect(
        page.getByText(
          outcome === 'failure'
            ? 'Could not sign out of the saved account. Try again.'
            : 'The saved account was not signed out. Try again when ready.',
        ),
      ).toBeVisible();
    }
  });
}

test('account mismatch can add a separate profile without signing out', async ({ page }) => {
  await signedOut(page, 'desktop.identity_mismatch');
  await page.evaluate(() => {
    (window as any).added = 0;
    (window as any).workspace.verdictanAddAccount = async () => {
      (window as any).added++;
      return { phase: 'signed-out', activeAccountId: 'new-account', executionReady: false };
    };
    // The new account has no region yet. Kalkidan gives it the region of the saved account.
    (window as any).workspace.verdictanSetRegion = async (region: string) => ({
      region,
      phase: 'signed-out',
      activeAccountId: 'new-account',
      executionReady: false,
    });
    (window as any).workspace.verdictanLogout = () => {
      throw new Error('Must keep the saved account');
    };
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  // The new account starts its sign-in at once, in the same region. No second click.
  await expect.poll(() => page.evaluate(() => (window as any).authorizations)).toBe(2);
  expect(await page.evaluate(() => (window as any).added)).toBe(1);
});

test('a gateway that is not ready is not an internet problem, and the sign-in tries again', async ({
  page,
}) => {
  await signedOut(page, 'desktop.gateway_unavailable');
  await signIn(page);
  await expect(page.getByRole('alert')).toHaveText(
    'The Verdictan gateway on this computer is not ready',
  );
  await expect(page.getByText(/Check the internet connection/)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).authorizations)).toBe(2);
});
