import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubProjects } from '../electron/github-projects';
import { completeConnection, workflowField } from '../electron/trackers/github-fields';
import type { TrackerField } from '../src/domain/tracker';

const project = {
  id: 'P',
  title: 'Roadmap',
  url: 'https://github.com/orgs/example/projects/1',
  number: 1,
  owner: 'example',
};
const option = { id: 'ready', name: 'Prêt' };
const field = (id: string, name: string): TrackerField => ({
  id,
  name,
  dataType: 'SINGLE_SELECT',
  options: [option],
  raw: {},
});
const page = (nodes: any[], endCursor?: string) => ({
  nodes,
  pageInfo: { hasNextPage: !!endCursor, endCursor },
});
test('workflow selection uses IDs, preserves renamed fields, and does not guess between labels', () => {
  const first = field('workflow', 'État');
  const second = field('priority', 'Status');
  assert.equal(workflowField([first])?.id, 'workflow');
  assert.equal(workflowField([first, second]), undefined);
  assert.equal(workflowField([first, second], 'workflow')?.id, 'workflow');
  assert.equal(workflowField([first, second], 'removed'), undefined);
  first.name = 'Renamed workflow';
  assert.equal(workflowField([first, second], 'workflow')?.id, 'workflow');
});
test('board reads all field/value pages and retains unknown variants with scope-specific cache entries', async () => {
  let reads = 0;
  const service = new GitHubProjects(async (_query, variables) => {
    reads++;
    if (variables.id === 'item') {
      assert.equal(variables.cursor, 'values-two');
      return {
        node: {
          fieldValues: page([
            {
              __typename: 'ProjectV2ItemFieldSingleSelectValue',
              optionId: 'ready',
              name: 'Prêt',
              field: { id: 'workflow' },
            },
          ]),
        },
      };
    }
    if (variables.cursor === 'fields-two')
      return {
        node: {
          fields: page([
            field('workflow', 'État'),
            { __typename: 'NewGitHubField', id: 'future', name: 'Future', dataType: 'NEW_KIND' },
          ]),
        },
      };
    return {
      node: {
        fields: page([field('priority', 'Status')], 'fields-two'),
        items: page([
          {
            id: 'item',
            content: { title: 'Item' },
            fieldValues: page([{ __typename: 'NewGitHubValue', value: 'preserved' }], 'values-two'),
          },
        ]),
      },
    };
  });
  const unmapped = await service.board(project);
  assert.equal(unmapped.statusField, undefined);
  assert.equal(unmapped.fields?.length, 3);
  assert.equal(unmapped.fields?.[2].raw.__typename, 'NewGitHubField');
  assert.equal(unmapped.items[0].fieldValues?.[0].value, 'preserved');
  const mapped = await service.board({ ...project, statusFieldId: 'workflow' });
  assert.equal(mapped.statusField?.id, 'workflow');
  assert.equal(mapped.items[0].statusId, 'ready');
  assert.equal(reads, 6);
  await service.board({ ...project, statusFieldId: 'workflow' });
  assert.equal(reads, 6);
});
test('pagination rejects cycles, malformed pages, and over-limit results instead of publishing partial data', async () => {
  await assert.rejects(
    completeConnection(page([], 'one'), async (cursor) =>
      page([], cursor === 'one' ? 'two' : 'one'),
    ),
    /pagination/,
  );
  await assert.rejects(
    completeConnection(page([], 'one'), async () => null),
    /incomplete/,
  );
  await assert.rejects(
    completeConnection(page([1, 2]), async () => null, 1),
    /too many/,
  );
  assert.deepEqual(await completeConnection(page([null, 1]), async () => null), [1]);
});

test('owner and project discovery reject pagination cycles, partial pages, and account changes', async () => {
  const owner = { id: 'O', login: 'org', kind: 'organization' as const };
  for (const action of ['owners', 'projects'] as const) {
    let calls = 0;
    const service = new GitHubProjects(async () => {
      const connection = page([], ++calls === 2 ? 'two' : 'one');
      return action === 'owners'
        ? { viewer: { id: 'U', login: 'user', organizations: connection } }
        : { organization: { projectsV2: connection } };
    });
    await assert.rejects(
      action === 'owners' ? service.owners() : service.list(owner),
      /pagination/,
    );
    assert.equal(calls, 3);
  }
  const changed = new GitHubProjects(async (_query, variables) => ({
    viewer: {
      id: variables.cursor ? 'other' : 'user',
      login: 'user',
      organizations: page([], 'next'),
    },
  }));
  await assert.rejects(changed.owners(), /account changed/);
  await assert.rejects(
    new GitHubProjects(async () => ({ viewer: null })).owners(),
    /not accessible/,
  );
  const partial = new GitHubProjects(async (_query, variables) => ({
    organization: {
      projectsV2: variables.cursor ? null : page([{ id: 'first', closed: false }], 'next'),
    },
  }));
  await assert.rejects(partial.list(owner), /not accessible/);
});

test('built-in field values drain nested connections and retain content properties', async () => {
  const { completeFieldValues } = await import('../electron/trackers/github-fields');
  const calls: any[] = [];
  const rows = [
    {
      __typename: 'ProjectV2ItemFieldLabelValue',
      field: { id: 'labels' },
      labels: {
        nodes: [{ id: 'L1', name: 'First' }],
        pageInfo: { hasNextPage: true, endCursor: 'next' },
      },
    },
  ];
  const result = await completeFieldValues(
    async (_query, variables) => {
      calls.push(variables);
      return {
        node: {
          project: { id: 'P' },
          fieldValues: {
            nodes: [
              {
                field: { id: 'labels' },
                labels: { nodes: [{ id: 'L2', name: 'Second' }], pageInfo: { hasNextPage: false } },
              },
            ],
            pageInfo: { hasNextPage: false },
          },
        },
      };
    },
    'P',
    'I',
    rows,
  );
  assert.deepEqual(result[0].labels, [
    { id: 'L1', name: 'First' },
    { id: 'L2', name: 'Second' },
  ]);
  assert.equal(calls[0].cursor, 'next');
});
