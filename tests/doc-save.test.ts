import test from 'node:test';
import assert from 'node:assert/strict';
import { DocSaveMachine } from '../src/domain/doc-save';
import type { ProjectDoc } from '../src/domain/docs';

const initial: ProjectDoc = { id: 'p', title: 'Page', parentId: null, markdown: '', revision: '1' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
test('page saves serialize edits, advance revisions, and clear only the newest saved draft', async () => {
  const requests: ProjectDoc[] = [];
  const pending = deferred<ProjectDoc>();
  const persisted: (ProjectDoc | null)[] = [];
  const machine = new DocSaveMachine(
    initial,
    async (doc) => {
      requests.push(doc);
      return requests.length === 1 ? pending.promise : { ...doc, revision: '3' };
    },
    () => {},
    (value) => persisted.push(value),
  );
  machine.edit({ ...initial, markdown: 'one' });
  const first = machine.flush();
  machine.edit({ ...initial, title: '', markdown: 'two' });
  assert.equal(machine.flush(), first);
  machine.refresh({ ...initial, markdown: 'external', revision: 'other' });
  assert.equal(machine.read().draft.markdown, 'two');
  pending.resolve({ ...requests[0], revision: '2' });
  await first;
  assert.equal(requests.length, 2);
  assert.equal(requests[1].revision, '2');
  assert.equal(requests[1].title, 'Untitled');
  assert.equal(machine.read().status, 'clean');
  assert.equal(machine.read().draft.markdown, 'two');
  assert.equal(persisted.filter((value) => value === null).length, 1);
});
test('conflicts block automatic retry and preserve edits until explicit discard', async () => {
  let calls = 0;
  const machine = new DocSaveMachine(
    initial,
    async () => {
      calls++;
      throw Error('DOC_CONFLICT: This page changed on disk.');
    },
    () => {},
    () => {},
  );
  let notifications = 0;
  const unsubscribe = machine.subscribe(() => notifications++);
  machine.edit({ ...initial, markdown: 'mine' });
  await machine.flush();
  machine.edit({ ...initial, markdown: 'still mine' });
  await machine.retry();
  assert.equal(calls, 1);
  assert.equal(machine.read().status, 'conflict');
  assert.equal(machine.read().draft.markdown, 'still mine');
  machine.discard({ ...initial, markdown: 'disk', revision: '2' });
  machine.refresh({ ...initial, markdown: 'new disk', revision: '3' });
  assert.equal(machine.read().draft.markdown, 'new disk');
  assert.ok(notifications > 0);
  unsubscribe();
});
test('failed and deleted saves do not lose edits; retry writes only after an explicit action', async () => {
  const pending = deferred<ProjectDoc>();
  let attempts = 0;
  const machine = new DocSaveMachine(
    initial,
    async (doc) => {
      if (++attempts === 1) return pending.promise;
      if (attempts === 2) throw Error('ENOENT: page deleted');
      return doc;
    },
    () => {},
    () => {},
  );
  machine.edit({ ...initial, markdown: 'first' });
  const save = machine.flush();
  assert.throws(() => machine.discard(initial), /Wait/);
  machine.edit({ ...initial, markdown: 'newest' });
  pending.reject(Error('Connection closed'));
  await save;
  assert.equal(machine.read().status, 'save-error');
  assert.equal(machine.read().draft.markdown, 'newest');
  await machine.flush();
  assert.equal(attempts, 1);
  await machine.retry();
  assert.equal(machine.read().status, 'deleted');
  await machine.retry();
  assert.equal(attempts, 2);
});

test('restoring an older draft preserves its revision and recovery data when the disk version conflicts', async () => {
  const persisted: (ProjectDoc | null)[] = [];
  const machine = new DocSaveMachine(
    { ...initial, revision: 'disk-2' },
    async (doc) => {
      assert.equal(doc.revision, 'disk-1');
      throw Error('DOC_CONFLICT');
    },
    () => {},
    (value) => persisted.push(value),
  );
  machine.restore({ ...initial, markdown: 'Recovered work', revision: 'disk-1' });
  await machine.flush();
  assert.equal(machine.read().status, 'conflict');
  assert.equal(machine.read().draft.markdown, 'Recovered work');
  assert.equal(persisted.includes(null), false);
});
