import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { GitHubProjectBatch } from '../electron/trackers/github-batch';
import type { TrackerBoard } from '../src/domain/tracker';
test('batch resumes a lost write response without replay and rejects changed request IDs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'batch-'));
  try {
    let calls = 0;
    const board: TrackerBoard = {
      project: { id: 'P', title: 'P', url: 'https://github.com/orgs/o/projects/1' },
      writable: true,
      fields: [{ id: 'F', name: 'Estimate', dataType: 'NUMBER', raw: {} }],
      items: [{ id: 'I', title: 'Task', body: '', fieldValues: [] }],
    };
    const request = {
      id: randomUUID(),
      changes: [{ itemId: 'I', fieldId: 'F', before: null, value: { number: 3 } }],
    };
    const read = async () => structuredClone(board);
    const write = async () => {
      calls++;
      board.items[0].fieldValues = [{ field: { id: 'F' }, number: 3 }];
      throw new Error('Lost reply');
    };
    assert.equal(
      (await new GitHubProjectBatch(root).run('P', request, read, write)).rows[0].state,
      'unknown-outcome',
    );
    assert.equal(
      (await new GitHubProjectBatch(root).run('P', request, read, write)).rows[0].state,
      'confirmed',
    );
    assert.equal(calls, 1);
    await assert.rejects(
      new GitHubProjectBatch(root).run('Other', request, read, write),
      /different request/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('batch reports conflicts and retains uncertain values without blind retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'batch-'));
  try {
    let calls = 0;
    const board: TrackerBoard = {
      project: { id: 'P', title: 'P', url: '' },
      writable: true,
      fields: [{ id: 'F', name: 'Estimate', dataType: 'NUMBER', raw: {} }],
      items: [
        { id: 'I', title: 'Task', body: '', fieldValues: [{ field: { id: 'F' }, number: 2 }] },
      ],
    };
    const read = async () => board;
    const write = async () => {
      calls++;
      throw new Error('Network');
    };
    const service = new GitHubProjectBatch(root);
    assert.equal(
      (
        await service.run(
          'P',
          {
            id: randomUUID(),
            changes: [{ itemId: 'I', fieldId: 'F', before: null, value: { number: 3 } }],
          },
          read,
          write,
        )
      ).rows[0].state,
      'conflict',
    );
    const request = {
      id: randomUUID(),
      changes: [{ itemId: 'I', fieldId: 'F', before: { number: 2 }, value: { number: 3 } }],
    };
    await service.run('P', request, read, write);
    assert.equal((await service.run('P', request, read, write)).rows[0].state, 'unknown-outcome');
    assert.equal(calls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('batch service reads only the affected item and validates it before changing a field', async () => {
  const { GitHubProjects } = await import('../electron/github-projects');
  const root = await mkdtemp(join(tmpdir(), 'batch-targeted-'));
  const calls: string[] = [];
  const fields = {
    nodes: [{ id: 'F', name: 'Estimate', dataType: 'NUMBER' }],
    pageInfo: { hasNextPage: false },
  };
  const project = {
    id: 'P',
    title: 'P',
    owner: 'org',
    number: 1,
    url: 'https://github.com/orgs/org/projects/1',
  };
  try {
    const service = new GitHubProjects(
      async (query) => {
        calls.push(query);
        if (query.startsWith('mutation'))
          return { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'I' } } };
        if (query.includes('project:node'))
          return {
            project: { id: 'P', viewerCanUpdate: true, fields },
            item: { id: 'I', project: { id: 'P' } },
          };
        return {
          node: {
            id: 'I',
            isArchived: false,
            project: { id: 'P', viewerCanUpdate: true, fields },
            fieldValues: { nodes: [], pageInfo: { hasNextPage: false } },
          },
        };
      },
      async () => 'test',
      root,
    );
    const result = await service.batch(project, {
      id: randomUUID(),
      changes: [{ itemId: 'I', fieldId: 'F', before: null, value: { number: 2 } }],
    });
    assert.equal(result.rows[0].state, 'confirmed');
    assert.equal(calls.filter((query) => query.startsWith('mutation')).length, 1);
    assert.ok(calls.every((query) => !query.includes('items(first:')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
