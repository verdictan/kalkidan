import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubProjectSettings } from '../electron/trackers/github-settings';
const project = {
  id: 'P',
  title: 'Project',
  owner: 'org',
  number: 1,
  url: 'https://github.com/orgs/org/projects/1',
};
function fixture() {
  const node = {
    id: 'P',
    title: 'Project',
    shortDescription: null as string | null,
    readme: null as string | null,
    closed: false,
    public: false,
    template: false,
    viewerCanUpdate: true,
    updatedAt: '2026-10-20T00:00:00Z',
    teams: { nodes: [], pageInfo: { hasNextPage: false } },
    repositories: {
      nodes: [] as { id: string; nameWithOwner: string }[],
      pageInfo: { hasNextPage: false },
    },
  };
  const calls: any[] = [];
  let invalidations = 0;
  let failWrite = false;
  let failRead = false;
  const service = new GitHubProjectSettings(
    async (query, variables) => {
      calls.push({ query, variables });
      if (query.includes('repository(owner:'))
        return { repository: { id: 'R', viewerPermission: 'WRITE' } };
      if (query.startsWith('mutation')) {
        if (failWrite) throw new Error('unknown-outcome');
        const method = /\{(\w+)\(input/.exec(query)![1];
        if (method === 'updateProjectV2') {
          const { projectId: _id, ...changes } = variables.input as any;
          Object.assign(node, changes);
        } else if (method === 'linkProjectV2ToRepository')
          node.repositories.nodes.push({ id: 'R', nameWithOwner: 'org/repo' });
        else if (method === 'unlinkProjectV2FromRepository') node.repositories.nodes = [];
        else node.template = method === 'markProjectV2AsTemplate';
        return { [method]: { clientMutationId: null } };
      }
      if (failRead) throw new Error('read failed');
      return { node: { ...node } };
    },
    () => invalidations++,
  );
  return {
    service,
    node,
    calls,
    invalidations: () => invalidations,
    failWrite: () => {
      failWrite = true;
    },
    failRead: () => {
      failRead = true;
    },
  };
}
const action = {
  kind: 'update' as const,
  title: ' New title ',
  shortDescription: 'Summary',
  readme: '# Details',
  closed: true,
  public: true,
};
test('project settings read, update and template changes use pinned inputs and invalidate the board', async () => {
  const f = fixture();
  let current = await f.service.read(project);
  assert.equal(current.readme, '');
  const before = current.revision;
  current = await f.service.update(project, current.revision, action);
  assert.equal(current.title, 'New title');
  assert.equal(current.public, true);
  assert.notEqual(current.revision, before);
  for (const enabled of [true, false]) {
    current = await f.service.update(project, current.revision, { kind: 'template', enabled });
    assert.equal(current.template, enabled);
  }
  assert.equal(f.invalidations(), 3);
  assert.equal(f.calls.filter((c) => c.query.startsWith('mutation')).length, 3);
});
test('settings reject stale edits, removed permission, invalid inputs and wrong node identity before writing', async () => {
  const f = fixture();
  const current = await f.service.read(project);
  f.node.title = 'Changed elsewhere';
  await assert.rejects(f.service.update(project, current.revision, action), /changed on GitHub/);
  f.node.viewerCanUpdate = false;
  await assert.rejects(f.service.update(project, current.revision, action), /permission/);
  for (const invalid of [
    { ...action, title: '' },
    { ...action, closed: 'yes' },
    { ...action, readme: 'x'.repeat(20001) },
    { ...action, unexpected: true },
    { kind: 'template', enabled: 'yes' },
  ]) {
    await assert.rejects(f.service.update(project, current.revision, invalid as any), /settings/);
  }
  await assert.rejects(f.service.update(project, '', action), /Reload/);
  f.node.id = 'OTHER';
  await assert.rejects(f.service.read(project), /not accessible/);
  assert.equal(f.calls.filter((c) => c.query.startsWith('mutation')).length, 0);
});
test('uncertain writes are not retried and the pending lock is released', async () => {
  const f = fixture();
  const current = await f.service.read(project);
  f.failWrite();
  await assert.rejects(f.service.update(project, current.revision, action), /unknown-outcome/);
  assert.equal(f.calls.filter((c) => c.query.startsWith('mutation')).length, 1);
  assert.equal(f.invalidations(), 1);
  f.failRead();
  await assert.rejects(f.service.update(project, current.revision, action), /read failed/);
  assert.equal(f.invalidations(), 2);
});
test('concurrent settings writes are refused before a second permission read', async () => {
  const f = fixture();
  const current = await f.service.read(project);
  const first = f.service.update(project, current.revision, action);
  await assert.rejects(f.service.update(project, current.revision, action), /being saved/);
  await first;
  assert.equal(f.calls.filter((c) => c.query.startsWith('mutation')).length, 1);
});

test('repository links resolve identity and no-op when the desired link already exists', async () => {
  const f = fixture();
  let current = await f.service.read(project);
  current = await f.service.update(project, current.revision, {
    kind: 'repository',
    nameWithOwner: 'org/repo',
    linked: true,
  });
  assert.deepEqual(current.repositories, [{ id: 'R', nameWithOwner: 'org/repo' }]);
  current = await f.service.update(project, current.revision, {
    kind: 'repository',
    nameWithOwner: 'org/repo',
    linked: true,
  });
  assert.equal(f.calls.filter((c) => c.query.startsWith('mutation')).length, 1);
  current = await f.service.update(project, current.revision, {
    kind: 'repository',
    nameWithOwner: 'org/repo',
    linked: false,
  });
  assert.deepEqual(current.repositories, []);
  await assert.rejects(
    f.service.update(project, current.revision, {
      kind: 'repository',
      nameWithOwner: 'not a repo',
      linked: true,
    }),
    /Invalid/,
  );
  assert.equal(f.calls.filter((c) => c.query.startsWith('mutation')).length, 2);
});

test('repository settings drain pages and refuse an incomplete connection', async () => {
  const f = fixture();
  const base = await f.service.read(project);
  const cursors: unknown[] = [];
  const service = new GitHubProjectSettings(
    async (_query, variables) => {
      cursors.push(variables.cursor);
      return {
        node: {
          ...base,
          viewerCanUpdate: true,
          teams: { nodes: [], pageInfo: { hasNextPage: false } },
          repositories: {
            nodes: [
              {
                id: variables.cursor ? 'B' : 'A',
                nameWithOwner: variables.cursor ? 'org/b' : 'org/a',
              },
            ],
            pageInfo: { hasNextPage: !variables.cursor, endCursor: 'next' },
          },
        },
      };
    },
    () => {},
  );
  const read = await service.read(project);
  assert.deepEqual(
    read.repositories.map((repo) => repo.id),
    ['A', 'B'],
  );
  assert.deepEqual(cursors, [undefined, 'next']);
  const incomplete = new GitHubProjectSettings(
    async () => ({ node: { ...base, viewerCanUpdate: true, repositories: null } }),
    () => {},
  );
  await assert.rejects(incomplete.read(project), /incomplete connection/);
});

test('administration resolves copy owners, confirms deletes, scopes teams and uses explicit collaborator roles', async () => {
  const f = fixture();
  const current = await f.service.read(project);
  const calls: { query: string; variables: any }[] = [];
  let organization = 'org';
  const service = new GitHubProjectSettings(
    async (query, variables) => {
      calls.push({ query, variables });
      if (query.startsWith('mutation')) {
        const method = /\{(\w+)\(input/.exec(query)![1];
        return { [method]: { projectV2: { url: 'https://github.com/orgs/org/projects/2' } } };
      }
      if (query.includes('repositoryOwner')) return { repositoryOwner: { id: 'OWNER' } };
      if (query.includes('user(login:')) return { user: { id: 'USER' } };
      if (query.includes('team(slug:'))
        return { node: { owner: { login: organization } }, organization: { team: { id: 'TEAM' } } };
      return { node: f.node };
    },
    () => {},
  );
  const copy = await service.administer(project, current.revision, {
    kind: 'copy',
    owner: 'org',
    title: 'Copied',
    includeDraftIssues: true,
  });
  assert.equal(copy.url, 'https://github.com/orgs/org/projects/2');
  await assert.rejects(
    service.administer(project, current.revision, { kind: 'delete', confirmation: 'wrong' }),
    /Type the current/,
  );
  assert.deepEqual(
    await service.administer(project, current.revision, {
      kind: 'delete',
      confirmation: 'Project',
    }),
    { deleted: true },
  );
  for (const linked of [true, false])
    await service.administer(project, current.revision, {
      kind: 'team',
      organization: 'org',
      slug: 'engineering',
      linked,
    });
  for (const role of ['NONE', 'READER', 'WRITER', 'ADMIN'] as const)
    await service.administer(project, current.revision, {
      kind: 'collaborator',
      user: 'person',
      role,
    });
  await service.administer(project, current.revision, {
    kind: 'team-collaborator',
    organization: 'org',
    slug: 'engineering',
    role: 'WRITER',
  });
  organization = 'different';
  await assert.rejects(
    service.administer(project, current.revision, {
      kind: 'team',
      organization: 'org',
      slug: 'engineering',
      linked: true,
    }),
    /project organization/,
  );
  assert.equal(calls.filter((call) => call.query.startsWith('mutation')).length, 9);
  assert.deepEqual(
    calls.find((call) => call.query.includes('updateProjectV2Collaborators'))?.variables.input
      .collaborators,
    [{ userId: 'USER', role: 'NONE' }],
  );
});
