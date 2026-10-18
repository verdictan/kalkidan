import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubProjects, parseProjectURL } from '../electron/github-projects';
import { chatArgs } from '../electron/chat';
const project = {
  id: 'P1',
  title: 'Roadmap',
  url: 'https://github.com/orgs/example/projects/1',
  owner: 'example',
  number: 1,
};
function page(id: string, more = false) {
  return {
    node: {
      title: 'Roadmap',
      fields: { nodes: [{ id: 'F1', name: 'Status', options: [{ id: 'O1', name: 'Done' }] }] },
      items: {
        pageInfo: { hasNextPage: more, endCursor: more ? 'next' : null },
        nodes: [
          {
            id,
            isArchived: false,
            content: {
              title: 'Task ' + id,
              body: 'Acceptance criteria',
              repository: { nameWithOwner: 'example/web' },
            },
            fieldValues: { nodes: [] },
          },
          { id: 'archived', isArchived: true },
          { id: 'redacted', content: null },
        ],
      },
    },
  };
}
test('GitHub URL validation constrains project and issue destinations', async () => {
  assert.deepEqual(parseProjectURL(project.url), {
    owner: 'example',
    number: 1,
    kind: 'organization',
  });
  for (const url of [
    'https://evil.com/orgs/example/projects/1',
    'http://github.com/orgs/example/projects/1',
    'https://github.com/orgs/example/projects/0',
  ])
    assert.throws(() => parseProjectURL(url));
  const github = new GitHubProjects(async () => {
    throw new Error('Must not request');
  });
  await assert.rejects(github.addIssue(project, 'https://evil.com/a/b/issues/2'), /github.com/);
});
test('GitHub project pagination includes every active item and validates status membership before mutation', async () => {
  const calls: { query: string; variables: Record<string, unknown> }[] = [];
  const github = new GitHubProjects(async (query, variables) => {
    calls.push({ query, variables });
    return query.startsWith('mutation')
      ? {}
      : page(variables.cursor ? 'I2' : 'I1', !variables.cursor);
  });
  assert.deepEqual(
    (await github.board(project)).items.map((i) => i.id),
    ['I1', 'I2'],
  );
  await github.setStatus(project, 'I2', 'O1');
  assert.deepEqual(calls.at(-1)!.variables, {
    project: 'P1',
    item: 'I2',
    field: 'F1',
    option: 'O1',
  });
  const count = calls.filter((c) => c.query.startsWith('mutation')).length;
  await assert.rejects(github.setStatus(project, 'foreign', 'O1'), /no longer exists/);
  await assert.rejects(github.setStatus(project, 'I1', 'unknown'), /no longer exists/);
  assert.equal(calls.filter((c) => c.query.startsWith('mutation')).length, count);
});
test('GitHub creation sends user text as variables and resolves existing issues before adding', async () => {
  const calls: any[] = [];
  const github = new GitHubProjects(async (query, variables) => {
    calls.push({ query, variables });
    return {
      repository: { issueOrPullRequest: { id: 'issue-id' } },
      addProjectV2DraftIssue: { projectItem: { id: 'new-item' } },
    };
  });
  const title = 'Fix "quotes" $(shell)';
  assert.equal(await github.addDraft(project, title, 'Body\nwith lines'), 'new-item');
  assert.equal(calls[0].variables.title, title);
  assert.ok(!calls[0].query.includes(title));
  await github.addIssue(project, 'https://github.com/example/web/issues/23');
  assert.deepEqual(calls[1].variables, { owner: 'example', repo: 'web', number: 23 });
  assert.deepEqual(calls[2].variables, { project: 'P1', content: 'issue-id' });
});
test('Claude model selection is a separate argument and Codex uses App Server', () => {
  for (const agent of ['codex', 'claude'] as const)
    for (const create of [false, true]) {
      const args = chatArgs(agent, 'session-id', false, create, 'custom-model');
      if (agent === 'claude') assert.equal(args[args.indexOf('--model') + 1], 'custom-model');
      else assert.deepEqual(args, ['app-server']);
      assert.ok(!chatArgs(agent, 'session-id', false, create).includes('--model'));
    }
  assert.throws(() => chatArgs('codex', 'session-id', false, true, '--dangerous'));
  assert.throws(() => chatArgs('claude', 'session-id', false, true, 'model\nother'));
});

test('project discovery paginates organizations and projects and excludes closed projects', async () => {
  const github = new GitHubProjects(async (query, variables) => {
    if (query.includes('viewer'))
      return {
        viewer: {
          id: 'me',
          login: 'me',
          organizations: {
            nodes: [
              { id: variables.cursor ? 'b' : 'a', login: variables.cursor ? 'beta' : 'alpha' },
            ],
            pageInfo: { hasNextPage: !variables.cursor, endCursor: 'next' },
          },
        },
      };
    return {
      organization: {
        projectsV2: {
          nodes: [
            {
              id: variables.cursor ? 'p2' : 'p1',
              title: 'Roadmap',
              number: 1,
              url: project.url,
              closed: false,
            },
            { id: 'closed', closed: true },
          ],
          pageInfo: { hasNextPage: !variables.cursor, endCursor: 'next' },
        },
      },
    };
  });
  assert.deepEqual(
    (await github.owners()).map((o) => o.login),
    ['me', 'alpha', 'beta'],
  );
  assert.deepEqual(
    (await github.list({ id: 'a', login: 'alpha', kind: 'organization' })).map((p) => p.id),
    ['p1', 'p2'],
  );
});
test('creating a project resolves owner on the server and sends title through variables', async () => {
  const calls: any[] = [];
  const github = new GitHubProjects(async (query, variables) => {
    calls.push({ query, variables });
    return query.startsWith('mutation')
      ? { createProjectV2: { projectV2: project } }
      : { organization: { id: 'real-owner' } };
  });
  const owner = { id: 'untrusted-id', login: 'example', kind: 'organization' as const };
  const title = 'Plan "quotes" $(shell)';
  assert.equal((await github.create(owner, title)).id, 'P1');
  assert.deepEqual(calls[1].variables, { owner: 'real-owner', title });
  await assert.rejects(github.create(owner, '  '), /title/);
  await assert.rejects(github.list({ ...owner, kind: 'invalid' as any }), /valid/);
});
