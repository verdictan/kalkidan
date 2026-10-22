import { type Page } from '@playwright/test';
import { test, expect } from './helpers/app';

/** Chooses an option of a Radix select. */
async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
/** Selects tasks on the board, then opens a planning tool from the selection bar. */
async function openTool(page: Page, tool: string, titles: string[]) {
  for (const title of titles)
    await page.getByRole('checkbox', { name: `Select ${title}`, exact: true }).check();
  const bar = page.getByRole('toolbar', { name: 'Selected tasks' });
  const button = bar.getByRole('button', { name: tool, exact: true });
  // The frequent tools are buttons. The other tools are in the More menu.
  if (await button.count()) await button.click();
  else {
    await bar.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: tool, exact: true }).click();
  }
}
/** Opens the Insights page of the project. */
async function openInsights(page: Page) {
  await page
    .getByRole('navigation', { name: 'Project page', exact: true })
    .getByRole('button', { name: 'Insights', exact: true })
    .click();
}
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
      projectServicesStatus: async () => ({
        available: true,
        historyList: true,
        operations: ['review.list', 'review.decide'],
        permissions: ['review.read', 'review.decide'],
      }),
      managedHistory: async (target: any) => {
        writes.push(['history', target]);
        const entry = {
          time: '2026-10-21T09:59:00Z',
          decision: 'allow',
          reason: 'allowed',
          review: null,
          provider: 'openai',
          model: 'gpt-5.4',
          agent: 'codex',
          inputTokens: '100',
          outputTokens: '20',
          cachedInputTokens: null,
          totalTokens: '120',
          cost: target.cursor ? null : '0.0125',
          currency: target.cursor ? null : 'USD',
          settlement: 'completed',
          corrected: !target.cursor,
          releasedAt: '2026-10-21T09:59:30Z',
          settledAt: '2026-10-21T10:00:00Z',
          startedAt: '2026-10-21T09:58:59Z',
          completedAt: '2026-10-21T09:59:00Z',
          latencyMs: '900',
          audited: true,
        };
        return {
          entries: [entry],
          cursor: target.cursor ? null : 'page-2',
          asOf: '2026-10-21T10:00:00Z',
          observedAt: '2026-10-21T10:00:00Z',
        };
      },
      projectServicesRequest: async (_group: string, request: any) => {
        writes.push(['project-service', request]);
        return request.operation === 'review.list'
          ? {
              project_scope: { organization_id: 'org', project_id: 'P' },
              actor_id: 'reviewer',
              revision: 'list-1',
              observed_at: '2026-10-21T00:00:00Z',
              items: [
                {
                  escalation_id: 'review-1',
                  title: 'Review tool access',
                  status: 'pending',
                  revision: 'review-v1',
                },
              ],
            }
          : {
              project_scope: { organization_id: 'org', project_id: 'P' },
              actor_id: 'reviewer',
              revision: 'list-2',
              observed_at: '2026-10-21T00:00:00Z',
              receipt_id: 'receipt-1',
              state: 'completed',
            };
      },
      taskUsageHistory: async () => [
        {
          runId: 'run-1',
          phase: 'ready-for-review',
          updatedAt: 1,
          evidence: [
            {
              observedAt: 1,
              value: {
                status: 'reconciling',
                requests: [
                  {
                    id: 'request-1',
                    policy: 'allow',
                    usage: null,
                    audit: null,
                    actualCost: null,
                    currency: null,
                    tokens: null,
                  },
                ],
              },
            },
          ],
        },
      ],
      trackerOwners: async () => [{ id: 'U', login: 'developer', kind: 'user' }],
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
  await page.goto('/');
  await page
    .locator('.project-tree')
    .getByRole('button', { name: 'Platform', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Project page', exact: true })
    .getByRole('button', { name: 'Tasks', exact: true })
    .click();
});
test('iteration proposal excludes blockers and writes only after review', async ({ page }) => {
  await openTool(page, 'Plan an iteration…', ['Independent issue', 'Blocked issue']);
  const dialog = page.getByRole('dialog', { name: 'Plan an iteration' });
  const selected = dialog.getByRole('region', { name: 'Selected tasks' });
  await expect(selected).toContainText('Independent issue');
  await expect(selected).toContainText('Blocked issue');
  // The board has one estimate field and one iteration field, so the tool chooses them.
  await expect(dialog.getByRole('combobox', { name: 'Estimate field' })).toContainText('Estimate');
  await expect(dialog.getByRole('combobox', { name: 'Iteration field' })).toContainText('Sprint');
  await choose(page, 'Target iteration', 'Next sprint · starts 2026-10-21');
  await dialog.getByRole('spinbutton', { name: 'Remaining capacity' }).fill('5');
  await dialog.getByRole('button', { name: 'Propose a plan' }).click();
  const plan = dialog.getByRole('region', { name: 'Proposed plan' });
  await expect(plan).toContainText('Other issues block this task.');
  await expect(plan.getByRole('checkbox', { name: 'Add Independent issue' })).toBeChecked();
  await expect(plan.getByRole('checkbox', { name: 'Add Blocked issue' })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).planningWrites)).toEqual([]);
  await dialog.getByRole('button', { name: 'Add 1 task to Next sprint' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).planningWrites.length)).toBe(1);
  const writes = await page.evaluate(() => (window as any).planningWrites);
  expect(writes[0][2].changes).toEqual([
    { itemId: 'I1', fieldId: 'S', before: null, value: { iterationId: 'next' } },
  ]);
});
test('explicit Docs selection previews source text and relationships before issue publication', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Create tasks from a doc…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create tasks from a doc page' });
  await dialog.getByRole('button', { name: 'Choose a page', exact: true }).click();
  await page.getByRole('option', { name: 'Launch guide', exact: true }).click();
  const repository = dialog.getByRole('combobox', { name: 'GitHub repository' });
  if ((await repository.textContent())?.includes('org/repo') !== true)
    await choose(page, 'GitHub repository', 'org/repo');
  await expect(repository).toContainText('org/repo');
  const second = dialog.getByRole('group', { name: 'Task 2', exact: true });
  await second.getByRole('combobox', { name: 'Parent task', exact: true }).click();
  await page.getByRole('option', { name: '1. Implement service', exact: true }).click();
  await second.getByRole('checkbox', { name: '1. Implement service', exact: true }).check();
  await dialog.getByRole('button', { name: 'Review 2 tasks' }).click();
  await expect(dialog).toContainText('Acceptance criteria B.');
  await expect(dialog.getByRole('button', { name: 'Create 2 tasks' })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).planningWrites)).toEqual([]);
  await dialog
    .getByRole('checkbox', { name: 'I checked the descriptions, the repository and the links' })
    .check();
  await dialog.getByRole('button', { name: 'Create 2 tasks' }).click();
  await expect(dialog.getByText('Created', { exact: true })).toHaveCount(2);
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
  await openTool(page, 'Check readiness…', ['Independent issue', 'Blocked issue', 'Merged change']);
  const dialog = page.getByRole('dialog', { name: 'Check readiness' });
  await dialog.getByRole('button', { name: 'Check readiness', exact: true }).click();
  const wave = dialog.getByRole('region', { name: 'Wave 1' });
  await expect(wave).toContainText('Independent issue');
  await expect(wave).toContainText('org/repo · Own branch copy');
  await expect(wave.getByRole('button', { name: 'Start wave (1 agent)' })).toBeVisible();
  // The release evidence of the merged change is collapsed until the user opens it.
  await dialog.getByRole('button', { name: 'Release evidence Ready to release' }).click();
  await expect(dialog.getByRole('link', { name: 'Jenkins Linux' })).toHaveAttribute(
    'href',
    'https://ci.example.test/job/release/42',
  );
  await expect(
    dialog
      .getByRole('region', { name: 'Tasks that need work' })
      .getByText('Other issues block this task.')
      .first(),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).planningWrites)).toEqual([]);
});
test('portfolio preserves source projects and filters personal assignments', async ({ page }) => {
  await page.getByRole('button', { name: 'Projects overview', exact: true }).click();
  await page
    .getByRole('group', { name: 'Projects overview view' })
    .getByRole('button', { name: 'My work', exact: true })
    .click();
  const work = page.getByRole('region', { name: 'My work' });
  const whose = work.getByRole('group', { name: 'Whose tasks' });
  await whose.getByRole('button', { name: 'Everyone', exact: true }).click();
  await expect(work.getByRole('button', { name: 'Other project task' })).toBeVisible();
  await expect(work).toContainText('Tools · No repository');
  await whose.getByRole('button', { name: 'Assigned to me (developer)', exact: true }).click();
  await expect(work.getByRole('button', { name: 'Other project task' })).toHaveCount(0);
  await expect(work.getByRole('button', { name: 'Independent issue' })).toBeVisible();
  await expect(work).toContainText('Platform · org/repo');
});

