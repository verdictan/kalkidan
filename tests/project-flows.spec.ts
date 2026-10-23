import { type Page } from '@playwright/test';
import { test, expect, newChat, openSettings, settingsDialog } from './helpers/app';
import {
  openCodeFolder,
  openAddCodeFolders,
  openProjectTab,
  openTreeChat,
} from './helpers/navigation';
const url = '/';

/** Goes back to the page before with ⌘[ (Ctrl+[), from a place that is not a text field. */
async function goBack(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('ControlOrMeta+BracketLeft');
}
test('single view ignores old split preferences and preserves conversation drafts while navigating', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('kalkidan.layout', 'split'));
  await page.goto(url);
  await expect(page.getByRole('region', { name: 'Projects', exact: true })).toBeVisible();
  await openCodeFolder(page, 'atlas-web');
  await newChat(page);
  await page.getByLabel('Message agent').fill('Preserve this draft');
  await expect(page.getByRole('combobox', { name: 'Content layout' })).toHaveCount(0);
  await expect(page.locator('.split-view, .repo-breadcrumb, .conversation-breadcrumb')).toHaveCount(
    0,
  );
  await expect(page.locator('.management-pane')).toBeHidden();
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  // The project row opens the Overview with its New chat composer.
  await expect(page.getByRole('textbox', { name: 'Message for a new chat' })).toBeVisible();
  await expect(page.getByLabel('Message agent')).toBeHidden();
  await goBack(page);
  await expect(page.getByLabel('Message agent')).toHaveValue('Preserve this draft');
  await page
    .getByRole('navigation', { name: 'Projects and repositories' })
    .getByRole('button', { name: 'Projects', exact: true })
    .click();
  await expect(page.getByRole('region', { name: 'Projects', exact: true })).toBeVisible();
  await goBack(page);
  await expect(page.getByLabel('Message agent')).toHaveValue('Preserve this draft');
  await page.setViewportSize({ width: 980, height: 680 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('adding a code folder from a project menu adds it to that project', async ({ page }) => {
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).folderCalls = calls;
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [],
        sessions: [],
        warnings: [],
        platform: 'darwin',
        groups: [
          { id: 'a', name: 'Atlas', repoIds: [] },
          { id: 'b', name: 'Platform', repoIds: [] },
        ],
      }),
      chooseFolder: async (title: string) => {
        calls.push(['choose', title]);
        return '/work/new-service';
      },
      scanRepositories: async (root: string) => ({
        root,
        rootIsRepository: true,
        repositories: [{ path: root, name: 'new-service', branch: 'main', added: false }],
      }),
      addRepositories: async (groupId: string, paths: string[]) => {
        calls.push(['add', groupId, paths]);
        return { added: paths.length, ids: ['r'] };
      },
    };
  });
  await page.goto(url);
  // A local project opens the system folder picker at once. There is no dialog first, and the
  // folder goes to the project of the menu.
  await openAddCodeFolders(page, 'Platform');
  await expect
    .poll(() => page.evaluate(() => (window as any).folderCalls))
    .toEqual([
      ['choose', 'Add code folder'],
      ['add', 'b', ['/work/new-service']],
    ]);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('dragging a task syncs its status and a failed write keeps the original column', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const project = { id: 'gh', title: 'Roadmap', owner: 'org', number: 1, url: '' };
    let statusId = 'todo';
    (window as any).writes = [];
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [],
        groups: [{ id: 'g', name: 'Platform', repoIds: [], github: project }],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      githubAuthCancel: async () => ({ status: 'idle' }),
      githubBoard: async () => ({
        project,
        statusField: {
          id: 's',
          options: [
            { id: 'todo', name: 'Todo' },
            { id: 'progress', name: 'In progress' },
            { id: 'done', name: 'Done' },
          ],
        },
        items: [{ id: 'task', title: 'Drag this task', body: 'Details', statusId }],
      }),
      githubStatus: async (_group: string, _item: string, option: string) => {
        (window as any).writes.push(option);
        if (option === 'done') throw new Error('GitHub temporarily unavailable');
        statusId = option;
      },
    };
  });
  await page.goto(url);
  // The project row opens the overview. The Tasks row opens the board.
  await openProjectTab(page, 'Tasks');
  const card = page.locator('[draggable="true"]');
  await card.dragTo(page.getByRole('region', { name: 'In progress column', exact: true }), {
    sourcePosition: { x: 4, y: 4 },
    targetPosition: { x: 50, y: 20 },
  });
  await expect(page.getByRole('region', { name: 'In progress column', exact: true })).toContainText(
    'Drag this task',
  );
  await card.dragTo(page.getByRole('region', { name: 'Done column', exact: true }), {
    sourcePosition: { x: 4, y: 4 },
    targetPosition: { x: 50, y: 20 },
  });
  await expect(page.getByRole('alert')).toContainText('GitHub temporarily unavailable');
  await expect(page.getByRole('region', { name: 'In progress column', exact: true })).toContainText(
    'Drag this task',
  );
  expect(await page.evaluate(() => (window as any).writes)).toEqual(['progress', 'done']);
});

