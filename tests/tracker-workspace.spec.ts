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
