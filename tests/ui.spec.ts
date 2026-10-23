import type { Page } from '@playwright/test';
import { test, expect, newChat, openSettings, settingsDialog } from './helpers/app';
import {
  openCodeFolder,
  openAddCodeFolders,
  openCloneFromGitHub,
  openProjectTab,
  openTreeChat,
} from './helpers/navigation';

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The sidebar tree. */
const tree = (page: Page) => page.getByRole('navigation', { name: 'Projects and repositories' });
/** The repo row of the tree with this name. */
const repoRow = (page: Page, name: string) =>
  page
    .locator('.tree-row[data-kind="repo"]')
    .filter({ has: page.locator('.tree-label', { hasText: new RegExp(`^${escape(name)}$`) }) });
/** The chat rows of the tree, in order. */
const chatRows = (page: Page) => tree(page).getByRole('button', { name: /^Chat: / });
/** Opens the menu of a repo row: New chat here, New branch copy…, Edit code folder… */
async function openRepoMenu(page: Page, name: string) {
  await repoRow(page, name).locator('.tree-row-button').click({ button: 'right' });
}
/** Opens the ⋯ menu of a chat row. The button shows when the pointer is on the row. */
async function openChatMenu(page: Page, title: string) {
  await tree(page)
    .getByRole('button', { name: `Chat: ${title}`, exact: true })
    .hover();
  await tree(page)
    .getByRole('button', { name: `${title} actions`, exact: true })
    .click();
}
/** Shows a repo in the tree and opens one of its chats. */
async function resumeChat(page: Page, title: string, repo?: string) {
  await openCodeFolder(page, repo);
  await openTreeChat(page, title);
}
/**
 * Opens the Settings page at the part of the project from the Project actions menu of the project
 * header, opens the board settings with the board chip, and returns the project part.
 */
async function openBoardSection(page: Page, project = 'Atlas') {
  await page.getByRole('button', { name: 'Project actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings…', exact: true }).click();
  const part = settingsDialog(page).getByRole('region', { name: project, exact: true });
  await expect(part.getByRole('heading', { name: project, exact: true })).toBeVisible();
  // The board chip opens the board settings in place.
  const chip = part.locator('button[aria-expanded]').last();
  if ((await chip.getAttribute('aria-expanded')) !== 'true') await chip.click();
  await expect(part.getByRole('list', { name: 'Connected board' })).toBeVisible();
  return part;
}

/** The dialog that changes the connected board. */
const changeBoardDialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Change board', exact: true });

/** The board list on the Tasks tab of a project without a board. */
const connectPanel = (page: Page) =>
  page.getByRole('region', { name: 'Connect a GitHub board', exact: true });

/** Opens the Tasks tab of a project without a board. The page lists the boards to connect. */
async function openConnectBoard(page: Page, project: string) {
  await openProjectTab(page, 'Tasks', project);
  await expect(connectPanel(page)).toBeVisible();
  return connectPanel(page);
}

/** Checks that the Tasks tab shows the connected board. The board menu button names it. */
async function expectConnectedBoard(page: Page, title: string | RegExp) {
  await expect(page.getByRole('region', { name: 'Tracker board', exact: true })).toBeVisible();
  const name = typeof title === 'string' ? new RegExp(`^Board: ${title}( #\\d+)?$`) : title;
  await expect(
    page.getByRole('toolbar', { name: 'Task tools' }).getByRole('button', { name }),
  ).toBeVisible();
}