for (const outcome of ['completed', 'failed', 'stopped']) {
  test(`linked task ${outcome}: starts In progress and only a finished run offers Mark task done`, async ({
    page,
  }) => {
    await page.addInitScript(
      ({ outcome }) => {
        const project = { id: 'gh', title: 'Roadmap', owner: 'org', number: 1, url: '' };
        const session = {
          id: 's',
          agent: 'codex',
          title: 'Linked conversation',
          cwd: '/tmp/repo',
          updatedAt: new Date().toISOString(),
          organization: { taskId: 'task' },
        };
        let statusId = 'todo';
        let run: any;
        (window as any).writes = [];
        (window as any).workspace = {
          snapshot: async () => ({
            projects: [
              { id: 'r', name: 'Repo', path: '/tmp/repo', notes: '', favorite: false, addedAt: '' },
            ],
            groups: [{ id: 'g', name: 'Platform', repoIds: ['r'], github: project }],
            sessions: [session],
            warnings: [],
            platform: 'darwin',
          }),
          git: async () => null,
          transcript: async () => ({ messages: [], truncated: false }),
          githubBoard: async () => ({
            project,
            statusField: {
              id: 's',
              options: [
                { id: 'todo', name: 'Todo' },
                { id: 'progress', name: 'In progress' },
                { id: 'done', name: 'Done' },
              ],
            },
            items: [{ id: 'task', title: 'Implement feature', body: '', statusId }],
          }),
          githubStatus: async (_group: string, _item: string, option: string) => {
            statusId = option;
            (window as any).writes.push(option);
          },
          chatStart: async () => {
            run = {
              id: 'run',
              agent: 'codex',
              sessionId: 's',
              sessionReady: true,
              status: 'running',
              messages: [],
              activity: 'Working',
            };
            return run;
          },
          chatStatus: async () => ({
            ...run,
            status: outcome,
            ...(outcome === 'failed' ? { error: 'Agent failed' } : {}),
            messages: [{ id: 'a', role: 'assistant', text: 'Response ended' }],
          }),
        };
      },
      { outcome },
    );
    await page.goto(url);
    await openCodeFolder(page);
    await openTreeChat(page, 'Linked conversation');
    await page.getByLabel('Message agent').fill('Implement the feature');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Response ended', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).writes)).toEqual(['progress']);
    // The run does not complete the task. After a finished run the user marks it done from the
    // chat menu. A failed or stopped run does not offer "Mark task done".
    await page.getByRole('button', { name: 'Chat actions', exact: true }).click();
    const done = page.getByRole('menuitem', { name: 'Mark task done', exact: true });
    if (outcome === 'completed') await expect(done).toBeVisible();
    else {
      await expect(page.getByRole('menuitem').first()).toBeVisible();
      await expect(done).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
    await expect(page.getByText('Task marked Done.', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).writes)).toEqual(['progress']);
    if (outcome === 'completed') {
      await done.click();
      await expect(page.getByText('Task marked Done.', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => (window as any).writes)).toEqual(['progress', 'done']);
    }
  });
}

