import { test, expect } from '@playwright/test';
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
    const calls: any[] = [];
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
        fields: [field],
        items: [
          {
            id: 'I',
            title: 'Selected work',
            fieldValues: [{ field: { id: 'estimate' }, number: 5 }],
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
        if (reviewedId) calls.push(['review', group, reviewedId]);
        return [
          {
            id: 'operation-1',
            operation: 'addComment',
            state: reviewedId ? 'reviewed' : 'unknown-outcome',
            updatedAt: 1,
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
  const pages = page.getByRole('navigation', { name: 'Project page', exact: true });
  await page.getByRole('combobox', { name: 'GitHub saved view' }).click();
  await page.getByRole('option', { name: 'Current sprint', exact: true }).click();
  const view = page.getByRole('region', { name: 'Saved GitHub view' });
  await expect(view.getByRole('columnheader', { name: 'Estimate' })).toBeVisible();
  await expect(view.getByRole('cell', { name: '5', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Other work', exact: true })).toHaveCount(0);
  // The health report is on the Insights page. The preview is the reviewed snapshot.
  await pages.getByRole('button', { name: 'Insights', exact: true }).click();
  const health = page.getByRole('region', { name: 'Health', exact: true });
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
  // Batch field changes start from the selected tasks on the Tasks page.
  await pages.getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByRole('combobox', { name: 'GitHub saved view' }).click();
  await page.getByRole('option', { name: 'All project items', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select Selected work', exact: true }).check();
  await page
    .getByRole('toolbar', { name: 'Selected tasks' })
    .getByRole('button', { name: 'Edit fields…', exact: true })
    .click();
  const batch = page.getByRole('dialog', { name: 'Edit fields of 1 task' });
  const fieldSelect = batch.getByRole('combobox', { name: 'Field', exact: true });
  if (!(await fieldSelect.textContent())?.includes('Estimate')) {
    await fieldSelect.click();
    await page.getByRole('option', { name: 'Estimate', exact: true }).click();
  }
  await batch.getByRole('spinbutton', { name: 'New value' }).fill('8');
  await batch.getByRole('button', { name: 'Review 1 change' }).click();
  await expect(batch.getByText('Estimate: 5 → 8')).toBeVisible();
  expect((await page.evaluate(() => (window as any).writes)).length).toBe(1);
  await batch.getByRole('button', { name: 'Apply 1 change' }).click();
  await expect(batch.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  await expect(batch.getByText('Saved', { exact: true })).toBeVisible();
  expect((await page.evaluate(() => (window as any).writes))[1][1].changes).toEqual([
    { itemId: 'I', fieldId: 'estimate', before: { number: 5 }, value: { number: 8 } },
  ]);
  await batch.getByRole('button', { name: 'Done', exact: true }).click();
  // A change with an unknown result stays in GitHub changes until the user checks it.
  await pages.getByRole('button', { name: 'Insights', exact: true }).click();
  const changes = page.getByRole('region', { name: 'GitHub changes' });
  const record = changes.getByRole('button', { name: 'I checked this on GitHub' });
  await record.click();
  await expect(record).toHaveCount(0);
  expect((await page.evaluate(() => (window as any).writes))[2]).toEqual([
    'review',
    'g',
    'operation-1',
  ]);
});
