import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalData, removeHostData } from '../electron/storage/local-data';
import { AppPreferences } from '../electron/app-preferences';
import { BindingStore } from '../electron/verdictan/bindings';
import { ChatOutcomes } from '../electron/chat-outcomes';
import { SessionLibrary } from '../electron/session-library';
import {
  dataDisclosure,
  localDataLimitBytes,
  revocationOfflineDelaySeconds,
  revocationOnlineDelaySeconds,
  storePolicies,
} from '../src/domain/data-policy';

const day = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-10-22T12:00:00Z');

function sandbox() {
  const base = mkdtempSync(join(tmpdir(), 'kalkidan-local-data-'));
  const root = join(base, '.kalkidan');
  mkdirSync(root, { recursive: true });
  const write = (path: string, bytes: number | string, ageDays = 0) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof bytes === 'number' ? Buffer.alloc(bytes, 1) : bytes);
    const time = new Date(now - ageDays * day);
    utimesSync(file, time, time);
    return file;
  };
  return { base, root, write, done: () => rmSync(base, { recursive: true, force: true }) };
}

test('the policy numbers match the user decisions', () => {
  assert.equal(localDataLimitBytes, 2_000_000_000);
  assert.equal(revocationOnlineDelaySeconds, 10);
  assert.equal(revocationOfflineDelaySeconds, 300);
  assert.deepEqual(
    dataDisclosure.map((section) => section.id),
    ['execution-host', 'provider', 'verdictan'],
  );
  for (const location of ['local', 'ssh-host', 'verdictan'])
    assert.ok(storePolicies.some((store) => store.location === location));
  const buffer = storePolicies.find((store) => store.id === 'local-event-buffer')!;
  assert.match(buffer.limit, /200 MB/);
  assert.match(buffer.retention, /30 days/);
});

test('usage counts each category and never follows a symbolic link', async () => {
  const s = sandbox();
  try {
    s.write('managed-agent-homes/a/codex/sessions/one.jsonl', 100);
    s.write('sessions.json', 10);
    s.write('operations/publish/a.json', 20);
    s.write('Cache/data_0', 30);
    s.write('Partitions/kalkidan-preview/Code Cache/js/x', 5);
    s.write('runtime/verdictan/versions/' + 'a'.repeat(64) + '/verdictan', 40);
    const outside = join(s.base, 'outside');
    writeFileSync(outside, Buffer.alloc(1000));
    symlinkSync(outside, join(s.root, 'operations', 'link'));
    const usage = await new LocalData({ root: s.root, now: () => now }).usage();
    const bytes = Object.fromEntries(usage.categories.map((c) => [c.category, c.bytes]));
    assert.equal(bytes['chat-history'], 110);
    assert.equal(bytes.logs, 20);
    assert.equal(bytes.caches, 35);
    assert.equal(bytes.runtime, 40);
    assert.equal(usage.total, 205);
    assert.equal(usage.limit, localDataLimitBytes);
  } finally {
    s.done();
  }
});

test('the limit removes the oldest logs and caches first and never chat history', async () => {
  const s = sandbox();
  try {
    const kept = 'b'.repeat(64);
    const unused = 'c'.repeat(64);
    s.write('managed-agent-homes/a/claude/projects/x.jsonl', 600);
    s.write('sessions.json', 50);
    const oldest = s.write('operations/worktree/old.json', 100, 10);
    const middle = s.write('operations/publish/middle.json', 100, 5);
    const fresh = s.write('operations/agent-start/fresh.json', 100, 0);
    s.write(
      'runtime/verdictan/installation.json',
      JSON.stringify({ schema: 1, history: [], active: { release: { sha256: kept } } }),
    );
    s.write(`runtime/verdictan/versions/${kept}/verdictan`, 100);
    const unusedFile = s.write(`runtime/verdictan/versions/${unused}/verdictan`, 100);
    const threeDays = new Date(now - 3 * day);
    utimesSync(dirname(unusedFile), threeDays, threeDays);
    let cleared = 0;
    const local = new LocalData({
      root: s.root,
      limit: 1000,
      now: () => now,
      clearBrowserCaches: async () => {
        cleared++;
      },
    });
    const result = await local.enforceLimit();
    assert.ok(result.before > 1000);
    assert.equal(existsSync(oldest), false);
    // The removal stops as soon as the folder is within the limit.
    assert.equal(result.overLimit, false);
    assert.ok(result.after <= 1000);
    assert.equal(existsSync(fresh), true, 'a log newer than 24 hours stays');
    assert.equal(existsSync(join(s.root, `runtime/verdictan/versions/${kept}/verdictan`)), true);
    assert.equal(existsSync(join(s.root, 'managed-agent-homes/a/claude/projects/x.jsonl')), true);
    assert.equal(existsSync(join(s.root, 'sessions.json')), true);
    assert.deepEqual(result.removed[0], join('operations', 'worktree', 'old.json'));
    // Oldest first: the 10-day log, the 5-day log, then the unused runtime version. The folder
    // is then within the limit, so the browser caches stay.
    assert.equal(existsSync(middle), false);
    assert.equal(existsSync(unusedFile), false);
    assert.equal(cleared, 0);
    assert.deepEqual(result.removed, [
      join('operations', 'worktree', 'old.json'),
      join('operations', 'publish', 'middle.json'),
      join('runtime', 'verdictan', 'versions', unused),
    ]);
  } finally {
    s.done();
  }
});

