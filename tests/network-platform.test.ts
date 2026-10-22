import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  chromiumFetch,
  isReleaseNetworkError,
  proxyConfigured,
  releaseNetworkError,
  releaseNetworkMessages,
  trustSystemCertificates,
  withReleaseErrors,
  type ChromiumNet,
} from '../electron/verdictan/network';
import {
  NetworkWatcher,
  networkFingerprint,
  recoverConnections,
} from '../electron/platform-events';
import { ManagedGateway } from '../electron/verdictan/gateway';
import { ManagedRuntimes } from '../electron/verdictan/runtime';
import {
  clockSkewMs,
  credentialLifetimeMs,
  parseRuntimeCredentials,
  type RuntimeCredentials,
} from '../electron/verdictan/credentials';
import { releaseClockSkewSeconds, verifyRuntimeRelease } from '../electron/verdictan/release';
import { downloadReleaseFile } from '../electron/verdictan/download';
import { managedErrors, managedRefusal } from '../src/domain/verdictan';
import { releaseFixture, signBundle } from './helpers/verdictan-fixture';

const failure = (code: string, message = 'fetch failed') =>
  Object.assign(new TypeError(message), { cause: Object.assign(new Error(code), { code }) });

test('release network failures have plain words and never suggest turning off TLS checks', () => {
  const cases: [unknown, string][] = [
    // Node.js fetch (undici) errors.
    [failure('UNABLE_TO_VERIFY_LEAF_SIGNATURE'), releaseNetworkMessages.certificate],
    [failure('SELF_SIGNED_CERT_IN_CHAIN'), releaseNetworkMessages.certificate],
    [failure('DEPTH_ZERO_SELF_SIGNED_CERT'), releaseNetworkMessages.certificate],
    [failure('CERT_HAS_EXPIRED'), releaseNetworkMessages.certificate],
    [failure('ERR_TLS_CERT_ALTNAME_INVALID'), releaseNetworkMessages.certificate],
    [failure('ENOTFOUND'), releaseNetworkMessages.offline],
    [failure('EAI_AGAIN'), releaseNetworkMessages.offline],
    [failure('ECONNRESET'), releaseNetworkMessages.offline],
    [failure('ENETUNREACH'), releaseNetworkMessages.offline],
    [failure('UND_ERR_CONNECT_TIMEOUT'), releaseNetworkMessages.timeout],
    [new DOMException('The operation timed out.', 'TimeoutError'), releaseNetworkMessages.timeout],
    [
      failure('UND_ERR_ABORTED', 'Proxy response (407) !== 200 when HTTP Tunneling'),
      releaseNetworkMessages.proxy,
    ],
    // Chromium (Electron net) errors.
    [new Error('net::ERR_CERT_AUTHORITY_INVALID'), releaseNetworkMessages.certificate],
    [new Error('net::ERR_CERT_DATE_INVALID'), releaseNetworkMessages.certificate],
    [new Error('net::ERR_PROXY_CONNECTION_FAILED'), releaseNetworkMessages.proxy],
    [new Error('net::ERR_TUNNEL_CONNECTION_FAILED'), releaseNetworkMessages.proxy],
    [new Error('net::ERR_PROXY_AUTH_UNSUPPORTED'), releaseNetworkMessages.proxy],
    [new Error('net::ERR_INTERNET_DISCONNECTED'), releaseNetworkMessages.offline],
    [new Error('net::ERR_NETWORK_CHANGED'), releaseNetworkMessages.offline],
    [new Error('net::ERR_NETWORK_IO_SUSPENDED'), releaseNetworkMessages.offline],
    [new Error('net::ERR_NAME_NOT_RESOLVED'), releaseNetworkMessages.offline],
    [new Error('net::ERR_TIMED_OUT'), releaseNetworkMessages.timeout],
  ];
  for (const [error, message] of cases) {
    assert.equal(releaseNetworkError(error)?.message, message, String(error));
    assert.ok(isReleaseNetworkError(message));
  }
  for (const message of Object.values(releaseNetworkMessages)) {
    assert.doesNotMatch(message, /NODE_TLS_REJECT_UNAUTHORIZED|insecure|--no-check/i);
    assert.match(message, /^The /, 'safeInstallError keeps messages that start with "The "');
  }
  // With a proxy, Node.js reports a refused proxy like any refused connection.
  assert.equal(
    releaseNetworkError(failure('ECONNREFUSED'), true)?.message,
    releaseNetworkMessages.proxy,
  );
  assert.equal(
    releaseNetworkError(failure('ECONNREFUSED'))?.message,
    releaseNetworkMessages.offline,
  );
  // A cancel, a checksum failure, and a signature failure keep their own words.
  assert.equal(releaseNetworkError(new DOMException('Aborted', 'AbortError')), undefined);
  assert.equal(releaseNetworkError(new Error('The runtime download checksum failed.')), undefined);
  assert.equal(releaseNetworkError(new Error('Download timed out.')), undefined);
  assert.equal(isReleaseNetworkError('Release signature verification failed.'), false);
  assert.equal(isReleaseNetworkError(undefined), false);
  const mapped = new Error(releaseNetworkMessages.proxy);
  assert.equal(releaseNetworkError(mapped), mapped);
  assert.equal(
    proxyConfigured({ HTTPS_PROXY: 'http://proxy:3128', NODE_USE_ENV_PROXY: '1' }),
    true,
  );
  assert.equal(
    proxyConfigured({ https_proxy: 'http://proxy:3128', NODE_USE_ENV_PROXY: '1' }),
    true,
  );
  assert.equal(proxyConfigured({ HTTPS_PROXY: 'http://proxy:3128' }), false);
  assert.equal(proxyConfigured({ NODE_USE_ENV_PROXY: '1' }), false);
});

