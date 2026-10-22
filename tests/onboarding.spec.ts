import { type Page } from '@playwright/test';
import { test, expect } from './helpers/app';

// The sidebar hides Get started after setup is complete. The search actions keep it.
async function openSetup(page: Page) {
  await page.getByRole('button', { name: 'Search or run a command', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search or run a command' }).fill('Get started');
  await page
    .getByRole('region', { name: 'Search results' })
    .getByRole('option', { name: /Get started/ })
    .click();
}

test('empty workspace starts onboarding once and can resume after dismissal', async ({ page }) => {
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
  await expect(page.getByRole('heading', { name: 'Set up your first chat' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Open a code folder…', exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Open first chat' })).toBeDisabled();
  // Step 2 opens only after a code folder.
  await expect(page.getByRole('button', { name: /^Write your first message/ })).toBeDisabled();
  // An empty project is the other way to start. Cancel returns to the checklist.
  await page.getByRole('button', { name: 'Start with an empty project', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Project name');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Set up your first chat' })).toBeVisible();
  await page.getByRole('button', { name: 'Set up later' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Get started', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Set up your first chat' })).toBeVisible();
});

test('existing workspace can prepare an editable first message without sending it', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openSetup(page);
  // Step 1 is done and shows the project of the setup.
  await expect(page.getByRole('button', { name: /^Choose your code folder/ })).toContainText(
    'Atlas',
  );
  // Step 2 opens at once, because the project has a code folder. It has a first draft.
  await expect(page.getByRole('heading', { name: 'Write your first message' })).toBeVisible();
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
  const status = page.getByRole('dialog').getByRole('status');
  await expect(status).toContainText('Temporary failure');
  // The session opens with a draft only, so a failed check does not block it.
  await expect(page.getByRole('button', { name: 'Open first chat' })).toBeEnabled();
  await page.evaluate(() => ((window as any).checkFails = false));
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(status).toContainText('Codex is installed');
  await expect(page.getByRole('button', { name: 'Check again' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Set up later' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('project and repository setup return to the checklist', async ({ page }) => {
  await page.goto('/');
  await openSetup(page);
  // The code folder step is done. The user can open it again to add a code folder.
  await page.getByRole('button', { name: /^Choose your code folder/ }).click();
  await expect(page.getByRole('heading', { name: 'Choose your code folder' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Setup project' })).toContainText('Atlas');
  await page.getByRole('button', { name: 'Add code folder', exact: true }).click();
  // The demo has no GitHub CLI, so the dialog starts with a local folder.
  await expect(page.getByRole('dialog').last()).toContainText('Choose folder');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Set up your first chat' })).toBeVisible();
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
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('status')).toContainText('Could not check agents');
  await expect(dialog.getByRole('button', { name: 'Check again' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('an empty overview has one action of each kind after Set up later', async ({ page }) => {
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
  await expect(page.getByRole('heading', { name: 'Set up your first chat' })).toBeVisible();
  await page.getByRole('button', { name: 'Set up later' }).click();
  // The empty overview opens a code folder or makes an empty project. Each action shows once.
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Open a code folder to start' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Open a code folder…', exact: true })).toHaveCount(
    1,
  );
  await expect(main.getByRole('button', { name: 'New empty project', exact: true })).toHaveCount(1);
  await expect(main.getByRole('button', { name: 'New project', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a true first run shows Welcome, signs in, and continues in onboarding', async ({ page }) => {
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
  await page.getByRole('button', { name: /^(Change the region|Choose a region)$/ }).click();
  await expect(page.getByRole('heading', { name: 'Where is your organization?' })).toBeVisible();
  await page.getByRole('radio', { name: /European Union/ }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Region' })).toContainText('European Union');
  await page.getByRole('button', { name: 'Continue with Verdictan', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Finish signing in in your browser' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open browser again' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Setting up Kalkidan' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Setup steps' })).toContainText(
    'Signed in to Acme Corp',
  );
  await page.getByRole('button', { name: 'Choose a code folder', exact: true }).click();
  expect(await page.evaluate(() => (window as any).welcomeDone)).toBe(true);
  // Onboarding continues at the code folder step, in the workspace.
  await expect(page.getByRole('heading', { name: 'Set up your first chat' })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Choose your code folder');
  // The sidebar behind the dialog shows the signed-in account.
  await expect(page.locator('.account-menu[data-state="signed-in"]')).toContainText('Dana Kim');
});
