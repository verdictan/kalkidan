import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { redactText, redactValue, redacted } from '../src/domain/redaction';
import {
  agentSupport,
  runtimeSupport,
  supportBundle,
  verdictanSupportSection,
  type DiagnosticsReport,
} from '../src/domain/diagnostics';
import { DiagnosticsJournal, summarize } from '../electron/diagnostics/journal';
import { collectDiagnostics, SupportBundles } from '../electron/diagnostics/report';

const home = '/Users/dana';
// Synthetic values in the formats of real credentials. None of them is a real credential.
const secrets = {
  openai: 'sk-proj-' + 'A1b2C3d4E5f6G7h8I9j0'.repeat(2),
  anthropic: 'sk-ant-api03-' + 'x'.repeat(40),
  github: 'ghp_' + 'Z'.repeat(36),
  githubPat: 'github_pat_' + '1'.repeat(30),
  slack: 'xoxb-' + '1234567890-abcdefghij',
  aws: 'AKIA' + 'ABCDEFGHIJKLMNOP',
  google: 'AIza' + 'S'.repeat(35),
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.c2lnbmF0dXJlLXZhbHVl',
  verdictan: 'vdt_' + 'q'.repeat(32),
  pem: '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----',
};

test('redaction removes each credential format from free text', () => {
  for (const [name, secret] of Object.entries(secrets)) {
    const { value, count } = redactText(`failed with ${secret} at step 2`);
    assert.ok(!value.includes(secret), `${name} stays: ${value}`);
    assert.ok(count >= 1, name);
    assert.match(value, /failed with .*\[redacted\].* at step 2/s, name);
  }
});

test('redaction removes header values, URL passwords, query secrets, e-mail, and home', () => {
  const text =
    `Authorization: Bearer abcdefghijklmnop1234 ` +
    `https://dana:hunter2@example.test/a?token=abc123&state=ok&api_key=zzz ` +
    `password=letmein contact dana@example.test in ${home}/work/kalkidan`;
  const { value } = redactText(text, home);
  for (const leaked of ['abcdefghijklmnop1234', 'hunter2', 'abc123', 'zzz', 'letmein', 'dana@'])
    assert.ok(!value.includes(leaked), `${leaked} stays: ${value}`);
  assert.match(value, /Bearer \[redacted\]/);
  assert.match(value, /https:\/\/\[redacted\]@example\.test/);
  assert.match(value, /state=ok/);
  assert.match(value, /\[email\]/);
  assert.match(value, /~\/work\/kalkidan/);
});

test('redaction removes values of secret keys at each depth and keeps safe values', () => {
  const input = {
    correlation_id: '11111111-1111-4111-8111-111111111111',
    build: 'a'.repeat(64),
    error: 'desktop.runtime_version_unsupported',
    max_tokens: 128,
    credentials_exported: true,
    nested: [{ apiKey: 'plain-value', refresh_token: 'r1', headers: { Authorization: 'Basic x' } }],
    runtime_credential: { value: 'secret' },
    password: 'pw',
    client_secret: 'cs',
    cookie: 'session=1',
  };
  const { value, count } = redactValue(input, home);
  assert.equal(value.correlation_id, input.correlation_id);
  assert.equal(value.build, input.build);
  assert.equal(value.error, input.error);
  assert.equal(value.max_tokens, 128);
  assert.equal(value.credentials_exported, true);
  assert.equal(value.nested[0].apiKey, redacted);
  assert.equal(value.nested[0].refresh_token, redacted);
  assert.equal(value.nested[0].headers.Authorization, redacted);
  assert.equal(value.runtime_credential as unknown, redacted);
  assert.equal(value.password, redacted);
  assert.equal(value.client_secret, redacted);
  assert.equal(value.cookie, redacted);
  assert.equal(count, 7);
  assert.equal(input.password, 'pw', 'the input does not change');
});

test('redaction stops at a deep value', () => {
  let deep: any = 'sk-' + 'a'.repeat(30);
  for (let i = 0; i < 40; i++) deep = { child: deep };
  const text = JSON.stringify(redactValue(deep).value);
  assert.ok(!text.includes('aaaaaaaaaa'));
});