test('project navigation, search, editing, worktrees, and sessions', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await openCodeFolder(page);
  // A repo row shows the branch of its main folder. The chats of the repo show under it.
  const repo = repoRow(page, 'atlas-web');
  await expect(repo.locator('.tree-meta')).toHaveText('main');
  await expect(
    tree(page).getByRole('button', { name: 'Chat: Refine project and repository navigation' }),
  ).toBeVisible();
  // New branch copy and Edit code folder are in the menu of the repo row.
  await openRepoMenu(page, 'atlas-web');
  await page.getByRole('menuitem', { name: 'New branch copy…', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await openRepoMenu(page, 'atlas-web');
  await page.getByRole('menuitem', { name: 'Edit code folder…', exact: true }).click();
  await page.getByLabel('Repository name', { exact: true }).fill('atlas-renamed');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    tree(page).getByRole('button', { name: 'atlas-renamed', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Search or run a command', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search or run a command' }).fill('not-a-project');
  await expect(page.getByText('No matches found.')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.screenshot({ path: 'test-results/desktop-preview.png', fullPage: true });
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('combobox', { name: 'Search or run a command' })).toBeFocused();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 980, height: 680 });
  // The tree keeps the repo row in a compact window, and the page does not scroll sideways.
  await expect(
    tree(page).getByRole('button', { name: 'atlas-renamed', exact: true }),
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
  await openChatMenu(page, 'Refine project and repository navigation');
  await page.getByRole('menuitem', { name: 'Rename…', exact: true }).click();
  await page.getByLabel('Chat name', { exact: true }).fill('Navigation follow-up');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  // The chat row menu has the frequent actions only. Notes is in ⌘K and the menu bar.
  await openChatMenu(page, 'Navigation follow-up');
  await expect(page.getByRole('menuitem', { name: 'Notes…', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
  // A pinned chat is the first chat of its repo. There is no Pinned section.
  await expect(chatRows(page).first()).toHaveAccessibleName('Chat: Navigation follow-up');
  await expect(page.locator('.pinned-sessions')).toHaveCount(0);
  await openTreeChat(page, 'Navigation follow-up');
  await expect(page.getByRole('region', { name: 'Chats', exact: true })).toBeVisible();
  await expect(page.getByText('This is a sample conversation.', { exact: false })).toBeVisible();
  // Notes of the open chat are in ⌘K.
  await page.getByRole('button', { name: 'Search or run a command', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search or run a command' }).fill('Notes');
  await page.getByRole('option', { name: 'Notes…', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Notes', exact: true })
    .fill('Finish keyboard navigation');
  await page.getByRole('button', { name: 'Save notes', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
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
  await expect(page.getByRole('alert')).toContainText('Open the Kalkidan desktop app');
  await expect(page.getByRole('alert')).not.toContainText(/managed agent/i);
  // The refused message shows in the transcript with "Try again". It leaves the composer.
  await expect(
    page.locator('.chat-message.user').filter({ hasText: 'Continue with keyboard navigation' }),
  ).toHaveCount(1);
  await expect(page.getByLabel('Message agent')).toHaveValue('');
  // Archive hides the chat in the tree. Undo in the notice brings it back.
  await openChatMenu(page, 'Navigation follow-up');
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
  const row = tree(page).getByRole('button', { name: 'Chat: Navigation follow-up', exact: true });
  await expect(row).toHaveCount(0);
  await page
    .getByRole('status')
    .filter({ hasText: 'Chat archived' })
    .getByRole('button', { name: 'Undo' })
    .click();
  await expect(row).toBeVisible();
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

  await chatRows(page).first().click();
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
  // Sessions open from the tree.
  await resumeChat(page, 'Another fixture', 'My project');
  await expect(page.locator('.agent-tabbar')).toHaveCount(0);
  await resumeChat(page, 'Live fixture', 'My project');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  // The transcript notes the stop in one word. The composer stays ready for the next message.
  await expect(page.getByText('Stopped', { exact: true })).toBeVisible();
  await expect(
    page.locator('.agent-pane:not([hidden])').getByLabel('Message agent'),
  ).toBeEditable();
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

  await chatRows(page).first().click();
  await page.getByLabel('Message agent').fill('Keep my follow-up');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('another window');
  // The failed message shows once, with its error card under it. It is not in the composer too.
  await expect(page.locator('.chat-message.user')).toHaveCount(1);
  await expect(page.locator('.chat-message.user')).toContainText('Keep my follow-up');
  await expect(page.locator('.chat-message.user + .chat-card[role="alert"]')).toBeVisible();
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

  await chatRows(page).first().click();
  const workspace = page.getByRole('region', { name: 'Chats', exact: true });
  const pane = page.locator('.agent-pane:not([hidden])');
  await expect(workspace).toBeVisible();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await pane.getByLabel('Message agent').fill('Keep this Codex draft');
  await resumeChat(page, 'Review the authentication flow and add integration tests', 'atlas-web');
  await pane.getByLabel('Message agent').fill('Keep this Claude draft');
  await resumeChat(page, 'Refine project and repository navigation', 'atlas-web');
  await expect(pane.getByLabel('Message agent')).toHaveValue('Keep this Codex draft');
  await expect(pane.getByRole('region', { name: 'Chat details', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Pin/ }).click();
  // The chat header menu pins the chat too. The tree has no Pinned section.
  await expect(chatRows(page).first()).toHaveAccessibleName(
    'Chat: Refine project and repository navigation',
  );
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /^Unpin/ })).toBeVisible();
  await page.getByRole('menuitem', { name: /^Unpin/ }).click();
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /^Pin/ })).toBeVisible();
  await page.keyboard.press('Escape');
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
  // A narrow title bar hides the project crumb first. In a wide window, the breadcrumb goes
  // back to the project.
  const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
  const projectCrumb = breadcrumb.getByRole('button', { name: 'Atlas project', exact: true });
  await expect(projectCrumb).toBeHidden();
  await page.setViewportSize({ width: 1360, height: 960 });
  await projectCrumb.click();
  await expect(page.getByRole('heading', { name: 'Atlas', level: 1 })).toBeVisible();
  // The Tasks tab of a project without a board connects one on the page.
  await openProjectTab(page, 'Tasks');
  await expect(
    page.getByRole('heading', { name: 'Connect a GitHub board', exact: true }),
  ).toBeVisible();
  await resumeChat(page, 'Refine project and repository navigation', 'atlas-web');
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

    await openTreeChat(page, 'Saved conversation');
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
  await expect(tree(page).getByText('Atlas', { exact: true })).toBeVisible();
  // The tree shows projects, their repos, and the chats of each repo.
  await expect(tree(page).getByRole('button', { name: 'atlas-web', exact: true })).toHaveCount(0);
  await openCodeFolder(page, 'api-service');
  await expect(tree(page).getByRole('button', { name: 'api-service', exact: true })).toBeVisible();
  await tree(page).getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill('Infrastructure');
  await page.getByRole('button', { name: 'More options', exact: true }).click();
  await page.getByRole('button', { name: 'Connect now', exact: true }).click();
  await page.getByRole('button', { name: 'Atlas roadmap #1', exact: true }).click();
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await openCodeFolder(page, 'api-service');
  await openRepoMenu(page, 'api-service');
  await page.getByRole('menuitem', { name: 'Edit code folder…', exact: true }).click();
  await page.getByRole('combobox', { name: 'Project', exact: true }).click();
  await page.getByRole('option', { name: 'Infrastructure', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await tree(page).getByRole('button', { name: 'Infrastructure', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Repos', exact: true }).getByRole('button', {
      name: /^api-service/,
    }),
  ).toBeVisible();
  await resumeChat(page, 'Refine project and repository navigation', 'atlas-web');
  await expect(page.getByRole('region', { name: 'Chats', exact: true })).toBeVisible();
  await expect(page.getByText('Atlas / atlas-web', { exact: true })).toHaveCount(0);
});

test('GitHub task status, repository choice, and the agent carry through to an agent turn', async ({
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
  // A right click on a card opens its menu. It has "Move to" with the status options.
  await page.getByRole('button', { name: 'Fix login', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Done column' })).toContainText('Fix login');
  await page.screenshot({ path: 'test-results/github-project.png', fullPage: true });
  await page.getByRole('button', { name: 'Fix login', exact: true }).click();
  // "Where to work" in the task sheet shows where the chat works: the code folder and the branch.
  const sheet = page.getByRole('dialog', { name: 'Fix login', exact: true });
  await sheet.getByRole('button', { name: /^Where to work: / }).click();
  const where = page.getByRole('dialog', { name: 'Where to work', exact: true });
  await where
    .getByRole('group', { name: 'Code folder', exact: true })
    .getByRole('radio', { name: 'API', exact: true })
    .check();
  // The fixture has no Git status, so the chat works in the folder itself, not a branch copy.
  await where.getByRole('radio', { name: 'Work in the folder', exact: true }).check();
  await page.keyboard.press('Escape');
  await expect(where).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: /^Where to work: API · / })).toBeVisible();
  // The Start task split button starts the preferred agent. Its menu starts another agent.
  await sheet.getByRole('button', { name: 'Choose an agent', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Claude Code', exact: true }).click();
  await expect(page.getByLabel('Message agent')).toHaveValue(/Fix login/);
  // The agent chip names the agent. The composer has no model choice and no More options menu.
  await expect(page.getByRole('button', { name: 'More options', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Agent: Claude Code', exact: true })).toBeVisible();
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
    options: { taskId: 'item1' },
  });
});

test('a project can connect, create a GitHub draft, and change its connection in preview', async ({
  page,
}) => {
  await page.goto('/');
  // The search field of the board list also takes the URL of a board.
  const connect = await openConnectBoard(page, 'Atlas');
  const url = 'https://github.com/orgs/example/projects/1';
  await connect.getByRole('searchbox', { name: /^Search .* or paste a URL$/ }).fill(url);
  await connect.getByRole('button', { name: `Connect the board at ${url}`, exact: true }).click();
  await expectConnectedBoard(page, 'Atlas roadmap');
  // New task adds the task in the board: a title field, and Enter adds it without a chat.
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  const title = page.getByRole('textbox', { name: 'New task title', exact: true });
  await title.fill('Ship the next release');
  await title.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Ship the next release', exact: true }),
  ).toBeVisible();
  // Settings › Atlas › the board chip changes the connected board in the "Change board" dialog.
  const boardSettings = await openBoardSection(page);
  await boardSettings.getByRole('button', { name: 'Change…', exact: true }).click();
  const change = changeBoardDialog(page);
  await expect(change).toBeVisible();
  // The connected board shows as connected. Close keeps it, and Settings stays open.
  await expect(change.getByRole('button', { name: /Connected$/ })).toBeDisabled();
  await change.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(change).toHaveCount(0);
  await expect(boardSettings).toContainText('Atlas roadmap #1');
  await page.keyboard.press('Escape');
  await expect(settingsDialog(page)).toHaveCount(0);
  await expectConnectedBoard(page, 'Atlas roadmap');
});

test('GitHub connection waits for browser approval and starts only when asked', async ({
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
    (window as any).starts = 0;
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
      githubAuthStart: async () => {
        (window as any).starts++;
        return (state = { status: 'waiting', code: 'ABCD-1234' });
      },
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
  // The Tasks tab reads the access. The sign-in starts only when the user asks for it.
  const connect = await openConnectBoard(page, 'Platform');
  const start = connect.getByRole('button', { name: 'Connect GitHub', exact: true });
  await expect(start).toBeVisible();
  await expect(connect.getByLabel('GitHub device code')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).starts)).toBe(0);
  await start.click();
  await expect(connect.getByLabel('GitHub device code')).toHaveText('ABCD-1234');
  // The tab shows the waiting sign-in again after the user leaves it. It does not start again.
  await openProjectTab(page, 'Overview');
  await openProjectTab(page, 'Tasks');
  await expect(connect.getByLabel('GitHub device code')).toHaveText('ABCD-1234');
  expect(await page.evaluate(() => (window as any).starts)).toBe(1);
  await page.evaluate(() => (window as any).approveGitHub());
  // After the approval, the code goes away and the boards of the account show.
  await expect(connect.getByLabel('GitHub device code')).toHaveCount(0);
  await connect.getByRole('button', { name: 'Connect Authorized roadmap #1', exact: true }).click();
  await expectConnectedBoard(page, 'Authorized roadmap');
});

test('choose an existing GitHub project or create one without entering a URL', async ({ page }) => {
  await page.goto('/');
  const connect = await openConnectBoard(page, 'Atlas');
  await connect.getByRole('searchbox', { name: /^Search .* or paste a URL$/ }).fill('roadmap');
  await connect.getByRole('button', { name: 'Connect Atlas roadmap #1', exact: true }).click();
  await expectConnectedBoard(page, 'Atlas roadmap');
  const boardSettings = await openBoardSection(page);
  await boardSettings.getByRole('button', { name: 'Change…', exact: true }).click();
  // "New board for Atlas" makes a board with the project name and connects it with one click.
  const change = changeBoardDialog(page);
  await change.getByRole('button', { name: 'New board for Atlas', exact: true }).click();
  await expect(change).toHaveCount(0);
  await expect(boardSettings.getByRole('list', { name: 'Connected board' })).not.toContainText(
    'Atlas roadmap',
  );
  // The Tasks tab shows the new board.
  await page.keyboard.press('Escape');
  await expect(settingsDialog(page)).toHaveCount(0);
  await expectConnectedBoard(page, 'Atlas');
});

test('New project connects a board, then Add repo adds a folder to it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('main').getByRole('button', { name: 'New project', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'New project', exact: true });
  await create.getByLabel('Project name', { exact: true }).fill('Mobile');
  await create.getByRole('button', { name: 'More options', exact: true }).click();
  await create.getByRole('button', { name: 'Connect now', exact: true }).click();
  await expect(create.getByRole('button', { name: 'Atlas roadmap #1', exact: true })).toBeVisible();
  await create.getByRole('button', { name: 'Create project', exact: true }).click();
  // Creating the project ends the flow. The new project opens.
  await expect(create).not.toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('heading', { name: 'Mobile' })).toBeVisible();
  // The demo has no GitHub CLI, so Clone from GitHub asks to connect GitHub first.
  await openCloneFromGitHub(page, 'Mobile');
  const clone = page.getByRole('dialog', { name: 'Clone from GitHub', exact: true });
  await expect(clone).toContainText('GitHub is not connected.');
  await expect(clone.getByRole('button', { name: 'Connect GitHub…', exact: true })).toBeVisible();
  await expect(clone.getByRole('button', { name: 'Clone', exact: true })).toBeDisabled();
  await clone.getByRole('button', { name: 'Cancel', exact: true }).click();
  // "Add code folder…" opens the folder picker and adds every Git repository in the folder.
  await openAddCodeFolders(page, 'Mobile');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('.project-tree').getByRole('button', { name: 'Mobile', exact: true }).click();
  // The Repos list of the Overview has the 3 repos and "Add repo…".
  await expect(
    page.getByRole('region', { name: 'Repos', exact: true }).getByRole('listitem'),
  ).toHaveCount(4);
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
      githubCliCheck: async () => ({ status: 'ready' }),
      githubRepositories: async () => [],
      cloneRepository: async () => false,
      add: async (id: string) => {
        (window as any).addedTo = id;
      },
    };
  });
  await page.goto('/');
  await openCloneFromGitHub(page, 'Platform');
  const clone = page.getByRole('dialog', { name: 'Clone from GitHub', exact: true });
  await clone.getByLabel('GitHub repository name').fill('example/web');
  await clone.getByRole('button', { name: 'Clone', exact: true }).click();
  await expect(clone).toBeVisible();
  await clone.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(clone).toHaveCount(0);
  // This build has no native folder picker, so "Add code folder…" opens the dialog.
  await openAddCodeFolders(page, 'Platform');
  const dialog = page.getByRole('dialog', { name: 'Add code folder', exact: true });
  await dialog.getByRole('button', { name: 'Choose folder…', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(await page.evaluate(() => (window as any).addedTo)).toBe('p');
});

test('tracker board groups tasks, syncs status moves, and filters', async ({ page }) => {
  await page.goto('/');
  const connect = await openConnectBoard(page, 'Atlas');
  await connect.getByRole('button', { name: 'Connect Atlas roadmap #1', exact: true }).click();
  const board = page.getByRole('region', { name: 'Tracker board', exact: true });
  await expect(board).toBeVisible();
  await expect(
    board
      .getByRole('region', { name: 'Todo column', exact: true })
      .getByRole('button', { name: 'Review authentication', exact: true }),
  ).toBeVisible();
  // A right click on a card opens its menu. It moves the task to another status.
  await board
    .getByRole('button', { name: 'Review authentication', exact: true })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Done', exact: true }).click();
  await expect(
    board
      .getByRole('region', { name: 'Done column', exact: true })
      .getByRole('button', { name: 'Review authentication', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/tracker-board.png', fullPage: true });
  // Search is an icon button that opens the search field.
  await page.getByRole('button', { name: 'Search tasks', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search tasks' }).fill('authentication');
  await expect(
    board.getByRole('button', { name: 'Build the project overview', exact: true }),
  ).toHaveCount(0);
  await board.getByRole('button', { name: 'Review authentication', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Review authentication');
});

test('repository authorization sends the user to Settings and starts nothing on its own', async ({
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
      // The GitHub CLI is signed out, so Clone from GitHub asks to connect GitHub.
      githubCliCheck: async () => ({ status: 'signed-out' }),
    };
  });
  await page.goto('/');
  await openCloneFromGitHub(page, 'Platform');
  const add = page.getByRole('dialog', { name: 'Clone from GitHub', exact: true });
  await expect(add).toContainText('GitHub is not connected.');
  await expect(add.getByRole('button', { name: 'Clone', exact: true })).toBeDisabled();
  // The GitHub state is in Settings › Tools (the GitHub CLI row). The clone dialog links to it.
  await add.getByRole('button', { name: 'Connect GitHub…', exact: true }).click();
  await expect(add).toHaveCount(0);
  const settings = settingsDialog(page);
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('region', { name: 'Tools', exact: true })).toBeVisible();
  // Nothing starts a GitHub sign-in or opens the browser until the user asks for it. Board
  // access stays with the board: the project part has "Connect board".
  expect(await page.evaluate(() => (window as any).authForced)).toBe(false);
  expect(await page.evaluate(() => (window as any).browserOpens)).toBe(0);
  await expect(
    settings
      .getByRole('region', { name: 'Platform', exact: true })
      .getByRole('button', { name: 'Connect board', exact: true }),
  ).toBeVisible();
});

test('project navigation replaces the main sidebar and global history page', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Session history/ })).toHaveCount(0);
  await expect(page.getByText('UNGROUPED REPOSITORIES', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Projects and repositories' })).toBeVisible();
  // Settings is a page of the main column. The sidebar stays in place beside it.
  const settings = await openSettings(page);
  await expect(page.locator('.project-tree')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Projects and repositories' })).toBeVisible();
  // The agents are in Settings › Tools. The sidebar has no Computers row.
  await expect(
    page
      .getByRole('navigation', { name: 'Projects and repositories' })
      .getByRole('button', { name: 'Computers' }),
  ).toHaveCount(0);
  const tools = (await openSettings(page, 'Agents')).getByRole('list', { name: 'This Mac' });
  await expect(tools.getByRole('listitem').filter({ hasText: /^Codex/ })).toBeVisible();
  await expect(tools.getByRole('listitem').filter({ hasText: /^Claude Code/ })).toBeVisible();
  await expect(page.locator('.project-tree')).toBeVisible();
  await page.screenshot({ path: 'test-results/project-navigation.png', fullPage: true });
});

test('simplified controls remain accessible and selection follows project and conversation', async ({
  page,
}) => {
  await page.goto('/');
  await openCodeFolder(page);
  await expect(page.getByRole('button', { name: 'Discover', exact: true })).toHaveCount(0);
  // The repo row menu has the folder actions.
  await openRepoMenu(page, 'atlas-web');
  await expect(
    page.getByRole('menuitem', { name: 'Open in Terminal app', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /^Show in / })).toBeVisible();
  await page.keyboard.press('Escape');
  // Repository notes are part of the repository settings.
  await openRepoMenu(page, 'atlas-web');
  await page.getByRole('menuitem', { name: 'Edit code folder…', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('textbox', { name: 'Notes' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const project = tree(page).getByRole('button', { name: 'Atlas', exact: true });
  const projectRow = page
    .locator('.tree-row[data-kind="project"]')
    .filter({ has: page.locator('.tree-label', { hasText: /^Atlas$/ }) });
  await project.click();
  // The tree has one strong highlight. The Overview selects its project row.
  await expect(project).toHaveAttribute('aria-current', 'page');
  await expect(projectRow).toHaveClass(/\bselected\b/);
  await openTreeChat(page, 'Refine project and repository navigation');
  // An open chat is selected in the tree. Its project row is not.
  const chat = tree(page).getByRole('button', {
    name: 'Chat: Refine project and repository navigation',
  });
  await expect(chat).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.tree-row.selected')).toHaveCount(1);
  await expect(projectRow).not.toHaveClass(/\bselected\b/);
  await expect(project).not.toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('region', { name: 'Chats', exact: true })).toBeVisible();
  await openSettings(page);
  await expect(page.getByRole('button', { name: 'Preview chat history', exact: true })).toHaveCount(
    0,
  );
});
