import type { Page } from '@playwright/test';
import { test, expect } from './helpers/app';
import { openProjectTab } from './helpers/navigation';

test('board quick creation, issue inspector and status changes share the tracker state', async ({
  page,
}) => {
  await page.setViewportSize({ width: 773, height: 988 });
  await page.goto('/');
  // Below 1100px wide, the sidebar starts closed.
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Project page' })
    .getByRole('button', { name: 'Tasks', exact: true })
    .click();
  // The Tasks tab lists the boards on the page; one click connects a board.
  await page
    .getByRole('region', { name: 'Project tracker' })
    .getByRole('button', { name: 'Connect Atlas roadmap #1', exact: true })
    .click();
  const board = page.getByRole('region', { name: 'Tracker board', exact: true });
  const todo = board.getByRole('region', { name: 'Todo column', exact: true });
  // New task opens a title field at the top of the first column. Enter adds the task there and
  // keeps the field open for the next title. There is no New task dialog.
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  const quick = todo.getByRole('textbox', { name: 'New task title', exact: true });
  await expect(quick).toBeFocused();
  await quick.fill('Write the release notes');
  await quick.press('Enter');
  await expect(
    todo.getByRole('button', { name: 'Write the release notes', exact: true }),
  ).toBeVisible();
  await expect(quick).toHaveValue('');
  await expect(quick).toBeFocused();
  await quick.fill('Polish the issue workflow');
  await quick.press('Enter');
  await expect(
    todo.getByRole('button', { name: 'Polish the issue workflow', exact: true }),
  ).toBeVisible();
  await quick.press('Escape');
  await expect(quick).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await todo.getByRole('button', { name: 'Polish the issue workflow', exact: true }).click();
  const detail = page.getByRole('dialog');
  // The status is a pill in the task sheet. A choice moves the task on the board.
  await detail.getByRole('button', { name: 'Status: Todo', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Done', exact: true }).click();
  await expect(detail.getByRole('button', { name: 'Status: Done', exact: true })).toBeVisible();
  // Previous task follows the board order: the task is now in Done, after In progress.
  await detail.getByRole('button', { name: 'Previous task', exact: true }).click();
  await expect(
    detail.getByRole('heading', { name: 'Build the project overview', exact: true }),
  ).toBeVisible();
  await detail.getByRole('button', { name: 'Previous task', exact: true }).click();
  await expect(
    detail.getByRole('heading', { name: 'Write the release notes', exact: true }),
  ).toBeVisible();
  await detail.getByRole('button', { name: 'Previous task', exact: true }).click();
  await expect(
    detail.getByRole('heading', { name: 'Review authentication', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/tracker-inspector.png' });
  await page.keyboard.press('Escape');
  // Refresh is in the board menu.
  await page.getByRole('button', { name: 'Board: Atlas roadmap #1', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Refresh/ }).click();
  await expect(
    board
      .getByRole('region', { name: 'Done column', exact: true })
      .getByRole('button', { name: 'Polish the issue workflow', exact: true }),
  ).toBeVisible();
  // Few tasks need no filters: the search button shows, the Filter button does not.
  await page.getByRole('button', { name: 'Search tasks', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Search tasks', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Filter', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/tracker-workspace.png' });
});

test('failed initial status leaves one created item available for a status retry', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const project = {
      id: 'p',
      title: 'Roadmap',
      url: 'https://github.com/orgs/example/projects/1',
    };
    const items: any[] = [];
    let attempts = 0;
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [],
        sessions: [],
        warnings: [],
        platform: 'darwin',
        groups: [
          { id: 'g', name: 'Platform', repoIds: [], tracker: { provider: 'github', project } },
        ],
      }),
      trackerProviders: async () => [
        {
          id: 'github',
          name: 'GitHub',
          capabilities: {
            createItem: true,
            updateStatus: true,
            importItem: false,
            createProject: false,
          },
          statusNames: { progress: 'Building', done: 'Released' },
        },
      ],
      trackerBoard: async () => ({
        project,
        items: structuredClone(items),
        statusField: { id: 'status', options: [{ id: 'building', name: 'Building' }] },
      }),
      trackerDraft: async (_group: string, title: string, body: string) => {
        items.push({ id: 'created', title, body });
        return 'created';
      },
      trackerStatus: async (_group: string, id: string, status: string) => {
        if (++attempts === 1) throw new Error('Connection interrupted');
        Object.assign(
          items.find((item) => item.id === id),
          { statusId: status, status: 'Building' },
        );
      },
    };
  });
  await page.goto('/');
  // The project row opens the overview. The Tasks row opens the board.
  await openProjectTab(page, 'Tasks');
  // The New task field is in the first column, Building. It creates the task, then sets its
  // status.
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  const quick = page
    .getByRole('region', { name: 'Building column', exact: true })
    .getByRole('textbox', { name: 'New task title', exact: true });
  await quick.fill('Only create once');
  await quick.press('Enter');
  // The task exists, so the field clears and Enter cannot create it again.
  await expect(quick).toHaveValue('');
  await quick.press('Escape');
  await expect(page.getByRole('alert')).toContainText(
    'Task created, but its status could not be set',
  );
  const board = page.getByRole('region', { name: 'Tracker board', exact: true });
  await expect(board.getByRole('button', { name: 'Only create once', exact: true })).toHaveCount(1);
  // The card menu opens on a right-click.
  await board
    .getByRole('button', { name: 'Only create once', exact: true })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Building', exact: true }).click();
  await expect(
    board
      .getByRole('region', { name: 'Building column', exact: true })
      .getByRole('button', { name: 'Only create once', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).not.toBeVisible();
});

/**
 * A GitHub board with one code folder (atlas-web) and the given items. Each tracker write goes
 * to `window.calls`, so a test can check the GitHub writes in their order.
 */
async function draftBoard(page: Page, seed: Record<string, unknown>[] = []) {
  await page.addInitScript((seed) => {
    const project = {
      id: 'p',
      title: 'Roadmap',
      owner: 'example',
      number: 1,
      url: 'https://github.com/orgs/example/projects/1',
    };
    const items: any[] = structuredClone(seed);
    const calls: unknown[][] = [];
    (window as any).calls = calls;
    let next = 0;
    let issue = 150;
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [
          {
            id: 'r',
            name: 'atlas-web',
            path: '/tmp/atlas-web',
            notes: '',
            favorite: false,
            addedAt: '',
          },
        ],
        sessions: [],
        warnings: [],
        platform: 'darwin',
        groups: [
          { id: 'g', name: 'Platform', repoIds: ['r'], tracker: { provider: 'github', project } },
        ],
      }),
      git: async () => null,
      workingStatus: async () => ({ branch: '' }),
      trackerProviders: async () => [
        {
          id: 'github',
          name: 'GitHub',
          capabilities: {
            createItem: true,
            updateStatus: true,
            importItem: false,
            createProject: false,
          },
          statusNames: { progress: 'In progress', done: 'Done' },
        },
      ],
      trackerBoard: async () => ({
        project,
        writable: true,
        items: structuredClone(items),
        statusField: {
          id: 'status',
          options: [
            { id: 'todo', name: 'Todo' },
            { id: 'progress', name: 'In progress' },
          ],
        },
      }),
      trackerDraft: async (_group: string, title: string, body: string) => {
        const id = `draft-${++next}`;
        calls.push(['draft', title, body]);
        items.push({ id, title, body, kind: 'DraftIssue', statusId: 'todo', status: 'Todo' });
        return id;
      },
      trackerStatus: async (_group: string, id: string, status: string) => {
        calls.push(['status', id, status]);
        Object.assign(
          items.find((item) => item.id === id),
          { statusId: status, status: status === 'todo' ? 'Todo' : 'In progress' },
        );
      },
      trackerItemAction: async (_group: string, id: string, action: any) => {
        calls.push(['item', id, action]);
        const index = items.findIndex((item) => item.id === id);
        if (action.kind === 'remove') items.splice(index, 1);
        if (action.kind === 'convert')
          Object.assign(items[index], {
            kind: 'Issue',
            number: ++issue,
            repository: action.repository,
            url: `https://github.com/${action.repository}/issues/${issue}`,
          });
      },
      trackerContent: async (_group: string, id: string) => {
        const item = items.find((value) => value.id === id);
        return {
          id: 'issue-' + id,
          kind: 'Issue',
          title: item.title,
          body: item.body,
          state: item.closed ? 'CLOSED' : 'OPEN',
          revision: 'r1',
          permissions: { edit: true, close: true, reopen: true, assign: true, label: true },
          assignees: [],
          labels: [],
          comments: [],
        };
      },
      trackerContentChange: async (_group: string, id: string, revision: string, action: any) => {
        calls.push(['content', id, revision, action]);
        items.find((item) => item.id === id).closed = true;
        return {};
      },
      dispatchPrepare: async (request: any) => {
        calls.push(['dispatch', request.tasks.map((task: any) => task.taskId)]);
        return { id: 'run' };
      },
      dispatchStart: async () => ({ id: 'run', tasks: [] }),
    };
  }, seed);
}
const calls = (page: Page) => page.evaluate(() => (window as any).calls as unknown[][]);
/** The last toast with this text. Its live-region copy has no buttons. */
const toast = (page: Page, text: string) =>
  page.getByRole('status').filter({ hasText: text }).last();

