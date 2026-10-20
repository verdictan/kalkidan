import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubProjectContent } from '../electron/trackers/github-content';
import type { GitHubProject } from '../src/domain/github';
test('repository fields reject foreign IDs and reviews bind to the loaded pull request head', async () => {
  const writes: any[] = [];
  let kind = 'Issue',
    head = 'a'.repeat(40),
    author = false;
  const query = async (text: string, variables: any) => {
    if (text.startsWith('mutation')) {
      writes.push(variables.input);
      return { [text.match(/\{(\w+)\(input/)![1]]: {} };
    }
    if (text.includes('user(login')) return { user: { id: 'reviewer' } };
    if (text.includes('contexts(first:'))
      return {
        node: {
          id: variables.id,
          headRefOid: head,
          statusCheckRollup: { contexts: { nodes: [], pageInfo: { hasNextPage: false } } },
        },
      };
    if (text.includes('ProjectV2Item'))
      return {
        node: {
          project: { id: 'P' },
          content: {
            __typename: kind,
            id: 'content',
            title: 'Work',
            body: '',
            state: 'OPEN',
            updatedAt: 'now',
            viewerCanUpdate: true,
            viewerCanSetMilestone: true,
            viewerCanType: true,
            viewerDidAuthor: author,
            headRefOid: head,
            repository: { id: 'R' },
          },
        },
      };
    const key = [
      'closedByPullRequestsReferences',
      'assignees',
      'labels',
      'comments',
      'reviews',
      'milestones',
      'issueTypes',
    ].find((key) => text.includes(key + '('))!;
    return {
      node: {
        id: variables.id,
        [key]: {
          nodes:
            key === 'milestones'
              ? [{ id: 'M', title: 'Launch' }]
              : key === 'issueTypes'
                ? [{ id: 'T', name: 'Bug' }]
                : [],
          pageInfo: { hasNextPage: false },
        },
      },
    };
  };
  const service = new GitHubProjectContent(query, () => {}),
    project = { id: 'P' } as GitHubProject;
  let snapshot = await service.read(project, 'I');
  await assert.rejects(
    service.change(project, 'I', snapshot.revision, { kind: 'milestone', id: 'foreign' }),
    /repository/,
  );
  await service.change(project, 'I', snapshot.revision, { kind: 'milestone', id: 'M' });
  await service.change(project, 'I', snapshot.revision, { kind: 'issue-type', id: null });
  assert.deepEqual(writes.slice(), [
    { id: 'content', milestoneId: 'M' },
    { id: 'content', issueTypeId: null },
  ]);
  kind = 'PullRequest';
  snapshot = await service.read(project, 'I');
  await service.change(project, 'I', snapshot.revision, {
    kind: 'request-review',
    login: 'reviewer',
  });
  await service.change(project, 'I', snapshot.revision, {
    kind: 'review',
    headOid: head,
    event: 'APPROVE',
    body: '',
  });
  assert.equal(writes.at(-1).commitOID, head);
  head = 'b'.repeat(40);
  await assert.rejects(
    service.change(project, 'I', snapshot.revision, {
      kind: 'review',
      headOid: 'a'.repeat(40),
      event: 'APPROVE',
      body: '',
    }),
    /changed/,
  );
  author = true;
  snapshot = await service.read(project, 'I');
  await assert.rejects(
    service.change(project, 'I', snapshot.revision, {
      kind: 'review',
      headOid: head,
      event: 'APPROVE',
      body: '',
    }),
    /own pull request/,
  );
  assert.equal(writes.length, 4);
});
test('content writes use issue permissions, repository labels, revisions and typed mutations', async () => {
  const writes: any[] = [];
  let permission = true,
    ack = true;
  const query = async (text: string, variables: any) => {
    if (text.startsWith('mutation')) {
      writes.push(variables.input);
      return ack ? { [text.match(/\{(\w+)\(input/)![1]]: {} } : {};
    }
    if (text.includes('user(login')) return { user: { id: 'user' } };
    if (text.includes('label(name')) return { repository: { label: { id: 'label' } } };
    if (text.includes('ProjectV2Item'))
      return {
        node: {
          project: { id: 'project' },
          content: {
            __typename: 'Issue',
            id: 'issue',
            title: 'Title',
            body: 'Body',
            state: 'OPEN',
            updatedAt: 'now',
            viewerCanUpdate: permission,
            viewerCanClose: permission,
            viewerCanReopen: permission,
            viewerCanAssign: permission,
            viewerCanLabel: permission,
            repository: { id: 'repo', name: 'repo', owner: { login: 'org' } },
          },
        },
      };
    const key = [
      'closedByPullRequestsReferences',
      'assignees',
      'labels',
      'comments',
      'milestones',
      'issueTypes',
    ].find((key) => text.includes(key + '('))!;
    return {
      node: {
        id: variables.id,
        [key]: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
      },
    };
  };
  const service = new GitHubProjectContent(query, () => {}),
    project = { id: 'project' } as GitHubProject;
  const snapshot = await service.read(project, 'item');
  await assert.rejects(
    service.change(project, 'item', 'stale', { kind: 'comment', body: 'Test' }),
    /changed/,
  );
  await service.change(project, 'item', snapshot.revision, {
    kind: 'edit',
    title: 'New title',
    body: 'New body',
  });
  assert.deepEqual(writes[0], { id: 'issue', title: 'New title', body: 'New body' });
  for (const kind of ['close', 'reopen'] as const)
    await service.change(project, 'item', snapshot.revision, { kind });
  for (const kind of ['assign', 'unassign'] as const)
    await service.change(project, 'item', snapshot.revision, { kind, login: 'alice' });
  for (const kind of ['label', 'unlabel'] as const)
    await service.change(project, 'item', snapshot.revision, { kind, name: 'bug' });
  assert.deepEqual(writes.at(-1), { labelableId: 'issue', labelIds: ['label'] });
  ack = false;
  await assert.rejects(
    service.change(project, 'item', snapshot.revision, { kind: 'comment', body: 'Hello' }),
  );
  assert.equal(writes.length, 8);
  permission = false;
  const denied = await service.read(project, 'item');
  await assert.rejects(
    service.change(project, 'item', denied.revision, { kind: 'edit', title: 'Bad', body: '' }),
    /cannot edit/,
  );
  assert.equal(writes.length, 8);
});
