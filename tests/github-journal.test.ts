import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitHubMutationJournal } from '../electron/trackers/github-journal';
import { GitHubRequestError } from '../electron/trackers/request-scheduler';
test('uncertain GitHub mutation survives restart and blocks dispatch until explicit review', async () => {
  const root = await mkdtemp(join(tmpdir(), 'github-journal-'));
  try {
    let calls = 0;
    const send = async () => {
      calls++;
      throw new Error('Lost response');
    };
    const service = new GitHubMutationJournal(root, 'P', () => {});
    await assert.rejects(service.run('addComment', { body: 'private text' }, send));
    const next = new GitHubMutationJournal(root, 'P', () => {});
    await assert.rejects(
      next.run('addComment', { body: 'private text' }, send),
      /uncertain result/,
    );
    assert.equal(calls, 1);
    const rows = await next.list();
    assert.equal(rows[0].state, 'unknown-outcome');
    const text = await readFile(join(root, (await readdir(root))[0]), 'utf8');
    assert.equal(text.includes('private text'), false);
    await next.review(rows[0].id);
    await next.run('addComment', { body: 'private text' }, async () => {
      calls++;
      return { ok: true };
    });
    assert.equal(calls, 2);
    assert.equal((await next.list()).at(-1)?.state, 'confirmed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('confirmed rejection is retryable and lost storage ownership prevents dispatch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'github-journal-'));
  try {
    const service = new GitHubMutationJournal(root, 'P', () => {});
    await assert.rejects(
      service.run('update', {}, async () => {
        throw new GitHubRequestError('permission');
      }),
    );
    assert.equal((await service.list())[0].state, 'rejected');
    await service.run('update', {}, async () => true);
    let sent = false;
    await assert.rejects(
      new GitHubMutationJournal(root, 'Other', () => {
        throw new Error('Lost lease');
      }).run('update', {}, async () => {
        sent = true;
      }),
      /Lost lease/,
    );
    assert.equal(sent, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