test('a draft becomes an issue on Start, and Undo closes the issue and puts a draft back', async ({
  page,
}) => {
  await draftBoard(page);
  await page.goto('/');
  await openProjectTab(page, 'Tasks');
  // ⌘⏎ in the New task field adds the task and starts it. The draft becomes an issue first.
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  const todo = page.getByRole('region', { name: 'Todo column', exact: true });
  const quick = todo.getByRole('textbox', { name: 'New task title', exact: true });
  await quick.fill('Write the release notes');
  await quick.press('ControlOrMeta+Enter');
  const converted = toast(page, 'Converted 1 draft to an issue.');
  await expect(converted).toBeVisible();
  expect(await calls(page)).toEqual([
    ['draft', 'Write the release notes', ''],
    ['status', 'draft-1', 'todo'],
    ['item', 'draft-1', { kind: 'convert', repository: 'example/atlas-web' }],
  ]);
  // Undo closes the new issue as not planned and puts a draft with the same text in its column.
  await converted.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect
    .poll(async () => (await calls(page)).slice(3))
    .toEqual([
      ['draft', 'Write the release notes', ''],
      ['status', 'draft-2', 'todo'],
      ['content', 'draft-1', 'r1', { kind: 'close', reason: 'not-planned' }],
      ['item', 'draft-1', { kind: 'remove' }],
    ]);
  await openProjectTab(page, 'Tasks');
  await expect(
    todo.getByRole('button', { name: 'Write the release notes', exact: true }),
  ).toHaveCount(1);
});

