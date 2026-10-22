import { type Page } from '@playwright/test';
import { test, expect, newChat } from './helpers/app';
import { openCodeFolder, openProjectTab } from './helpers/navigation';
import { openTool } from './helpers/tools';

/** Connects the demo board to Atlas from the Tasks page of the project. */
async function connectAtlasBoard(page: Page) {
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Project page', exact: true })
    .getByRole('button', { name: 'Tasks', exact: true })
    .click();
  await page.getByRole('button', { name: 'Connect a board', exact: true }).click();
  await page.getByRole('button', { name: 'Atlas roadmap #1', exact: true }).click();
  await page.getByRole('button', { name: 'Connect board', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Tracker board', exact: true })).toBeVisible();
}

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
  // The owner has one board, so the picker selects it at once.
  const board = dialog.getByRole('button', { name: 'Atlas roadmap #1', exact: true });
  await expect(board).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('button', { name: 'Create project', exact: true })).toBeEnabled();
  // Without a board, Create project tells what to do and does not create the project.
  await dialog.getByRole('button', { name: 'Use URL', exact: true }).click();
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('or choose Connect later.');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Choose existing', exact: true }).click();
  await board.click();
  await expect(board).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  // The board menu of the Tasks page names the connected board.
  await openProjectTab(page, 'Tasks');
  await page.getByRole('button', { name: 'Board actions', exact: true }).click();
  await expect(page.getByRole('menu', { name: 'Board actions' })).toContainText('Atlas roadmap #1');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Manage project Platform' }).click();
  await page.getByRole('menuitem', { name: 'Rename…', exact: true }).click();
  // Rename opens Project settings at the project name.
  const settings = page.getByRole('dialog', { name: 'Project settings: Platform', exact: true });
  await expect(settings.getByLabel('Project name', { exact: true })).toHaveValue('Platform');
  await expect(settings.getByLabel('Client label', { exact: true })).toHaveCount(0);
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(settings).toHaveCount(0);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  const overview = page.getByRole('region', { name: 'Projects', exact: true });
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
        // The Changes tool shows when the folder has changed files. It reads the working tree.
        workingStatus: async () => ({
          branch: 'feature',
          changed: run?.diff ? 1 : 0,
          untracked: 0,
          ahead: 0,
          published: false,
          defaultBranch: 'main',
        }),
        repositoryDiff: async () => ({
          unstaged: run?.diff || '',
          staged: '',
          untracked: [],
          truncated: false,
        }),
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
    await openCodeFolder(page);
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
    // The steps of the run are folded below its last message. A click on a step shows its output.
    await page.getByRole('button', { name: /^1 step\b/ }).click();
    await page.getByRole('button', { name: /npm test/ }).click();
    await expect(page.getByText('Test output', { exact: true })).toBeVisible();
    // The changes of the run are in the Changes tool of the title bar.
    await openTool(page, 'Changes');
    await expect(
      page
        .getByRole('group', { name: 'Tools', exact: true })
        .getByRole('button', { name: /^Changes/ }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('+change').first()).toBeVisible();
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
  await openProjectTab(page, 'Tasks');
  await page.getByRole('button', { name: 'Implement feature', exact: true }).click();
  const dialog = page.getByRole('dialog');
  // A new branch is the default. Change shows where the task works.
  await expect(dialog).toContainText('Repo · new branch implement-feature');
  await dialog.getByRole('button', { name: 'Change', exact: true }).click();
  const where = dialog.getByRole('group', { name: 'Where to work' });
  await expect(where.getByRole('radio', { name: /^New branch/ })).toBeChecked();
  // The branch field is filled from the task. An empty branch blocks the start.
  await expect(dialog.getByLabel('Task branch')).not.toHaveValue('');
  await dialog.getByLabel('Task branch').clear();
  await expect(dialog.getByRole('button', { name: 'Start task with Codex' })).toBeDisabled();
  await dialog.getByLabel('Task branch').fill('feature/client-task');
  await dialog.getByRole('button', { name: 'Start task with Codex' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Start task with Codex' }).click();
  await expect(dialog).not.toBeVisible();
  // The folder pill of the new chat names the branch copy.
  await expect(
    page.getByRole('button', { name: 'Code folder: task-worktree', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Message agent')).toContainText('Implement feature');
  expect(await page.evaluate(() => (window as any).branches)).toEqual([
    { id: 'r', branch: 'feature/client-task' },
    { id: 'r', branch: 'feature/client-task' },
  ]);
});

test('general conversations can add task context later', async ({ page }) => {
  await page.goto('/');
  await connectAtlasBoard(page);
  await openCodeFolder(page);
  await newChat(page);
  await page.getByLabel('Message agent').fill('General question');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  // Link a task… is in the "+" menu of the composer.
  await page.getByRole('button', { name: 'Add context', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Link a task…', exact: true }).click();
  await page.getByRole('combobox', { name: 'Chat task' }).click();
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
  await connectAtlasBoard(page);
  const tracker = page.getByRole('region', { name: 'Project tracker' });
  await expect(tracker.getByRole('button', { name: 'Filter', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await tracker.getByRole('combobox', { name: 'Filter by GitHub repository' }).click();
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
  await openCodeFolder(page, 'api-service');
  await expect(page.getByRole('heading', { name: 'api-service', exact: true })).toBeVisible();
  await openProjectTab(page, 'Tasks');
  await page.setViewportSize({ width: 980, height: 680 });
  await expect(tracker.getByRole('region', { name: 'Tracker board', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/project-tracker-compact.png' });
});

test('project board moves tasks and starts work in the selected repository', async ({ page }) => {
  await page.goto('/');
  await connectAtlasBoard(page);
  const tasks = page.getByRole('region', { name: 'Project tracker', exact: true });
  await expect(tasks.getByRole('region', { name: 'Tracker board', exact: true })).toBeVisible();
  // Card actions show on hover.
  await tasks.getByRole('button', { name: 'Build the project overview', exact: true }).hover();
  await tasks.getByRole('button', { name: 'Task menu: Build the project overview' }).click();
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
  // Change shows the code folder and the branch of the task.
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Change', exact: true }).click();
  const where = sheet.getByRole('group', { name: 'Where to work' });
  await where.getByRole('radio', { name: 'api-service', exact: true }).check();
  await expect(sheet).toContainText('api-service · new branch');
  await where.getByRole('radio', { name: 'atlas-web', exact: true }).check();
  await expect(where.getByRole('radio', { name: 'atlas-web', exact: true })).toBeChecked();
  // On main, a branch copy is the default. The preview has no Git, so work on main.
  await where.getByRole('radio', { name: 'Work on main instead', exact: true }).check();
  await page.getByRole('button', { name: 'Start task with Codex', exact: true }).click();
  await expect(page.getByLabel('Message agent')).toContainText('Build the project overview');
  // The folder pill of the new chat names the selected code folder.
  await expect(page.getByRole('button', { name: /^Code folder: atlas-web/ })).toBeVisible();
});
