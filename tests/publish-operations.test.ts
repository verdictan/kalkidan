import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PublishOperations, type PublishEffects } from '../electron/operations/publish';
const id = '11111111-1111-4111-8111-111111111111';
const request = {
  id,
  commit: { message: 'Implement feature', files: ['file.ts'] },
  pullRequest: { title: 'Feature', body: 'Changes' },
};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'publish-operation-'));
  let head = 'before',
    body = '',
    commits = 0,
    creates = 0,
    pushes = 0;
  let failPush = true,
    uncertainCommit = false,
    uncertainPR = false,
    pr: string | undefined;
  const effects: PublishEffects = {
    git: async (_cwd, args) => {
      if (args[0] === 'branch') return 'feature/work';
      if (args[0] === 'symbolic-ref') return 'origin/main';
      if (args[0] === 'rev-parse') return args[1] === 'HEAD^' ? 'before' : head;
      if (args[0] === 'log') return body;
      if (args[0] === 'push') {
        pushes++;
        if (failPush) throw Error('network unavailable');
      }
      return '';
    },
    commit: async (_cwd, message) => {
      commits++;
      head = 'after';
      body = message;
      if (uncertainCommit) throw Error('lost receipt');
      return { commit: head };
    },
    findPR: async () => pr,
    createPR: async () => {
      creates++;
      pr = 'https://github.com/org/repo/pull/1';
      if (uncertainPR) throw Error('lost receipt');
      return pr;
    },
  };
  const service = () => new PublishOperations(join(root, 'operations'), effects);
  return {
    root,
    service,
    counts: () => ({ commits, creates, pushes }),
    allowPush: () => {
      failPush = false;
    },
    loseCommit: () => {
      uncertainCommit = true;
    },
    losePR: () => {
      uncertainPR = true;
    },
  };
}
test('publish restart preserves committed SHA and retries push without another commit', async () => {
  const f = await fixture();
  try {
    const partial = await f.service().run(f.root, request);
    assert.equal(partial.phase, 'committed');
    assert.equal(partial.commit, 'after');
    assert.equal((await f.service().status(f.root, id))?.commit, 'after');
    f.allowPush();
    const complete = await f.service().run(f.root, { id });
    assert.equal(complete.phase, 'completed');
    assert.equal(complete.url, 'https://github.com/org/repo/pull/1');
    await f.service().run(f.root, { id });
    assert.deepEqual(f.counts(), { commits: 1, creates: 1, pushes: 2 });
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
test('uncertain commit and PR receipts reconcile their confirmed effects without replay', async () => {
  const f = await fixture();
  try {
    f.allowPush();
    f.loseCommit();
    f.losePR();
    assert.equal((await f.service().run(f.root, request)).phase, 'unknown-outcome');
    assert.equal((await f.service().run(f.root, { id })).phase, 'unknown-outcome');
    assert.equal((await f.service().run(f.root, { id })).phase, 'completed');
    assert.deepEqual(f.counts(), { commits: 1, creates: 1, pushes: 1 });
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
