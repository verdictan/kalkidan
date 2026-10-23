import { type Page } from '@playwright/test';
import { test, expect, newChat, settingsDialog, settingsSection } from './helpers/app';
import { openCodeFolder, openProjectTab } from './helpers/navigation';

/** Connects the demo board to Atlas from the Tasks page of the project. */
async function connectAtlasBoard(page: Page) {
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Project page', exact: true })
    .getByRole('button', { name: 'Tasks', exact: true })
    .click();
  // The Tasks tab lists the boards on the page; one click connects a board.
  await page.getByRole('button', { name: 'Connect Atlas roadmap #1', exact: true }).click();
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
  await expect(
    page.getByRole('button', { name: 'Board: Atlas roadmap #1', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Manage project Platform' }).click();
  await page.getByRole('menuitem', { name: 'Rename…', exact: true }).click();
  // Rename opens a dialog with the project name.
  const rename = page.getByRole('dialog', { name: 'Rename project', exact: true });
  await expect(rename.getByLabel('Project name', { exact: true })).toHaveValue('Platform');
  await page.keyboard.press('Escape');
  await expect(rename).toHaveCount(0);
  // The project section of Settings has no client field.
  await page.getByRole('button', { name: 'Manage project Platform' }).click();
  await page.getByRole('menuitem', { name: 'Project settings…', exact: true }).click();
  const settings = settingsDialog(page);
  await expect(settingsSection(page, 'Platform')).toHaveAttribute('aria-selected', 'true');
  await expect(settings.getByLabel('Client label', { exact: true })).toHaveCount(0);
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(settings).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Projects and repositories' })
    .getByRole('button', { name: 'Projects', exact: true })
    .click();
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
    // The live step shows under the steps fold, and the chat row shows that it waits for you.
    await expect(page.getByRole('button', { name: 'npm test Running', exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Waiting for your approval' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Agent approval' })).toContainText('npm test');
    await page.screenshot({ path: `test-results/approval-${allow}.png` });
    await page.getByRole('button', { name: allow ? 'Allow' : 'Deny', exact: true }).click();
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
    // The changes of the run open from Review on the changes row of the chat.
    const review = page.getByRole('button', { name: 'Review', exact: true });
    await review.click();
    await expect(review).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { name: 'Changes', exact: true })).toBeVisible();
    // The diff shows no "+" mark. A screen reader hears "Added".
    await expect(page.getByLabel('Git diff')).toContainText('Added: change');
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
  // A new branch is the default. "Where to work" names the folder and the branch, and opens
  // the choice.
  const whereButton = dialog.getByRole('button', {
    name: 'Where to work: Repo · implement-feature',
    exact: true,
  });
  await whereButton.click();
  const where = page.getByRole('dialog', { name: 'Where to work', exact: true });
  await expect(where.getByRole('radio', { name: 'New branch', exact: true })).toBeChecked();
  // The branch field is filled from the task. An empty branch blocks the start.
  await expect(where.getByLabel('Task branch')).not.toHaveValue('');
  await where.getByLabel('Task branch').clear();
  await expect(dialog.getByRole('button', { name: 'Start task with Codex' })).toBeDisabled();
  await where.getByLabel('Task branch').fill('feature/client-task');
  await page.keyboard.press('Escape');
  await expect(where).toHaveCount(0);
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
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Message agent')).toHaveValue('General question');
  // A chat links one task, so the "+" menu no longer offers a link.
  await page.getByRole('button', { name: 'Add context', exact: true }).click();
  await expect(page.getByRole('menuitem').first()).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Link a task…', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  // The chat menu shows the link before the first message saves it.
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Open linked task', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Link task…', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('project opens its board and filters tasks by repository', async ({ page }) => {
  await page.goto('/');
  await connectAtlasBoard(page);
  const tracker = page.getByRole('region', { name: 'Project tracker' });
  // Few tasks need no filter controls. Other pages filter the board by a repository with an
  // event, and a removable chip shows the filter.
  await expect(tracker.getByRole('button', { name: 'Filter', exact: true })).toHaveCount(0);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('kalkidan-board-filter', { detail: { repository: 'example/api-service' } }),
    ),
  );
  await expect(
    tracker.getByRole('button', { name: 'Review authentication', exact: true }),
  ).toBeVisible();
  await expect(
    tracker.getByRole('button', { name: 'Build the project overview', exact: true }),
  ).toHaveCount(0);
  await expect(tracker.getByRole('tab')).toHaveCount(0);
  await expect(page.locator('.library-footer')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'GitHub project', exact: true })).toHaveCount(0);
  await tracker.getByRole('button', { name: 'Clear the filter api-service', exact: true }).click();
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
  // The card menu opens on a right-click.
  await tasks
    .getByRole('button', { name: 'Build the project overview', exact: true })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Done', exact: true }).click();
  await expect(tasks.getByRole('region', { name: 'Done column', exact: true })).toContainText(
    'Build the project overview',
  );
  await expect(page.locator('.return-conversation, .projects-home')).toHaveCount(0);
  await page.setViewportSize({ width: 961, height: 988 });
  await page.screenshot({ path: 'test-results/project-board-tasks.png', fullPage: true });
  await tasks.getByRole('button', { name: 'Build the project overview', exact: true }).click();
  // "Where to work" shows the code folder and the branch of the task.
  const sheet = page.getByRole('dialog', { name: 'Build the project overview', exact: true });
  await sheet.getByRole('button', { name: /^Where to work: / }).click();
  const where = page.getByRole('dialog', { name: 'Where to work', exact: true });
  await where.getByRole('radio', { name: 'api-service', exact: true }).check();
  await expect(where.getByRole('radio', { name: 'New branch', exact: true })).toBeChecked();
  // Escape closes the choice. The button names the folder and the branch.
  await page.keyboard.press('Escape');
  await expect(where).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: /^Where to work: api-service · / })).toBeVisible();
  await sheet.getByRole('button', { name: /^Where to work: / }).click();
  await where.getByRole('radio', { name: 'atlas-web', exact: true }).check();
  await expect(where.getByRole('radio', { name: 'atlas-web', exact: true })).toBeChecked();
  // On main, a branch copy is the default. The preview has no Git, so work on main.
  await where.getByRole('radio', { name: 'Work on main', exact: true }).check();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Start task with Codex', exact: true }).click();
  await expect(page.getByLabel('Message agent')).toContainText('Build the project overview');
  // The folder pill of the new chat names the selected code folder.
  await expect(page.getByRole('button', { name: /^Code folder: atlas-web/ })).toBeVisible();
});

