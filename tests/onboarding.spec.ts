import { type Page } from '@playwright/test';
import { test, expect } from './helpers/app';

// The sidebar hides Get started after setup is complete. The search actions keep it.
async function openSetup(page: Page) {
  await page.getByRole('button', { name: 'Search or run a command', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search or run a command' }).fill('Get started');
  await page
    .getByRole('region', { name: 'Search results' })
    .getByRole('option', { name: 'Get started', exact: true })
    .click();
  await expect(getStarted(page)).toBeVisible();
}

/** The Get started dialog. */
const getStarted = (page: Page) => page.getByRole('dialog', { name: 'Get started', exact: true });

test('an empty workspace asks for a code folder, and Get started opens from search', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).workspace = {
      trackerProviders: async () => [],
      snapshot: async () => ({
        projects: [],
        groups: [],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      agentInstallations: async () => [{ agent: 'codex', status: 'missing' }],
    };
  });
  await page.goto('/');
  // Get started does not open by itself. The empty state asks for a code folder.
  await expect(
    page.getByRole('main').getByRole('heading', { name: 'Open a code folder' }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // With no project, the sidebar does not show Get started: the empty state asks.
  await expect(page.getByRole('button', { name: 'Get started', exact: true })).toHaveCount(0);
  await openSetup(page);
  const dialog = getStarted(page);
  await expect(dialog.getByRole('heading', { name: 'Open a code folder' })).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Open a code folder…', exact: true }),
  ).toBeEnabled();
  // Step 3 opens only after a code folder. Its button shows only at step 3.
  await expect(dialog.getByRole('button', { name: /^Say hello/ })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Open first chat' })).toHaveCount(0);
  // An empty project is the other way to start. Cancel returns to the steps.
  await dialog.getByRole('button', { name: 'Start with an empty project', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Project name');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(getStarted(page)).toBeVisible();
  await getStarted(page).getByRole('button', { name: 'Set up later' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('main').getByRole('heading', { name: 'Open a code folder' }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openSetup(page);
});

test('existing workspace can prepare an editable first message without sending it', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openSetup(page);
  // The code folder step is done and shows the project of the setup.
  await expect(page.getByRole('button', { name: /^Open a code folder/ })).toContainText('Atlas');
  // Step 3 opens at once, because the project has a code folder. It has a first draft.
  await expect(getStarted(page).getByRole('heading', { name: 'Say hello' })).toBeVisible();
  await expect(page.getByLabel('First message', { exact: true })).not.toHaveValue('');
  await page
    .getByLabel('First message', { exact: true })
    .fill('Inspect the authentication flow and suggest an integration test plan.');
  await page.screenshot({ path: 'test-results/onboarding.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Open first chat' }).click();
  await expect(page.getByLabel('Message agent')).toHaveValue(
    'Inspect the authentication flow and suggest an integration test plan.',
  );
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('agent check failure is recoverable and short screens keep setup actions accessible', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).checkFails = true;
    (window as any).workspace = {
      trackerProviders: async () => [],
      snapshot: async () => ({
        projects: [
          { id: 'r', name: 'Repo', path: '/tmp/repo', favorite: false, notes: '', addedAt: '' },
        ],
        groups: [{ id: 'g', name: 'Project', repoIds: ['r'] }],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      agentInstallations: async () => {
        if ((window as any).checkFails) throw Error('Temporary failure');
        return [{ agent: 'codex', status: 'installed' }];
      },
    };
  });
  await page.setViewportSize({ width: 600, height: 650 });
  await page.goto('/');
  // Below 900px wide, the sidebar starts closed.
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  const status = getStarted(page).getByRole('status');
  await expect(status).toContainText('Could not check agents: Temporary failure');
  // The session opens with a draft only, so a failed check does not block it.
  await expect(page.getByRole('button', { name: 'Open first chat' })).toBeEnabled();
  await page.evaluate(() => ((window as any).checkFails = false));
  await page.getByRole('button', { name: 'Check again' }).click();
  // The check works and Codex is installed, so the line goes away.
  await expect(status).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Check again' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open first chat' })).toBeEnabled();
  await page.getByRole('button', { name: 'Set up later' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('project and repository setup return to the steps', async ({ page }) => {
  await page.goto('/');
  await openSetup(page);
  // The code folder step is done. The user can open it again to add a code folder.
  await page.getByRole('button', { name: /^Open a code folder/ }).click();
  await expect(getStarted(page).getByRole('heading', { name: 'Open a code folder' })).toBeVisible();
  // The folder of the first chat is in step 3. Step 2 adds a folder to that project.
  await page.getByRole('button', { name: 'Add code folder', exact: true }).click();
  // The demo has no GitHub CLI, so the dialog starts with a local folder.
  await expect(page.getByRole('dialog').last()).toContainText('Choose folder');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(getStarted(page).getByRole('heading', { name: 'Open a code folder' })).toBeVisible();
});

test('a missing agent check shows an error in the first message step', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    // A bridge without agentInstallations: the check fails.
    (window as any).workspace = {
      trackerProviders: async () => [],
      snapshot: async () => ({
        projects: [
          { id: 'r', name: 'Repo', path: '/tmp/repo', favorite: false, notes: '', addedAt: '' },
        ],
        groups: [{ id: 'g', name: 'Project', repoIds: ['r'] }],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
    };
  });
  await page.goto('/');
  await openSetup(page);
  const dialog = getStarted(page);
  await expect(dialog.getByRole('heading', { name: 'Say hello' })).toBeVisible();
  await expect(dialog.getByRole('status')).toContainText('Could not check agents');
  await expect(dialog.getByRole('button', { name: 'Check again' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('an empty overview has one action of each kind', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    (window as any).workspace = {
      trackerProviders: async () => [],
      snapshot: async () => ({
        projects: [],
        groups: [],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
    };
  });
  await page.goto('/');
  // Get started does not open by itself. The empty overview asks for a code folder.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // The empty overview opens a code folder or makes an empty project. Each action shows once.
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Open a code folder' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Open a folder…', exact: true })).toHaveCount(1);
  await expect(main.getByRole('button', { name: 'New empty project', exact: true })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('a true first run shows Welcome, signs in, and opens the empty workspace', async ({
  page,
}) => {
  await page.addInitScript(() => {
    // A desktop app at its first launch: no region, no account, no projects.
    const account = { region: undefined as string | undefined, signedIn: false };
    const firstRun = { welcomeDone: false, everSignedIn: false };
    let authorization: Record<string, string> | undefined;
    const listeners = new Set<() => void>();
    const changed = () => listeners.forEach((listener) => listener());
    const status = () => {
      if (!account.region)
        return { phase: 'error', error: 'desktop.region_required', executionReady: false };
      const apiUrl = `https://api.${account.region}.verdictan.com`;
      if (authorization)
        return {
          region: account.region,
          phase: 'authorizing',
          account: { state: 'authorizing', apiUrl },
          authorization,
          executionReady: false,
        };
      if (!account.signedIn)
        return {
          region: account.region,
          phase: 'signed-out',
          account: { state: 'signed-out', apiUrl },
          executionReady: false,
        };
      return {
        region: account.region,
        phase: 'authenticated',
        executionReady: false,
        account: {
          state: 'authenticated',
          userId: 'user',
          organizationId: 'organization',
          apiUrl,
          userName: 'Dana Kim',
          userEmail: 'dana.kim@acme.dev',
          organizationName: 'Acme Corp',
        },
      };
    };
    const runtime = { version: '0.6.9', releaseId: 'r', sha256: '0'.repeat(64) };
    (window as any).workspace = {
      trackerProviders: async () => [],
      snapshot: async () => ({
        projects: [],
        groups: [],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      agentInstallations: async () => [
        { agent: 'codex', status: 'installed', version: '0.161.0' },
        { agent: 'claude', status: 'installed', version: '2.1.306' },
      ],
      runtimeUpdateStatus: async () => ({
        hostId: 'local',
        component: 'verdictan',
        discovery: 'current',
        stale: false,
        history: [],
        latest: runtime,
        installed: runtime,
        running: runtime,
      }),
      firstRunState: async () => ({ ...firstRun }),
      setWelcomeDone: async () => {
        firstRun.welcomeDone = true;
        (window as any).welcomeDone = true;
        return { ...firstRun };
      },
      onVerdictanChanged: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      verdictanStatus: async () => status(),
      verdictanSetRegion: async (region: string) => {
        account.region = region;
        changed();
        return status();
      },
      verdictanAuthorize: (intent: string) => {
        const now = Date.now();
        authorization = {
          url: `https://console.${account.region}.verdictan.com/auth/cli?intent=${intent}`,
          intent,
          startedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 300_000).toISOString(),
        };
        changed();
        // The user finishes the sign-in in the browser a moment later.
        return new Promise((resolve) =>
          setTimeout(() => {
            authorization = undefined;
            account.signedIn = true;
            firstRun.everSignedIn = true;
            changed();
            resolve(status());
          }, 800),
        );
      },
      verdictanCancel: async () => {
        authorization = undefined;
        return status();
      },
      verdictanSetup: async () => ({
        status: 'ready',
        teams: [],
        policies: [],
        providerConnections: [],
        selections: {},
      }),
    };
  });
  await page.goto('/');
  // The Welcome screen fills the window. The workspace does not show behind it.
  await expect(page.getByRole('heading', { name: 'Welcome to Kalkidan' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Projects and repositories' })).toHaveCount(0);
  // The region is a menu in the card. The user chooses it before the sign-in.
  const region = page.getByRole('group', { name: 'Region' });
  await region.getByRole('button').click();
  await page.getByRole('menuitemradio', { name: /^European Union/ }).click();
  await expect(region).toContainText('European Union');
  await page.getByRole('button', { name: 'Sign in with Verdictan', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Finish signing in in your browser' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open browser again' })).toBeVisible();
  // After the sign-in, Welcome sets up the agents by itself and opens the workspace.
  await expect(page.getByRole('navigation', { name: 'Projects and repositories' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).welcomeDone)).toBe(true);
  // The empty workspace asks for a code folder. Get started does not open.
  await expect(
    page.getByRole('main').getByRole('heading', { name: 'Open a code folder' }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // The sidebar shows the signed-in account.
  await expect(page.locator('.account-menu[data-state="signed-in"]')).toContainText('Dana Kim');
});
