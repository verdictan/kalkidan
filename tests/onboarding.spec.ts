import { type Page } from '@playwright/test';
import { test, expect } from './helpers/app';
import { openNewProject } from './helpers/navigation';

/** The search field of the command palette, open. */
async function search(page: Page, text: string) {
  // Before the first project there is no sidebar, so ⌘K opens the palette.
  await page.keyboard.press('ControlOrMeta+KeyK');
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
    };
  });
  await page.goto('/');
}

test('an empty workspace opens the composer, and there is no Get started', async ({ page }) => {
  await emptyWorkspace(page);
  // No dialog opens by itself. The first window is the composer of a new chat.
  const main = page.getByRole('main');
  const composer = main.getByRole('textbox', { name: 'Message for a new chat' });
  await expect(composer).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Get started is gone: there is no sidebar row and no search entry.
  await expect(page.getByRole('button', { name: 'Get started', exact: true })).toHaveCount(0);
  await search(page, 'Get started');
  await expect(page.getByRole('option', { name: 'Get started', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(composer).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('an empty workspace has one action of each kind', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await emptyWorkspace(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // The composer chooses a folder. Before the first project there is no sidebar (ST-C2):
  // New project is ⇧⌘N and ⌘K. There is no "New empty project".
  const main = page.getByRole('main');
  const nav = page.getByRole('navigation', { name: 'Projects and repositories' });
  await expect(main.getByRole('button', { name: 'Choose a folder', exact: true })).toHaveCount(1);
  await expect(nav).toBeHidden();
  await expect(page.getByRole('button', { name: 'Toggle sidebar', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New empty project', exact: true })).toHaveCount(0);
  await openNewProject(page);
  await expect(page.getByRole('dialog', { name: 'New project', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

/** One tool of a computer, as the tool detection of the desktop reports it. */
function tool(id: string, name: string, version?: string) {
  return {
    tool: id,
    name,
    kind: id === 'gh' ? 'github' : 'agent',
    state: version ? 'ready' : 'missing',
    installed: !!version,
    ...(version ? { version, path: `/opt/homebrew/bin/${id}` } : {}),
    signedIn: version ? 'yes' : 'unknown',
    access: version ? 'granted' : 'unknown',
    usable: id !== 'gh' && !!version,
    installUrl: {
      codex: 'https://github.com/openai/codex',
      claude: 'https://docs.anthropic.com/claude-code',
      gh: 'https://cli.github.com',
    }[id],
  };
}

/**
 * A desktop app at its first launch: no account and no projects. `versions` gives the version
 * of each tool that Kalkidan finds on this Mac. A tool with no version is not installed.
 */
async function firstRun(page: Page, versions: { codex?: string; claude?: string; gh?: string }) {
  await page.addInitScript(
    (tools) => {
      const w = window as any;
      w.welcomeDone = false;
      w.restarts = 0;
      w.workspace = {
        trackerProviders: async () => [],
        snapshot: async () => ({
          projects: [],
          groups: [],
          sessions: [],
          warnings: [],
          platform: 'darwin',
        }),
        firstRunState: async () => ({ welcomeDone: w.welcomeDone, everSignedIn: false }),
        setWelcomeDone: async () => {
          w.welcomeDone = true;
          return { welcomeDone: true, everSignedIn: false };
        },
        verdictanStatus: async () => ({
          region: 'eu',
          phase: 'signed-out',
          account: { state: 'signed-out', apiUrl: 'https://api.eu.verdictan.com' },
          executionReady: false,
        }),
        computerTools: async () => [
          {
            computer: 'local',
            name: 'This Mac',
            connected: true,
            checkedAt: new Date().toISOString(),
            tools,
          },
        ],
        restartApp: async () => {
          w.restarts++;
        },
      };
    },
    [
      tool('codex', 'Codex', versions.codex),
      tool('claude', 'Claude Code', versions.claude),
      tool('gh', 'GitHub CLI', versions.gh),
    ],
  );
  await page.goto('/');
}

const toolsCheck = (page: Page) => page.getByTestId('welcome');

test('a first run with a missing tool shows the tools check, then the composer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 600, height: 650 });
  await firstRun(page, { claude: '2.1.306', gh: '2.62.0' });
  // "Your tools" lists the tools of this Mac. It asks for no sign-in and no folder.
  await expect(toolsCheck(page).getByRole('heading', { name: 'Your tools' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Projects and repositories' })).toHaveCount(0);
  const rows = toolsCheck(page).getByRole('list', { name: 'Your tools' }).getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: 'Claude Code' }).getByRole('img')).toHaveAccessibleName(
    'Ready',
  );
  // A missing tool links to its official page. Kalkidan does not install it.
  const codex = rows.filter({ hasText: 'Codex' });
  await expect(codex.getByRole('img')).toHaveAccessibleName('Needs you');
  await expect(codex.getByRole('link')).toHaveAttribute('href', 'https://github.com/openai/codex');
  await expect(toolsCheck(page)).toContainText('Installed something? Restart Kalkidan to find it.');
  await expect(toolsCheck(page).getByRole('button', { name: /Sign in/ })).toHaveCount(0);
  // The actions stay in a short window, with no horizontal scroll.
  const go = toolsCheck(page).getByRole('button', { name: 'Continue with Claude Code' });
  await expect(go).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Restart finds the tools that the user installed.
  await toolsCheck(page).getByRole('button', { name: 'Restart Kalkidan', exact: true }).click();
  expect(await page.evaluate(() => (window as any).restarts)).toBe(1);
  // Continue ends the first run and opens the composer.
  await go.click();
  await expect(toolsCheck(page)).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message for a new chat' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).welcomeDone)).toBe(true);
});

test('a first run with every tool found goes straight to the composer', async ({ page }) => {
  await firstRun(page, { codex: '0.163.0', claude: '2.1.306', gh: '2.62.0' });
  await expect(page.getByRole('textbox', { name: 'Message for a new chat' })).toBeVisible();
  await expect(toolsCheck(page)).toHaveCount(0);
  // The first run ends here, so the tools check never shows.
  await expect.poll(() => page.evaluate(() => (window as any).welcomeDone)).toBe(true);
});

test('a first run with no agent offers only Restart Kalkidan', async ({ page }) => {
  await firstRun(page, { gh: '2.62.0' });
  await expect(toolsCheck(page).getByRole('heading', { name: 'Your tools' })).toBeVisible();
  await expect(toolsCheck(page).getByRole('button')).toHaveCount(1);
  await toolsCheck(page).getByRole('button', { name: 'Restart Kalkidan', exact: true }).click();
  expect(await page.evaluate(() => (window as any).restarts)).toBe(1);
  expect(await page.evaluate(() => (window as any).welcomeDone)).toBe(false);
});
