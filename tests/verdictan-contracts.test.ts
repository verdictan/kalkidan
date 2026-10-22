import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { assertRuntimeSupported, parseCapabilities } from '../electron/verdictan/account';
import { DesktopProtocol, DesktopProtocolError } from '../electron/verdictan/protocol';
import { agentMinimumVersions, compareVersionCores } from '../src/domain/agent-version';
import {
  knownBrokenRuntime,
  recommendedRuntime,
  runtimeCompatibility,
  supportWindow,
} from '../src/domain/compatibility';
import { managedErrorText } from '../src/domain/verdictan';

// Verdictan cli/docs/contracts is the source of truth. contracts/verdictan is a pinned byte copy.
const root = resolve('contracts/verdictan');
const read = (name: string) => JSON.parse(readFileSync(join(root, name), 'utf8'));
const source = read('source.json') as { commit: string; files: Record<string, string> };
const window = read('desktop-support-window.v1.json');
const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;
const ajv = addFormats(new Ajv2020({ allErrors: true, strict: false }));
const compile = (name: string) =>
  ajv.getSchema(name) ?? (ajv.addSchema(read(name), name), ajv.getSchema(name)!);
const pointer = (value: any, path?: string) =>
  path
    ? path
        .slice(1)
        .split('/')
        .reduce((node, key) => node?.[key], value)
    : value;
const files = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(directory, entry.name))
      : [relative(root, join(directory, entry.name))],
  );

test('the pinned copy matches the digests of its Verdictan commit', () => {
  assert.match(source.commit, /^[0-9a-f]{40}$/);
  const copied = files(root)
    .filter((name) => name !== 'source.json')
    .sort();
  assert.deepEqual(copied, Object.keys(source.files).sort());
  for (const [name, digest] of Object.entries(source.files))
    assert.equal(
      createHash('sha256')
        .update(readFileSync(join(root, name)))
        .digest('hex'),
      digest,
      `${name} differs from Verdictan. Run npm run sync:verdictan-contracts.`,
    );
});

test('the support window agrees with its schema and with the Kalkidan rules', () => {
  const validate = compile('desktop-support-window.v1.schema.json');
  assert.equal(validate(window), true, JSON.stringify(validate.errors));
  assert.equal(window.protocol.current, supportWindow.protocol.current);
  assert.deepEqual(window.protocol.supported, [...supportWindow.protocol.supported]);
  assert.equal(window.runtime.minimum, supportWindow.runtime.minimum);
  assert.deepEqual(
    window.runtime.versions.map((entry: any) => entry.version),
    [...supportWindow.runtime.supported],
  );
  assert.equal(window.runtime.deprecation_notice_days, supportWindow.runtime.noticeDays);
  assert.equal(window.runtime.setup_minimum, supportWindow.runtime.setupMinimum);
  assert.deepEqual(
    (window.runtime.known_broken ?? []).map((entry: any) => ({
      version: entry.version,
      components: entry.components,
      fixedIn: entry.fixed_in,
    })),
    supportWindow.runtime.knownBroken,
  );
  assert.equal(window.runtime.newest_verified, supportWindow.runtime.newestVerified);
  assert.deepEqual(
    window.runtime.deprecations.map((entry: any) => ({
      minimum: entry.versions.minimum,
      maximum: entry.versions.maximum,
      replacement: entry.replacement,
      deprecated: entry.deprecated,
      endOfSupport: entry.end_of_support,
    })),
    supportWindow.runtime.deprecations,
  );
  assert.equal(window.desktop.minimum, supportWindow.desktop.minimum);
  assert.equal(window.agents.codex, agentMinimumVersions.codex);
  assert.equal(window.agents.claude_code, agentMinimumVersions.claude_code);
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.ok((compareVersionCores(version, window.desktop.minimum) ?? -1) >= 0);
});