test('release downloads translate connection and body failures', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(
    downloadReleaseFile(
      'https://github.com/verdictan/packages/releases/download/v1.0.0/x',
      ['https://github.com'],
      100,
      signal,
      (async () => {
        throw failure('SELF_SIGNED_CERT_IN_CHAIN');
      }) as typeof fetch,
    ),
    { message: releaseNetworkMessages.certificate },
  );
  // The connection drops after the headers, for example when the Wi-Fi changes.
  const broken = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(failure('ECONNRESET', 'terminated'));
    },
  });
  await assert.rejects(
    downloadReleaseFile(
      'https://github.com/verdictan/packages/releases/download/v1.0.0/x',
      ['https://github.com'],
      100,
      signal,
      (async () => new Response(broken)) as typeof fetch,
    ),
    { message: releaseNetworkMessages.offline },
  );
  const wrapped = withReleaseErrors(async () => {
    throw failure('ECONNREFUSED');
  }, true);
  await assert.rejects(wrapped('https://github.com'), { message: releaseNetworkMessages.proxy });
  const passthrough = withReleaseErrors(async () => {
    throw new Error('Other');
  });
  await assert.rejects(passthrough('https://github.com'), { message: 'Other' });
});

test('the system certificate store adds to the trusted authorities and keeps the others', () => {
  let installed: string[] | undefined;
  const api = {
    getCACertificates: (kind: string) =>
      kind === 'system' ? ['enterprise', 'shared'] : ['bundled', 'extra', 'shared'],
    setDefaultCACertificates: (value: string[]) => {
      installed = value;
    },
  };
  assert.equal(trustSystemCertificates(api as any), true);
  assert.deepEqual(installed, ['bundled', 'extra', 'shared', 'enterprise']);
  // An older Node.js keeps its authorities. Kalkidan never turns off verification instead.
  assert.equal(trustSystemCertificates({} as any), false);
  assert.equal(
    trustSystemCertificates({
      getCACertificates: () => {
        throw new Error('No system store.');
      },
      setDefaultCACertificates: () => assert.fail('must not replace the trusted set'),
    } as any),
    false,
  );
});

/** A fake Electron `net` whose requests the test answers. */
function fakeNet() {
  const requests: any[] = [];
  const net: ChromiumNet = {
    request(options) {
      const request: any = new EventEmitter();
      request.options = options;
      request.headers = {} as Record<string, string>;
      request.aborted = false;
      request.setHeader = (name: string, value: string) => {
        if (name === 'accept-encoding') throw new Error('Chromium sets this header.');
        request.headers[name] = value;
      };
      request.abort = () => {
        request.aborted = true;
      };
      request.end = () => {};
      requests.push(request);
      return request;
    },
  };
  return { net, requests };
}