test('chat history alone above the limit stays and reports over limit', async () => {
  const s = sandbox();
  try {
    const transcript = s.write('managed-agent-homes/a/codex/sessions/big.jsonl', 2000);
    const log = s.write('operations/publish/old.json', 100, 3);
    const result = await new LocalData({
      root: s.root,
      limit: 1000,
      now: () => now,
    }).enforceLimit();
    assert.equal(existsSync(log), false);
    assert.equal(existsSync(transcript), true);
    assert.equal(result.overLimit, true);
  } finally {
    s.done();
  }
});

test('an update in progress keeps every runtime version', async () => {
  const s = sandbox();
  try {
    const other = s.write(`runtime/verdictan/versions/${'d'.repeat(64)}/verdictan`, 500, 30);
    s.write(
      'runtime/verdictan/installation.json',
      JSON.stringify({
        schema: 1,
        history: [],
        active: { release: { sha256: 'e'.repeat(64) } },
        operation: { phase: 'downloading' },
      }),
    );
    await new LocalData({ root: s.root, limit: 10, now: () => now }).enforceLimit();
    assert.equal(existsSync(other), true);
  } finally {
    s.done();
  }
});

test('removing a log symbolic link never removes its target', async () => {
  const s = sandbox();
  try {
    const outside = join(s.base, 'user-file');
    writeFileSync(outside, 'keep');
    mkdirSync(join(s.root, 'operations'), { recursive: true });
    symlinkSync(outside, join(s.root, 'operations', 'link.json'));
    s.write('operations/old.json', 50, 3);
    await new LocalData({ root: s.root, limit: 1, now: () => now }).delete('caches-and-logs');
    assert.equal(readFileSync(outside, 'utf8'), 'keep');
    assert.equal(existsSync(join(s.root, 'operations')), false);
  } finally {
    s.done();
  }
});

test('export copies the stores and transcripts without credentials, passwords, or code', async () => {
  const s = sandbox();
  try {
    s.write('sessions.json', '{"codex:1":{"title":"Fix"}}');
    s.write('verdictan-bindings.json', '{"schema":1}');
    s.write('managed-agent-homes/h/codex/sessions/2026/one.jsonl', '{"prompt":"hello"}');
    s.write('managed-agent-homes/h/codex-subscription/auth.json', '{"access_token":"secret"}');
    s.write('managed-agent-homes/h/claude/.credentials.json', '{"token":"secret"}');
    s.write('operations/publish/a.json', '{}');
    s.write('projects/p1/docs/plan.md', '# Plan');
    s.write('projects/p1/memory/one.md', 'memory');
    s.write('projects/p1/repos/app/main.ts', 'code');
    s.write('Cookies', 'cookie');
    s.write(
      'browser/profile.json',
      JSON.stringify({
        history: [{ url: 'https://a.test' }],
        downloads: [],
        passwords: ['secret'],
      }),
    );
    const destination = join(s.base, 'exports');
    mkdirSync(destination);
    const result = await new LocalData({ root: s.root, now: () => now }).export(destination);
    assert.equal(dirname(result.path), destination);
    const read = (path: string) => readFileSync(join(result.path, path), 'utf8');
    assert.equal(read('sessions.json'), '{"codex:1":{"title":"Fix"}}');
    assert.equal(read('managed-agent-homes/h/codex/sessions/2026/one.jsonl'), '{"prompt":"hello"}');
    assert.equal(read('projects/p1/docs/plan.md'), '# Plan');
    assert.equal(existsSync(join(result.path, 'projects/p1/repos')), false);
    assert.equal(existsSync(join(result.path, 'Cookies')), false);
    assert.equal(
      existsSync(join(result.path, 'managed-agent-homes/h/codex-subscription/auth.json')),
      false,
    );
    assert.equal(
      existsSync(join(result.path, 'managed-agent-homes/h/claude/.credentials.json')),
      false,
    );
    assert.deepEqual(JSON.parse(read('browser/history.json')), {
      history: [{ url: 'https://a.test' }],
      downloads: [],
    });
    const manifest = JSON.parse(read('manifest.json'));
    assert.equal(manifest.files.length, result.files);
    const all = JSON.stringify(
      readdirSync(result.path, { recursive: true }).map((name) =>
        existsSync(join(result.path, String(name))) && !String(name).includes('.')
          ? ''
          : readFileSync(join(result.path, String(name)), 'utf8'),
      ),
    );
    assert.doesNotMatch(all, /secret/);
  } finally {
    s.done();
  }
});

test('export refuses a folder inside the data folder', async () => {
  const s = sandbox();
  try {
    await assert.rejects(
      new LocalData({ root: s.root, now: () => now }).export(s.root),
      /outside the Kalkidan data folder/,
    );
  } finally {
    s.done();
  }
});

