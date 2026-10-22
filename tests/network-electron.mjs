// Checks the release requests of the desktop on the real Chromium network stack of Electron:
// a PAC file selects a local proxy, the proxy asks for a user name and password, and the server
// certificate comes from a test enterprise certificate authority.
//
// Run: node tests/network-electron.mjs
// It needs OpenSSL. On Linux, it also needs `certutil` (libnss3-tools) to put the test authority
// in a new NSS database, which Chromium reads. On macOS, Chromium reads the system keychain, and a
// trusted root there needs an administrator. The script then checks that Kalkidan refuses the
// untrusted server with clear words. docs/network-and-platform.md has the manual steps.
import { execFile, spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect } from 'node:net';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const work = await mkdtemp(join(tmpdir(), 'kalkidan-network-electron-'));
const results = [];
const record = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
const servers = [];
// Chromium sends loopback names directly, so the test uses a name that only the proxy knows.
const releaseHost = 'kalkidan-release.test';
const listen = (server) =>
  new Promise((done) => {
    servers.push(server);
    server.listen(0, '127.0.0.1', () => done(server.address().port));
  });

try {
  // A test enterprise certificate authority and a server certificate for localhost.
  const openssl = (args) => run('openssl', args, { cwd: work });
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
    '/CN=Kalkidan Test Enterprise Root',
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-addext',
    'keyUsage=critical,keyCertSign,cRLSign',
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
    `/CN=${releaseHost}`,
    '-out',
    'server.csr',
  ]);
  await writeFile(
    join(work, 'server.ext'),
    `subjectAltName=DNS:${releaseHost}\nextendedKeyUsage=serverAuth\nkeyUsage=digitalSignature\n`,
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
  const origin = createHttpsServer(
    {
      key: await readFile(join(work, 'server.key')),
      cert: await readFile(join(work, 'server.pem')),
    },
    (_request, response) => response.end('release'),
  );
  const originPort = await listen(origin);

  // A CONNECT proxy that asks for Basic credentials, as many corporate proxies do.
  const tunnels = [];
  const proxy = createHttpServer();
  proxy.on('connect', (request, socket, head) => {
    const expected = 'Basic ' + Buffer.from('dev:proxy-test-password').toString('base64');
    if (request.headers['proxy-authorization'] !== expected) {
      tunnels.push('refused');
      socket.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Corp"\r\nContent-Length: 0\r\n\r\n',
      );
      return;
    }
    tunnels.push(String(request.url));
    const [, port] = String(request.url).split(':');
    const upstream = connect(Number(port), '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });
  const proxyPort = await listen(proxy);

  // The PAC file sends the release host through the proxy.
  const pac = createHttpServer((_request, response) => {
    response.setHeader('content-type', 'application/x-ns-proxy-autoconfig');
    response.end(
      `function FindProxyForURL(url, host) { return host == "${releaseHost}" ? "PROXY 127.0.0.1:${proxyPort}" : "DIRECT"; }`,
    );
  });
  const pacPort = await listen(pac);

  // On Linux, Chromium trusts the roots in the NSS database of the user. No administrator.
  const home = join(work, 'home');
  await mkdir(join(home, '.pki', 'nssdb'), { recursive: true });
  let enterpriseRoot = false;
  if (process.platform === 'linux') {
    try {
      const db = `sql:${join(home, '.pki', 'nssdb')}`;
      await run('certutil', ['-d', db, '-N', '--empty-password']);
      await run('certutil', [
        '-d',
        db,
        '-A',
        '-t',
        'C,,',
        '-n',
        'Kalkidan Test',
        '-i',
        join(work, 'ca.pem'),
      ]);
      enterpriseRoot = true;
    } catch (error) {
      console.log(`SKIP enterprise root in NSS: ${error.message.split('\n')[0]}`);
    }
  }

  // The Electron program: the release fetch of Kalkidan, with a fixed proxy sign-in.
  await build({
    stdin: {
      contents: `
        import { app, net, session } from 'electron';
        import { chromiumFetch, withReleaseErrors } from ${JSON.stringify(join(root, 'electron/verdictan/network.ts'))};
        import { downloadReleaseFile } from ${JSON.stringify(join(root, 'electron/verdictan/download.ts'))};
        app.whenReady().then(async () => {
          // As a PAC file of the system does, this PAC file selects the proxy.
          await session.defaultSession.setProxy({ mode: 'pac_script', pacScript: process.env.TEST_PAC });
          const asked = [];
          const request = withReleaseErrors(chromiumFetch(net, {
            proxyLogin: async (challenge, retry) => {
              asked.push({ host: challenge.host, realm: challenge.realm, retry });
              return { username: 'dev', password: retry ? 'wrong' : 'proxy-test-password' };
            },
          }));
          const url = process.env.TEST_URL;
          let outcome;
          try {
            const bytes = await downloadReleaseFile(url, [new URL(url).origin], 1024, AbortSignal.timeout(20000), request);
            outcome = { text: bytes.toString() };
          } catch (error) {
            outcome = { error: error.message };
          }
          console.log('RESULT ' + JSON.stringify({ ...outcome, asked }));
          app.quit();
        });
      `,
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    outfile: join(work, 'main.cjs'),
    logLevel: 'warning',
  });
  const electronPath = (await import('electron')).default;
  const output = await new Promise((done, reject) => {
    const env = {
      ...process.env,
      HOME: home,
      TEST_PAC: `http://127.0.0.1:${pacPort}/proxy.pac`,
      TEST_URL: `https://${releaseHost}:${originPort}/release`,
    };
    for (const key of [
      'HTTPS_PROXY',
      'https_proxy',
      'HTTP_PROXY',
      'http_proxy',
      'NO_PROXY',
      'no_proxy',
      'ELECTRON_RUN_AS_NODE',
    ])
      delete env[key];
    const flags = process.platform === 'linux' ? ['--no-sandbox'] : [];
    const child = spawn(electronPath, [...flags, join(work, 'main.cjs')], { env });
    let text = '';
    child.stdout.on('data', (data) => (text += data));
    child.stderr.on('data', () => {});
    const timer = setTimeout(() => child.kill(), 60000);
    child.on('error', reject);
    child.on('close', () => {
      clearTimeout(timer);
      done(text);
    });
  });
  const line = output.split('\n').find((row) => row.startsWith('RESULT '));
  if (!line) throw new Error(`Electron gave no result: ${output.slice(-400)}`);
  const result = JSON.parse(line.slice(7));
  record(
    'the PAC file selects the proxy for the release host',
    tunnels.length > 0,
    tunnels.join(', '),
  );
  record(
    'the proxy asks for a sign-in, and Kalkidan answers the proxy challenge',
    result.asked.length > 0 && result.asked[0].realm === 'Corp' && result.asked[0].retry === false,
    JSON.stringify(result.asked),
  );
  record(
    'with the sign-in, the proxy opens the tunnel',
    tunnels.includes(`${releaseHost}:${originPort}`),
  );
  if (enterpriseRoot)
    record(
      'the enterprise root in the user certificate store makes the server trusted',
      result.text === 'release',
      result.error || result.text,
    );
  else
    record(
      'without the enterprise root, Kalkidan refuses the server with clear words and TLS stays on',
      result.error?.startsWith('The release server certificate is not trusted.') === true,
      result.error || result.text,
    );
} catch (error) {
  record('network check', false, error.message);
} finally {
  for (const server of servers) server.close();
  await rm(work, { recursive: true, force: true });
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