test('the Chromium fetch returns redirects, streams bodies, and translates errors', async () => {
  const { net, requests } = fakeNet();
  const request = chromiumFetch(net);
  const redirect = request('https://github.com/latest', {
    redirect: 'manual',
    headers: { 'Accept-Encoding': 'identity', accept: 'application/json' },
  });
  const first = requests[0];
  assert.equal(first.options.redirect, 'manual');
  assert.equal(first.options.useSessionCookies, false);
  assert.equal(first.options.credentials, 'omit');
  assert.deepEqual(first.headers, { accept: 'application/json' });
  first.emit('redirect', 302, 'GET', 'https://github.com/tag/v1.0.0', {});
  const answer = await redirect;
  assert.equal(answer.status, 302);
  assert.equal(answer.headers.get('location'), 'https://github.com/tag/v1.0.0');
  assert.equal(first.aborted, true, 'Kalkidan checks each redirect itself');

  const body = request('https://github.com/file', { redirect: 'manual' });
  const response: any = new PassThrough();
  response.statusCode = 200;
  response.headers = { 'content-length': '5', 'set-cookie': ['a', 'b'] };
  requests[1].emit('response', response);
  response.end('hello');
  const file = await body;
  assert.equal(file.headers.get('content-length'), '5');
  assert.equal(await file.text(), 'hello');

  const canceled = request('https://github.com/large');
  const large: any = new PassThrough();
  large.statusCode = 200;
  large.headers = {};
  requests[2].emit('response', large);
  await (await canceled).body!.cancel();
  assert.equal(requests[2].aborted, true, 'a canceled body stops the request');

  const empty = request('https://github.com/none');
  const none: any = new PassThrough();
  none.statusCode = 204;
  none.headers = {};
  requests[3].emit('response', none);
  assert.equal((await empty).body, null);

  const failed = request('https://github.com/fail');
  requests[4].emit('error', new Error('net::ERR_CERT_AUTHORITY_INVALID'));
  await assert.rejects(failed, { message: releaseNetworkMessages.certificate });

  const errorRedirect = request('https://api.github.com/x', { redirect: 'error' });
  requests[5].emit('redirect', 301, 'GET', 'https://elsewhere.example/', {});
  await assert.rejects(errorRedirect, /redirect/);

  const controller = new AbortController();
  const aborted = request('https://github.com/slow', { signal: controller.signal });
  controller.abort(new Error('Canceled.'));
  await assert.rejects(aborted, /Canceled/);
  assert.equal(requests[6].aborted, true);
  await assert.rejects(request('https://github.com', { signal: controller.signal }), /Canceled/);
  await assert.rejects(request('https://github.com', { method: 'POST' }), /GET/);
});

test('recovery after a wake stops expired credentials first and runs every other step', async () => {
  const order: string[] = [];
  const results = await recoverConnections({
    checkExpiry: () => {
      order.push('expiry');
    },
    reconcileHosts: async () => {
      order.push('hosts');
      throw new Error('SSH host does not answer.');
    },
    renewAccount: async () => {
      order.push('account');
    },
    checkRuntime: async () => {
      order.push('runtime');
    },
  });
  assert.equal(order[0], 'expiry');
  assert.deepEqual(order.slice(1).sort(), ['account', 'hosts', 'runtime']);
  assert.deepEqual(
    results.map((result) => result.status),
    ['rejected', 'fulfilled', 'fulfilled'],
  );
  // A failed expiry check does not stop the reconnection.
  let reconnected = false;
  await recoverConnections({
    checkExpiry: () => {
      throw new Error('broken');
    },
    reconcileHosts: async () => {
      reconnected = true;
    },
    renewAccount: async () => {},
    checkRuntime: async () => {},
  });
  assert.equal(reconnected, true);
});

