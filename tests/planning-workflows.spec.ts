import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kalkidan:onboarding:v1', 'dismissed');
    const project = {
      id: 'P',
      title: 'Roadmap',
      owner: 'org',
      number: 1,
      url: 'https://github.com/orgs/org/projects/1',
    };
    const fields = [
      { id: 'E', name: 'Estimate', dataType: 'NUMBER', raw: {} },
      {
        id: 'S',
        name: 'Sprint',
        dataType: 'ITERATION',
        iterations: [{ id: 'next', title: 'Next sprint', startDate: '2026-10-21', duration: 14 }],
        raw: {},
      },
    ];
    const items = [
      {
        id: 'I1',
        title: 'Independent issue',
        kind: 'Issue',
        body: 'Acceptance criteria',
        repository: 'org/repo',
        fieldValues: [
          { field: { id: 'E' }, number: 3 },
          { field: { id: 'users' }, users: [{ id: 'U', login: 'developer' }] },
        ],
      },
      {
        id: 'I2',
        title: 'Blocked issue',
        kind: 'Issue',
        body: 'Acceptance criteria',
        repository: 'org/repo',
        fieldValues: [{ field: { id: 'E' }, number: 2 }],
      },
      {
        id: 'PR',
        title: 'Merged change',
        kind: 'PullRequest',
        body: 'Done',
        repository: 'org/repo',
        fieldValues: [],
      },
    ];
    const board = { project, items, fields, writable: true };
    const writes: any[] = [];
    (window as any).planningWrites = writes;
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [],
        sessions: [],
        warnings: [],
        platform: 'darwin',
        groups: [
          { id: 'g', name: 'Platform', repoIds: [], tracker: { provider: 'github', project } },
          {
            id: 'h',
            name: 'Tools',
            repoIds: [],
            tracker: { provider: 'github', project: { ...project, id: 'P2', title: 'Tools' } },
          },
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
      trackerBoard: async () => board,
      trackerRelations: async (_group: string, id: string) => ({
        issueId: 'content-' + id,
        revision: 'r',
        writable: true,
        parent: null,
        subIssues: [],
        blocking: [],
        blockedBy:
          id === 'I2' ? [{ id: 'content-I1', title: 'Independent issue', state: 'OPEN' }] : [],
      }),
      trackerContent: async (_group: string, id: string) => ({
        id: 'content-' + id,
        kind: id === 'PR' ? 'PullRequest' : 'Issue',
        title: id,
        body: 'Acceptance',
        state: id === 'PR' ? 'MERGED' : 'OPEN',
        permissions: {},
        revision: 'r',
        assignees: [],
        labels: [],
        comments: [],
        headOid: 'a'.repeat(40),
        checks: 'SUCCESS',
        checkEvidence:
          id === 'PR'
            ? [
                {
                  name: 'Jenkins Linux',
                  state: 'SUCCESS',
                  kind: 'status',
                  url: 'https://ci.example.test/job/release/42',
                },
              ]
            : [],
        linkedPullRequests: [],
      }),
      trackerBatch: async (group: string, request: any) => {
        writes.push(['batch', group, request]);
        return {
          id: request.id,
          rows: request.changes.map((change: any) => ({ ...change, state: 'confirmed' })),
        };
      },
      docsMetadata: async () => [{ id: 'doc', title: 'Launch guide', parentId: null }],
      docsRead: async () => ({
        id: 'doc',
        title: 'Launch guide',
        parentId: null,
        revision: 'source-v1',
        markdown:
          '## Implement service\nAcceptance criteria A.\n## Connect client\nAcceptance criteria B.',
      }),
      trackerDocsPlan: async (group: string, request: any) => {
        writes.push(['docs', group, request]);
        return {
          id: request.id,
          rows: request.entries.map((_entry: any, index: number) => ({
            index,
            itemId: 'created-' + index,
            state: 'complete',
          })),
        };
      },
      trackerPortfolio: async (ids: string[]) =>
        ids.map((groupId) => ({
          groupId,
          board: {
            ...board,
            project: { ...project, title: groupId === 'g' ? 'Roadmap' : 'Tools' },
            items:
              groupId === 'g'
                ? items
                : [{ id: 'other', title: 'Other project task', body: '', fieldValues: [] }],
          },
        })),
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
});
test('iteration proposal excludes blockers and writes only after review', async ({ page }) => {
  await page.getByText('Plan an iteration', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Estimate field', exact: true }).selectOption('E');
  await page.getByRole('combobox', { name: 'Iteration field', exact: true }).selectOption('S');
  await page.getByRole('combobox', { name: 'Target iteration', exact: true }).selectOption('next');
  await page.getByRole('spinbutton', { name: 'Remaining capacity' }).fill('5');
  await page.getByRole('checkbox', { name: 'Independent issue', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Blocked issue', exact: true }).check();
  await page.getByRole('button', { name: 'Prepare allocation' }).click();
  await expect(
    page.getByText('An open or unknown blocker must be resolved first.', { exact: false }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).planningWrites)).toEqual([]);
  await page.getByRole('button', { name: 'Apply selected allocation' }).click();
  const writes = await page.evaluate(() => (window as any).planningWrites);
  expect(writes[0][2].changes).toEqual([
    { itemId: 'I1', fieldId: 'S', before: null, value: { iterationId: 'next' } },
  ]);
});
test('explicit Docs selection previews source text and relationships before issue publication', async ({
  page,
}) => {
  await page.getByText('Plan issues from Docs', { exact: true }).click();
  await page.getByRole('button', { name: 'Choose source document' }).click();
  await page.getByRole('option', { name: 'Launch guide', exact: true }).click();
  await page.getByRole('textbox', { name: 'Plan issue repository' }).fill('org/repo');
  const second = page.getByRole('group', { name: 'Issue 2', exact: true });
  await second.getByRole('combobox', { name: 'Parent', exact: true }).selectOption('0');
  await second.getByRole('checkbox', { name: '1. Implement service', exact: true }).check();
  await page.getByRole('button', { name: 'Review issue plan' }).click();
  await expect(page.getByRole('button', { name: 'Publish reviewed issues' })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).planningWrites)).toEqual([]);
  await page
    .getByRole('checkbox', { name: 'I reviewed the descriptions, repository, and relationships.' })
    .check();
  await page.getByRole('button', { name: 'Publish reviewed issues' }).click();
  await expect(page.getByText('Issue 2: complete', { exact: true })).toBeVisible();
  const request = (await page.evaluate(() => (window as any).planningWrites))[0][2];
  expect(request.entries[1]).toMatchObject({
    title: 'Connect client',
    body: 'Acceptance criteria B.',
    parent: 0,
    blockedBy: [0],
  });
  expect(JSON.stringify(request)).not.toContain('source-v1');
});
test('readiness retains missing evidence and shows Jenkins sources without changing tasks', async ({
  page,
}) => {
  await page.getByText('Agent and release readiness', { exact: true }).click();
  for (const name of ['Independent issue', 'Blocked issue', 'Merged change'])
    await page.getByRole('checkbox', { name, exact: true }).check();
  await page.getByRole('button', { name: 'Inspect selected tasks' }).click();
  await expect(
    page.getByText('Wave 1: org/repo · Independent issue · separate worktree', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Jenkins Linux' })).toHaveAttribute(
    'href',
    'https://ci.example.test/job/release/42',
  );
  await expect(page.getByText(/Open or unknown blockers remain/)).toBeVisible();
  expect(await page.evaluate(() => (window as any).planningWrites)).toEqual([]);
});
test('portfolio preserves source projects and filters personal assignments', async ({ page }) => {
  await page.getByText('Portfolio and personal work', { exact: true }).click();
  await page.getByRole('button', { name: 'Choose connected projects' }).click();
  for (const name of ['Platform', 'Tools'])
    await page.getByRole('checkbox', { name, exact: true }).check();
  await page.getByRole('button', { name: 'Load selected projects' }).click();
  await expect(page.getByRole('link', { name: 'Other project task' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Assigned GitHub login' }).fill('developer');
  await expect(page.getByRole('link', { name: 'Other project task' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Independent issue' })).toBeVisible();
});
