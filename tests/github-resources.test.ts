import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubProjectResources } from '../electron/trackers/github-resources';
import type { ProjectResourceKind, ProjectResourceOperation } from '../src/domain/github-resources';
const project = {
  id: 'P',
  title: 'Project',
  owner: 'org',
  number: 1,
  url: 'https://github.com/orgs/org/projects/1',
};
test('configured view creation uses REST numeric field IDs and preserves the filter, grouping and sort', async () => {
  const calls: any[] = [];
  const service = new GitHubProjectResources(
    async (query) => {
      if (query.includes('owner{__typename'))
        return {
          node: { id: 'P', number: 1, owner: { __typename: 'Organization', login: 'org' } },
        };
      return {
        node: {
          id: 'P',
          viewerCanUpdate: true,
          fields: {
            nodes: [{ id: 'F', databaseId: 123, name: 'Priority', dataType: 'SINGLE_SELECT' }],
            pageInfo: { hasNextPage: false },
          },
          views: { nodes: [], pageInfo: { hasNextPage: false } },
        },
      };
    },
    () => {},
    async (path, body) => {
      calls.push({ path, body });
      return { body: { id: 77 } };
    },
  );
  const current = await service.read(project, 'views');
  await service.change(project, current.revision, 'createConfiguredProjectView', {
    name: 'Sprint',
    layout: 'BOARD_LAYOUT',
    filter: 'status:"In progress"',
    visibleFieldIds: ['F'],
    groupFieldId: 'F',
    columnFieldId: 'F',
    sort: [{ id: 'F', direction: 'DESC' }],
  });
  assert.deepEqual(calls[0], {
    path: '/orgs/org/projectsV2/1/views',
    body: {
      name: 'Sprint',
      layout: 'board',
      filter: 'status:"In progress"',
      visible_fields: [123],
      group_by: [123],
      vertical_group_by: [123],
      sort_by: [[123, 'desc']],
    },
  });
  await assert.rejects(
    service.change(project, current.revision, 'createConfiguredProjectView', {
      name: 'Bad',
      layout: 'TABLE_LAYOUT',
      filter: '',
      groupFieldId: 'foreign',
    }),
    /this project/,
  );
  assert.equal(calls.length, 1);
});
function fixture() {
  let writable = true;
  let unknown = false;
  const writes: any[] = [];
  const rows = {
    issueFields: [{ id: 'IF', name: 'Shared priority', dataType: 'TEXT' }],
    fields: [{ id: 'F', name: 'Estimate', dataType: 'NUMBER' }],
    views: [
      {
        id: 'V',
        name: 'All',
        layout: 'TABLE_LAYOUT',
        groupByFields: { nodes: [], pageInfo: { hasNextPage: false } },
        verticalGroupByFields: { nodes: [], pageInfo: { hasNextPage: false } },
        sortByFields: { nodes: [], pageInfo: { hasNextPage: false } },
        configuration: {
          visibleFields: { nodes: [{ id: 'F' }], pageInfo: { hasNextPage: false } },
        },
      },
    ],
    statusUpdates: [{ id: 'S', body: 'On track', status: 'ON_TRACK' }],
    workflows: [{ id: 'W', name: 'Auto close', enabled: true }],
  };
  const service = new GitHubProjectResources(
    async (query, variables) => {
      if (query.startsWith('mutation')) {
        writes.push(variables.input);
        const name = /\{(\w+)\(input/.exec(query)![1];
        return unknown ? {} : { [name]: { clientMutationId: null } };
      }
      const kind = (Object.keys(rows) as ProjectResourceKind[]).find((kind) =>
        query.includes(`${kind}(first:`),
      )!;
      return {
        node: {
          id: 'P',
          viewerCanUpdate: writable,
          ...(kind === 'issueFields'
            ? {
                owner: {
                  issueFields: {
                    nodes: structuredClone(rows.issueFields),
                    pageInfo: { hasNextPage: false },
                  },
                },
              }
            : {}),
          [kind]: { nodes: structuredClone(rows[kind]), pageInfo: { hasNextPage: false } },
        },
      };
    },
    () => {},
  );
  return {
    service,
    writes,
    rows,
    deny: () => {
      writable = false;
    },
    uncertain: () => {
      unknown = true;
    },
  };
}
test('resource operations validate schema, project scope, and current revisions across all supported families', async () => {
  const f = fixture();
  const cases: [ProjectResourceKind, ProjectResourceOperation, Record<string, unknown>][] = [
    ['issueFields', 'createProjectV2IssueField', { issueFieldId: 'IF' }],
    ['fields', 'createProjectV2Field', { name: 'New', dataType: 'TEXT' }],
    ['fields', 'updateProjectV2Field', { fieldId: 'F', name: 'Size' }],
    ['fields', 'deleteProjectV2Field', { fieldId: 'F' }],
    [
      'views',
      'createProjectV2View',
      { name: 'Board', layout: 'BOARD_LAYOUT', configuration: { visibleFieldIds: ['F'] } },
    ],
    ['views', 'updateProjectV2View', { viewId: 'V', filter: 'is:issue' }],
    ['views', 'deleteProjectV2View', { viewId: 'V' }],
    ['statusUpdates', 'createProjectV2StatusUpdate', { body: 'Progress', status: 'ON_TRACK' }],
    ['statusUpdates', 'updateProjectV2StatusUpdate', { statusUpdateId: 'S', status: 'AT_RISK' }],
    ['statusUpdates', 'deleteProjectV2StatusUpdate', { statusUpdateId: 'S' }],
    ['workflows', 'deleteProjectV2Workflow', { workflowId: 'W' }],
  ];
  for (const [kind, operation, input] of cases) {
    const snapshot = await f.service.read(project, kind);
    await f.service.change(project, snapshot.revision, operation, input);
  }
  assert.equal(f.writes.length, cases.length);
  assert.equal(f.writes[0].projectId, 'P');
});
test('foreign IDs, stale forms, revoked permission, invalid schema and unknown outcomes never cause replay', async () => {
  const f = fixture();
  let current = await f.service.read(project, 'fields');
  await assert.rejects(
    f.service.change(project, current.revision, 'deleteProjectV2Field', { fieldId: 'FOREIGN' }),
    /not in this project/,
  );
  await assert.rejects(
    f.service.change(project, current.revision, 'createProjectV2Field', {
      projectId: 'OTHER',
      name: 'Bad',
      dataType: 'TEXT',
    }),
    /does not match/,
  );
  await assert.rejects(
    f.service.change(project, current.revision, 'createProjectV2Field', {
      name: 'Bad',
      dataType: 'INVALID',
    }),
  );
  f.rows.fields[0].name = 'Changed';
  await assert.rejects(
    f.service.change(project, current.revision, 'deleteProjectV2Field', { fieldId: 'F' }),
    /changed/,
  );
  current = await f.service.read(project, 'fields');
  f.uncertain();
  await assert.rejects(
    f.service.change(project, current.revision, 'deleteProjectV2Field', { fieldId: 'F' }),
    /unknown|Confirm/i,
  );
  assert.equal(f.writes.length, 1);
  f.deny();
  await assert.rejects(
    f.service.change(project, current.revision, 'deleteProjectV2Field', { fieldId: 'F' }),
    /permission/,
  );
  assert.equal(f.writes.length, 1);
});
test('view configuration preserves field identity and rejects foreign or duplicate fields', async () => {
  const f = fixture();
  const current = await f.service.read(project, 'views');
  assert.deepEqual(current.records[0].configuration, { visibleFieldIds: ['F'] });
  for (const ids of [['OTHER'], ['F', 'F']])
    await assert.rejects(
      f.service.change(project, current.revision, 'updateProjectV2View', {
        viewId: 'V',
        configuration: { visibleFieldIds: ids },
      }),
      /Choose fields/,
    );
  assert.equal(f.writes.length, 0);
});