test('the network watcher reports online, offline, and a change of network', () => {
  let online = false;
  let addresses = 'en0/IPv4/10.0.0.2';
  const events: string[] = [];
  const pending: (() => void)[] = [];
  let canceled = 0;
  const watcher = new NetworkWatcher(
    () => online,
    (reason) => events.push(reason),
    () => addresses,
    {
      later: (fn) => {
        pending.push(fn);
        return () => canceled++;
      },
    },
  );
  watcher.start();
  watcher.start();
  assert.equal(pending.length, 1, 'start runs once');
  const tick = () => pending.shift()!();
  tick();
  assert.deepEqual(events, []);
  online = true;
  tick();
  assert.deepEqual(events, ['online']);
  tick();
  addresses = 'en0/IPv4/192.168.1.20';
  tick();
  assert.deepEqual(events, ['online', 'network-changed']);
  online = false;
  tick();
  assert.deepEqual(events, ['online', 'network-changed', 'offline']);
  // A change of address while offline is not a reconnection.
  addresses = 'en0/IPv4/172.16.0.4';
  tick();
  assert.equal(events.length, 3);
  watcher.close();
  assert.equal(canceled, 1);
  // A failed read keeps the state.
  const broken = new NetworkWatcher(
    () => {
      throw new Error('net is not ready');
    },
    () => assert.fail('no event'),
    () => '',
    { later: () => () => {} },
  );
  broken.tick();
  assert.equal(
    networkFingerprint(
      () =>
        ({
          lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
          en1: [{ address: 'fe80::1', family: 'IPv6', internal: false }],
          en0: [{ address: '10.0.0.2', family: 'IPv4', internal: false }],
          utun: undefined,
        }) as any,
    ),
    'en0/IPv4/10.0.0.2,en1/IPv6/fe80::1',
  );
});

const id = '11111111-1111-4111-8111-111111111111';
const credentials = (expires: number): RuntimeCredentials => ({
  schema_version: 1,
  correlation_id: 'sleep',
  runtime_id: id,
  runtime_registration_id: id,
  session_id: id,
  agent_id: id,
  gateway_id: 'gateway',
  api_url: 'https://api.verdictan.com',
  expires_at: new Date(expires).toISOString(),
  generation: 1,
  runtime_credential: 'vdt_' + 'a'.repeat(20),
  inference_credential: 'vdt_' + 'b'.repeat(20),
});

test('after a wake, a gateway whose credential expired during sleep stops at once', async () => {
  const start = Date.parse('2026-10-20T00:00:00Z');
  let now = start;
  const child: any = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdio = [child.stdin, child.stdout, child.stderr, new PassThrough()];
  let killed = 0;
  child.kill = () => {
    killed++;
    child.emit('close', 0);
  };
  let lost = 0;
  let environment: Record<string, string> = {};
  const gateway = new ManagedGateway({
    executable: '/fixture/verdictan',
    credentials: credentials(start + 10 * 60000),
    now: () => now,
    eventDirectory: '/home/u/.kalkidan/runtime/verdictan/events',
    launch: ((_file: string, _args: string[], options: { env: Record<string, string> }) => {
      environment = options.env;
      return child;
    }) as any,
    lost: () => lost++,
  });
  // The event queue is in a folder that survives a restart, not in the temporary folder.
  assert.equal(
    environment.VERDICTAN_EVENT_WAL_DATA_DIR,
    '/home/u/.kalkidan/runtime/verdictan/events',
  );
  const listening = gateway.readiness({ kind: 'codex', version: '1.0.0' });
  gateway.checkExpiry();
  assert.equal(killed, 0, 'a valid credential keeps running');
  // The computer sleeps for an hour. The expiry timer did not count that time.
  now = start + 60 * 60000;
  gateway.checkExpiry();
  gateway.checkExpiry();
  assert.equal(killed, 1);
  assert.equal(lost, 1);
  await assert.rejects(listening, { code: 'desktop.runtime_expired' });
  await gateway.stop();
  // The runtime owner checks each gateway that it owns.
  const runtimes = new ManagedRuntimes({
    apiOrigin: 'https://api.verdictan.com',
    client: async () => assert.fail('no client'),
    executable: async () => null,
  });
  let checked = 0;
  (runtimes as any).records.set('session', { gateway: { checkExpiry: () => checked++ } });
  (runtimes as any).records.set('stopped', {});
  runtimes.checkExpiry();
  assert.equal(checked, 1);
});

