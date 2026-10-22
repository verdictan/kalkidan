// Checks the Kalkidan SSH helper on a headless Linux host: no display, no D-Bus session, and no
// keyring. It installs the signed Verdictan runtime from GitHub. With --offline, the host has no
// network, and this computer copies a verified runtime to it over the helper connection.
//
// Run after `npm run build:electron`:
//   node --import tsx tests/headless-linux.mjs
//     Starts the helper on this computer. Use it on Linux, for example in the ci/ container.
//   node --import tsx tests/headless-linux.mjs --ssh <host> --docker <image> [--offline]
//     Starts the helper in a new container on an SSH host. --offline adds `--network none`.
//   --status-only checks the helper and the runtime status, without an install. CI uses it.
// The SSH host must accept a key login (BatchMode). The script never sends a password.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { transferRuntime } from '../electron/verdictan/transfer.ts';
import { releaseNetworkMessages } from '../electron/verdictan/network.ts';

const root = resolve(import.meta.dirname, '..');
const bundle = join(root, 'dist-electron', 'remote-agent.cjs');
const option = (name) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const ssh = option('--ssh');
const image = option('--docker') || 'node:24.21.0-bookworm-slim';
const offline = process.argv.includes('--offline');
// CI uses this: it checks the helper and the runtime status, and installs nothing.
const statusOnly = process.argv.includes('--status-only');
const desktopVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const hostId = 'headless-check';
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
// Remove every variable that gives access to a display, a session bus, or a keyring.
const headlessEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !/^(?:DISPLAY|WAYLAND_DISPLAY|DBUS_SESSION_BUS_ADDRESS|XDG_RUNTIME_DIR|GNOME_KEYRING_.*|SSH_AUTH_SOCK)$/.test(
        key,
      ),
  ),
);

function startHelper() {
  if (!ssh) {
    const home = mkdtempSync(join(tmpdir(), 'kalkidan-headless-'));
    const child = spawn(process.execPath, [bundle], {
      env: { ...headlessEnv, HOME: home, NODE_USE_ENV_PROXY: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { child, cleanup: () => rmSync(home, { recursive: true, force: true }) };
  }
  const flags = ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];
  const directory = `/tmp/kalkidan-headless-${randomUUID()}`;
  execFileSync(
    'ssh',
    [
      ...flags,
      ssh,
      `umask 077; mkdir -p ${directory} && cat > ${directory}/agent.cjs && chmod 644 ${directory}/agent.cjs && chmod 755 ${directory}`,
    ],
    {
      input: readFileSync(bundle),
    },
  );
  const name = `kalkidan-headless-${randomUUID().slice(0, 8)}`;
  const command = [
    'docker run --rm -i',
    `--name ${name}`,
    offline ? '--network none' : '',
    '-e NODE_USE_ENV_PROXY=1',
    `-v ${directory}/agent.cjs:/opt/kalkidan/agent.cjs:ro,z`,
    image,
    'node /opt/kalkidan/agent.cjs',
  ]
    .filter(Boolean)
    .join(' ');
  const child = spawn('ssh', [...flags, ssh, command], { stdio: ['pipe', 'pipe', 'pipe'] });
  return {
    child,
    cleanup: () => {
      try {
        execFileSync('ssh', [
          ...flags,
          ssh,
          `docker rm -f ${name} >/dev/null 2>&1; rm -rf ${directory}`,
        ]);
      } catch {}
    },
  };
}

const { child, cleanup } = startHelper();
let stderr = '';
child.stderr.on('data', (data) => (stderr = (stderr + data).slice(-4000)));
const pending = new Map();
createInterface({ input: child.stdout }).on('line', (line) => {
  let reply;
  try {
    reply = JSON.parse(line);
  } catch {
    return;
  }
  const waiter = pending.get(reply.id);
  if (!waiter) return;
  pending.delete(reply.id);
  reply.error ? waiter.reject(new Error(reply.error)) : waiter.resolve(reply.result);
});
child.on('close', () => {
  for (const waiter of pending.values()) waiter.reject(new Error(`Helper stopped. ${stderr}`));
});
function call(method, args = [], timeout = 120000) {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, timeout);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    child.stdin.write(JSON.stringify({ id, method, args }) + '\n');
  });
}
const runtime = (operation) =>
  call('runtime-update', [operation, desktopVersion, hostId, null], 300000);
async function settle() {
  for (let i = 0; i < 300; i++) {
    const status = await runtime('status');
    if (
      !status.installing &&
      ![
        'requested',
        'downloading',
        'verifying',
        'activating',
        'validating',
        'rolling-back',
      ].includes(status.operation?.phase)
    )
      return status;
    await new Promise((done) => setTimeout(done, 2000));
  }
  throw new Error('The install did not finish in 10 minutes.');
}

try {
  const hello = await call('hello', [], 60000);
  record(
    'helper starts without a display, D-Bus session, or keyring',
    hello.platform === 'linux',
    `${hello.platform} ${hello.arch} Node.js ${hello.node}`,
  );
  record(
    'helper reports the OS version for release checks',
    /^\d+\.\d+\.\d+$/.test(hello.systemVersion || ''),
    hello.systemVersion,
  );
  if (statusOnly) {
    const checked = await runtime('check');
    record(
      'the runtime check answers with a known state and plain words',
      ['available', 'current', 'failed'].includes(checked.discovery) &&
        (checked.discovery !== 'failed' || !!checked.error),
      `${checked.discovery}${checked.error ? `: ${checked.error}` : ''}`,
    );
  } else if (offline) {
    const checked = await runtime('check');
    record(
      'a host without network reports a clear error and offers a copy',
      checked.discovery === 'failed' &&
        checked.error === releaseNetworkMessages.offline &&
        checked.canTransfer === true,
      `${checked.discovery}: ${checked.error}`,
    );
    let sent = 0;
    const started = Date.now();
    const copied = await transferRuntime({
      host: { platform: hello.platform, arch: hello.arch, systemVersion: hello.systemVersion },
      desktopVersion,
      directory: tmpdir(),
      call: (operation, args) =>
        call('runtime-transfer', [operation, desktopVersion, hostId, null, ...args], 120000),
      progress: (update) => {
        if (update.phase === 'copying') sent = update.bytes;
      },
    });
    record(
      'this computer verifies the release and copies it over the helper connection',
      !!copied,
      `${(sent / 1048576).toFixed(1)} MiB in ${((Date.now() - started) / 1000).toFixed(0)} s`,
    );
  } else {
    await runtime('check');
    await runtime('install');
  }
  const status = statusOnly ? undefined : await settle();
  if (status)
    record(
      'the host verifies and installs the signed runtime, and the version probe passes',
      !!status.installed && status.operation?.phase === 'completed',
      status.installed
        ? `Verdictan ${status.installed.version}`
        : `${status.operation?.phase}: ${status.operation?.error || status.error}`,
    );
  if (status && offline)
    record(
      'the copied release is current, with no error',
      status.discovery === 'current' && !status.error,
      status.discovery,
    );
} catch (error) {
  record('headless Linux check', false, `${error.message} ${stderr.trim().slice(-400)}`);
} finally {
  child.stdin.end();
  child.kill();
  cleanup();
}
const failed = results.filter((result) => !result.ok);
console.log(`${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
