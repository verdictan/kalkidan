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
  await page.goto('http://127.0.0.1:5173');
  await page
    .locator('.project-tree')
    .getByRole('button', { name: 'Platform', exact: true })
    .click();
  await page
    .getByRole('group', { name: 'Project page', exact: true })
    .getByRole('button', { name: 'Tasks', exact: true })
    .click();
  await page.getByRole('combobox', { name: 'GitHub saved view' }).selectOption('V');
  const view = page.getByRole('region', { name: 'Saved GitHub view' });
  await expect(view.getByRole('columnheader', { name: 'Estimate' })).toBeVisible();
  await expect(view.getByRole('cell', { name: '5', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Other work', exact: true })).toHaveCount(0);
  await page.getByText('Project health report', { exact: true }).click();
  await page.getByRole('button', { name: 'Prepare current snapshot' }).click();
  await expect(page.getByRole('textbox', { name: 'Project health report preview' })).toContainText(
    '2 active items',
  );
  expect(await page.evaluate(() => (window as any).writes)).toEqual([]);
  await page.getByRole('button', { name: 'Publish status update' }).click();
  await expect(page.getByText('Status update published on GitHub.')).toBeVisible();
  expect((await page.evaluate(() => (window as any).writes))[0].slice(0, 3)).toEqual([
    'g',
    'resources',
    'createProjectV2StatusUpdate',
  ]);
  await page.getByText('Batch fields and iteration planning', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Batch field' }).selectOption('estimate');
  await page.getByRole('checkbox', { name: /Selected work/ }).check();
  await page.getByRole('spinbutton', { name: 'Estimate' }).fill('8');
  await page.getByRole('button', { name: 'Save Estimate' }).click();
  await expect(page.getByText('Estimate: 5 → 8')).toBeVisible();
  expect((await page.evaluate(() => (window as any).writes)).length).toBe(1);
  await page.getByRole('button', { name: 'Apply reviewed batch' }).click();
  await expect(page.getByText('Selected work: confirmed', { exact: true })).toBeVisible();
  expect((await page.evaluate(() => (window as any).writes))[1][1].changes).toEqual([
    { itemId: 'I', fieldId: 'estimate', before: { number: 5 }, value: { number: 8 } },
  ]);
  await page.getByText('GitHub write history', { exact: true }).click();
  const record = page.getByRole('button', { name: 'Record review' });
  await expect(record).toBeDisabled();
  await page.getByRole('checkbox', { name: 'I inspected the result on GitHub.' }).check();
  await record.click();
  await expect(record).toHaveCount(0);
  expect((await page.evaluate(() => (window as any).writes))[2]).toEqual([
    'review',
    'g',
    'operation-1',
  ]);
});