for (const protocol of window.protocol.supported as number[]) {
  const entry = window.protocol.versions.find((value: any) => value.version === protocol);
  for (const contract of entry.contracts)
    test(`protocol ${protocol}: ${contract.schema} fixtures validate`, () => {
      const validate = compile(contract.schema);
      for (const fixture of contract.fixtures) {
        const values = pointer(read(fixture.file), fixture.pointer);
        const list = Array.isArray(values) ? values : [values];
        assert.ok(list.length > 0, fixture.file);
        for (const value of list)
          assert.equal(
            validate(value),
            true,
            `${fixture.file}: ${JSON.stringify(validate.errors)}`,
          );
      }
    });
  test(`protocol ${protocol}: Kalkidan reads each capabilities fixture`, () => {
    const events = read('fixtures/auth-desktop.events.json').filter(
      (event: any) => event.event === 'capabilities',
    );
    assert.ok(events.length > 0);
    for (const event of events) {
      const parsed = parseCapabilities(event.data);
      assert.ok(parsed.protocolMin <= protocol && protocol <= parsed.protocolMax);
    }
  });
  test(`protocol ${protocol}: the requests that Kalkidan writes agree with the request schema`, async () => {
    const validate = compile('auth-desktop.request.v1.schema.json');
    const requests = await written([
      ['capabilities', {}],
      ['status', {}],
      ['authorization.start', { intent: 'login' }],
      ['setup.inspect', {}],
      ['hosts.inspect', {}],
      ['session.renew', {}],
    ]);
    assert.equal(requests.length, 6);
    for (const request of requests) {
      assert.equal(request.schema_version, protocol);
      assert.equal(validate(request), true, JSON.stringify(validate.errors));
    }
  });
}

test('a runtime older than the window is refused with plain words after its notice', () => {
  const [fixture] = read('fixtures/auth-desktop.events.json');
  const capabilities = parseCapabilities({ ...fixture.data, cli_version: '0.6.5' });
  assertRuntimeSupported(capabilities, Date.parse('2026-10-22T00:00:00Z'));
  assert.throws(
    () => assertRuntimeSupported(capabilities, Date.parse('2027-01-20T00:00:00Z')),
    (error: unknown) =>
      error instanceof DesktopProtocolError &&
      error.code === 'desktop.runtime_version_unsupported' &&
      error.version === '0.6.5',
  );
  assert.match(managedErrorText('desktop.runtime_version_unsupported'), /0\.6\.12 or later/);
  for (const version of [...supportWindow.runtime.supported, '0.6.7', '1.0.0'])
    assertRuntimeSupported(
      parseCapabilities({ ...fixture.data, cli_version: version }),
      Date.parse('2027-01-01T00:00:00Z'),
    );
});

test('a protocol range without version 1 has its own code', () => {
  const [fixture] = read('fixtures/auth-desktop.events.json');
  assert.throws(
    () => parseCapabilities({ ...fixture.data, protocol_min: 2, protocol_max: 3 }),
    (error: unknown) =>
      error instanceof DesktopProtocolError && error.code === 'desktop.protocol_unsupported',
  );
  assert.throws(
    () => parseCapabilities({ ...fixture.data, protocol_min: 2, protocol_max: 1 }),
    (error: unknown) =>
      error instanceof DesktopProtocolError && error.code === 'desktop.capabilities_invalid',
  );
  assert.match(managedErrorText('desktop.protocol_unsupported'), /desktop protocol 1/);
});

test('a deprecated runtime gets a warning until its end-of-support date', () => {
  for (const version of ['0.1.0', '0.6.5', '0.6.6', '0.6.7', '0.6.8', '0.6.9', '0.6.10']) {
    const during = runtimeCompatibility(version, Date.parse('2027-01-19T23:59:00Z'));
    assert.equal(during.status, 'deprecated', version);
    assert.equal(during.endOfSupport, '2027-01-20');
    assert.match(during.message, /Support stops on 2027-01-20\. Update the runtime to 0\.6\.13/);
    const after = runtimeCompatibility(version, Date.parse('2027-01-20T00:00:00Z'));
    assert.equal(after.status, 'unsupported', version);
    assert.match(after.message, /stopped on 2027-01-20/);
  }
  assert.equal(
    runtimeCompatibility('0.6.5', Date.parse('2027-02-01T00:00:00Z')).status,
    'unsupported',
  );
  assert.equal(runtimeCompatibility('not a version').status, 'unknown');
  assert.equal(runtimeCompatibility('0.7.0-rc.1').status, 'supported');
});

test('each deprecation gives at least the notice period', () => {
  const days = (value: string) => Date.parse(`${value}T00:00:00Z`) / 86400000;
  for (const entry of supportWindow.runtime.deprecations)
    assert.ok(
      days(entry.endOfSupport) - days(entry.deprecated) >= supportWindow.runtime.noticeDays,
    );
});

