import { test, expect } from '@playwright/test';

test('project creation is GitHub-backed without client fields or navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('combobox', { name: 'Filter projects by client' })).toHaveCount(0);
  await page.getByRole('main').getByRole('button', { name: 'New project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New project', exact: true });
  await expect(dialog.getByLabel('Client label', { exact: true })).toHaveCount(0);
  await dialog.getByLabel('Project name', { exact: true }).fill('Platform');
  // The tracker is optional, so a name is sufficient to create the project.
  await expect(dialog.getByRole('button', { name: 'Create project', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'More options', exact: true }).click();
  await dialog.getByRole('button', { name: 'Connect now', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Create project', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Atlas roadmap #1', exact: true }).click();
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('region', { name: 'Project tracker' })).toContainText(
    'Atlas roadmap',
  );
  await page.getByRole('button', { name: 'Manage project Platform' }).click();
  await page.getByRole('menuitem', { name: 'Rename…', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Client label', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  const overview = page.getByRole('region', { name: 'Project overview' });
  await expect(overview.getByRole('button', { name: 'Platform', exact: true })).toBeVisible();
  await expect(overview.getByRole('button', { name: 'Atlas', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/project-directory.png' });
});

for (const allow of [true, false])
  test(`approval cards ${allow ? 'allow' : 'deny'} only the pending request and show expandable output`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const repo = {
        id: 'r',
        name: 'Repo',
        path: '/tmp/repo',
        notes: '',
        favorite: false,
        addedAt: '',
      };
      const session = {
        id: 's',
        agent: 'codex',
        title: 'Review changes',
        cwd: '/tmp/repo',
        updatedAt: new Date().toISOString(),
      };
      let run: any;
      (window as any).answers = [];
      (window as any).workspace = {
        snapshot: async () => ({
          projects: [repo],
          groups: [{ id: 'g', name: 'Project work', repoIds: ['r'] }],
          sessions: [session],
          warnings: [],
          platform: 'darwin',
        }),
        git: async () => null,
        transcript: async () => ({ messages: [], truncated: false }),
        chatStart: async () =>
          (run = {
            id: 'run',
            agent: 'codex',
            sessionId: 's',
            sessionReady: true,
            status: 'running',
            activity: 'Waiting for your approval',
            messages: [],
            approvals: [
              { id: 'approval', title: 'Allow command?', detail: 'npm test', status: 'pending' },
            ],
            tools: [{ id: 't', title: 'npm test', status: 'inProgress', detail: 'Test output' }],
          }),
        chatStatus: async () => run,
        chatApprove: async (id: string, approval: string, allow: boolean) => {
          (window as any).answers.push({ id, approval, allow });
          run = {
            ...run,
            status: 'completed',
            messages: [
              { id: 'm', role: 'assistant', text: allow ? 'Checks complete' : 'Request declined' },
            ],
            diff: '--- a/file\n+++ b/file\n+change',
            approvals: [{ ...run.approvals[0], status: allow ? 'approved' : 'denied' }],
          };
        },
      };
    });
    await page.goto('/');
    await page.locator('.repo-select').click();
    await page.getByRole('button', { name: 'Resume Review changes', exact: true }).click();
    await page.getByLabel('Message agent').fill('Review and test');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Waiting for your approval');
    await expect(page.getByRole('region', { name: 'Agent approval' })).toContainText('npm test');
    await page.screenshot({ path: `test-results/approval-${allow}.png` });
    await page.getByRole('button', { name: allow ? 'Allow once' : 'Deny', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Agent approval' })).not.toBeVisible();
    await expect(
      page.getByText(allow ? 'Checks complete' : 'Request declined', { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => (window as any).answers)).toEqual([
      { id: 'run', approval: 'approval', allow },
    ]);
    await page.getByRole('button', { name: 'Activity · 1 step' }).click();
    await page.getByRole('button', { name: /npm test Running/ }).click();
    await expect(page.getByText('Test output', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'View changes', exact: true }).click();
    await expect(page.locator('pre').filter({ hasText: '+change' })).toBeVisible();
  });

test('task worktree cancellation keeps the task open and a created worktree becomes the session folder', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const repo = {
      id: 'r',
      name: 'Repo',
      path: '/tmp/repo',
      notes: '',
      favorite: false,
      addedAt: '',
    };
    const repos = [repo];
    const github = {
      id: 'gh',
      title: 'Roadmap',
      url: 'https://github.com/orgs/example/projects/1',
      owner: 'example',
      number: 1,
    };
    let attempts = 0;
    (window as any).branches = [];
    (window as any).workspace = {
      snapshot: async () => ({
        projects: repos,
        groups: [{ id: 'g', name: 'Project work', repoIds: repos.map((r) => r.id), github }],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      git: async () => null,
      githubAuthCancel: async () => ({}),
      githubBoard: async () => ({
        project: github,
        items: [{ id: 'task', title: 'Implement feature', body: 'Details' }],
      }),
      taskWorktree: async (id: string, branch: string) => {
        (window as any).branches.push({ id, branch });
        if (!attempts++) return null;
        const tree = { ...repo, id: 'tree', name: 'Task worktree', path: '/tmp/task-worktree' };
        repos.push(tree);
        return tree;
      },
    };
  });
  await page.goto('/');
  await page.locator('.project-tree').getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByRole('button', { name: 'Implement feature', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('radio', { name: 'In a separate copy on a new branch (recommended)' })
    .check();
  // The branch field is filled from the task. An empty branch blocks the start.
  await expect(dialog.getByLabel('Task branch')).not.toHaveValue('');
  await dialog.getByLabel('Task branch').clear();
  await expect(dialog.getByRole('button', { name: 'New Codex session' })).toBeDisabled();
  await dialog.getByLabel('Task branch').fill('feature/client-task');
  await dialog.getByRole('button', { name: 'New Codex session' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'New Codex session' }).click();
  await expect(dialog).not.toBeVisible();
  // The tool launcher names the session folder.
  await page.getByRole('button', { name: 'New tool tab', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Repository tools', exact: true })).toContainText(
    'task-worktree · This computer',
  );
  await expect(page.getByLabel('Message agent')).toContainText('Implement feature');
  expect(await page.evaluate(() => (window as any).branches)).toEqual([
    { id: 'r', branch: 'feature/client-task' },
    { id: 'r', branch: 'feature/client-task' },
  ]);
});

test('general conversations can add task context later', async ({ page }) => {
  await page.goto('/');
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await page.getByRole('button', { name: 'Connect a GitHub Projects board', exact: true }).click();
  await page.getByRole('button', { name: 'Atlas roadmap #1', exact: true }).click();
  await page.getByRole('button', { name: 'Connect board', exact: true }).click();
  await page.locator('.repo-select').first().click();
  await page.getByRole('button', { name: 'New Codex session', exact: true }).click();
  await page.getByLabel('Message agent').fill('General question');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Link task', exact: true }).click();
  await page.getByRole('combobox', { name: 'Session task' }).click();
  await page.getByRole('option', { name: 'Build the project overview', exact: true }).click();
  await page.getByRole('button', { name: 'Save task link', exact: true }).click();
  await expect(page.getByText('Task · Build the project overview')).toBeVisible();
  await expect(page.getByLabel('Message agent')).toHaveValue('General question');
});

test('project opens its board and filters tasks by repository', async ({ page }) => {
  // Few tasks hide the Filter button. A saved sort keeps the filters open.
  await page.addInitScript(() =>
    localStorage.setItem('kalkidan-tracker-filters:atlas', JSON.stringify({ sort: 'title' })),
  );
  await page.goto('/');
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await page.getByRole('button', { name: 'Connect a GitHub Projects board', exact: true }).click();
  await page.getByRole('button', { name: 'Atlas roadmap #1', exact: true }).click();
  await page.getByRole('button', { name: 'Connect board', exact: true }).click();
  const tracker = page.getByRole('region', { name: 'Project tracker' });
  await expect(tracker.getByRole('button', { name: 'Filter', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await tracker.getByRole('combobox', { name: 'Filter by repository' }).click();
  await page.getByRole('option', { name: 'example/api-service', exact: true }).click();
  await expect(
    tracker.getByRole('button', { name: 'Review authentication', exact: true }),
  ).toBeVisible();
  await expect(
    tracker.getByRole('button', { name: 'Build the project overview', exact: true }),
  ).toHaveCount(0);
  await expect(tracker.getByRole('tab')).toHaveCount(0);
  await expect(page.locator('.library-footer')).toHaveCount(0);
  await expect(
    page.locator('.sidebar-github').getByRole('button', { name: 'GitHub project', exact: true }),
  ).toHaveCount(0);
  await tracker.getByRole('button', { name: 'Clear filters' }).click();
  await expect(
    tracker.getByRole('button', { name: 'Build the project overview', exact: true }),
  ).toBeVisible();
  await page.locator('.repo-select').filter({ hasText: 'api-service' }).click();
  await expect(page.getByRole('heading', { name: 'api-service', exact: true })).toBeVisible();
  await page.locator('.project-tree').getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.setViewportSize({ width: 980, height: 680 });
  await expect(tracker.getByRole('region', { name: 'Tracker board', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/project-tracker-compact.png' });
});

test('project board moves tasks and starts work in the selected repository', async ({ page }) => {
  await page.goto('/');
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await page.getByRole('button', { name: 'Connect a GitHub Projects board', exact: true }).click();
  await page.getByRole('button', { name: 'Atlas roadmap #1', exact: true }).click();
  await page.getByRole('button', { name: 'Connect board', exact: true }).click();
  const tasks = page.getByRole('region', { name: 'Project tracker', exact: true });
  await expect(tasks.getByRole('region', { name: 'Tracker board', exact: true })).toBeVisible();
  await tasks.getByRole('button', { name: 'Move task: Build the project overview' }).click();
  await page.getByRole('menuitem', { name: 'Done', exact: true }).click();
  await expect(tasks.getByRole('region', { name: 'Done column', exact: true })).toContainText(
    'Build the project overview',
  );
  await expect(page.locator('.return-conversation, .projects-home, .sidebar-github>p')).toHaveCount(
    0,
  );
  await page.setViewportSize({ width: 961, height: 988 });
  await page.screenshot({ path: 'test-results/project-board-tasks.png', fullPage: true });
  await tasks.getByRole('button', { name: 'Build the project overview', exact: true }).click();
  await page.getByRole('combobox', { name: 'Task repository', exact: true }).click();
  await page.getByRole('option', { name: 'atlas-web', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Task repository', exact: true })).toContainText(
    'atlas-web',
  );
  // On main, a branch copy is the default. The preview has no Git, so work in the folder.
  await page.getByRole('radio', { name: 'In atlas-web on main', exact: true }).check();
  await page.getByRole('button', { name: 'New Codex session', exact: true }).click();
  await expect(page.getByLabel('Message agent')).toContainText('Build the project overview');
  await expect(
    page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button', { name: /atlas-web/ }),
  ).toBeVisible();
});
