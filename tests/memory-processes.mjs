// Native acceptance: independent processes use the real filesystem lease.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, readdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = await mkdtemp(join(tmpdir(), 'kalkidan-memory-processes-'));
const workers = [];
function worker() {
  const process = fork(
    fileURLToPath(new URL('./fixtures/memory-process.mjs', import.meta.url)),
    [],
    {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  workers.push(process);
  let diagnostic = '';
  process.stderr.on('data', (bytes) => {
    diagnostic = (diagnostic + bytes).slice(-4000);
  });
  const messages = [];
  const listeners = new Set();
  let closed = false;
  process.on('message', (message) => {
    messages.push(message);
    for (const read of listeners) read();
  });
  const exited = new Promise((resolve) =>
    process.on('exit', () => {
      closed = true;
      for (const read of listeners) read();
      resolve();
    }),
  );
  function wait(kind) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error(`Timed out: ${kind}. ${diagnostic}`)), 10000);
      function finish(error, result) {
        clearTimeout(timer);
        listeners.delete(read);
        if (error) reject(error);
        else resolve(result);
      }
      function read() {
        const failure = messages.find((message) => message.kind === 'error');
        if (failure) return finish(new Error(failure.message));
        const index = messages.findIndex((message) => message.kind === kind);
        if (index >= 0) return finish(null, messages.splice(index, 1)[0]);
        if (closed) finish(new Error(`Worker exited: ${diagnostic}`));
      }
      listeners.add(read);
      read();
    });
  }
  return {
    process,
    exited,
    wait,
    run: (command) => process.send({ kind: 'run', root: directory, ...command }),
  };
}
try {
  const first = worker(),
    second = worker();
  await Promise.all([first.wait('ready'), second.wait('ready')]);
  assert.notEqual(first.process.pid, second.process.pid);
  first.run({ operation: 'write' });
  const initial = (await first.wait('result')).result;
  assert.equal(initial.status, 'saved');
  const update = {
    operation: 'write',
    entryId: initial.entry.id,
    revision: initial.entry.revision,
  };
  first.run({ ...update, content: 'Use npm run build.' });
  second.run({ ...update, content: 'Use the main branch.' });
  const writes = await Promise.all([first.wait('result'), second.wait('result')]);
  assert.deepEqual(writes.map(({ result }) => result.status).sort(), ['conflict', 'saved']);

  first.run({ operation: 'extract' });
  await first.wait('extracting');
  // The first process owns the extraction lease while another process requests the same turn.
  second.run({ operation: 'extract' });
  first.process.send({ kind: 'release' });
  const outcomes = await Promise.all([first.wait('result'), second.wait('result')]);
  assert.equal(outcomes[0].result.status, 'saved');
  assert.deepEqual(outcomes[0].result, outcomes[1].result);

  first.run({ operation: 'extract', turnId: 'crashed-turn' });
  await first.wait('extracting');
  first.process.kill('SIGKILL');
  await first.exited;
  // Simulate lease expiry after the owner is dead; do not sleep for the 30-second TTL.
  const memory = join(directory, 'memory');
  const leases = (await readdir(memory)).filter((name) => name.endsWith('.lock'));
  assert.equal(leases.length, 1);
  const expired = new Date(Date.now() - 60000);
  await utimes(join(memory, leases[0]), expired, expired);
  second.run({ operation: 'extract', turnId: 'crashed-turn' });
  await second.wait('extracting');
  second.process.send({ kind: 'release' });
  assert.equal((await second.wait('result')).result.status, 'saved');
  assert.deepEqual(
    (await readdir(memory)).filter((name) => name.endsWith('.lock')),
    [],
  );
  console.log(
    'Memory cross-process revision checks, extraction ownership, and crashed-owner recovery passed.',
  );
} finally {
  await Promise.all(
    workers
      .filter((child) => child.exitCode === null && child.signalCode === null)
      .map(
        (child) =>
          new Promise((resolve) => {
            child.once('exit', resolve);
            child.kill('SIGKILL');
          }),
      ),
  );
  await rm(directory, { recursive: true, force: true });
}