test('navigation collapse preserves the conversation and command K restores search', async ({
  page,
}) => {
  await page.goto(url);
  await openCodeFolder(page, 'atlas-web');
  await newChat(page);
  await page.getByLabel('Message agent').fill('Keep this draft while I focus');
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  await expect(
    page.getByRole('navigation', { name: 'Projects and repositories' }),
  ).not.toBeVisible();
  await expect(page.getByLabel('Message agent')).toHaveValue('Keep this draft while I focus');
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('combobox', { name: 'Search or run a command' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Toggle sidebar', exact: true })).toBeFocused();
  await page.screenshot({ path: 'test-results/chatgpt-new-conversation.png', fullPage: true });
  await page.setViewportSize({ width: 980, height: 680 });
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('settings shows agent and remote controls without history import', async ({ page }) => {
  await page.setViewportSize({ width: 773, height: 988 });
  await page.goto(url);
  // Below 1100px wide, the sidebar starts closed.
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  // The agents and the SSH hosts are in the Tools part of Settings.
  const settings = await openSettings(page, 'Tools');
  const tools = settings.getByRole('region', { name: 'Tools', exact: true });
  const computer = tools.getByRole('list', { name: 'This Mac', exact: true });
  await expect(computer).toContainText('Codex');
  await expect(computer).toContainText('Claude Code');
  // The GitHub CLI row has the GitHub account.
  await expect(computer).toContainText('GitHub CLI');
  // Without a host, "Add SSH host…" is in the last line. It opens the field in SSH hosts.
  await settings.getByRole('button', { name: 'Add SSH host…', exact: true }).click();
  await expect(settings.getByRole('textbox', { name: 'SSH target' })).toBeVisible();
  // No part has a history import.
  await expect(settings.getByText('Import chat history', { exact: true })).toHaveCount(0);
  await expect(settings.getByRole('button', { name: 'Preview chat history' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/settings-page.png', fullPage: true });
  // Escape closes the SSH host form, then Settings.
  await expect(async () => {
    await page.keyboard.press('Escape');
    await expect(settingsDialog(page)).toHaveCount(0, { timeout: 1000 });
  }).toPass({ timeout: 10000 });
  await expect(page.getByRole('navigation', { name: 'Projects and repositories' })).toBeVisible();
});

test('project menu connects the chosen project without duplicate authorization', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).authStarts = 0;
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [],
        sessions: [],
        warnings: [],
        platform: 'darwin',
        groups: [
          { id: 'a', name: 'Atlas', repoIds: [] },
          { id: 'b', name: 'Platform', repoIds: [] },
        ],
      }),
      githubAuthStart: async () => {
        (window as any).authStarts++;
        return { status: 'waiting', code: 'ABCD-1234' };
      },
      githubAuthCancel: async () => ({}),
      githubAuthStatus: async () => ({ status: 'waiting', code: 'ABCD-1234' }),
    };
  });
  await page.goto(url);
  await expect(page.getByRole('combobox', { name: 'Tracker connection project' })).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Projects and repositories' })
    .getByRole('button', { name: 'Platform', exact: true })
    .click({ button: 'right' });
  // The row menu has no board item. The project part of Settings has the board connection.
  await expect(
    page.getByRole('menuitem', { name: 'Connect a GitHub Projects board…', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Settings…', exact: true }).click();
  const settings = settingsDialog(page);
  const project = settings.getByRole('region', { name: 'Platform', exact: true });
  await expect(project).toBeVisible();
  // The board chip opens the board settings in place.
  await project.getByRole('button', { name: 'Connect board', exact: true }).click();
  await project.getByRole('button', { name: 'Connect board…', exact: true }).click();
  // The Connect board dialog checks the board access once.
  const connect = page.getByRole('dialog', { name: 'Connect board', exact: true });
  await expect(connect.getByLabel('GitHub device code')).toHaveText('ABCD-1234');
  expect(await page.evaluate(() => (window as any).authStarts)).toBe(1);
  await page.keyboard.press('Escape');
  await expect(connect).toHaveCount(0);
  // Escape again leaves Settings.
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
});

test('task conversation returns to the filtered project board', async ({ page }) => {
  await page.goto(url);
  await openProjectTab(page, 'Tasks', 'Atlas');
  // The Tasks tab lists the boards on the page; one click connects a board.
  await page
    .getByRole('region', { name: 'Project tracker', exact: true })
    .getByRole('button', { name: 'Connect Atlas roadmap #1', exact: true })
    .click();
  const search = page.getByRole('searchbox', { name: 'Search tasks', exact: true });
  await page.getByRole('button', { name: 'Search tasks', exact: true }).click();
  await search.fill('authentication');
  await page.getByRole('button', { name: 'Review authentication', exact: true }).click();
  // The preview cannot make a branch copy, so the agent works in the folder on main.
  await page.getByRole('button', { name: /^Where to work: /, exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Where to work', exact: true })
    .getByRole('radio', { name: 'Work on main', exact: true })
    .check();
  await page.keyboard.press('Escape');
  // The task starts with the agent that is ready (Codex is not installed in the preview).
  await page.getByRole('button', { name: /^Start task with / }).click();
  await expect(page.getByLabel('Message agent')).toHaveValue(/Review authentication/);
  // The new chat puts the caret in its composer after it opens. ⌘[ in a text field does not go
  // back, so try again until the board shows.
  await expect(async () => {
    if (!(await search.isVisible())) await goBack(page);
    await expect(search).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10000 });
  await expect(search).toHaveValue('authentication');
  await expect(page.getByRole('region', { name: 'Tracker board', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Build the project overview', exact: true }),
  ).toHaveCount(0);
});
