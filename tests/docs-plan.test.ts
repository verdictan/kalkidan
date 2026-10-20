import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { GitHubDocsPlan } from '../electron/trackers/github-docs-plan';
import { splitDocPlan } from '../src/domain/docs-plan';
import type { TrackerBoard } from '../src/domain/tracker';
test('Docs breakdown ignores code headings and bounds the explicit source', () => {
  assert.deepEqual(
    splitDocPlan('Intro\n## First\nAcceptance\n```md\n## not a task\n```\n## Second\nDone', 'Doc'),
    [
      { title: 'First', body: 'Acceptance\n```md\n## not a task\n```' },
      { title: 'Second', body: 'Done' },
    ],
  );
  assert.equal(
    splitDocPlan(Array.from({ length: 30 }, (_, i) => `## ${i}\nTask`).join('\n'), 'Doc').length,
    20,
  );
});
test('Docs issue plan recovers a lost draft response and creates each issue and relationship once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'docs-plan-'));
  try {
    const board: TrackerBoard = {
      project: { id: 'P', title: 'P', url: '' },
      writable: true,
      items: [],
    };
    let creates = 0,
      converts = 0,
      lost = true;
    const relations: Record<string, any> = {};
    const effects = {
      prepare: async () => {},
      board: async () => structuredClone(board),
      create: async (title: string, body: string) => {
        const id = 'I' + ++creates;
        board.items.push({ id, title, body, kind: 'DraftIssue' });
        relations[id] = {
          issueId: 'content-' + id,
          revision: 'r',
          writable: true,
          parent: null,
          subIssues: [],
          blockedBy: [],
          blocking: [],
        };
        if (lost) {
          lost = false;
          throw new Error('Lost response');
        }
        return id;
      },
      convert: async (id: string, repository: string) => {
        converts++;
        Object.assign(
          board.items.find((item) => item.id === id)!,
          {
            kind: 'Issue',
            repository,
            url: `https://github.com/${repository}/issues/${id.slice(1)}`,
          },
        );
      },
      relations: async (id: string) => structuredClone(relations[id]),
      relate: async (id: string, _revision: string, action: any) => {
        const target = board.items.find((item) => item.url === action.url)!;
        relations[id][action.kind === 'add-child' ? 'subIssues' : 'blockedBy'].push({
          id: 'content-' + target.id,
        });
      },
    };
    const request = {
      id: randomUUID(),
      repository: 'org/repo',
      entries: [
        { title: 'Parent', body: 'Acceptance' },
        { title: 'Child', body: 'Acceptance', parent: 0, blockedBy: [0] },
      ],
    };
    assert.equal(
      (await new GitHubDocsPlan(root).run('P', request, effects)).rows[0].state,
      'creating',
    );
    const result = await new GitHubDocsPlan(root).run('P', request, effects);
    assert.ok(result.rows.every((row) => row.state === 'complete'));
    assert.equal(creates, 2);
    assert.equal(converts, 2);
    await new GitHubDocsPlan(root).run('P', request, effects);
    assert.equal(creates, 2);
    assert.equal(relations.I1.subIssues.length, 1);
    assert.equal(relations.I2.blockedBy.length, 1);
    await assert.rejects(
      new GitHubDocsPlan(root).run('Other', request, effects),
      /different request/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('an uncertain conversion or externally edited draft is not replayed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'docs-plan-'));
  try {
    const board: TrackerBoard = {
      project: { id: 'P', title: 'P', url: '' },
      writable: true,
      items: [],
    };
    let calls = 0;
    const request = {
      id: randomUUID(),
      repository: 'org/repo',
      entries: [{ title: 'Title', body: 'Body' }],
    };
    const effects = {
      prepare: async () => {},
      board: async () => board,
      create: async (title: string, body: string) => {
        board.items.push({ id: 'I', title, body, kind: 'DraftIssue' });
        return 'I';
      },
      convert: async () => {
        calls++;
        throw new Error('Uncertain');
      },
      relations: async () => {
        throw new Error('No relations expected');
      },
      relate: async () => {},
    };
    await new GitHubDocsPlan(root).run('P', request, effects);
    const result = await new GitHubDocsPlan(root).run('P', request, effects);
    assert.equal(calls, 1);
    assert.match(result.rows[0].message!, /uncertain/);
    board.items[0].title = 'Changed';
    assert.match(
      (await new GitHubDocsPlan(root).run('P', request, effects)).rows[0].message!,
      /changed after review/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
