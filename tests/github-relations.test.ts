import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubIssueRelations } from '../electron/trackers/github-relations';
import type { GitHubProject } from '../src/domain/github';
const project = { id: 'project' } as GitHubProject;
test('relationships enforce revision, membership and no uncertain mutation replay', async () => {
  const writes: any[] = [];
  let writable = true;
  let receipt = true;
  const service = new GitHubIssueRelations(
    async (query, variables: any) => {
      if (query.startsWith('mutation')) {
        writes.push(variables.input);
        return receipt ? { [query.match(/\{(\w+)\(input/)![1]]: {} } : {};
      }
      if (query.includes('repository(owner:'))
        return { repository: { issue: { id: 'target', parent: null } } };
      if (query.includes('ProjectV2Item'))
        return {
          node: {
            project: { id: 'project', viewerCanUpdate: true },
            content: { id: 'issue', viewerCanUpdate: writable, parent: null },
          },
        };
      const key = ['subIssues', 'blockedBy', 'blocking'].find((value) =>
        query.includes(value + '('),
      )!;
      return {
        node: {
          id: 'issue',
          [key]: {
            nodes: [
              {
                id: 'child',
                title: 'Child',
                url: 'https://github.com/a/b/issues/2',
                state: 'OPEN',
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      };
    },
    () => {},
  );
  let snapshot = await service.read(project, 'item');
  await assert.rejects(
    service.change(project, 'item', 'stale', {
      kind: 'add-child',
      url: 'https://github.com/a/b/issues/3',
    }),
    /changed/,
  );
  await assert.rejects(
    service.change(project, 'item', snapshot.revision, { kind: 'remove-child', id: 'foreign' }),
    /not linked/,
  );
  assert.equal(writes.length, 0);
  await service.change(project, 'item', snapshot.revision, {
    kind: 'add-child',
    url: 'https://github.com/a/b/issues/3',
  });
  assert.deepEqual(writes[0], { issueId: 'issue', subIssueId: 'target', replaceParent: false });
  await service.change(project, 'item', snapshot.revision, {
    kind: 'add-blocker',
    url: 'https://github.com/a/b/issues/3',
  });
  await service.change(project, 'item', snapshot.revision, { kind: 'remove-child', id: 'child' });
  await service.change(project, 'item', snapshot.revision, { kind: 'remove-blocker', id: 'child' });
  receipt = false;
  await assert.rejects(
    service.change(project, 'item', snapshot.revision, {
      kind: 'add-blocker',
      url: 'https://github.com/a/b/issues/3',
    }),
  );
  assert.equal(writes.length, 5);
  writable = false;
  snapshot = await service.read(project, 'item');
  await assert.rejects(
    service.change(project, 'item', snapshot.revision, { kind: 'remove-child', id: 'child' }),
    /permission/,
  );
  assert.equal(writes.length, 5);
});
