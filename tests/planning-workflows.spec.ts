import { type Page } from '@playwright/test';
import { test, expect, openPalette, palette } from './helpers/app';

/** Chooses an option of a Radix select. */
async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
/** Runs a command of the command palette (⌘K) of the project. */
async function runCommand(page: Page, label: string) {
  const input = await openPalette(page);
  await input.fill(label);
  await palette(page)
    .getByRole('option', { name: `${label} in Platform`, exact: true })
    .click();
}
/**
 * Selects tasks on the board (⌘-click starts the selection, then the checkboxes show), then opens
 * a planning tool from ⌘K. The tool acts on the selected tasks.
 */
async function openTool(page: Page, tool: string, titles: string[]) {
  const [first, ...rest] = titles;
  await page
    .getByRole('button', { name: first, exact: true })
    .click({ modifiers: ['ControlOrMeta'] });
  for (const title of rest)
    await page.getByRole('checkbox', { name: `Select ${title}`, exact: true }).check();
  await expect(page.getByRole('toolbar', { name: 'Selected tasks' })).toContainText(
    `${titles.length} selected`,
  );
  await runCommand(page, tool);
}
/** Opens the Projects page from the sidebar. */
async function openProjects(page: Page) {
  await page
    .getByRole('navigation', { name: 'Projects and repositories' })
    .getByRole('button', { name: 'Projects', exact: true })
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
  // Make tasks from a page is in ⌘K (and on a Knowledge page), not on the Tasks tab.
  await runCommand(page, 'Make tasks from a page…');
  // The page choice opens first.
  const picker = page.getByRole('dialog', { name: 'Choose a page for the tasks', exact: true });
  await picker.getByRole('option', { name: 'Launch guide', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Make tasks from a page', exact: true });
  // The board has one repository, so the tasks go there without a repository choice.
  await expect(dialog.getByRole('combobox', { name: 'GitHub repository' })).toHaveCount(0);
  // "More" shows the description, the parent and the blockers of a task.
  await dialog.getByRole('button', { name: 'More for task 2', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Task 2 description' })).toHaveValue(
    /Acceptance criteria B\./,
  );
  await dialog.getByRole('combobox', { name: 'Parent task', exact: true }).click();
  await page.getByRole('option', { name: '1. Implement service', exact: true }).click();
  await dialog.getByRole('checkbox', { name: '1. Implement service', exact: true }).check();
  // Nothing is written before Create.
  await expect(
    dialog.getByRole('checkbox', {
      name: 'I checked the descriptions, the repository and the links',
    }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).planningWrites)).toEqual([]);
  await dialog.getByRole('button', { name: 'Create 2 tasks' }).click();
  await expect(dialog.getByText('Created', { exact: true })).toHaveCount(2);
  const request = (await page.evaluate(() => (window as any).planningWrites))[0][2];
  expect(request.repository).toBe('org/repo');
  expect(request.entries[1]).toMatchObject({
    title: 'Connect client',
    parent: 0,
    blockedBy: [0],
  });
  // Each task names its source page and version, so an agent can read it.
  expect(request.entries[1].body).toBe(
    'Acceptance criteria B.\n\nSource document: Launch guide (doc, revision source-v1).',
  );
});
test('a usage link from a chat opens the Usage sheet without the task sheet', async ({ page }) => {
  // Chats send this event from their usage chip. The project page is not open yet.
  await openProjects(page);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('kalkidan-open-project-page', {
        detail: { groupId: 'g', page: 'insights', taskId: 'I1' },
      }),
    ),
  );
  // Knowledge has no Insights now: the usage of a task is in the Usage sheet of the project.
  await expect(page.getByRole('dialog', { name: 'Usage', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
});
