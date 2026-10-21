import { test, expect } from '@playwright/test';
test('project navigation, search, editing, worktrees, and sessions', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.locator('.repo-select').first().click();
  await expect(page.getByRole('heading', { name: 'atlas-web', exact: true })).toBeVisible();

  await expect(page.getByRole('region', { name: 'Repository branch copies' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Code folder chats' })).toBeVisible();
  await expect(page.locator('.repository-overview').getByRole('tablist')).toHaveCount(0);
  await expect(page.locator('.project-status')).toHaveCount(0);
  await expect(page.getByText(/Give each agent its own worktree/)).toHaveCount(0);
  await expect(page.locator('.worktree-sessions').getByRole('button')).toHaveCount(2);
  await page.getByRole('button', { name: 'Refresh branch copies' }).click();
  await expect(page.locator('.worktree-sessions').getByRole('button')).toHaveCount(2);
  await page.getByRole('button', { name: 'New branch copy' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await expect(page.getByText('Refine project and repository navigation').last()).toBeVisible();
  await page.getByRole('button', { name: 'Repository actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit code folder…', exact: true }).click();
  await page.getByLabel('Repository name', { exact: true }).fill('atlas-renamed');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: 'atlas-renamed' })).toBeVisible();
  await page.getByRole('button', { name: 'Search or run', exact: true }).click();
  await page.getByLabel('Search projects and chats').fill('not-a-project');
  await expect(page.getByText('No matches found.')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.screenshot({ path: 'test-results/desktop-preview.png', fullPage: true });
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByLabel('Search projects and chats')).toBeFocused();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 980, height: 680 });
  await expect(page.getByRole('button', { name: 'New Codex chat' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/compact-preview.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('organize sessions and continue inside the conversation UI', async ({ page }) => {
  await page.goto('/');
  await page.locator('.repo-select').first().click();
  const list = page.locator('.session-list');

  await list
    .getByRole('button', { name: 'Refine project and repository navigation actions' })
    .click();
  await page.getByRole('menuitem', { name: 'Rename…', exact: true }).click();
  await page.getByLabel('Session name', { exact: true }).fill('Navigation follow-up');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await list.getByRole('button', { name: 'Navigation follow-up actions' }).click();
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
  await expect(list.getByText('Finish keyboard navigation', { exact: true })).toBeVisible();
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
  await page.getByRole('button', { name: /^Back to / }).click();
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
  await page.locator('.repo-select').first().click();

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
  // Sessions open from the repository page. The sidebar lists repositories only.
  // The activity dot adds to the row name while the agent works.
  const repository = page.locator('.repo-select').filter({ hasText: 'My project' });
  await repository.click();
  await page.getByRole('button', { name: 'Resume Another fixture', exact: true }).click();
  await expect(page.locator('.agent-tabbar')).toHaveCount(0);
  await repository.click();
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
  await page.locator('.repo-select').first().click();

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
  await page.locator('.repo-select').first().click();

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
  const repository = page
    .getByRole('navigation', { name: 'Projects and repositories' })
    .getByRole('button', { name: 'atlas-web', exact: true });
  await repository.click();
  await page
    .getByRole('button', {
      name: 'Resume Review the authentication flow and add integration tests',
      exact: true,
    })
    .click();
  await pane.getByLabel('Message agent').fill('Keep this Claude draft');
  await repository.click();
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
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByLabel('Search projects and chats')).toBeFocused();
  await page.keyboard.press('Escape');
  // The narrow window hides the sidebar. The palette does not change the sidebar.
  await expect(
    page.getByRole('navigation', { name: 'Projects and repositories' }),
  ).not.toBeVisible();
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Projects and repositories' })).toBeVisible();
  await page.getByRole('button', { name: /^Back to / }).click();
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Connect a GitHub Projects board', exact: true }),
  ).toBeVisible();
  await repository.click();
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
    await page.locator('.repo-select').first().click();
    // The split button starts Codex by default. Other agents are in its menu.
    if (agent === 'codex')
      await page.getByRole('button', { name: 'New Codex chat', exact: true }).click();
    else {
      await page.getByRole('button', { name: 'Choose an agent', exact: true }).click();
      await page.getByRole('menuitem', { name: 'New Claude Code chat', exact: true }).click();
    }
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
    await page.locator('.repo-select').first().click();

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
  await expect(tree.getByRole('button', { name: 'atlas-web', exact: true })).toBeVisible();
  await tree.getByRole('button', { name: 'api-service', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'api-service', exact: true })).toBeVisible();
  await tree.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill('Infrastructure');
  await page.getByRole('button', { name: 'More options', exact: true }).click();
  await page.getByRole('button', { name: 'Connect now', exact: true }).click();
  await page.getByRole('button', { name: 'Atlas roadmap #1', exact: true }).click();
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await tree.getByRole('button', { name: 'api-service', exact: true }).click();
  await page.getByRole('button', { name: 'Repository actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit code folder…', exact: true }).click();
  await page.getByRole('combobox', { name: 'Project', exact: true }).click();
  await page.getByRole('option', { name: 'Infrastructure', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  const infrastructure = tree
    .locator('.project-group')
    .filter({ has: page.getByText('Infrastructure', { exact: true }) });
  await expect(
    infrastructure.getByRole('button', { name: 'api-service', exact: true }),
  ).toBeVisible();
  await tree.getByRole('button', { name: 'atlas-web', exact: true }).click();
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
  await page.locator('.project-tree').getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByRole('button', { name: 'Move task: Fix login' }).click();
  await page.getByRole('menuitem', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Done column' })).toContainText('Fix login');
  await page.screenshot({ path: 'test-results/github-project.png', fullPage: true });
  await page.getByRole('button', { name: 'Fix login', exact: true }).click();
  await page.getByRole('combobox', { name: 'Code folder for this task' }).click();
  await page.getByRole('option', { name: 'API', exact: true }).click();
  await page.getByRole('button', { name: 'Choose an agent', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New Claude Code chat', exact: true }).click();
  await expect(page.getByLabel('Message agent')).toHaveValue(/Fix login/);
  // The model chip is next to the mode chip. The composer has no More options menu.
  await expect(page.getByRole('button', { name: 'More options', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Model', exact: true }).click();
  await page.getByRole('option', { name: 'Opus', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toHaveText('Opus');
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
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await page.getByRole('button', { name: 'Connect a GitHub Projects board', exact: true }).click();
  await page.getByRole('button', { name: 'Use URL', exact: true }).click();
  await page
    .getByLabel('GitHub Projects board URL')
    .fill('https://github.com/orgs/example/projects/1');
  await page.getByRole('button', { name: 'Connect board', exact: true }).click();
  await expect(page.getByText('Atlas roadmap', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByLabel('Task title').fill('Ship the next release');
  await page.getByLabel('Task description').fill('Verify release checks');
  await page.getByRole('button', { name: 'Add to GitHub', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Ship the next release', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Board actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Change GitHub Projects board…', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Project settings', exact: true });
  await expect(settings.getByRole('tab', { name: 'Board connection' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(settings.getByRole('region', { name: 'Change board' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(settings).toHaveCount(0);
  await expect(page.getByText('Atlas roadmap', { exact: true })).toBeVisible();
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
  await page
    .locator('.project-tree')
    .getByRole('button', { name: 'Platform', exact: true })
    .click();
  await page.getByRole('button', { name: 'Connect a GitHub Projects board', exact: true }).click();
  await expect(page.getByLabel('GitHub device code')).toHaveValue('ABCD-1234');
  await expect(page.getByRole('button', { name: 'Connect board', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Connect a GitHub Projects board', exact: true }).click();
  await expect(page.getByLabel('GitHub device code')).toHaveValue('ABCD-1234');
  await page.evaluate(() => (window as any).approveGitHub());
  await expect(page.getByText('GitHub access granted')).toBeVisible();
  await page.getByRole('button', { name: 'Authorized roadmap #1', exact: true }).click();
  await page.getByRole('button', { name: 'Connect board', exact: true }).click();
  await expect(page.getByText('Authorized roadmap', { exact: true })).toBeVisible();
});

test('choose an existing GitHub project or create one without entering a URL', async ({ page }) => {
  await page.goto('/');
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await page.getByRole('button', { name: 'Connect a GitHub Projects board', exact: true }).click();
  await page.getByLabel('Search GitHub projects').fill('roadmap');
  await page.getByRole('button', { name: 'Atlas roadmap #1', exact: true }).click();
  await page.getByRole('button', { name: 'Connect board', exact: true }).click();
  await expect(page.getByText('Atlas roadmap', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Board actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Change GitHub Projects board…', exact: true }).click();
  await page.getByRole('button', { name: 'Create new', exact: true }).click();
  await expect(page.getByLabel('New GitHub Projects board name')).toHaveValue('Atlas');
  await page.getByLabel('New GitHub Projects board name').fill('Next release');
  await page.getByRole('button', { name: 'Create GitHub Projects board', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Created “Next release”' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Connect board', exact: true }).click();
  await expect(
    page.getByLabel('Project tracker').getByText('Next release', { exact: true }),
  ).toBeVisible();
});

test('add repositories can create a project, then clone a GitHub repo into it', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Add code folders to Atlas', exact: true })
    .first()
    .click();
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
  await page
    .locator('.project-group')
    .filter({ has: page.getByRole('button', { name: 'Mobile', exact: true }) })
    .getByRole('button', { name: 'Add code folders to Mobile', exact: true })
    .click();
  await expect(dialog.getByRole('combobox', { name: 'Add to project' })).toContainText('Mobile');
  await dialog.getByRole('button', { name: 'Clone from GitHub', exact: true }).click();
  await dialog.getByLabel('Search GitHub repositories').fill('mobile');
  await dialog.getByRole('radio', { name: /example\/mobile-app/ }).click();
  await dialog.getByRole('button', { name: 'Clone into project', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const group = page
    .locator('.project-group')
    .filter({ has: page.getByRole('button', { name: 'Mobile', exact: true }) });
  await expect(group.getByRole('button', { name: 'mobile-app', exact: true })).toBeVisible();
  await group.getByRole('button', { name: 'Add code folders to Mobile', exact: true }).click();
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
  await page.getByRole('button', { name: 'Add code folders to Platform', exact: true }).click();
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
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await page.getByRole('button', { name: 'Connect a GitHub Projects board', exact: true }).click();
  await page.getByRole('button', { name: 'Atlas roadmap #1', exact: true }).click();
  await page.getByRole('button', { name: 'Connect board', exact: true }).click();
  const board = page.getByRole('region', { name: 'Tracker board', exact: true });
  await expect(board).toBeVisible();
  await expect(
    board
      .getByRole('region', { name: 'Todo column', exact: true })
      .getByRole('button', { name: 'Review authentication', exact: true }),
  ).toBeVisible();
  await board.getByRole('button', { name: 'Move task: Review authentication' }).click();
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
  await page
    .getByRole('button', { name: 'Add code folders to Platform', exact: true })
    .first()
    .click();
  const add = page.getByRole('dialog', { name: 'Add code folders', exact: true });
  await add.getByRole('button', { name: 'Clone from GitHub', exact: true }).click();
  // GitHub sign-in is in Settings › Accounts. The clone source links to it.
  await add
    .getByRole('button', { name: 'Check your GitHub account in Settings', exact: true })
    .click();
  const settings = page.getByRole('region', { name: 'Settings', exact: true });
  const access = settings.getByLabel('GitHub Projects board access');
  await expect(access).toContainText('Not allowed');
  await access.getByRole('button', { name: 'Allow access', exact: true }).click();
  await expect(settings.getByLabel('GitHub device code')).toHaveValue('ABCD-1234');
  // The first approval does not force a new sign-in. Allow again does.
  expect(await page.evaluate(() => (window as any).authForced)).toBe(false);
  await settings.getByRole('button', { name: 'Open GitHub', exact: true }).click();
  expect(await page.evaluate(() => (window as any).browserOpens)).toBe(1);
  await page.evaluate(() => (window as any).approve());
  await expect(access).toContainText('Allowed');
  await access.getByRole('button', { name: 'Allow again', exact: true }).click();
  expect(await page.evaluate(() => (window as any).authForced)).toBe(true);
});

test('project navigation replaces the main sidebar and global history page', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Session history/ })).toHaveCount(0);
  await expect(page.getByText('UNGROUPED REPOSITORIES', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Projects and repositories' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('region', { name: 'Settings', exact: true });
  await settings.getByRole('tab', { name: 'Agents', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Agents on this computer' })).toBeVisible();
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await expect(settings).toHaveCount(0);
  await page.screenshot({ path: 'test-results/project-navigation.png', fullPage: true });
});

test('simplified controls remain accessible and selection follows project and conversation', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('.repo-select').first().click();
  await expect(page.getByRole('button', { name: /^Add code folders to / })).toHaveCount(1);
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
  const repository = tree.locator('.repo-select').filter({ hasText: 'atlas-web' });
  await repository.click();
  await expect(repository).toHaveAttribute('aria-current', 'page');
  await page
    .getByRole('button', { name: 'Resume Refine project and repository navigation', exact: true })
    .click();
  // An open session marks its repository as the current location.
  await expect(repository).toHaveAttribute('aria-current', 'location');
  await expect(page.getByRole('region', { name: 'Chats', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preview chat history', exact: true })).toHaveCount(
    0,
  );
});