test('project reviews require an explicit reason and confirmation before the broker mutation', async ({
  page,
}) => {
  await openInsights(page);
  await page.getByRole('button', { name: 'Check project services' }).click();
  await choose(page, 'Project service view', 'Reviews and approvals');
  await page.getByRole('button', { name: 'Load current data' }).click();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled();
  await page.getByLabel('Decision reason').fill('Reviewed the requested tool access.');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  const calls = await page.evaluate(() => (window as any).planningWrites);
  expect(calls.filter((call: any) => call[1]?.operation === 'review.decide')).toHaveLength(0);
  await page.getByRole('button', { name: 'Confirm action', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Approve or deny a review' }),
  ).toBeVisible();
  // The receipt ID stays internal.
  await expect(page.getByText('Verdictan recorded a receipt.')).toBeVisible();
  await expect(page.getByText('receipt-1')).toHaveCount(0);
  const mutation = await page.evaluate(
    () =>
      (window as any).planningWrites.find((call: any) => call[1]?.operation === 'review.decide')[1],
  );
  expect(mutation.fields).toMatchObject({
    decision: 'approve',
    expected_revision: 'review-v1',
    escalation_id: 'review-1',
  });
  expect(mutation.fields.operation_id).toMatch(/^[a-f0-9-]{36}$/);
});
test('saved task usage keeps unavailable cost and tokens unknown', async ({ page }) => {
  await openInsights(page);
  const usage = page.getByRole('region', { name: 'Usage', exact: true });
  await usage.getByRole('combobox', { name: 'Task', exact: true }).click();
  await page.getByRole('option', { name: 'Independent issue', exact: true }).click();
  const record = usage.locator('dl.meta-list');
  await expect(record).toContainText('CostUnknown');
  await expect(record).toContainText('TokensUnknown');
  await expect(record).toContainText('Audit recordUnknown');
});
test('a usage link from a chat opens Insights at the task without the task sheet', async ({
  page,
}) => {
  // Chats send this event from their usage chip. The project page is not open yet.
  await page.getByRole('button', { name: 'Projects overview', exact: true }).click();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('kalkidan-open-project-page', {
        detail: { groupId: 'g', page: 'insights', taskId: 'I1' },
      }),
    ),
  );
  const usage = page.getByRole('region', { name: 'Usage', exact: true });
  await expect(usage.getByRole('combobox', { name: 'Task', exact: true })).toContainText(
    'Independent issue',
  );
  await expect(usage.locator('dl.meta-list')).toContainText('CostUnknown');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('task history from Verdictan shows each request without IDs and restarts to refresh', async ({
  page,
}) => {
  await openInsights(page);
  await page.getByRole('button', { name: 'Check project services' }).click();
  await choose(page, 'Project service task', 'Independent issue');
  const services = page.getByRole('region', { name: 'Managed agent services' });
  const request = services.locator('.review-row').first();
  await expect(request).toContainText('Request 1');
  await expect(request).toContainText('Allowed');
  await expect(request).toContainText('gpt-5.4');
  await expect(request).toContainText('120 in total · 100 in · 20 out · unknown cached');
  await expect(request).toContainText('0.0125 USD');
  await expect(request).toContainText('Completed · Corrected after release');
  await services.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(services.locator('.review-row')).toHaveCount(2);
  await expect(services.locator('.review-row').nth(1)).toContainText('CostUnknown');
  await services.getByRole('button', { name: 'Load again', exact: true }).click();
  await expect(services.locator('.review-row')).toHaveCount(1);
  const calls = await page.evaluate(() =>
    (window as any).planningWrites.filter((call: any) => call[0] === 'history'),
  );
  expect(calls.map((call: any) => call[1])).toEqual([
    { kind: 'task', groupId: 'g', taskId: 'I1' },
    { kind: 'task', groupId: 'g', taskId: 'I1', cursor: 'page-2' },
    { kind: 'task', groupId: 'g', taskId: 'I1' },
  ]);
  const text = await services.innerText();
  for (const id of ['page-2', 'I1', 'cfg_', 'vdt_']) expect(text).not.toContain(id);
});