test('Start N in the selection bar converts the drafts, and Undo reverts each one', async ({
  page,
}) => {
  await draftBoard(page, [
    { id: 'a', title: 'Draft A', body: 'Body A', kind: 'DraftIssue', statusId: 'todo' },
    { id: 'b', title: 'Draft B', body: 'Body B', kind: 'DraftIssue', statusId: 'progress' },
  ]);
  await page.goto('/');
  await openProjectTab(page, 'Tasks');
  const board = page.getByRole('region', { name: 'Tracker board', exact: true });
  await board
    .getByRole('button', { name: 'Draft A', exact: true })
    .click({ modifiers: ['ControlOrMeta'] });
  await board
    .getByRole('button', { name: 'Draft B', exact: true })
    .click({ modifiers: ['ControlOrMeta'] });
  await page
    .getByRole('toolbar', { name: 'Selected tasks', exact: true })
    .getByRole('button', { name: /^Start 2 tasks with / })
    .click();
  const converted = toast(page, 'Converted 2 drafts to issues.');
  await expect(converted).toBeVisible();
  expect(await calls(page)).toEqual([
    ['item', 'a', { kind: 'convert', repository: 'example/atlas-web' }],
    ['item', 'b', { kind: 'convert', repository: 'example/atlas-web' }],
    ['dispatch', ['a', 'b']],
  ]);
  await converted.getByRole('button', { name: 'Undo', exact: true }).click();
  // Each draft goes back to the column of its issue: A to Todo, B to In progress.
  await expect
    .poll(async () => (await calls(page)).slice(3))
    .toEqual([
      ['draft', 'Draft A', 'Body A'],
      ['status', 'draft-1', 'todo'],
      ['content', 'a', 'r1', { kind: 'close', reason: 'not-planned' }],
      ['item', 'a', { kind: 'remove' }],
      ['draft', 'Draft B', 'Body B'],
      ['status', 'draft-2', 'progress'],
      ['content', 'b', 'r1', { kind: 'close', reason: 'not-planned' }],
      ['item', 'b', { kind: 'remove' }],
    ]);
  await expect(
    board
      .getByRole('region', { name: 'In progress column', exact: true })
      .getByRole('button', { name: 'Draft B', exact: true }),
  ).toBeVisible();
});
