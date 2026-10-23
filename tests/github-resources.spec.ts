import { test, expect } from './helpers/app';

test('saved views render configured fields and explicit report publishing uses the reviewed snapshot', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('kalkidan:onboarding:v1', 'dismissed');
    const project = {
      id: 'P',
      title: 'Roadmap',
      owner: 'example',
      number: 1,
      url: 'https://github.com/orgs/example/projects/1',
    };
    const field = { id: 'estimate', name: 'Estimate', dataType: 'NUMBER', raw: {} };
    const priority = {
      id: 'priority',
      name: 'Priority',
      dataType: 'SINGLE_SELECT',
      options: [
        { id: 'p1', name: 'P1' },
        { id: 'p2', name: 'P2' },
      ],
      raw: {},
    };
    const calls: any[] = [];
    // The backend keeps the review, as the desktop history does.
    let reviewed = false;
    (window as any).writes = calls;
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
          capabilities: { createItem: true, updateStatus: true },
          statusNames: {},
        },
      ],
      trackerBoard: async () => ({
        project,
        writable: true,
        cache: { revision: 'board', fetchedAt: 1 },
        fields: [field, priority],
        items: [
          {
            id: 'I',
            title: 'Selected work',
            fieldValues: [
              { field: { id: 'estimate' }, number: 5 },
              { field: { id: 'priority' }, optionId: 'p2', name: 'P2' },
            ],
          },
          { id: 'other', title: 'Other work' },
        ],
      }),
      trackerResources: async (_g: string, kind: string) => ({
        projectId: 'P',
        kind,
        revision: 'resources',
        writable: true,
        records:
          kind === 'fields'
            ? [field]
            : kind === 'views'
              ? [{ id: 'V', name: 'Current sprint' }]
              : [],
      }),
      trackerSavedView: async () => ({
        id: 'V',
        name: 'Current sprint',
        layout: 'TABLE_LAYOUT',
        filter: 'is:open',
        itemIds: ['I'],
        visibleFieldIds: ['estimate'],
      }),
      trackerResourceChange: async (...args: any[]) => {
        calls.push(args);
        return {
          projectId: 'P',
          kind: 'statusUpdates',
          revision: 'next',
          writable: true,
          records: [],
        };
      },
      trackerBatch: async (group: string, request: any) => {
        calls.push([group, request]);
        return {
          id: request.id,
          rows: request.changes.map((change: any) => ({ ...change, state: 'confirmed' })),
        };
      },
      trackerMutationHistory: async (group: string, reviewedId?: string) => {
        if (reviewedId) {
          calls.push(['review', group, reviewedId]);
          reviewed = true;
        }
        return [
          {
            id: 'operation-1',
            operation: 'addComment',
            state: reviewed ? 'reviewed' : 'unknown-outcome',
            // The Tasks header shows the unconfirmed changes of this session only.
            updatedAt: Date.now(),
          },
        ];
      },
    };
  });
  await page.goto('/');
  await page
    .locator('.project-tree')
    .getByRole('button', { name: 'Platform', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Project page', exact: true })
    .getByRole('button', { name: 'Tasks', exact: true })
    .click();
  const board = page.getByRole('button', { name: 'Board: Roadmap #1', exact: true });
  // Saved views are a submenu of the board menu.
  await board.click();
  await page.getByRole('menuitem', { name: 'Saved view: All tasks', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Current sprint', exact: true }).click();
  const view = page.getByRole('region', { name: 'Saved GitHub view: Current sprint' });
  await expect(view.getByRole('columnheader', { name: 'Estimate' })).toBeVisible();
  await expect(view.getByRole('cell', { name: '5', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Other work', exact: true })).toHaveCount(0);
  // "Post status update…" in the board menu writes the health report. The preview is the
  // reviewed snapshot.
  await board.click();
  await page.getByRole('menuitem', { name: 'Post status update…', exact: true }).click();
  const health = page
    .getByRole('dialog', { name: 'Post status update', exact: true })
    .getByRole('region', { name: 'Board health', exact: true });
  await health.getByRole('button', { name: 'Write report' }).click();
  await expect(health).toContainText('2 active items');
  await health.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(
    health.getByRole('textbox', { name: 'Project health report preview' }),
  ).toContainText('2 active items');
  expect(await page.evaluate(() => (window as any).writes)).toEqual([]);
  await health.getByRole('button', { name: 'Publish status update' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Published the status update on GitHub.' }),
  ).toBeVisible();
  expect((await page.evaluate(() => (window as any).writes))[0].slice(0, 3)).toEqual([
    'g',
    'resources',
    'createProjectV2StatusUpdate',
  ]);
  await page.keyboard.press('Escape');
  // Batch field changes start from the selected tasks. "Set field" in the selection bar sets
  // a choice field; the choice is the review.
  await board.click();
  await page.getByRole('menuitem', { name: 'Saved view: Current sprint', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'All tasks', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select Selected work', exact: true }).check();
  await page
    .getByRole('toolbar', { name: 'Selected tasks' })
    .getByRole('button', { name: 'Set field', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Priority', exact: true }).click();
  await page.getByRole('menuitem', { name: 'P1', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Set Priority to P1 on 1 task.' }),
  ).toBeVisible();
  expect((await page.evaluate(() => (window as any).writes))[1][1].changes).toEqual([
    {
      itemId: 'I',
      fieldId: 'priority',
      before: { singleSelectOptionId: 'p2' },
      value: { singleSelectOptionId: 'p1' },
    },
  ]);
  // A change with an unknown result shows in the Tasks header until the user checks it.
  await page.getByRole('button', { name: '1 change may not have reached GitHub. Check' }).click();
  const record = page
    .getByRole('dialog', { name: 'Changes to check' })
    .getByRole('button', { name: 'Dismiss', exact: true });
  await record.click();
  await expect(record).toHaveCount(0);
  expect((await page.evaluate(() => (window as any).writes))[2]).toEqual([
    'review',
    'g',
    'operation-1',
  ]);
});