test('deleting chat history removes only chat data', async () => {
  const s = sandbox();
  try {
    s.write('managed-agent-homes/h/codex/sessions/one.jsonl', 'x');
    s.write('sessions.json', '{}');
    s.write('chat-outcomes.json', '{}');
    const project = s.write('projects/p1/docs/plan.md', '# Plan');
    const settings = s.write('preferences.json', '{}');
    const result = await new LocalData({ root: s.root, now: () => now }).delete('chat-history');
    assert.deepEqual(result.removed, [
      'managed-agent-homes',
      'sessions.json',
      'chat-outcomes.json',
    ]);
    assert.equal(existsSync(join(s.root, 'managed-agent-homes')), false);
    assert.equal(existsSync(project), true);
    assert.equal(existsSync(settings), true);
  } finally {
    s.done();
  }
});

test('the session, outcome, and binding stores clear their chat data', async () => {
  const s = sandbox();
  try {
    const outcomes = new ChatOutcomes(join(s.root, 'chat-outcomes.json'));
    await outcomes.record({
      agent: 'codex',
      id: 'a',
      outcome: 'failed',
      reason: 'timeout',
      at: '2026-10-22T00:00:00Z',
    });
    assert.equal(outcomes.list().length, 1);
    await outcomes.clear();
    assert.deepEqual(outcomes.list(), []);
    const library = new SessionLibrary(join(s.root, 'sessions.json'));
    await library.update('codex', 'a', { title: 'Fix' });
    await library.clear();
    assert.equal(readFileSync(join(s.root, 'sessions.json'), 'utf8').trim(), '{}');
    const bindings = new BindingStore(s.root);
    const identity = await bindings.identities('host-1');
    assert.deepEqual(await bindings.knownIdentities('host-1'), identity);
    assert.equal(await bindings.knownIdentities('host-2'), null);
    await bindings.clearConversations();
    const stored = JSON.parse(readFileSync(join(s.root, 'verdictan-bindings.json'), 'utf8'));
    assert.deepEqual(stored.bindings, {});
    assert.equal(stored.installationId, identity.installationId);
    await bindings.forgetHost('host-1');
    assert.equal(await bindings.knownIdentities('host-1'), null);
  } finally {
    s.done();
  }
});

test('the data notice shows until the user reads it once', async () => {
  const s = sandbox();
  try {
    const file = join(s.root, 'preferences.json');
    const preferences = new AppPreferences(file);
    assert.deepEqual(await preferences.dataNotice(), { seen: false });
    assert.deepEqual(await preferences.setDataNoticeSeen(), { seen: true });
    assert.deepEqual(await new AppPreferences(file).dataNotice(), { seen: true });
  } finally {
    s.done();
  }
});

test('host data removal touches only what Kalkidan made and keeps project folders', async () => {
  const base = mkdtempSync(join(tmpdir(), 'kalkidan-host-'));
  try {
    const put = (path: string) => {
      mkdirSync(dirname(join(base, path)), { recursive: true });
      writeFileSync(join(base, path), 'x');
    };
    put('.kalkidan/managed-agent-homes/h/codex/sessions/one.jsonl');
    put('.kalkidan/runtime/verdictan/installation.json');
    put('.kalkidan/operations/publish/a.json');
    put('.kalkidan/verdictan-bindings.json');
    put('.kalkidan/projects/p1/repos/app/main.ts');
    put('.local/share/kalkidan/agents/abc/agent.cjs');
    put('.local/share/other-app/data');
    put('.codex/sessions/user.jsonl');
    put('.verdictan/config.json');
    const result = await removeHostData(base);
    assert.equal(existsSync(join(base, '.kalkidan/managed-agent-homes')), false);
    assert.equal(existsSync(join(base, '.kalkidan/runtime')), false);
    assert.equal(existsSync(join(base, '.kalkidan/projects/p1/repos/app/main.ts')), true);
    assert.deepEqual(result.kept, ['~/.kalkidan/projects']);
    assert.equal(existsSync(join(base, '.local/share/kalkidan')), false);
    assert.equal(existsSync(join(base, '.local/share/other-app/data')), true);
    assert.equal(existsSync(join(base, '.codex/sessions/user.jsonl')), true);
    assert.equal(existsSync(join(base, '.verdictan/config.json')), true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('host data removal removes an empty data folder and ignores a linked one', async () => {
  const base = mkdtempSync(join(tmpdir(), 'kalkidan-host-'));
  try {
    mkdirSync(join(base, '.kalkidan', 'operations'), { recursive: true });
    assert.deepEqual((await removeHostData(base)).removed, [
      '~/.kalkidan/operations',
      '~/.kalkidan',
    ]);
    assert.equal(existsSync(join(base, '.kalkidan')), false);
    const target = join(base, 'elsewhere');
    mkdirSync(join(target, 'operations'), { recursive: true });
    symlinkSync(target, join(base, '.kalkidan'));
    assert.deepEqual((await removeHostData(base)).removed, []);
    assert.equal(existsSync(join(target, 'operations')), true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