function report(overrides: Partial<DiagnosticsReport> = {}): DiagnosticsReport {
  return {
    schemaVersion: 1,
    createdAt: '2026-10-22T10:00:00.000Z',
    app: { version: '0.1.0-build.7.abcdefabcdef', build: 'b'.repeat(64), packaged: true },
    platform: 'darwin',
    arch: 'arm64',
    osVersion: '26.7.1',
    supportWindow: { protocol: 1, runtimeMinimum: '0.6.8', runtimeNewestVerified: '0.6.10' },
    connection: {
      region: 'eu',
      phase: 'error',
      executionReady: false,
      error: `desktop.runtime_version_unsupported ${secrets.openai}`,
      capabilities: [],
    },
    runtimes: [
      runtimeSupport(
        {
          hostId: 'local',
          name: 'This computer',
          connected: true,
          installed: '0.6.5',
        },
        Date.parse('2027-02-01T00:00:00Z'),
      ),
      runtimeSupport({
        hostId: 'h1',
        name: 'devbox',
        connected: true,
        installed: '0.6.10',
        error: `ssh failed for https://u:${secrets.github}@host.test in ${home}/.ssh`,
      }),
    ],
    agents: [
      agentSupport({ hostId: 'local', agent: 'codex', status: 'installed', version: '0.150.0' }),
    ],
    correlations: [
      {
        kind: 'broker',
        id: '22222222-2222-4222-8222-222222222222',
        operation: 'status',
        outcome: 'ok',
        at: '2026-10-22T10:00:00.000Z',
      },
    ],
    measurements: new DiagnosticsJournal(() => 0).summary(),
    ...overrides,
  };
}

test('the support bundle is redacted and its Verdictan part agrees with the shared contract', () => {
  const { value, count } = supportBundle(report(), home);
  const text = JSON.stringify(value);
  for (const secret of Object.values(secrets)) assert.ok(!text.includes(secret));
  assert.ok(!text.includes(home));
  assert.ok(count >= 3);
  assert.equal(value.uploaded, false);
  assert.equal(value.telemetry, 'off');
  assert.equal(value.diagnostics.runtimes[0].support, 'unsupported');
  assert.equal(value.diagnostics.agents[0].support, 'outdated');
  const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;
  const ajv = addFormats(new Ajv2020({ allErrors: true, strict: false }));
  const validate = ajv.compile(
    JSON.parse(readFileSync('contracts/verdictan/desktop-support-bundle.v1.schema.json', 'utf8')),
  );
  assert.equal(validate(value.verdictan), true, JSON.stringify(validate.errors));
  assert.deepEqual(value.verdictan.versions, { cli: '0.6.5', desktop: '0.1.0' });
  assert.equal(value.verdictan.components[1].error_code, 'desktop.version_unsupported');
  const empty = verdictanSupportSection(
    report({ runtimes: [], correlations: [], platform: 'freebsd' }),
  );
  assert.equal(validate(empty), true, JSON.stringify(validate.errors));
});

