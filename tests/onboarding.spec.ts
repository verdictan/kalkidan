import { type Page } from '@playwright/test';
import { test, expect } from './helpers/app';

/** The search field of the command palette, open. */
async function search(page: Page, text: string) {
  await page.getByRole('button', { name: 'Search or run a command', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search or run a command' }).fill(text);
}

/** A workspace without projects. */
async function emptyWorkspace(page: Page) {
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
}

test('an empty workspace asks for a first project, and there is no Get started', async ({
  page,
}) => {
  await emptyWorkspace(page);
  // No dialog opens by itself. The empty state asks for a first project in one line of text.
  const main = page.getByRole('main');
  await expect(main.getByText('No projects yet.')).toBeVisible();
  await expect(main.getByRole('heading', { name: /No projects yet/ })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Get started is gone: there is no sidebar row and no search entry. Welcome does the setup.
  await expect(page.getByRole('button', { name: 'Get started', exact: true })).toHaveCount(0);
  await search(page, 'Get started');
  await expect(page.getByRole('option', { name: 'Get started', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(main.getByText('No projects yet.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('an empty overview has one action of each kind', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await emptyWorkspace(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // The empty Projects page opens a folder, and its header makes a new project. Each action
  // shows once. There is no "New empty project".
  const main = page.getByRole('main');
  await expect(main.getByText('No projects yet.')).toBeVisible();
  await expect(main.getByRole('button', { name: 'Open a folder…', exact: true })).toHaveCount(1);
  await expect(main.getByRole('button', { name: 'New project', exact: true })).toHaveCount(1);
  await expect(main.getByRole('button', { name: 'New empty project', exact: true })).toHaveCount(0);
  // All chats and Waiting show only when a project exists.
  const nav = page.getByRole('navigation', { name: 'Projects and repositories' });
  await expect(nav.getByRole('button', { name: 'All chats', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: /^Waiting/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

/**
 * A desktop app at its first launch: no region, no account, no projects. The folder picker
 * returns /Users/dana/code, which has two Git repositories. The project that Welcome makes is
 * in the next snapshot.
 */
async function firstRun(page: Page) {
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
    const groups: any[] = [];
    const projects: any[] = [];
    const repositories = [
      { path: '/Users/dana/code/web', name: 'web', branch: 'main', added: false },
      { path: '/Users/dana/code/api', name: 'api', branch: 'main', added: false },
    ];
    (window as any).created = [];
    (window as any).workspace = {
      trackerProviders: async () => [],
      snapshot: async () => ({
        projects: [...projects],
        groups: groups.map((group) => ({ ...group })),
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      chooseFolder: async () => '/Users/dana/code',
      scanRepositories: async (root: string) => ({
        root,
        rootIsRepository: false,
        repositories,
      }),
      createGroup: async (
        name: string,
        _url: string,
        _hostId: unknown,
        _source: unknown,
        _board: unknown,
        _operationId: string,
        paths: string[],
      ) => {
        (window as any).created.push({ name, paths });
        const repoIds = paths.map((path) => 'r-' + path.split('/').pop());
        for (const path of paths)
          projects.push({
            id: 'r-' + path.split('/').pop(),
            name: path.split('/').pop(),
            path,
            favorite: false,
            notes: '',
            addedAt: '',
          });
        groups.push({ id: 'g', name, repoIds });
        return 'g';
      },
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
}

const welcome = (page: Page) => page.getByRole('region', { name: 'Welcome to Kalkidan' });

test('a true first run signs in, chooses a folder, and starts in the new project', async ({
  page,
}) => {
  await firstRun(page);
  // The Welcome card fills the window. The workspace does not show behind it.
  await expect(welcome(page)).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Projects and repositories' })).toHaveCount(0);
  // Step 2 waits for step 1. It has no buttons yet.
  await expect(welcome(page).getByRole('button', { name: 'Choose folder…' })).toHaveCount(0);
  // The region is a menu in the card. The user chooses it before the sign-in.
  const region = page.getByRole('button', { name: /^Region: / });
  await region.click();
  await page.getByRole('menuitemradio', { name: /^European Union/ }).click();
  await expect(region).toHaveAccessibleName('Region: European Union');
  await page.getByRole('button', { name: 'Sign in with Verdictan', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Finish signing in in your browser' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open browser again' })).toBeVisible();
  // After the sign-in, step 1 shows the account and step 2 asks for a code folder.
  await expect(welcome(page)).toContainText('Dana Kim');
  await expect(welcome(page)).toContainText('Acme Corp · European Union');
  await welcome(page).getByRole('button', { name: 'Choose folder…' }).click();
  // The card lists the Git repositories in the folder, all checked.
  const list = welcome(page).getByRole('list', { name: 'Git repositories' });
  await expect(list.getByRole('checkbox')).toHaveCount(2);
  await expect(list.getByRole('checkbox', { checked: true })).toHaveCount(2);
  await expect(welcome(page)).toContainText('~/code · 2 Git repositories');
  await list.getByRole('checkbox').nth(1).uncheck();
  await welcome(page).getByRole('button', { name: 'Start in code', exact: true }).click();
  // "Start in code" makes the project with the checked repositories and opens it.
  await expect(page.getByRole('navigation', { name: 'Projects and repositories' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).created)).toEqual([
    { name: 'code', paths: ['/Users/dana/code/web'] },
  ]);
  expect(await page.evaluate(() => (window as any).welcomeDone)).toBe(true);
  await expect(page.locator('.project-header').getByRole('heading')).toHaveText('code');
  // The Overview opens on its composer. No dialog opens, and the message is empty: Kalkidan
  // does not write a first prompt.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('main').getByRole('textbox', { name: 'Message for a new chat' }),
  ).toHaveValue('');
  // The sidebar shows the signed-in account.
  await expect(page.locator('.account-menu[data-state="signed-in"]')).toContainText('Dana Kim');
});

test('Later skips each step, and a short window keeps the Welcome actions reachable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 600, height: 650 });
  await firstRun(page);
  await expect(welcome(page)).toBeVisible();
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  expect(await fits()).toBe(true);
  // Step 1: Later skips the sign-in. Step 1 then offers the sign-in again.
  await welcome(page).getByRole('button', { name: 'Later', exact: true }).click();
  await expect(welcome(page)).toContainText('Not signed in');
  await expect(welcome(page).getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  // Step 2: the folder actions are in the window.
  const choose = welcome(page).getByRole('button', { name: 'Choose folder…' });
  await expect(choose).toBeInViewport();
  expect(await fits()).toBe(true);
  // Later skips the folder too and opens the empty workspace.
  await welcome(page).getByRole('button', { name: 'Later', exact: true }).click();
  await expect(welcome(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).welcomeDone)).toBe(true);
  await expect(page.getByRole('main').getByText('No projects yet.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).created)).toEqual([]);
});
