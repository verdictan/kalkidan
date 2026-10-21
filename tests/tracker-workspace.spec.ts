import { test, expect } from '@playwright/test';

test('board quick creation, issue inspector and status changes share the tracker state', async ({
  page,
}) => {
  await page.setViewportSize({ width: 773, height: 988 });
  await page.goto('/');
  // Below 1100px wide, the sidebar starts closed.
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await page
    .getByRole('region', { name: 'Project tracker' })
    .getByRole('button', { name: 'Connect a GitHub Projects board', exact: true })
    .click();
  await page.getByRole('button', { name: 'Atlas roadmap #1', exact: true }).click();
  await page.getByRole('button', { name: 'Connect board', exact: true }).click();
  const board = page.getByRole('region', { name: 'Tracker board', exact: true });
  await board.getByRole('button', { name: 'New task in In progress', exact: true }).click();
  const create = page.getByRole('dialog');
  await expect(create.getByRole('combobox', { name: 'Initial status' })).toContainText(
    'In progress',
  );
  await create.getByLabel('Task title').fill('Polish the issue workflow');
  await create.getByLabel('Task description').fill('## Acceptance criteria\n- Keep GitHub in sync');
  await create.getByRole('button', { name: 'Add to GitHub', exact: true }).click();
  const progress = board.getByRole('region', { name: 'In progress column', exact: true });
  await expect(
    progress.getByRole('button', { name: 'Polish the issue workflow', exact: true }),
  ).toBeVisible();
  await progress.getByRole('button', { name: 'Polish the issue workflow', exact: true }).click();
  const detail = page.getByRole('dialog');
  await expect(detail.getByRole('heading', { name: 'Acceptance criteria' })).toBeVisible();
  await detail.getByRole('combobox', { name: 'Task status', exact: true }).click();
  await page.getByRole('option', { name: 'Done', exact: true }).click();
  await expect(detail.getByRole('combobox', { name: 'Task status', exact: true })).toContainText(
    'Done',
  );
  await detail.getByRole('button', { name: 'Previous task', exact: true }).click();
  await expect(
    detail.getByRole('heading', { name: 'Review authentication', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/tracker-inspector.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Refresh board', exact: true }).click();
  await expect(
    board
      .getByRole('region', { name: 'Done column', exact: true })
      .getByRole('button', { name: 'Polish the issue workflow', exact: true }),
  ).toBeVisible();
  // Few tasks need no filters: the search shows, the Filter button does not.
  await expect(page.getByLabel('Search tasks')).toBeVisible();
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
  await page.locator('.project-tree').getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByRole('button', { name: 'New task in Building', exact: true }).click();
  await page.getByLabel('Task title').fill('Only create once');
  await page.getByRole('button', { name: 'Add to GitHub', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('alert')).toContainText(
    'Task created, but its status could not be set',
  );
  const board = page.getByRole('region', { name: 'Tracker board', exact: true });
  await expect(board.getByRole('button', { name: 'Only create once', exact: true })).toHaveCount(1);
  await board
    .getByRole('button', { name: 'Move task: Only create once. Status: No status' })
    .click();
  await page.getByRole('menuitem', { name: 'Building', exact: true }).click();
  await expect(
    board
      .getByRole('region', { name: 'Building column', exact: true })
      .getByRole('button', { name: 'Only create once', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).not.toBeVisible();
});