test('the journal counts an unclean stop as a crash and keeps samples on this computer', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kalkidan-diagnostics-'));
  try {
    const file = join(directory, 'diagnostics', 'measurements.json');
    let now = 1000;
    const first = new DiagnosticsJournal(() => now);
    await first.open(file);
    now = 4000;
    first.setupCompleted();
    first.setupCompleted();
    first.connectionClosed('desktop.transport_lost');
    now = 6500;
    first.connected();
    first.connected();
    first.brokerRequest('33333333-3333-4333-8333-333333333333', 'status', 'ok', 12.4);
    first.turnEnded('completed', 2000, ['req-1'], 'run-1');
    first.turnEnded('failed', 100);
    first.sample('stream_first_output_ms', -1);
    await first.open(file); // A second open without close counts the first session as a crash.
    const summary = first.summary();
    assert.equal(summary.sessions, 2);
    assert.equal(summary.crashes, 1);
    assert.equal(summary.turnsCompleted, 1);
    assert.equal(summary.turnsFailed, 1);
    assert.deepEqual(summary.samples.setup_completion_ms, {
      count: 1,
      last: 3000,
      p50: 3000,
      p95: 3000,
    });
    assert.equal(summary.samples.recovery_ms?.last, 2500);
    assert.equal(summary.samples.first_success_ms?.last, 5500);
    assert.equal(summary.samples.stream_first_output_ms, undefined);
    assert.equal(summary.telemetry, 'off');
    assert.deepEqual(
      first.recentCorrelations().map((record) => [record.kind, record.id, record.outcome]),
      [
        ['request', 'req-1', 'completed'],
        ['broker', '33333333-3333-4333-8333-333333333333', 'ok'],
      ],
    );
    first.close();
    const second = new DiagnosticsJournal(() => now);
    await second.open(file);
    assert.equal(second.summary().crashes, 1);
    assert.equal(second.summary().sessions, 3);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    const saved = await readFile(file, 'utf8');
    assert.ok(!saved.includes('33333333'), 'correlation IDs stay in memory');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a damaged journal file starts again from zero', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kalkidan-diagnostics-'));
  try {
    const file = join(directory, 'measurements.json');
    await import('node:fs/promises').then((fs) => fs.writeFile(file, '{not json'));
    const journal = new DiagnosticsJournal();
    await journal.open(file);
    assert.equal(journal.summary().sessions, 1);
    assert.equal(journal.summary().crashes, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('summaries give the median and the 95th percentile', () => {
  assert.deepEqual(summarize([5, 1, 3, 2, 4]), { count: 5, last: 4, p50: 3, p95: 5 });
  const many = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.deepEqual(summarize(many), { count: 100, last: 100, p50: 50, p95: 95 });
});

test('collection reads each host and shows a host that does not answer', async () => {
  const journal = new DiagnosticsJournal(() => 0);
  const result = await collectDiagnostics({
    app: async () => ({ version: '0.1.0', build: 'unknown', packaged: false }),
    platform: 'linux',
    arch: 'x64',
    osVersion: '6.8.0',
    account: () => ({
      phase: 'authenticated',
      region: 'us',
      executionReady: true,
      capabilities: {
        cliVersion: '0.6.10',
        protocolMin: 1,
        protocolMax: 1,
        capabilities: ['status'],
        managedExecutionReady: true,
        testedAgents: [],
      },
    }),
    hosts: () => [
      { id: 'h1', name: 'devbox', connected: true, helper: 'abc' },
      { id: 'h2', name: 'slow', connected: true },
      { id: 'h3', name: 'off', connected: false },
    ],
    runtime: async (hostId) => {
      if (hostId === 'h2') return new Promise(() => {});
      const release = { version: hostId ? '0.6.6' : '0.6.10', releaseId: 'r', sha256: '0' };
      return {
        hostId: hostId ?? 'local',
        component: 'verdictan',
        discovery: 'current',
        installed: release,
        running: release,
        stale: false,
        history: [],
      };
    },
    agents: async (hostId) =>
      hostId === 'h2'
        ? Promise.reject(new Error('no answer'))
        : [{ agent: 'claude', status: 'installed', version: '2.1.306' }],
    journal,
    now: () => Date.parse('2026-11-01T00:00:00Z'),
    timeoutMs: 20,
  });
  assert.deepEqual(
    result.runtimes.map((runtime) => [runtime.hostId, runtime.support, runtime.error ?? '']),
    [
      ['local', 'supported', ''],
      ['h1', 'deprecated', ''],
      ['h2', 'unknown', 'The host did not answer in time.'],
      ['h3', 'unknown', ''],
    ],
  );
  assert.equal(result.runtimes[1].helper, 'abc');
  assert.deepEqual(
    result.agents.map((agent) => [agent.hostId, agent.support]),
    [
      ['local', 'supported'],
      ['h1', 'supported'],
    ],
  );
  assert.equal(result.connection.protocolMax, 1);
  assert.equal(result.createdAt, '2026-11-01T00:00:00.000Z');
});

test('export writes only the previewed text, and only after a preview', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kalkidan-bundle-'));
  try {
    const bundles = new SupportBundles(async () => report(), home);
    await assert.rejects(
      bundles.export('x', async () => join(directory, 'a.json')),
      /Preview/,
    );
    const preview = await bundles.preview();
    assert.match(preview.digest, /^[0-9a-f]{64}$/);
    assert.equal(preview.bytes, Buffer.byteLength(preview.text));
    for (const secret of Object.values(secrets)) assert.ok(!preview.text.includes(secret));
    await assert.rejects(bundles.export('0'.repeat(64), async () => join(directory, 'a.json')));
    assert.equal(await bundles.export(preview.digest, async () => undefined), false);
    const file = join(directory, 'bundle.json');
    assert.equal(await bundles.export(preview.digest, async () => file), true);
    assert.equal(await readFile(file, 'utf8'), preview.text);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