test('a task linked to a new chat stays linked after the first message', async ({ page }) => {
  await page.addInitScript(() => {
    const repo = {
      id: 'r',
      name: 'Repo',
      path: '/tmp/repo',
      notes: '',
      favorite: false,
      addedAt: '',
    };
    const sessions: any[] = [];
    const task = {
      id: 'task-1',
      title: 'Build the overview',
      status: 'Todo',
      url: 'https://github.com/o/r/issues/1',
      number: 1,
      repository: 'o/r',
      kind: 'Issue',
    };
    let run: any;
    (window as any).saved = [];
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [repo],
        groups: [
          {
            id: 'g',
            name: 'Atlas',
            repoIds: ['r'],
            github: { id: 'p', title: 'Roadmap', url: 'https://github.com/orgs/o/projects/1' },
          },
        ],
        sessions: structuredClone(sessions),
        warnings: [],
        platform: 'darwin',
      }),
      git: async () => null,
      transcript: async () => ({ messages: [], truncated: false }),
      trackerBoard: async () => ({ items: [task], fields: [] }),
      chatCreate: async () =>
        (run = {
          id: 'run',
          agent: 'codex',
          sessionId: 'new-s',
          sessionReady: true,
          status: 'completed',
          messages: [{ id: 'm', role: 'assistant', text: 'Done' }],
          approvals: [],
          tools: [],
        }),
      chatStart: async () => run,
      chatStatus: async () => run,
      updateSession: async (agent: string, id: string, changes: any) => {
        (window as any).saved.push({ id, ...changes });
        let session = sessions.find((s) => s.agent === agent && s.id === id);
        if (!session) {
          session = {
            id,
            agent,
            title: 'Fix it',
            cwd: '/tmp/repo',
            updatedAt: new Date().toISOString(),
          };
          sessions.push(session);
        }
        session.organization = { ...session.organization, ...changes };
      },
    };
  });
  await page.goto('/');
  await openCodeFolder(page);
  await newChat(page);
  await page.getByLabel('Message agent').fill('Fix it');
  await page.getByRole('button', { name: 'Add context', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Link a task…', exact: true }).click();
  await page.getByRole('combobox', { name: 'Chat task' }).click();
  await page.getByRole('option', { name: 'Build the overview', exact: true }).click();
  await page.getByRole('button', { name: 'Save task link', exact: true }).click();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Done', { exact: true })).toBeVisible();
  // The first message saves the link on the new chat.
  await expect
    .poll(() => page.evaluate(() => (window as any).saved))
    .toContainEqual(expect.objectContaining({ id: 'new-s', taskId: 'task-1' }));
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Open linked task', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Link task…', exact: true })).toHaveCount(0);
});
