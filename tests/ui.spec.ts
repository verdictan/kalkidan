import { test, expect } from '@playwright/test';
test('project navigation, search, editing, worktrees, and sessions', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.repo-select').first().click();
  await expect(page.getByRole('heading', { name: 'atlas-web', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /Worktrees/ }).click();
  await expect(page.getByText('Parallel work, separate branches')).toBeVisible();
  await page.getByRole('button', { name: 'New worktree' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('tab', { name: /Sessions/ }).click();
  await expect(page.getByText('Refine project and repository navigation').last()).toBeVisible();
  await page.getByRole('button', { name: 'Edit repository', exact: true }).click();
  await page.getByLabel('Repository name', { exact: true }).fill('atlas-renamed');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: 'atlas-renamed' })).toBeVisible();
  await page.getByLabel('Search projects or sessions').fill('not-a-project');
  await expect(page.getByText('No matching projects or repositories.')).toBeVisible();
  await page.getByLabel('Search projects or sessions').fill('');
  await page.getByRole('tab', { name: 'Overview' }).click();
  await page.screenshot({ path: 'test-results/desktop-preview.png', fullPage: true });
  await page.keyboard.press('Meta+k');
  await expect(page.getByLabel('Search projects or sessions')).toBeFocused();
  await page.setViewportSize({ width: 980, height: 680 });
  await expect(page.getByRole('button', { name: 'Codex New session' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/compact-preview.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('organize sessions and continue inside the conversation UI', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.repo-select').first().click();
  await page.getByRole('tab', { name: /^Sessions/ }).click();
  await page.getByRole('button', { name: 'Organize Refine project and repository navigation' }).click();
  await page.getByLabel('Session title', { exact: true }).fill('Navigation follow-up');
  await page.getByLabel('Collection', { exact: true }).fill('Website');
  await page.getByLabel('Session notes', { exact: true }).fill('Finish keyboard navigation');
  await page.getByRole('button', { name: 'Pin session', exact: true }).click();
  await page.getByRole('button', { name: 'Save session', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Pinned', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume Navigation follow-up', exact: true })).toBeVisible();
  await expect(page.locator('.session-list').getByText('Review the authentication flow and add integration tests', { exact: true })).not.toBeVisible();
  await page.getByRole('combobox', { name: 'Filter by collection' }).click();
  await page.getByRole('option', { name: 'Website', exact: true }).click();
  await page.getByRole('button', { name: 'Resume session', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Session conversations', exact: true })).toBeVisible();
  await expect(page.getByText('This is a sample conversation.', { exact: false })).toBeVisible();
  await page.getByLabel('Message agent').fill('Continue with keyboard navigation');
  await page.screenshot({ path: 'test-results/conversation-preview.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Open the desktop app');
  await expect(page.getByLabel('Message agent')).toHaveValue('Continue with keyboard navigation');
  await page.getByRole('button', { name: 'Repository details', exact: true }).click();
  await page.getByRole('button', { name: 'Organize Navigation follow-up' }).click();
  await page.getByRole('button', { name: 'Archive session', exact: true }).click();
  await page.getByRole('button', { name: 'Save session', exact: true }).click();
  await expect(page.getByText('No pinned sessions', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume Navigation follow-up', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Organize Navigation follow-up' }).click();
  await page.getByRole('button', { name: 'Archived', exact: true }).last().click();
  await page.getByRole('button', { name: 'Save session', exact: true }).click();
  await page.getByRole('button', { name: 'Active', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume Navigation follow-up', exact: true })).toBeVisible();
});

test('conversation streams responses, keeps multiple turns, and stops without leaving the app', async ({ page }) => {
  await page.addInitScript(() => {
    let run: any;
    let count = 0;
    let polls = 0;
    const session = { id: 'session-1', agent: 'codex', title: 'Live fixture', cwd: '/tmp/project', updatedAt: new Date().toISOString() };
    (window as any).workspace = {
      snapshot: async () => ({ projects: [{ id: 'p1', name: 'My project', path: '/tmp/project', favorite: false, notes: '', addedAt: '' }], groups: [{ id: 'g1', name: 'Test project', repoIds: ['p1'] }], sessions: [session, { ...session, id: 'session-2', title: 'Another fixture' }], warnings: [], platform: 'darwin' }),
      git: async () => null,
      transcript: async () => ({ messages: [{ id: 'old', role: 'user', text: 'Original prompt' }], truncated: false }),
      chatStart: async (_agent: string, _id: string, prompt: string) => { polls = 0; run = { id: 'run-' + ++count, agent: 'codex', sessionId: 'session-1', status: 'running', messages: [], activity: 'Working', prompt }; return { ...run }; },
      chatStatus: async () => { polls++; run.messages = [{ id: 'item-0', role: 'assistant', text: polls < 2 ? 'Working on it' : 'Completed: ' + run.prompt }]; if (polls > 2 && run.prompt !== 'Long task' && run.status !== 'stopped') run.status = 'completed'; return { ...run }; },
      chatStop: async () => { run.status = 'stopped'; },
    };
  });
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.repo-select').first().click();
  await page.getByRole('tab', { name: /^Sessions/ }).click();
  await page.getByRole('button', { name: 'Resume session', exact: true }).first().click();
  await expect(page.getByText('Original prompt', { exact: true })).toBeVisible();
  await page.getByLabel('Message agent').fill('First follow-up');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Completed: First follow-up', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  await page.getByLabel('Message agent').fill('Second follow-up');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Completed: Second follow-up', { exact: true })).toBeVisible();
  await expect(page.getByText('Completed: First follow-up', { exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  await page.getByLabel('Message agent').fill('Long task');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('region', { name: 'Projects and repositories' }).getByRole('button', { name: 'Another fixture CX', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close tab Live fixture', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Open Live fixture', exact: true }).click();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByText('Response stopped. Send another message to continue.')).toBeVisible();
});


test('a session ownership conflict restores the unsent draft and permits an explicit retry', async ({ page }) => {
  await page.addInitScript(() => {
    let attempts = 0;
    let run: any;
    const session = { id: 'locked-session', agent: 'codex', title: 'Locked session', cwd: '/tmp/project', updatedAt: new Date().toISOString() };
    (window as any).workspace = {
      snapshot: async () => ({ projects: [{ id: 'p1', name: 'My project', path: '/tmp/project', favorite: false, notes: '', addedAt: '' }], groups: [{ id: 'g1', name: 'Test project', repoIds: ['p1'] }], sessions: [session], warnings: [], platform: 'darwin' }),
      git: async () => null,
      transcript: async () => ({ messages: [], truncated: false }),
      chatStart: async () => { run = { id: 'run-' + ++attempts, agent: 'codex', sessionId: session.id, status: 'running', messages: [], activity: 'Starting' }; return { ...run }; },
      chatStatus: async () => attempts === 1 ? { ...run, status: 'failed', errorCode: 'session_busy', error: 'This Codex session is already open in another client.' } : { ...run, status: 'completed', messages: [{ id: 'answer', role: 'assistant', text: 'Resumed successfully' }] },
    };
  });
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.repo-select').first().click();
  await page.getByRole('tab', { name: /^Sessions/ }).click();
  await page.getByRole('button', { name: 'Resume session', exact: true }).click();
  await page.getByLabel('Message agent').fill('Keep my follow-up');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('another client');
  await expect(page.getByLabel('Message agent')).toHaveValue('Keep my follow-up');
  await expect(page.locator('.chat-message.user')).toHaveCount(0);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Resumed successfully', { exact: true })).toBeVisible();
  await expect(page.locator('.chat-message.user')).toHaveCount(1);
});


test('integrated conversations keep drafts and project navigation visible', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.repo-select').first().click();
  await page.getByRole('tab', { name: /^Sessions/ }).click();
  await page.getByRole('button', { name: 'Resume session', exact: true }).first().click();
  const workspace = page.getByRole('region', { name: 'Session conversations', exact: true });
  const pane = page.locator('.agent-pane:not([hidden])');
  await expect(workspace).toBeVisible();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await pane.getByLabel('Message agent').fill('Keep this Codex draft');
  await page.getByRole('region', { name: 'Projects and repositories' }).getByRole('button', { name: 'Review the authentication flow and add integration tests CC', exact: true }).click();
  await pane.getByLabel('Message agent').fill('Keep this Claude draft');
  await page.getByRole('button', { name: 'Open Refine project and repository navigation', exact: true }).click();
  await expect(pane.getByLabel('Message agent')).toHaveValue('Keep this Codex draft');
  await page.getByRole('button', { name: 'Toggle session details', exact: true }).click();
  const metadata = pane.getByRole('region', { name: 'Session details', exact: true });
  await expect(metadata).toBeVisible();
  await expect(page.locator('.agent-inspector')).toHaveCount(0);
  await page.setViewportSize({ width: 961, height: 988 });
  const metadataBounds = await metadata.boundingBox();
  const messagesBounds = await pane.locator('.conversation-messages').boundingBox();
  expect(metadataBounds!.y + metadataBounds!.height).toBeLessThanOrEqual(messagesBounds!.y + 1);
  await expect(pane.getByRole('button', { name: 'Send', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'test-results/agent-workspace.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Toggle session details', exact: true }).click();
  await page.setViewportSize({ width: 980, height: 680 });
  await expect(pane.getByRole('button', { name: 'Send', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press('Meta+k');
  await expect(page.getByLabel('Search projects or sessions')).toBeFocused();
  await expect(page.getByRole('region', { name: 'Projects and repositories' })).toBeVisible();
  await page.getByRole('button', { name: 'Repository details', exact: true }).click();
  await page.getByRole('button', { name: 'Atlas 3', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect GitHub', exact: true })).toBeVisible();
  await page.getByRole('region', { name: 'Projects and repositories' }).getByRole('button', { name: 'Refine project and repository navigation CX', exact: true }).click();
  await expect(pane.getByLabel('Message agent')).toHaveValue('Keep this Codex draft');
});

for (const agent of ['codex', 'claude'] as const) {
  test(`${agent} project button creates an in-app session and resumes its next turn`, async ({ page }) => {
    await page.addInitScript(() => {
      let run: any;
      (window as any).calls = [];
      (window as any).workspace = {
        snapshot: async () => ({ projects: [{ id: 'p1', name: 'My project', path: '/tmp/project', favorite: false, notes: '', addedAt: '' }], groups: [{ id: 'g1', name: 'Test project', repoIds: ['p1'] }], sessions: [], warnings: [], platform: 'darwin' }),
        git: async () => null,
        launch: async () => { throw new Error('Agent launch must not open Terminal'); },
        chatCreate: async (projectId: string, agent: string, prompt: string) => { (window as any).calls.push({ kind: 'create', projectId, agent, prompt }); run = { id: 'r1', agent, sessionId: 'provider-session', status: 'running', messages: [], activity: '' }; return { ...run }; },
        chatStart: async (agent: string, sessionId: string, prompt: string) => { (window as any).calls.push({ kind: 'resume', agent, sessionId, prompt }); run = { id: 'r2', agent, sessionId, status: 'running', messages: [], activity: '' }; return { ...run }; },
        chatStatus: async () => ({ ...run, sessionReady: true, status: 'completed', messages: [{ id: 'answer', role: 'assistant', text: 'Reply for ' + run.id }] }),
      };
    });
    await page.goto('http://127.0.0.1:5173');
    await page.locator('.repo-select').first().click();
    await page.getByRole('button', { name: agent === 'codex' ? 'Codex New session' : 'Claude Code New session', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Session conversations', exact: true })).toBeVisible();
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
    await page.addInitScript(({ agent }) => {
      const session = { id: 'saved-session', agent, cwd: '/tmp/project', title: 'Saved conversation', updatedAt: new Date().toISOString() };
      let run: any;
      (window as any).resumes = [];
      (window as any).workspace = {
        snapshot: async () => ({ projects: [{ id: 'p1', name: 'My project', path: '/tmp/project', favorite: false, notes: '', addedAt: '' }], groups: [{ id: 'g1', name: 'Test project', repoIds: ['p1'] }], sessions: [session], warnings: [], platform: 'darwin' }),
        git: async () => null,
      transcript: async () => ({ messages: [{ id: 'old', role: 'assistant', text: 'Previous conversation context' }], truncated: false }),
        launch: async () => { throw new Error('Terminal must not open'); },
        chatStart: async (agent: string, sessionId: string, prompt: string) => {
          (window as any).resumes.push({ agent, sessionId, prompt });
          run = { id: 'response', agent, sessionId, status: 'running', messages: [], activity: '' };
          return { ...run };
        },
        chatStatus: async () => ({ ...run, status: 'completed', messages: [{ id: 'new', role: 'assistant', text: 'Continued in Kalkidan' }] }),
      };
    }, { agent });
    await page.goto('http://127.0.0.1:5173');
    await page.locator('.repo-select').first().click();
    await page.getByRole('tab', { name: /^Sessions/ }).click();
    await page.getByRole('button', { name: 'Resume Saved conversation', exact: true }).click();
    await expect(page.getByText('Previous conversation context', { exact: true })).toBeVisible();
    await page.getByLabel('Message agent').fill('Continue where we left off');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Continued in Kalkidan', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).resumes)).toEqual([{ agent, sessionId: 'saved-session', prompt: 'Continue where we left off' }]);
  });
}

test('projects group multiple repositories and each repository opens its own sessions', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173');
  const tree = page.getByRole('region', { name: 'Projects and repositories' });
  await expect(tree.getByText('Atlas', { exact: true })).toBeVisible();
  await expect(tree.getByRole('button', { name: 'atlas-web 2', exact: true })).toBeVisible();
  await tree.getByRole('button', { name: 'api-service 0', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'api-service', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New project group' }).click();
  await page.getByLabel('Project name', { exact: true }).fill('Infrastructure');
  await page.getByRole('button', { name: 'Atlas roadmap #1', exact: true }).click();
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await tree.getByRole('button', { name: 'api-service 0', exact: true }).click();
  await page.getByRole('button', { name: 'Edit repository', exact: true }).click();
  await page.getByRole('combobox', { name: 'Project', exact: true }).click();
  await page.getByRole('option', { name: 'Infrastructure', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  const infrastructure = tree.locator('.project-group').filter({ has: page.getByText('Infrastructure', { exact: true }) });
  await expect(infrastructure.getByRole('button', { name: 'api-service 0', exact: true })).toBeVisible();
  await tree.getByRole('button', { name: 'atlas-web 2', exact: true }).click();
  await tree.getByRole('button', { name: /Refine project and repository navigation/ }).click();
  await expect(page.getByRole('region', { name: 'Session conversations', exact: true })).toBeVisible();
  await expect(page.getByText('Atlas / atlas-web', { exact: true })).toHaveCount(0);
});

test('GitHub task status, repository choice, and composer model carry through to an agent turn', async ({ page }) => {
  await page.addInitScript(() => {
    const project = { id: 'gh1', title: 'Roadmap', url: 'https://github.com/orgs/example/projects/1', owner: 'example', number: 1 };
    let statusId = 'todo'; let run: any;
    (window as any).requests = [];
    (window as any).workspace = {
      snapshot: async () => ({ projects: [{ id: 'web', name: 'Web', path: '/tmp/web', favorite: false, notes: '', addedAt: '' }, { id: 'api', name: 'API', path: '/tmp/api', favorite: false, notes: '', addedAt: '' }], groups: [{ id: 'platform', name: 'Platform', repoIds: ['web','api'], github: project }], sessions: [], warnings: [], platform: 'darwin' }),
      git: async () => null,
      models: async () => [{ id: 'opus', name: 'Opus' }],
      githubAuthCancel: async () => ({ status: 'idle' }),
      githubBoard: async () => ({ project, statusField: { id: 'status', options: [{ id: 'todo', name: 'Todo' }, { id: 'done', name: 'Done' }] }, items: [{ id: 'item1', title: 'Fix login', body: 'Handle expired cookies', statusId, status: statusId === 'done' ? 'Done' : 'Todo' }] }),
      githubStatus: async (groupId: string, item: string, option: string) => { statusId = option; (window as any).requests.push({ groupId, item, option }); },
      chatCreate: async (repoId: string, agent: string, prompt: string, _edits: boolean, options: any) => { (window as any).requests.push({ repoId, agent, prompt, options }); run = { id: 'r1', sessionId: 'saved', sessionReady: true, agent, status: 'running', messages: [], activity: '' }; return { ...run }; },
      chatStatus: async () => ({ ...run, status: 'completed', messages: [{ id: 'a', role: 'assistant', text: 'Task context received' }] }),
      updateSession: async () => {},
    };
  });
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Platform 2', exact: true }).click();
  await page.getByRole('combobox', { name: 'Status for Fix login' }).click();
  await page.getByRole('option', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Status for Fix login' })).toContainText('Done');
  await page.screenshot({ path: 'test-results/github-project.png', fullPage: true });
  await page.getByRole('button', { name: 'Work on this' }).click();
  await page.getByRole('combobox', { name: 'Task repository' }).click();
  await page.getByRole('option', { name: 'API', exact: true }).click();
  await page.getByRole('button', { name: 'Open in Claude Code' }).click();
  await expect(page.getByLabel('Message agent')).toHaveValue(/Fix login/);
  await page.getByRole('combobox', { name: 'Model', exact: true }).click();
  await page.getByRole('option', { name: 'Opus', exact: true }).click();
  await expect(page.getByRole('listbox')).not.toBeVisible();
  await page.getByLabel('Message agent').fill('Plan the fix');
  await page.screenshot({ path: 'test-results/composer-model.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Task context received', { exact: true })).toBeVisible();
  const requests = await page.evaluate(() => (window as any).requests);
  expect(requests[0]).toEqual({ groupId: 'platform', item: 'item1', option: 'done' });
  expect(requests[1]).toMatchObject({ repoId: 'api', agent: 'claude', prompt: 'Plan the fix', options: { model: 'opus', taskId: 'item1' } });
});

test('a project can connect, create a GitHub draft, and change its connection in preview', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Atlas 3', exact: true }).click();
  await page.getByRole('button', { name: 'Connect GitHub', exact: true }).click();
  await page.getByRole('button', { name: 'Use URL', exact: true }).click();
  await page.getByLabel('GitHub URL').fill('https://github.com/orgs/example/projects/1');
  await page.getByRole('button', { name: 'Connect project', exact: true }).click();
  await expect(page.getByText('Atlas roadmap', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New item', exact: true }).click();
  await page.getByLabel('Item title').fill('Ship the next release');
  await page.getByLabel('Item description').fill('Verify release checks');
  await page.getByRole('button', { name: 'Add to GitHub', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ship the next release', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'GitHub project', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Connect GitHub Project', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('Atlas roadmap', { exact: true })).toBeVisible();
});

test('GitHub connection waits for browser approval and supports cancel and retry', async ({ page }) => {
  await page.addInitScript(() => {
    let state: any = { status: 'idle' }; let linked = false;
    const project = { id: 'gh', title: 'Authorized roadmap', url: 'https://github.com/orgs/example/projects/1', owner: 'example', number: 1 };
    (window as any).approveGitHub = () => { state = { status: 'ready' }; };
    (window as any).workspace = {
      snapshot: async () => ({ projects: [], groups: [{ id: 'p', name: 'Platform', repoIds: [], github: linked ? project : undefined }], sessions: [], warnings: [], platform: 'darwin' }),
      githubAuthStart: async () => state = { status: 'waiting', code: 'ABCD-1234' },
      githubAuthStatus: async () => state,
      githubAuthCancel: async () => state = { status: 'idle' },
      githubAuthOpen: async () => {},
      githubOwners: async () => [{ id: 'example', login: 'example', kind: 'organization' }],
      githubProjects: async () => [project],
      githubLink: async () => { if (state.status !== 'ready') throw new Error('Not authorized'); linked = true; },
      githubBoard: async () => ({ project, items: [] }),
    };
  });
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Platform 0', exact: true }).click();
  await page.getByRole('button', { name: 'Connect GitHub', exact: true }).click();
  await expect(page.getByLabel('GitHub device code')).toHaveValue('ABCD-1234');
  await expect(page.getByRole('button', { name: 'Connect project', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Connect GitHub', exact: true }).click();
  await page.evaluate(() => (window as any).approveGitHub());
  await expect(page.getByText('GitHub access granted')).toBeVisible();
  await page.getByRole('button', { name: 'Authorized roadmap #1', exact: true }).click();
  await page.getByRole('button', { name: 'Connect project', exact: true }).click();
  await expect(page.getByText('Authorized roadmap', { exact: true })).toBeVisible();
});

test('choose an existing GitHub project or create one without entering a URL', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Atlas 3', exact: true }).click();
  await page.getByRole('button', { name: 'Connect GitHub', exact: true }).click();
  await page.getByLabel('Search GitHub projects').fill('roadmap');
  await page.getByRole('button', { name: 'Atlas roadmap #1', exact: true }).click();
  await page.getByRole('button', { name: 'Connect project', exact: true }).click();
  await expect(page.getByText('Atlas roadmap', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'GitHub project', exact: true }).click();
  await page.getByRole('button', { name: 'Create new', exact: true }).click();
  await expect(page.getByLabel('New GitHub project name')).toHaveValue('Atlas');
  await page.getByLabel('New GitHub project name').fill('Next release');
  await page.getByRole('button', { name: 'Create GitHub project', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Created “Next release”');
  await page.getByRole('button', { name: 'Connect project', exact: true }).click();
  await expect(page.getByText('Next release', { exact: true })).toBeVisible();
});

test('add repositories can create a project, pick a GitHub repo, and clone into it', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Add repository', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add repositories', exact: true });
  await dialog.getByRole('button', { name: 'Create a new project', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Create project', exact: true });
  await create.getByLabel('Project name', { exact: true }).fill('Mobile');
  await create.getByRole('button', { name: 'Atlas roadmap #1', exact: true }).click();
  await create.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: 'Add to project' })).toContainText('Mobile');
  await dialog.getByLabel('Search GitHub repositories').fill('mobile');
  await dialog.getByRole('button', { name: /example\/mobile-app/ }).click();
  await dialog.getByRole('button', { name: 'Choose location and clone', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const group = page.locator('.project-group').filter({ has: page.getByRole('button', { name: 'Mobile 1', exact: true }) });
  await expect(group.getByRole('button', { name: 'mobile-app 0', exact: true })).toBeVisible();
  await group.getByRole('button', { name: 'Add repositories', exact: true }).click();
  await dialog.getByRole('button', { name: 'From library', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Repository from library' }).click();
  await page.getByRole('option', { name: /design-system ·/ }).click();
  await dialog.getByRole('button', { name: 'Add to project', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mobile 2', exact: true })).toBeVisible();
});

test('local folder selection keeps the chosen project and clone cancellation keeps dialog open', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).addedTo = '';
    (window as any).workspace = {
      snapshot: async () => ({ projects: [], groups: [{ id: 'p', name: 'Platform', repoIds: [] }], sessions: [], warnings: [], platform: 'darwin' }),
      githubRepositories: async () => [],
      cloneRepository: async () => false,
      add: async (id: string) => { (window as any).addedTo = id; },
    };
  });
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Add repositories', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('GitHub repository name').fill('example/web');
  await dialog.getByRole('button', { name: 'Choose location and clone', exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Local folders', exact: true }).click();
  await dialog.getByRole('button', { name: 'Choose folders', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(await page.evaluate(() => (window as any).addedTo)).toBe('p');
});

test('tracker board groups tasks, syncs status moves, and filters', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Atlas 3', exact: true }).click();
  await page.getByRole('button', { name: 'Connect GitHub', exact: true }).click();
  await page.getByRole('button', { name: 'Atlas roadmap #1', exact: true }).click();
  await page.getByRole('button', { name: 'Connect project', exact: true }).click();
  const board = page.getByRole('region', { name: 'Tracker board', exact: true });
  await expect(board).toBeVisible();
  await expect(board.getByRole('region', { name: 'Todo column', exact: true }).getByRole('button', { name: 'Review authentication', exact: true })).toBeVisible();
  await board.getByRole('combobox', { name: 'Status for Review authentication' }).click();
  await page.getByRole('option', { name: 'Done', exact: true }).click();
  await expect(board.getByRole('region', { name: 'Done column', exact: true }).getByRole('button', { name: 'Review authentication', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/tracker-board.png', fullPage: true });
  await page.getByLabel('Search GitHub items').fill('authentication');
  await expect(board.getByRole('button', { name: 'Build the project overview', exact: true })).toHaveCount(0);
  await board.getByRole('button', { name: 'Work on this', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Review authentication');
});

test('repository authorization explicitly requests browser login and shows approval feedback', async ({ page }) => {
  await page.addInitScript(() => {
    let state: any = { status: 'idle' };
    (window as any).authForced = false; (window as any).browserOpens = 0;
    (window as any).approve = () => { state = { status: 'ready' }; };
    (window as any).workspace = {
      snapshot: async () => ({ projects: [], groups: [], sessions: [], warnings: [], platform: 'darwin' }),
      githubRepositories: async () => state.status === 'ready' ? [{ nameWithOwner: 'example/connected-repo', description: '', isPrivate: true, isArchived: false }] : [],
      githubAuthStart: async (force: boolean) => { (window as any).authForced = force; return state = { status: 'waiting', code: 'ABCD-1234' }; },
      githubAuthStatus: async () => state,
      githubAuthOpen: async () => { (window as any).browserOpens++; },
      githubAuthCancel: async () => state = { status: 'idle' },
    };
  });
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Add repository', exact: true }).first().click();
  await page.getByRole('button', { name: 'Connect or authorize GitHub', exact: true }).click();
  await expect(page.getByLabel('GitHub device code')).toHaveValue('ABCD-1234');
  expect(await page.evaluate(() => (window as any).authForced)).toBe(true);
  await page.getByRole('button', { name: 'Open GitHub', exact: true }).click();
  expect(await page.evaluate(() => (window as any).browserOpens)).toBe(1);
  await page.evaluate(() => (window as any).approve());
  await expect(page.getByRole('status')).toContainText('GitHub connected');
  await expect(page.getByRole('button', { name: /example\/connected-repo/ })).toBeVisible();
});

test('project navigation replaces the main sidebar and global history page', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173');
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Session history/ })).toHaveCount(0);
  await expect(page.getByText('UNGROUPED REPOSITORIES', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Projects and repositories' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Agents');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.screenshot({ path: 'test-results/project-navigation.png', fullPage: true });
});

test('simplified controls remain accessible and selection follows project and conversation', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.repo-select').first().click();
  await expect(page.getByRole('button', { name: 'Add repository', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Discover', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Repository actions', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Open Terminal', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Open folder in Finder', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  const notes = page.getByRole('button', { name: 'Repository notes', exact: true });
  await expect(notes).toHaveAttribute('aria-expanded', 'false');
  await notes.click();
  await expect(notes).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Atlas 3', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Atlas 3', exact: true })).toHaveAttribute('aria-current', 'page');
  const session = page.getByRole('region', { name: 'Projects and repositories' }).getByRole('button', { name: 'Refine project and repository navigation CX', exact: true });
  await session.click();
  await expect(session).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('region', { name: 'Session conversations', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Discover local repositories', exact: true })).toBeVisible();
});