test('a small clock difference does not block credentials or releases, and a large one is clear', () => {
  const now = Date.parse('2026-10-20T00:00:00Z');
  // Verdictan issues credentials for 15 minutes. A clock that is 2 minutes slow sees 17 minutes.
  assert.ok(parseRuntimeCredentials(credentials(now + credentialLifetimeMs + 120000), now));
  assert.ok(parseRuntimeCredentials(credentials(now + credentialLifetimeMs + clockSkewMs), now));
  assert.throws(
    () => parseRuntimeCredentials(credentials(now + credentialLifetimeMs + clockSkewMs + 1), now),
    { code: 'desktop.clock_skew' },
  );
  assert.throws(() => parseRuntimeCredentials(credentials(now - 1), now), {
    code: 'desktop.runtime_expired',
  });
  assert.match(managedErrors['desktop.clock_skew'].message, /clock/);
  const refusal = managedRefusal('desktop.clock_skew', { computer: 'build-host' });
  assert.match(refusal.message, /clock of build-host is wrong/);
  assert.equal(refusal.step, null);

  const release = releaseFixture();
  const manifest = () => Buffer.from(JSON.stringify(release.manifest));
  const verify = (now: number) =>
    verifyRuntimeRelease(manifest(), signBundle(manifest()), release.discovered(), {
      ...release.options,
      now,
    });
  const issued = release.manifest.issued_at;
  // The release was issued 2 minutes "in the future" of a slow clock.
  assert.equal(verify(issued - 120).version, '0.2.1');
  assert.equal(verify(issued - releaseClockSkewSeconds).version, '0.2.1');
  assert.throws(() => verify(issued - releaseClockSkewSeconds - 1), /system clock is behind/);
  assert.throws(() => verify(issued - 86400), /Set the date and time/);
});

test('a proxy that asks for a sign-in gets an answer, and a server gets none', async () => {
  const { net, requests } = fakeNet();
  const asked: [string, boolean][] = [];
  let answer: { username: string; password: string } | null = { username: 'dev', password: 'pw' };
  const request = chromiumFetch(net, {
    proxyLogin: async (challenge, retry) => {
      asked.push([`${challenge.host}:${challenge.port}`, retry]);
      return answer;
    },
  });
  const reply = (index: number) =>
    new Promise<unknown[]>((resolve) =>
      requests[index].emit(
        'login',
        { isProxy: true, scheme: 'basic', host: 'proxy', port: 3128, realm: 'Corp' },
        (...args: unknown[]) => resolve(args),
      ),
    );
  void request('https://github.com/a').catch(() => {});
  assert.deepEqual(await reply(0), ['dev', 'pw']);
  // The proxy refused the answer, so the second challenge of the request is a retry.
  answer = null;
  assert.deepEqual(await reply(0), []);
  assert.deepEqual(asked, [
    ['proxy:3128', false],
    ['proxy:3128', true],
  ]);
  // After three challenges, the request stops asking.
  answer = { username: 'dev', password: 'pw' };
  assert.deepEqual(await reply(0), ['dev', 'pw']);
  assert.deepEqual(await reply(0), []);
  // A server (not a proxy) that asks for a sign-in gets no answer.
  void request('https://github.com/b').catch(() => {});
  const server = await new Promise<unknown[]>((resolve) =>
    requests[1].emit(
      'login',
      { isProxy: false, scheme: 'basic', host: 'github.com', port: 443, realm: 'x' },
      (...args: unknown[]) => resolve(args),
    ),
  );
  assert.deepEqual(server, []);
  assert.equal(asked.length, 3);
  // Without a sign-in source, a proxy challenge also gets no answer.
  void chromiumFetch(net)('https://github.com/c').catch(() => {});
  const none = await new Promise<unknown[]>((resolve) =>
    requests[2].emit(
      'login',
      { isProxy: true, scheme: 'basic', host: 'proxy', port: 3128, realm: 'Corp' },
      (...args: unknown[]) => resolve(args),
    ),
  );
  assert.deepEqual(none, []);
});
