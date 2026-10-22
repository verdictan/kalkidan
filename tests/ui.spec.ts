import type { Page } from '@playwright/test';
import { test, expect, newChat, openSettings, settingsDialog } from './helpers/app';
import { openCodeFolder, openAddCodeFolders, openProjectTab } from './helpers/navigation';
/** The Project settings dialog. Its name includes the project name. */
const projectSettings = (page: Page) => page.getByRole('dialog', { name: /^Project settings: / });

/** Opens Project settings › Board from the Project actions menu of the project header. */
async function openBoardSection(page: Page) {
  await page.getByRole('button', { name: 'Project actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Project settings…', exact: true }).click();
  const settings = projectSettings(page);
  await settings.getByRole('tab', { name: 'Board', exact: true }).click();
  await expect(settings.getByRole('tab', { name: 'Board', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
}

/** Opens the Tasks tab of a project and selects "Connect a board". */
async function openConnectBoard(page: Page, project: string) {
  await openProjectTab(page, 'Tasks', project);
  await page.getByRole('button', { name: 'Connect a board', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Connect a GitHub Projects board', exact: true }),
  ).toBeVisible();
}

/** Checks that the Tasks tab shows the connected board. The Board actions menu names it. */
async function expectConnectedBoard(page: Page, title: string) {
  await expect(page.getByRole('region', { name: 'Tracker board', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Board actions', exact: true }).click();
  await expect(page.getByRole('menu', { name: 'Board actions', exact: true })).toContainText(title);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
}

test('project navigation, search, editing, worktrees, and sessions', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await openCodeFolder(page);
  await expect(page.getByRole('heading', { name: 'atlas-web', exact: true })).toBeVisible();

  // The main folder shows first, without its chats. The chats have their own section, and
  // "Branch copies" shows only when the folder has one or more.
  await expect(page.getByText('Main folder · main', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Code folder chats' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Repository branch copies' })).toHaveCount(0);
  await expect(page.locator('.repository-overview').getByRole('tablist')).toHaveCount(0);
  await expect(page.locator('.project-status')).toHaveCount(0);
  await expect(page.getByText(/Give each agent its own worktree/)).toHaveCount(0);
  await expect(page.locator('.worktree-sessions').getByRole('button')).toHaveCount(0);
  // Refresh and New branch copy are in the Repository actions menu.
  await page.getByRole('button', { name: 'Repository actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Refresh branch copies', exact: true }).click();
  await expect(page.getByText('Main folder · main', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Repository actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New branch copy…', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await expect(page.getByText('Refine project and repository navigation').last()).toBeVisible();
  await page.getByRole('button', { name: 'Repository actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit code folder…', exact: true }).click();
  await page.getByLabel('Repository name', { exact: true }).fill('atlas-renamed');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: 'atlas-renamed' })).toBeVisible();
  await page.getByRole('button', { name: 'Search or run a command', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search or run a command' }).fill('not-a-project');
  await expect(page.getByText('No matches found.')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.screenshot({ path: 'test-results/desktop-preview.png', fullPage: true });
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('combobox', { name: 'Search or run a command' })).toBeFocused();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 980, height: 680 });
  // The code folder page keeps its New chat split button in a compact window.
  await expect(
    page.getByRole('main').getByRole('group', { name: 'New chat' }).getByRole('button', {
      name: 'New chat',
      exact: true,
    }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/compact-preview.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('organize sessions and continue inside the conversation UI', async ({ page }) => {
  await page.goto('/');
  await openCodeFolder(page);
  const list = page.locator('.session-list');

  await list
    .getByRole('button', { name: 'Refine project and repository navigation actions' })
    .click();
  await page.getByRole('menuitem', { name: 'Rename…', exact: true }).click();
  await page.getByLabel('Session name', { exact: true }).fill('Navigation follow-up');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await list.getByRole('button', { name: 'Navigation follow-up actions' }).click();
  // Notes is at the top level of the chat row menu.
  await page.getByRole('menuitem', { name: 'Notes…', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Notes', exact: true })
    .fill('Finish keyboard navigation');
  await page.getByRole('button', { name: 'Save notes', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await list.getByRole('button', { name: 'Navigation follow-up actions' }).click();
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
  await page.getByRole('button', { name: 'Pinned', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Resume Navigation follow-up', exact: true }),
  ).toBeVisible();
  await expect(
    list.getByText('Review the authentication flow and add integration tests', { exact: true }),
  ).not.toBeVisible();
  // The row shows the note. The list has no groups.
  await expect(list.getByTitle('Finish keyboard navigation', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Filter by group' })).toHaveCount(0);
  await list
    .getByRole('button', { name: /^Resume / })
    .first()
    .click();
  await expect(page.getByRole('region', { name: 'Chats', exact: true })).toBeVisible();
  await expect(page.getByText('This is a sample conversation.', { exact: false })).toBeVisible();
  // The chat header shows the note of the chat.
  await expect(
    page.getByRole('button', { name: 'Notes: Finish keyboard navigation', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Message agent').fill('Continue with keyboard navigation');
  await page.screenshot({
    path: 'test-results/conversation-preview.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Open the desktop app');
  // The refused message shows in the transcript with "Try again". It leaves the composer.
  await expect(
    page.locator('.chat-message.user').filter({ hasText: 'Continue with keyboard navigation' }),
  ).toHaveCount(1);
  await expect(page.getByLabel('Message agent')).toHaveValue('');
  await openCodeFolder(page, 'atlas-web');
  await list.getByRole('button', { name: 'Navigation follow-up actions' }).click();
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
  await expect(page.getByText('No pinned chats', { exact: true })).toBeVisible();
  await page
    .getByRole('status')
    .filter({ hasText: 'Chat archived' })
    .getByRole('button', { name: 'View archived' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Resume Navigation follow-up', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Restore Navigation follow-up', exact: true }).click();
  await page.getByRole('button', { name: 'Active', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Resume Navigation follow-up', exact: true }),
  ).toBeVisible();
});

test('conversation streams responses, keeps multiple turns, and stops without leaving the app', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let run: any;
    let count = 0;
    let polls = 0;
    const session = {
      id: 'session-1',
      agent: 'codex',
      title: 'Live fixture',
      cwd: '/tmp/project',
      updatedAt: new Date().toISOString(),
    };
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [
          {
            id: 'p1',
            name: 'My project',
            path: '/tmp/project',
            favorite: false,
            notes: '',
            addedAt: '',
          },
        ],
        groups: [{ id: 'g1', name: 'Test project', repoIds: ['p1'] }],
        sessions: [session, { ...session, id: 'session-2', title: 'Another fixture' }],
        warnings: [],
        platform: 'darwin',
      }),
      git: async () => null,
      transcript: async () => ({
        messages: [{ id: 'old', role: 'user', text: 'Original prompt' }],
        truncated: false,
      }),
      chatStart: async (_agent: string, _id: string, prompt: string) => {
        polls = 0;
        run = {
          id: 'run-' + ++count,
          agent: 'codex',
          sessionId: 'session-1',
          status: 'running',
          messages: [],
          activity: 'Working',
          prompt,
        };
        return { ...run };
      },
      chatStatus: async () => {
        polls++;
        run.messages = [
          {
            id: 'item-0',
            role: 'assistant',
            text: polls < 2 ? 'Working on it' : 'Completed: ' + run.prompt,
          },
        ];
        if (polls > 2 && run.prompt !== 'Long task' && run.status !== 'stopped')
          run.status = 'completed';
        return { ...run };
      },
      chatStop: async () => {
        run.status = 'stopped';
      },
    };
  });
  await page.goto('/');
  await openCodeFolder(page);

  await page
    .locator('.session-list')
    .getByRole('button', { name: /^Resume / })
    .first()
    .click();
  await expect(page.getByText('Original prompt', { exact: true })).toBeVisible();
  await page.getByLabel('Message agent').fill('First follow-up');
  await page.getByLabel('Message agent').press('Shift+Enter');
  await expect(page.getByLabel('Message agent')).toHaveValue('First follow-up\n');
  await page.getByLabel('Message agent').press('Enter');
  await expect(page.getByText('Completed: First follow-up', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  await page.getByLabel('Message agent').fill('Second follow-up');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Completed: Second follow-up', { exact: true })).toBeVisible();
  await expect(page.getByText('Completed: First follow-up', { exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  await page.getByLabel('Message agent').fill('Long task');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  // Sessions open from the code folder page.
  await openCodeFolder(page, 'My project');
  await page.getByRole('button', { name: 'Resume Another fixture', exact: true }).click();
  await expect(page.locator('.agent-tabbar')).toHaveCount(0);
  await openCodeFolder(page, 'My project');
  await page.getByRole('button', { name: 'Resume Live fixture', exact: true }).click();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByText('Response stopped. Send another message to continue.')).toBeVisible();
});

test('a session ownership conflict shows the unsent message and permits an explicit retry', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let attempts = 0;
    let run: any;
    const session = {
      id: 'locked-session',
      agent: 'codex',
      title: 'Locked session',
      cwd: '/tmp/project',
      updatedAt: new Date().toISOString(),
    };
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [
          {
            id: 'p1',
            name: 'My project',
            path: '/tmp/project',
            favorite: false,
            notes: '',
            addedAt: '',
          },
        ],
        groups: [{ id: 'g1', name: 'Test project', repoIds: ['p1'] }],
        sessions: [session],
        warnings: [],
        platform: 'darwin',
      }),
      git: async () => null,
      transcript: async () => ({ messages: [], truncated: false }),
      chatStart: async () => {
        run = {
          id: 'run-' + ++attempts,
          agent: 'codex',
          sessionId: session.id,
          status: 'running',
          messages: [],
          activity: 'Starting',
        };
        return { ...run };
      },
      chatStatus: async () =>
        attempts === 1
          ? {
              ...run,
              status: 'failed',
              errorCode: 'session_busy',
              error: 'This Codex session is already open in another client.',
            }
          : {
              ...run,
              status: 'completed',
              messages: [{ id: 'answer', role: 'assistant', text: 'Resumed successfully' }],
            },
    };
  });
  await page.goto('/');
  await openCodeFolder(page);

  await page
    .locator('.session-list')
    .getByRole('button', { name: /^Resume / })
    .first()
    .click();
  await page.getByLabel('Message agent').fill('Keep my follow-up');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('another window');
  // The failed message shows once, with its error under it. It is not in the composer too.
  await expect(page.locator('.chat-message.user')).toHaveCount(1);
  await expect(page.locator('.chat-message.user')).toContainText('Keep my follow-up');
  await expect(page.locator('.chat-message.user').getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Message agent')).toHaveValue('');
  // "Try again" sends the same message again and replaces the failed one.
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('Resumed successfully', { exact: true })).toBeVisible();
  await expect(page.locator('.chat-message.user')).toHaveCount(1);
});

test('integrated conversations keep drafts and project navigation visible', async ({ page }) => {
  await page.goto('/');
  await openCodeFolder(page);

  await page
    .locator('.session-list')
    .getByRole('button', { name: /^Resume / })
    .first()
    .click();
  const workspace = page.getByRole('region', { name: 'Chats', exact: true });
  const pane = page.locator('.agent-pane:not([hidden])');
  await expect(workspace).toBeVisible();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await pane.getByLabel('Message agent').fill('Keep this Codex draft');
  await openCodeFolder(page, 'atlas-web');
  await page
    .getByRole('button', {
      name: 'Resume Review the authentication flow and add integration tests',
      exact: true,
    })
    .click();
  await pane.getByLabel('Message agent').fill('Keep this Claude draft');
  await openCodeFolder(page, 'atlas-web');
  await page
    .getByRole('button', { name: 'Resume Refine project and repository navigation', exact: true })
    .click();
  await expect(pane.getByLabel('Message agent')).toHaveValue('Keep this Codex draft');
  await expect(pane.getByRole('region', { name: 'Chat details', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Pin/ }).click();
  await expect(
    page
      .getByRole('navigation', { name: 'Projects and repositories' })
      .getByRole('button', { name: 'Resume pinned Refine project and repository navigation' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Unpin/ }).click();
  await expect(
    page
      .getByRole('navigation', { name: 'Projects and repositories' })
      .getByRole('button', { name: 'Resume pinned Refine project and repository navigation' }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 961, height: 988 });
  await expect(pane.getByRole('button', { name: 'Send', exact: true })).toBeInViewport();
  await page.screenshot({
    path: 'test-results/agent-workspace.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 980, height: 680 });
  await expect(pane.getByRole('button', { name: 'Send', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  // Below 900 px the sidebar starts closed.
  await page.setViewportSize({ width: 860, height: 680 });
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('combobox', { name: 'Search or run a command' })).toBeFocused();
  await page.keyboard.press('Escape');
  // The narrow window hides the sidebar. The palette does not change the sidebar.
  await expect(
    page.getByRole('navigation', { name: 'Projects and repositories' }),
  ).not.toBeVisible();
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Projects and repositories' })).toBeVisible();
  // The breadcrumb goes back to the project.
  await page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('button', { name: 'Atlas project', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Atlas', level: 1 })).toBeVisible();
  await openProjectTab(page, 'Tasks');
  await expect(page.getByRole('button', { name: 'Connect a board', exact: true })).toBeVisible();
  await openCodeFolder(page, 'atlas-web');
  await page
    .getByRole('button', { name: 'Resume Refine project and repository navigation', exact: true })
    .click();
  await expect(pane.getByLabel('Message agent')).toHaveValue('Keep this Codex draft');
});

for (const agent of ['codex', 'claude'] as const) {
  test(`${agent} project button creates an in-app session and resumes its next turn`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      let run: any;
      (window as any).calls = [];
      (window as any).workspace = {
        snapshot: async () => ({
          projects: [
            {
              id: 'p1',
              name: 'My project',
              path: '/tmp/project',
              favorite: false,
              notes: '',
              addedAt: '',
            },
          ],
          groups: [{ id: 'g1', name: 'Test project', repoIds: ['p1'] }],
          sessions: [],
          warnings: [],
          platform: 'darwin',
        }),
        git: async () => null,
        launch: async () => {
          throw new Error('Agent launch must not open Terminal');
        },
        chatCreate: async (projectId: string, agent: string, prompt: string) => {
          (window as any).calls.push({ kind: 'create', projectId, agent, prompt });
          run = {
            id: 'r1',
            agent,
            sessionId: 'provider-session',
            status: 'running',
            messages: [],
            activity: '',
          };
          return { ...run };
        },
        chatStart: async (agent: string, sessionId: string, prompt: string) => {
          (window as any).calls.push({ kind: 'resume', agent, sessionId, prompt });
          run = { id: 'r2', agent, sessionId, status: 'running', messages: [], activity: '' };
          return { ...run };
        },
        chatStatus: async () => ({
          ...run,
          sessionReady: true,
          status: 'completed',
          messages: [{ id: 'answer', role: 'assistant', text: 'Reply for ' + run.id }],
        }),
      };
    });
    await page.goto('/');
    await openCodeFolder(page);
    // The split button starts Codex by default. Other agents are in its menu.
    await newChat(page, agent);
    await expect(page.getByRole('region', { name: 'Chats', exact: true })).toBeVisible();
    await page.getByLabel('Message agent').fill('Build the first feature');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Reply for r1', { exact: true })).toBeVisible();
    await page.getByLabel('Message agent').fill('Now add tests');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Reply for r2', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).calls)).toEqual([
      { kind: 'create', projectId: 'p1', agent, prompt: 'Build the first feature' },
      { kind: 'resume', agent, sessionId: 'provider-session', prompt: 'Now add tests' },
    ]);
  });
}

for (const agent of ['codex', 'claude'] as const) {
  test(`${agent} history title resumes the saved session in Kalkidan`, async ({ page }) => {
    await page.addInitScript(
      ({ agent }) => {
        const session = {
          id: 'saved-session',
          agent,
          cwd: '/tmp/project',
          title: 'Saved conversation',
          updatedAt: new Date().toISOString(),
        };
        let run: any;
        (window as any).resumes = [];
        (window as any).workspace = {
          snapshot: async () => ({
            projects: [
              {
                id: 'p1',
                name: 'My project',
                path: '/tmp/project',
                favorite: false,
                notes: '',
                addedAt: '',
              },
            ],
            groups: [{ id: 'g1', name: 'Test project', repoIds: ['p1'] }],
            sessions: [session],
            warnings: [],
            platform: 'darwin',
          }),
          git: async () => null,
          transcript: async () => ({
            messages: [{ id: 'old', role: 'assistant', text: 'Previous conversation context' }],
            truncated: false,
          }),
          launch: async () => {
            throw new Error('Terminal must not open');
          },
          chatStart: async (agent: string, sessionId: string, prompt: string) => {
            (window as any).resumes.push({ agent, sessionId, prompt });
            run = {
              id: 'response',
              agent,
              sessionId,
              status: 'running',
              messages: [],
              activity: '',
            };
            return { ...run };
          },
          chatStatus: async () => ({
            ...run,
            status: 'completed',
            messages: [{ id: 'new', role: 'assistant', text: 'Continued in Kalkidan' }],
          }),
        };
      },
      { agent },
    );
    await page.goto('/');
    await openCodeFolder(page);

    await page.getByRole('button', { name: 'Resume Saved conversation', exact: true }).click();
    await expect(page.getByText('Previous conversation context', { exact: true })).toBeVisible();
    await page.getByLabel('Message agent').fill('Continue where we left off');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Continued in Kalkidan', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).resumes)).toEqual([
      { agent, sessionId: 'saved-session', prompt: 'Continue where we left off' },
    ]);
  });
}

test('projects group multiple repositories and each repository opens its own sessions', async ({
  page,
}) => {
  await page.goto('/');
  const tree = page.getByRole('navigation', { name: 'Projects and repositories' });
  await expect(tree.getByText('Atlas', { exact: true })).toBeVisible();
  // The sidebar shows projects and their chats. Code folders open from the project overview.
  await expect(tree.getByRole('button', { name: 'atlas-web', exact: true })).toHaveCount(0);
  await openCodeFolder(page, 'api-service');
  await expect(page.getByRole('heading', { name: 'api-service', exact: true })).toBeVisible();
  await tree.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill('Infrastructure');
  await page.getByRole('button', { name: 'More options', exact: true }).click();
  await page.getByRole('button', { name: 'Connect now', exact: true }).click();
  await page.getByRole('button', { name: 'Atlas roadmap #1', exact: true }).click();
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await openCodeFolder(page, 'api-service');
  await page.getByRole('button', { name: 'Repository actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit code folder…', exact: true }).click();
  await page.getByRole('combobox', { name: 'Project', exact: true }).click();
  await page.getByRole('option', { name: 'Infrastructure', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await tree.getByRole('button', { name: 'Infrastructure', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Code folders' }).getByText('api-service', { exact: true }),
  ).toBeVisible();
  await openCodeFolder(page, 'atlas-web');
  await page
    .getByRole('button', { name: 'Resume Refine project and repository navigation', exact: true })
    .click();
  await expect(page.getByRole('region', { name: 'Chats', exact: true })).toBeVisible();
  await expect(page.getByText('Atlas / atlas-web', { exact: true })).toHaveCount(0);
});

test('GitHub task status, repository choice, and composer model carry through to an agent turn', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const project = {
      id: 'gh1',
      title: 'Roadmap',
      url: 'https://github.com/orgs/example/projects/1',
      owner: 'example',
      number: 1,
    };
    let statusId = 'todo';
    let run: any;
    (window as any).requests = [];
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [
          { id: 'web', name: 'Web', path: '/tmp/web', favorite: false, notes: '', addedAt: '' },
          { id: 'api', name: 'API', path: '/tmp/api', favorite: false, notes: '', addedAt: '' },
        ],
        groups: [{ id: 'platform', name: 'Platform', repoIds: ['web', 'api'], github: project }],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      git: async () => null,
      models: async () => [{ id: 'opus', name: 'Opus' }],
      githubAuthCancel: async () => ({ status: 'idle' }),
      githubBoard: async () => ({
        project,
        statusField: {
          id: 'status',
          options: [
            { id: 'todo', name: 'Todo' },
            { id: 'done', name: 'Done' },
          ],
        },
        items: [
          {
            id: 'item1',
            title: 'Fix login',
            body: 'Handle expired cookies',
            statusId,
            status: statusId === 'done' ? 'Done' : 'Todo',
          },
        ],
      }),
      githubStatus: async (groupId: string, item: string, option: string) => {
        statusId = option;
        (window as any).requests.push({ groupId, item, option });
      },
      chatCreate: async (
        repoId: string,
        agent: string,
        prompt: string,
        _edits: boolean,
        options: any,
      ) => {
        (window as any).requests.push({ repoId, agent, prompt, options });
        run = {
          id: 'r1',
          sessionId: 'saved',
          sessionReady: true,
          agent,
          status: 'running',
          messages: [],
          activity: '',
        };
        return { ...run };
      },
      chatStatus: async () => ({
        ...run,
        status: 'completed',
        messages: [{ id: 'a', role: 'assistant', text: 'Task context received' }],
      }),
      updateSession: async () => {},
    };
  });
  await page.goto('/');
  // The project row opens the overview. The Tasks row opens the board.
  await openProjectTab(page, 'Tasks');
  // The task menu of a card has "Move to" with the status options.
  await page.getByRole('button', { name: 'Task menu: Fix login' }).click();
  await page.getByRole('menuitem', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Done column' })).toContainText('Fix login');
  await page.screenshot({ path: 'test-results/github-project.png', fullPage: true });
  await page.getByRole('button', { name: 'Fix login', exact: true }).click();
  // "Change" in the task sheet shows where the chat works: the code folder and the branch.
  const sheet = page.getByRole('dialog', { name: 'Fix login', exact: true });
  await sheet.getByRole('button', { name: 'Change', exact: true }).click();
  await sheet
    .getByRole('group', { name: 'Code folder', exact: true })
    .getByRole('radio', { name: 'API', exact: true })
    .check();
  // The fixture has no Git status, so the chat works in the folder itself, not a branch copy.
  await sheet.getByRole('radio', { name: 'Work in the folder instead', exact: true }).check();
  // The Start task split button starts the preferred agent. Its menu starts another agent.
  await sheet.getByRole('button', { name: 'Choose an agent', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Start with Claude Code', exact: true }).click();
  await expect(page.getByLabel('Message agent')).toHaveValue(/Fix login/);
  // The model chip is next to the mode chip. The composer has no More options menu.
  await expect(page.getByRole('button', { name: 'More options', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /^Agent and model: Claude Code · / }).click();
  await page.getByRole('menuitemradio', { name: 'Opus', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Agent and model: Claude Code · Opus', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Message agent').fill('Plan the fix');
  await page.screenshot({
    path: 'test-results/composer-model.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Task context received', { exact: true })).toBeVisible();
  const requests = await page.evaluate(() => (window as any).requests);
  expect(requests[0]).toEqual({ groupId: 'platform', item: 'item1', option: 'done' });
  expect(requests[1]).toMatchObject({
    repoId: 'api',
    agent: 'claude',
    prompt: 'Plan the fix',
    options: { model: 'opus', taskId: 'item1' },
  });
});

test('a project can connect, create a GitHub draft, and change its connection in preview', async ({
  page,
}) => {
  await page.goto('/');
  await openConnectBoard(page, 'Atlas');
  await page.getByRole('button', { name: 'Use URL', exact: true }).click();
  await page
    .getByLabel('GitHub Projects board URL')
    .fill('https://github.com/orgs/example/projects/1');
  await page.getByRole('button', { name: 'Connect board', exact: true }).click();
  await expectConnectedBoard(page, 'Atlas roadmap');
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByLabel('Task title').fill('Ship the next release');
  await page.getByLabel('Task description').fill('Verify release checks');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Ship the next release', exact: true }),
  ).toBeVisible();
  // Project settings › Board changes the connected board.
  await openBoardSection(page);
  const settings = projectSettings(page);
  await settings.getByRole('button', { name: 'Change…', exact: true }).click();
  await expect(settings.getByRole('region', { name: 'Change board' })).toBeVisible();
  // Cancel keeps the board that is connected.
  await settings.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(settings.getByRole('region', { name: 'Change board' })).toHaveCount(0);
  await expect(settings).toContainText('Atlas roadmap #1');
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await expectConnectedBoard(page, 'Atlas roadmap');
});

test('GitHub connection waits for browser approval and supports cancel and retry', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let state: any = { status: 'idle' };
    let linked = false;
    const project = {
      id: 'gh',
      title: 'Authorized roadmap',
      url: 'https://github.com/orgs/example/projects/1',
      owner: 'example',
      number: 1,
    };
    (window as any).approveGitHub = () => {
      state = { status: 'ready' };
    };
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [],
        groups: [{ id: 'p', name: 'Platform', repoIds: [], github: linked ? project : undefined }],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      githubAuthStart: async () => (state = { status: 'waiting', code: 'ABCD-1234' }),
      githubAuthStatus: async () => state,
      githubAuthCancel: async () => (state = { status: 'idle' }),
      githubAuthOpen: async () => {},
      githubOwners: async () => [{ id: 'example', login: 'example', kind: 'organization' }],
      githubProjects: async () => [project],
      githubLink: async () => {
        if (state.status !== 'ready') throw new Error('Not authorized');
        linked = true;
      },
      githubBoard: async () => ({ project, items: [] }),
    };
  });
  await page.goto('/');
  await openConnectBoard(page, 'Platform');
  await expect(page.getByLabel('GitHub device code')).toHaveValue('ABCD-1234');
  await expect(page.getByRole('button', { name: 'Connect board', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Connect a board', exact: true }).click();
  await expect(page.getByLabel('GitHub device code')).toHaveValue('ABCD-1234');
  await page.evaluate(() => (window as any).approveGitHub());
  // After the approval, the code goes away and the boards of the account show.
  await expect(page.getByLabel('GitHub device code')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Available GitHub Projects boards' })).toBeVisible();
  await page.getByRole('button', { name: 'Authorized roadmap #1', exact: true }).click();
  await page.getByRole('button', { name: 'Connect board', exact: true }).click();
  await expectConnectedBoard(page, 'Authorized roadmap');
});

test('choose an existing GitHub project or create one without entering a URL', async ({ page }) => {
  await page.goto('/');
  await openConnectBoard(page, 'Atlas');
  await page.getByLabel('Search GitHub Projects boards').fill('roadmap');
  await page.getByRole('button', { name: 'Atlas roadmap #1', exact: true }).click();
  await page.getByRole('button', { name: 'Connect board', exact: true }).click();
  await expectConnectedBoard(page, 'Atlas roadmap');
  await openBoardSection(page);
  await page.getByRole('button', { name: 'Change…', exact: true }).click();
  await page.getByRole('button', { name: 'Create new', exact: true }).click();
  await expect(page.getByLabel('New GitHub Projects board name')).toHaveValue('Atlas');
  await page.getByLabel('New GitHub Projects board name').fill('Next release');
  await page.getByRole('button', { name: 'Create GitHub Projects board', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Created “Next release”' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Connect board', exact: true }).click();
  // The Tasks tab shows the new board.
  await page.keyboard.press('Escape');
  await expect(projectSettings(page)).toHaveCount(0);
  await expectConnectedBoard(page, 'Next release');
});

test('add repositories can create a project, then clone a GitHub repo into it', async ({
  page,
}) => {
  await page.goto('/');
  await openAddCodeFolders(page, 'Atlas');
  const dialog = page.getByRole('dialog', { name: 'Add code folders', exact: true });
  await dialog.getByRole('button', { name: 'Create a new project', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'New project', exact: true });
  await create.getByLabel('Project name', { exact: true }).fill('Mobile');
  await create.getByRole('button', { name: 'More options', exact: true }).click();
  await create.getByRole('button', { name: 'Connect now', exact: true }).click();
  await create.getByRole('button', { name: 'Atlas roadmap #1', exact: true }).click();
  await create.getByRole('button', { name: 'Create project', exact: true }).click();
  // Creating the project ends the flow. The new project opens, and the dialog stays closed.
  await expect(create).not.toBeVisible();
  await expect(dialog).not.toBeVisible();
  await openAddCodeFolders(page, 'Mobile');
  await expect(dialog.getByRole('combobox', { name: 'Add to project' })).toContainText('Mobile');
  await dialog.getByRole('button', { name: 'Clone from GitHub', exact: true }).click();
  await dialog.getByLabel('Search GitHub repositories').fill('mobile');
  await dialog.getByRole('radio', { name: /example\/mobile-app/ }).click();
  await dialog.getByRole('button', { name: 'Clone into project', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Code folders' }).getByText('mobile-app', { exact: true }),
  ).toBeVisible();
  await openAddCodeFolders(page, 'Mobile');
  await dialog.getByRole('button', { name: 'Already in Kalkidan', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Code folder already in Kalkidan' }).click();
  await page.getByRole('option', { name: /design-system ·/ }).click();
  await dialog.getByRole('button', { name: 'Move to project', exact: true }).click();
  await expect(
    page.locator('.project-tree').getByRole('button', { name: 'Mobile', exact: true }),
  ).toBeVisible();
});

test('local folder selection keeps the chosen project and clone cancellation keeps dialog open', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).addedTo = '';
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [],
        groups: [{ id: 'p', name: 'Platform', repoIds: [] }],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      githubRepositories: async () => [],
      cloneRepository: async () => false,
      add: async (id: string) => {
        (window as any).addedTo = id;
      },
    };
  });
  await page.goto('/');
  await openAddCodeFolders(page, 'Platform');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Clone from GitHub', exact: true }).click();
  await dialog.getByLabel('GitHub repository name').fill('example/web');
  await dialog.getByRole('button', { name: 'Clone into project', exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Local folder', exact: true }).click();
  await dialog.getByRole('button', { name: 'Choose folder', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(await page.evaluate(() => (window as any).addedTo)).toBe('p');
});

test('tracker board groups tasks, syncs status moves, and filters', async ({ page }) => {
  await page.goto('/');
  await openConnectBoard(page, 'Atlas');
  await page.getByRole('button', { name: 'Atlas roadmap #1', exact: true }).click();
  await page.getByRole('button', { name: 'Connect board', exact: true }).click();
  const board = page.getByRole('region', { name: 'Tracker board', exact: true });
  await expect(board).toBeVisible();
  await expect(
    board
      .getByRole('region', { name: 'Todo column', exact: true })
      .getByRole('button', { name: 'Review authentication', exact: true }),
  ).toBeVisible();
  // The task menu of a card moves the task to another status.
  await board.getByRole('button', { name: 'Task menu: Review authentication' }).click();
  await page.getByRole('menuitem', { name: 'Done', exact: true }).click();
  await expect(
    board
      .getByRole('region', { name: 'Done column', exact: true })
      .getByRole('button', { name: 'Review authentication', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/tracker-board.png', fullPage: true });
  await page.getByLabel('Search tasks').fill('authentication');
  await expect(
    board.getByRole('button', { name: 'Build the project overview', exact: true }),
  ).toHaveCount(0);
  await board.getByRole('button', { name: 'Review authentication', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Review authentication');
});

test('repository authorization explicitly requests browser login and shows approval feedback', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let state: any = { status: 'idle' };
    (window as any).authForced = false;
    (window as any).browserOpens = 0;
    (window as any).approve = () => {
      state = { status: 'ready' };
    };
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [],
        groups: [{ id: 'g', name: 'Platform', repoIds: [] }],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      githubRepositories: async () =>
        state.status === 'ready'
          ? [
              {
                nameWithOwner: 'example/connected-repo',
                description: '',
                isPrivate: true,
                isArchived: false,
              },
            ]
          : [],
      githubAuthStart: async (force: boolean) => {
        (window as any).authForced = force;
        return (state = { status: 'waiting', code: 'ABCD-1234' });
      },
      githubAuthStatus: async () => state,
      githubAuthOpen: async () => {
        (window as any).browserOpens++;
      },
      githubAuthCancel: async () => (state = { status: 'idle' }),
    };
  });
  await page.goto('/');
  await openAddCodeFolders(page, 'Platform');
  const add = page.getByRole('dialog', { name: 'Add code folders', exact: true });
  await add.getByRole('button', { name: 'Clone from GitHub', exact: true }).click();
  // GitHub sign-in is in Preferences. The clone source links to it.
  await add
    .getByRole('button', { name: 'Check your GitHub account in Preferences', exact: true })
    .click();
  // GitHub and GitHub Projects access are one row of Preferences. The approval opens in its own
  // dialog.
  const settings = settingsDialog(page);
  await expect(settings).toBeVisible();
  const access = settings.getByRole('group', { name: 'GitHub and boards', exact: true });
  await expect(access).toContainText('Boards not allowed');
  await access.getByRole('button', { name: 'Allow access…', exact: true }).click();
  const approval = page.getByRole('dialog', { name: 'Allow access to GitHub Projects' });
  await expect(approval.getByLabel('GitHub device code')).toHaveValue('ABCD-1234');
  // The first approval does not force a new sign-in. Allow again does.
  expect(await page.evaluate(() => (window as any).authForced)).toBe(false);
  await approval.getByRole('button', { name: 'Open GitHub', exact: true }).click();
  expect(await page.evaluate(() => (window as any).browserOpens)).toBe(1);
  await page.evaluate(() => (window as any).approve());
  // The approval dialog closes by itself, and the row shows the result.
  await expect(approval).toHaveCount(0);
  await expect(access).toContainText('Boards allowed');
  await expect(access.getByRole('button', { name: 'Allow access…', exact: true })).toHaveCount(0);
});

test('project navigation replaces the main sidebar and global history page', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Session history/ })).toHaveCount(0);
  await expect(page.getByText('UNGROUPED REPOSITORIES', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Projects and repositories' })).toBeVisible();
  // Preferences is a dialog over the page, not a page in the sidebar or the history.
  const settings = await openSettings(page);
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Projects and repositories' })).toBeVisible();
  // The agents are on the Computers page, which opens from the sidebar.
  const computers = await openSettings(page, 'Agents');
  await expect(computers.getByRole('group', { name: 'Codex', exact: true })).toBeVisible();
  await expect(computers.getByRole('group', { name: 'Claude Code', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Projects and repositories' })).toBeVisible();
  await page.screenshot({ path: 'test-results/project-navigation.png', fullPage: true });
});

test('simplified controls remain accessible and selection follows project and conversation', async ({
  page,
}) => {
  await page.goto('/');
  await openCodeFolder(page);
  await expect(page.getByRole('button', { name: /^Manage project / })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Discover', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Repository actions', exact: true }).click();
  await expect(
    page.getByRole('menuitem', { name: 'Open in Terminal app', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /^Show in / })).toBeVisible();
  await page.keyboard.press('Escape');
  // Repository notes are part of the repository settings.
  await page.getByRole('button', { name: 'Repository actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit code folder…', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('textbox', { name: 'Notes' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const tree = page.locator('.project-tree');
  await tree.getByRole('button', { name: 'Atlas', exact: true }).click();
  await expect(tree.getByRole('button', { name: 'Atlas', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  // A code folder page marks its project row as the place that contains the current page.
  await openCodeFolder(page, 'atlas-web');
  const projectRow = tree.locator('.project-group-heading').filter({ hasText: 'Atlas' });
  await expect(projectRow).toHaveClass(/contains-current/);
  await page
    .getByRole('button', { name: 'Resume Refine project and repository navigation', exact: true })
    .click();
  // An open chat is selected in the sidebar. Its project row contains it.
  await expect(
    tree.getByRole('button', { name: 'Chat: Refine project and repository navigation' }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(projectRow).toHaveClass(/contains-current/);
  await expect(page.getByRole('region', { name: 'Chats', exact: true })).toBeVisible();
  await openSettings(page);
  await expect(page.getByRole('button', { name: 'Preview chat history', exact: true })).toHaveCount(
    0,
  );
});
