import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubProjectMutations } from '../electron/trackers/github-mutations';
import type { ProjectFieldValue } from '../src/domain/github-mutations';
const project = {
  id: 'P',
  owner: 'example',
  number: 1,
  title: 'Plan',
  url: 'https://github.com/orgs/example/projects/1',
};
function fixture() {
  let invalidations = 0;
  const calls: { query: string; variables: Record<string, any> }[] = [];
  const fields = [
    'TEXT',
    'NUMBER',
    'DATE',
    'SINGLE_SELECT',
    'MULTI_SELECT',
    'ITERATION',
    'UNKNOWN',
  ].map((dataType) => ({
    id: dataType,
    name: dataType,
    dataType,
    options: [{ id: 'o', name: 'Option' }],
    configuration: { iterations: [{ id: 'i', title: 'Iteration' }] },
  }));
  const state: any = {
    project: { viewerCanUpdate: true, fields: { nodes: fields } },
    item: {
      project: { id: 'P' },
      content: { __typename: 'DraftIssue', id: 'D' },
      isArchived: false,
    },
    after: 'P',
    repository: { id: 'R', hasIssuesEnabled: true, viewerPermission: 'WRITE' },
    failure: false,
  };
  const service = new GitHubProjectMutations(
    async (query, variables) => {
      calls.push({ query, variables });
      if (query.startsWith('mutation')) {
        if (state.failure) throw Error('unknown-outcome');
        const name = /\{([a-zA-Z0-9]+)\(input:/.exec(query)![1];
        return state.emptyResult ? {} : { [name]: { clientMutationId: null } };
      }
      if (query.includes('hasIssuesEnabled')) return { repository: state.repository };
      if (variables.id) return { node: { project: { id: state.after } } };
      return state;
    },
    () => invalidations++,
  );
  return { service, state, calls, invalidations: () => invalidations };
}
test('GitHub field writes validate fresh field types, options, dates and permission without replay', async () => {
  const f = fixture();
  for (const [field, value] of Object.entries({
    TEXT: { text: 'private content' },
    NUMBER: { number: 0 },
    DATE: { date: '2028-02-29' },
    SINGLE_SELECT: { singleSelectOptionId: 'o' },
    MULTI_SELECT: { multiSelectOptionIds: ['o'] },
    ITERATION: { iterationId: 'i' },
  })) {
    await f.service.field(project, 'I', field, value as ProjectFieldValue);
    assert.deepEqual(f.calls.at(-1)?.variables.input, {
      projectId: 'P',
      itemId: 'I',
      fieldId: field,
      value,
    });
    assert.ok(!f.calls.at(-1)?.query.includes('private content'));
  }
  await f.service.field(project, 'I', 'TEXT', null);
  assert.match(f.calls.at(-1)!.query, /clearProjectV2ItemFieldValue/);
  const invalid: [string, unknown][] = [
    ['TEXT', { text: 1 }],
    ['TEXT', { text: 'x'.repeat(20001) }],
    ['NUMBER', { number: NaN }],
    ['DATE', { date: '2027-02-29' }],
    ['DATE', { date: 'bad' }],
    ['DATE', { date: '9999-99-99' }],
    ['SINGLE_SELECT', { singleSelectOptionId: 'missing' }],
    ['MULTI_SELECT', { multiSelectOptionIds: ['o', 'o'] }],
    ['MULTI_SELECT', { multiSelectOptionIds: ['missing'] }],
    ['MULTI_SELECT', { multiSelectOptionIds: 'o' }],
    ['ITERATION', { iterationId: 'missing' }],
    ['TEXT', { text: 'x', number: 1 }],
    ['TEXT', []],
    ['UNKNOWN', null],
    ['removed', null],
  ];
  for (const [field, value] of invalid) {
    const before = f.calls.filter((call) => call.query.startsWith('mutation')).length;
    await assert.rejects(f.service.field(project, 'I', field, value as ProjectFieldValue));
    assert.equal(f.calls.filter((call) => call.query.startsWith('mutation')).length, before);
  }
  await assert.rejects(f.service.field(project, 'I', 'bad field', null), /Invalid/);
  f.state.project.viewerCanUpdate = false;
  await assert.rejects(f.service.field(project, 'I', 'TEXT', null), /permission/);
  f.state.project.viewerCanUpdate = true;
  f.state.item.project.id = 'foreign';
  await assert.rejects(f.service.field(project, 'I', 'TEXT', null), /no longer/);
  f.state.item.project.id = 'P';
  f.state.emptyResult = true;
  await assert.rejects(f.service.field(project, 'I', 'TEXT', { text: 'x' }), /outcome|confirm/i);
  f.state.emptyResult = false;
  f.state.failure = true;
  const before = f.calls.length;
  await assert.rejects(f.service.field(project, 'I', 'TEXT', { text: 'x' }), /unknown-outcome/);
  assert.equal(f.calls.length, before + 2);
  assert.ok(f.invalidations() > 20);
});
test('GitHub item lifecycle resolves membership and preserves completed archive transitions', async () => {
  const f = fixture();
  for (const kind of ['archive', 'remove'] as const) {
    await f.service.item(project, 'I', { kind });
    assert.deepEqual(f.calls.at(-1)?.variables.input, { projectId: 'P', itemId: 'I' });
  }
  let before = f.calls.length;
  await f.service.item(project, 'I', { kind: 'unarchive' });
  assert.equal(f.calls.length, before + 1);
  f.state.item.isArchived = true;
  before = f.calls.length;
  await f.service.item(project, 'I', { kind: 'archive' });
  assert.equal(f.calls.length, before + 1);
  await f.service.item(project, 'I', { kind: 'unarchive' });
  assert.match(f.calls.at(-1)!.query, /unarchiveProjectV2Item/);
  await f.service.item(project, 'I', { kind: 'reorder', afterId: null });
  await f.service.item(project, 'I', { kind: 'reorder', afterId: 'Other' });
  assert.equal(f.calls.at(-1)?.variables.input.afterId, 'Other');
  await assert.rejects(
    f.service.item(project, 'I', { kind: 'reorder', afterId: 'I' }),
    /another item/,
  );
  f.state.after = 'OtherProject';
  await assert.rejects(
    f.service.item(project, 'I', { kind: 'reorder', afterId: 'Other' }),
    /not in/,
  );
  await assert.rejects(f.service.item(project, 'I', { kind: 'bad' } as any), /Invalid/);
  await assert.rejects(f.service.item(project, 'bad id', { kind: 'archive' }), /Invalid/);
});
test('draft conversion uses repository permissions and draft IDs read from GitHub', async () => {
  const f = fixture();
  await f.service.item(project, 'I', {
    kind: 'edit-draft',
    title: '  Draft  ',
    body: 'Description',
  });
  assert.deepEqual(f.calls.at(-1)?.variables.input, {
    draftIssueId: 'D',
    title: 'Draft',
    body: 'Description',
  });
  await assert.rejects(
    f.service.item(project, 'I', { kind: 'edit-draft', title: '', body: '' }),
    /title/,
  );
  await f.service.item(project, 'I', { kind: 'convert', repository: 'example/repo' });
  assert.deepEqual(f.calls.at(-1)?.variables.input, { itemId: 'I', repositoryId: 'R' });
  await assert.rejects(
    f.service.item(project, 'I', { kind: 'convert', repository: 'bad' }),
    /owner\/name/,
  );
  f.state.repository.viewerPermission = 'READ';
  await assert.rejects(
    f.service.item(project, 'I', { kind: 'convert', repository: 'example/repo' }),
    /issue access/,
  );
  f.state.repository = null;
  await assert.rejects(
    f.service.item(project, 'I', { kind: 'convert', repository: 'example/repo' }),
    /issue access/,
  );
  f.state.item.content = { __typename: 'Issue' };
  await assert.rejects(
    f.service.item(project, 'I', { kind: 'edit-draft', title: 'Title', body: '' }),
    /no longer a draft/,
  );
});
test('concurrent writes to one item are rejected and the slot clears after failure', async () => {
  let release!: (value: any) => void;
  let changes = 0;
  const service = new GitHubProjectMutations(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    () => changes++,
  );
  const first = service.item(project, 'I', { kind: 'archive' });
  await assert.rejects(service.item(project, 'I', { kind: 'archive' }), /in progress/);
  release({});
  await assert.rejects(first, /permission/);
  const retry = service.item(project, 'I', { kind: 'archive' });
  release({});
  await assert.rejects(retry, /permission/);
  assert.equal(changes, 2);
});
