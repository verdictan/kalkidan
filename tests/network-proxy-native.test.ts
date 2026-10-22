import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect, type AddressInfo } from 'node:net';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { releaseNetworkMessages } from '../electron/verdictan/network';

const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..');

/** A test certificate authority and a server certificate for localhost, made with OpenSSL. */
async function certificates(directory: string) {
  const openssl = (args: string[]) => run('openssl', args, { cwd: directory });
  await openssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'ca.key']);
  await openssl([
    'req',
    '-x509',
    '-new',
    '-key',
    'ca.key',
    '-days',
    '2',
    '-subj',
    '/CN=Kalkidan Test Enterprise CA',
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-addext',
    'keyUsage=critical,keyCertSign',
    '-out',
    'ca.pem',
  ]);
  await openssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'server.key']);
  await openssl([
    'req',
    '-new',
    '-key',
    'server.key',
    '-subj',
    '/CN=localhost',
    '-out',
    'server.csr',
  ]);
  await writeFile(
    join(directory, 'server.ext'),
    'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n',
  );
  await openssl([
    'x509',
    '-req',
    '-in',
    'server.csr',
    '-CA',
    'ca.pem',
    '-CAkey',
    'ca.key',
    '-CAcreateserial',
    '-days',
    '2',
    '-extfile',
    'server.ext',
    '-out',
    'server.pem',
  ]);
  return {
    ca: join(directory, 'ca.pem'),
    key: await readFile(join(directory, 'server.key')),
    cert: await readFile(join(directory, 'server.pem')),
  };
}

const listen = (server: Server) =>
  new Promise<number>((done) =>
    server.listen(0, '127.0.0.1', () => done((server.address() as AddressInfo).port)),
  );

/** Download a release file in a separate Node.js process, as the SSH helper does. */
async function download(url: string, env: Record<string, string>, trustSystem = false) {
  const script = `
import { downloadReleaseFile } from ${JSON.stringify(join(root, 'electron/verdictan/download.ts'))};
import { proxyConfigured, trustSystemCertificates, withReleaseErrors } from ${JSON.stringify(join(root, 'electron/verdictan/network.ts'))};
if (${trustSystem}) trustSystemCertificates();
const url = ${JSON.stringify(url)};
try {
  const bytes = await downloadReleaseFile(url, [new URL(url).origin], 1024, AbortSignal.timeout(10000),
    withReleaseErrors(fetch, proxyConfigured()));
  console.log(JSON.stringify({ text: bytes.toString() }));
} catch (error) {
  console.log(JSON.stringify({ error: error.message }));
}`;
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(?:https?_proxy|no_proxy|all_proxy|NODE_EXTRA_CA_CERTS|NODE_USE_ENV_PROXY|NODE_TLS_REJECT_UNAUTHORIZED|NODE_OPTIONS)$/i.test(
          key,
        ),
    ),
  );
  const { stdout } = await run(
    process.execPath,
    ['--no-warnings', '--import', 'tsx', '--input-type=module', '-e', script],
    { cwd: root, env: { ...clean, ...env }, timeout: 30000 },
  );
  return JSON.parse(stdout.trim().split('\n').at(-1)!) as { text?: string; error?: string };
}

test('release downloads work through a corporate proxy with an enterprise certificate authority', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'kalkidan-proxy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { ca, key, cert } = await certificates(directory);
  const origin = createHttpsServer({ key, cert }, (_request, response) => response.end('release'));
  const originPort = await listen(origin as unknown as Server);
  t.after(() => origin.close());
  // A CONNECT proxy, like most corporate proxies. It records each tunnel.
  const tunnels: string[] = [];
  let requireAuth = false;
  const proxy = createHttpServer();
  proxy.on('connect', (request, socket, head) => {
    tunnels.push(String(request.url));
    if (requireAuth && !request.headers['proxy-authorization']) {
      socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic\r\n\r\n');
      return;
    }
    const [host, port] = String(request.url).split(':');
    const upstream = connect(Number(port), host === 'localhost' ? '127.0.0.1' : host, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });
  const proxyPort = await listen(proxy);
  t.after(() => proxy.close());
  const url = `https://localhost:${originPort}/release`;
  const viaProxy = { HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`, NODE_USE_ENV_PROXY: '1' };

  // The enterprise authority from NODE_EXTRA_CA_CERTS, through the proxy.
  assert.deepEqual(await download(url, { ...viaProxy, NODE_EXTRA_CA_CERTS: ca }), {
    text: 'release',
  });
  assert.deepEqual(tunnels, [`localhost:${originPort}`]);
  // The SSH helper also adds the system store. NODE_EXTRA_CA_CERTS still works after that.
  assert.deepEqual(await download(url, { ...viaProxy, NODE_EXTRA_CA_CERTS: ca }, true), {
    text: 'release',
  });
  // Without the enterprise authority, the request stops with clear words. TLS stays on.
  assert.deepEqual(await download(url, viaProxy), {
    error: releaseNetworkMessages.certificate,
  });
  assert.deepEqual(await download(url, viaProxy, true), {
    error: releaseNetworkMessages.certificate,
  });
  // A proxy that asks for credentials.
  requireAuth = true;
  assert.deepEqual(await download(url, { ...viaProxy, NODE_EXTRA_CA_CERTS: ca }), {
    error: releaseNetworkMessages.proxy,
  });
  requireAuth = false;
  // A proxy that does not run.
  const closed = createHttpServer();
  const closedPort = await listen(closed);
  await new Promise((done) => closed.close(done));
  assert.deepEqual(
    await download(url, {
      HTTPS_PROXY: `http://127.0.0.1:${closedPort}`,
      NODE_USE_ENV_PROXY: '1',
      NODE_EXTRA_CA_CERTS: ca,
    }),
    { error: releaseNetworkMessages.proxy },
  );
  // NO_PROXY keeps a direct connection, and the direct connection also uses the authority.
  const before = tunnels.length;
  assert.deepEqual(
    await download(url, { ...viaProxy, NO_PROXY: 'localhost', NODE_EXTRA_CA_CERTS: ca }),
    { text: 'release' },
  );
  assert.equal(tunnels.length, before);
  // No server answers on a closed port: the network words, not the proxy words.
  assert.deepEqual(await download(`https://localhost:${closedPort}/x`, {}), {
    error: releaseNetworkMessages.offline,
  });
});

test('no source file turns off TLS certificate verification', async () => {
  const offenders: string[] = [];
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (/\.(?:ts|tsx|mjs|cjs|js)$/.test(entry.name)) {
        const source = await readFile(path, 'utf8');
        if (
          /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED|ignore-certificate-errors|setCertificateVerifyProc/.test(
            source,
          )
        )
          offenders.push(path);
      }
    }
  }
  for (const directory of ['electron', 'src', 'scripts']) await visit(join(root, directory));
  assert.deepEqual(offenders, []);
});