// The contract files of one protocol version, and their digest as Verdictan computes it.
function contractDigest(protocol: number, base = '') {
  const entry = window.protocol.versions.find((value: any) => value.version === protocol);
  const names = [
    ...new Set<string>(
      entry.contracts.flatMap((contract: any) => [
        contract.schema,
        ...contract.fixtures.map((fixture: any) => fixture.file),
      ]),
    ),
  ].sort();
  const hash = createHash('sha256');
  for (const name of names) {
    // A snapshot has only the contracts of its release. A contract that a later release added is
    // absent there, as in the Verdictan test.
    if (base && !existsSync(join(root, base, name))) continue;
    const bytes = readFileSync(join(root, base, name));
    hash.update(`${name}\0${createHash('sha256').update(bytes).digest('hex')}\n`);
  }
  return hash.digest('hex');
}

for (const entry of window.runtime.versions)
  test(`runtime ${entry.version}: Kalkidan accepts the contracts and capabilities of that release`, () => {
    assert.equal(contractDigest(entry.protocol, entry.snapshot ?? ''), entry.contracts_sha256);
    const events = read(window.runtime.capabilities_fixture).filter(
      (event: any) => event.data.cli_version === entry.version,
    );
    assert.equal(events.length, 1);
    const validate = compile('auth-desktop.event.v1.schema.json');
    assert.equal(validate(events[0]), true, JSON.stringify(validate.errors));
    const capabilities = parseCapabilities(events[0].data);
    // A known-broken release keeps its broker. Only its managed gateways cannot start.
    assert.equal(
      runtimeCompatibility(capabilities.cliVersion).status,
      knownBrokenRuntime(capabilities.cliVersion) ? 'broken' : 'supported',
    );
    assertRuntimeSupported(capabilities);
  });

test('each recorded release before the window still runs, with a warning, until 2027-01-20', () => {
  const older = read(window.runtime.capabilities_fixture).filter(
    (event: any) =>
      (compareVersionCores(event.data.cli_version, supportWindow.runtime.minimum) ?? 0) < 0,
  );
  assert.deepEqual(
    older.map((event: any) => event.data.cli_version),
    ['0.6.5', '0.6.6', '0.6.7', '0.6.8', '0.6.9', '0.6.10'],
  );
  for (const event of older) {
    const capabilities = parseCapabilities(event.data);
    const during = Date.parse('2027-01-19T12:00:00Z');
    assert.equal(runtimeCompatibility(capabilities.cliVersion, during).status, 'deprecated');
    assertRuntimeSupported(capabilities, during);
    assert.throws(() => assertRuntimeSupported(capabilities, Date.parse('2027-01-20T00:00:00Z')));
    // Only releases from the setup minimum on can run the one-time Kalkidan setup.
    assert.equal(
      capabilities.capabilities.includes('setup.bootstrap'),
      (compareVersionCores(capabilities.cliVersion, supportWindow.runtime.setupMinimum) ?? -1) >= 0,
    );
  }
});

/** The JSON lines that DesktopProtocol writes for each request. Nothing answers them. */
async function written(requests: [string, Record<string, unknown>][]) {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdio = [child.stdin, child.stdout, child.stderr, new PassThrough()];
  const lines: any[] = [];
  child.stdin.write = (line: string) => lines.push(JSON.parse(line));
  child.stdin.destroy = () => {};
  child.kill = () => {};
  const client = new DesktopProtocol(resolve('fixture-verdictan'), [], (() => child) as any);
  const pending = requests.map(([operation, parameters]) =>
    client.request(operation as any, parameters).catch(() => undefined),
  );
  client.close();
  await Promise.all(pending);
  return lines;
}

test('a known-broken release keeps its account, and names the release that fixes it', () => {
  const result = runtimeCompatibility('0.6.11');
  assert.equal(result.status, 'broken');
  assert.equal(result.replacement, '0.6.12');
  assert.match(result.message, /cannot start managed gateways.*0\.6\.12 or later/);
  assert.equal(knownBrokenRuntime('0.6.12'), undefined);
  assert.equal(knownBrokenRuntime('0.6.11')?.fixedIn, '0.6.12');
  // The oldest version in the window is known-broken, so messages name the next one.
  assert.equal(supportWindow.runtime.minimum, '0.6.11');
  assert.equal(recommendedRuntime(), '0.6.12');
  for (const entry of supportWindow.runtime.knownBroken) {
    assert.ok(supportWindow.runtime.supported.includes(entry.fixedIn));
    assert.notEqual(entry.version, supportWindow.runtime.newestVerified);
  }
});
