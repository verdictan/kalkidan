import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { _electron as electron } from '@playwright/test';

const [oldInput, newInput] = process.argv.slice(2);
assert.ok(
  ['darwin', 'linux', 'win32'].includes(process.platform),
  'Use macOS DMGs, Linux DEBs, or Windows NSIS installers.',
);
if (process.platform === 'linux') {
  assert.ok(
    existsSync('/.dockerenv') && process.getuid() === 0,
    'Run DEB acceptance as root in a disposable container.',
  );
  let installed = false;
  try {
    installed = execFileSync('dpkg-query', ['-W', '-f=${Status}', 'kalkidan'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).includes('install ok installed');
  } catch {}
  assert.equal(installed, false, 'The acceptance container must not have Kalkidan installed.');
}
if (process.platform === 'win32') {
  const installed = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      "$entries = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue; if($entries | Where-Object { $_.DisplayName -eq 'Kalkidan' }) { 'installed' }",
    ],
    { encoding: 'utf8' },
  ).trim();
  assert.equal(installed, '', 'Use a worker without an existing Kalkidan installation.');
}
assert.ok(
  oldInput && newInput,
  'Provide the old and new installer packages. Keep SHA256SUMS.txt beside each file.',
);
async function checked(path) {
  const file = resolve(path),
    bytes = await readFile(file);
  const sums = await readFile(join(file, '..', 'SHA256SUMS.txt'), 'utf8');
  const line = sums
    .split('\n')
    .find((line) => line.trim().split(/\s+/).at(-1)?.replace(/^\*/, '') === basename(file));
  assert.ok(line, 'Published checksum is required.');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), line.split(/\s+/)[0]);
  return file;
}
const oldDmg = await checked(oldInput),
  newDmg = await checked(newInput);
const root = await mkdtemp(join(tmpdir(), 'kalkidan-installed-upgrade-'));
const home = join(root, 'home'),
  applications = join(root, 'Applications'),
  installed = join(applications, process.platform === 'win32' ? 'Kalkidan' : 'Kalkidan.app');
await mkdir(join(home, '.kalkidan'), { recursive: true });
await mkdir(applications);
let application, mounted;
const profileEnv = () => {
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
    XDG_CONFIG_HOME: join(home, '.config'),
    CODEX_HOME: join(home, '.codex'),
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
};
async function install(dmg) {
  if (process.platform === 'win32') {
    execFileSync(dmg, ['/S', '/currentuser', `/D=${installed}`], {
      env: profileEnv(),
      stdio: 'pipe',
      timeout: 180000,
    });
    return;
  }
  if (process.platform === 'linux') {
    execFileSync('apt-get', ['install', '-y', dmg], {
      stdio: 'pipe',
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' },
    });
    return;
  }
  const volume = join(root, 'volume');
  execFileSync(
    '/usr/bin/hdiutil',
    ['attach', '-nobrowse', '-readonly', '-mountpoint', volume, dmg],
    { stdio: 'pipe' },
  );
  mounted = volume;
  try {
    await rm(installed, { recursive: true, force: true });
    execFileSync('/usr/bin/ditto', [join(volume, 'Kalkidan.app'), installed]);
  } finally {
    execFileSync('/usr/bin/hdiutil', ['detach', volume], { stdio: 'pipe' });
    mounted = undefined;
  }
}
async function launch() {
  const env = profileEnv();
  const executablePath =
    process.platform === 'darwin'
      ? join(installed, 'Contents', 'MacOS', 'Kalkidan')
      : process.platform === 'win32'
        ? join(installed, 'Kalkidan.exe')
        : '/opt/Kalkidan/kalkidan';
  application = await electron.launch({
    executablePath,
    args: process.platform === 'linux' ? ['--no-sandbox'] : [],
    env,
    timeout: 60000,
  });
  assert.equal(
    await application.evaluate(({ app }) => app.getPath('userData')),
    join(home, '.kalkidan'),
  );
  const page = await application.firstWindow();
  await page.waitForFunction(() => !!window.workspace);
  return { page, version: await application.evaluate(({ app }) => app.getVersion()) };
}
try {
  await install(oldDmg);
  const old = await launch();
  const saved = await old.page.evaluate(async () => {
    const api = window.workspace;
    const group = await api.createGroup('Upgrade acceptance', '');
    await api.setGroupColor(group, 'violet');
    const page = await api.docsCreate(group, 'Persistent page', null);
    const doc = await api.docsSave(group, {
      ...page,
      markdown: '# Acceptance\n\nPreserve this page during upgrade.\n',
    });
    return { group, doc };
  });
  await application.close();
  application = undefined;
  await install(newDmg);
  const upgraded = await launch();
  assert.notEqual(old.version, upgraded.version, 'Use distinct release versions.');
  const restored = await upgraded.page.evaluate(
    async ({ group, id }) => ({
      snapshot: await window.workspace.snapshot(),
      doc: await window.workspace.docsRead(group, id),
    }),
    { group: saved.group, id: saved.doc.id },
  );
  assert.equal(restored.snapshot.groups.find((group) => group.id === saved.group)?.color, 'violet');
  assert.equal(restored.doc.markdown, saved.doc.markdown);
  assert.equal(restored.doc.title, saved.doc.title);
  await application.close();
  application = undefined;
  const restarted = await launch();
  assert.equal(restarted.version, upgraded.version);
  console.log(
    JSON.stringify({
      platform: process.platform,
      arch: process.arch,
      oldVersion: old.version,
      newVersion: upgraded.version,
      package:
        process.platform === 'darwin' ? 'dmg' : process.platform === 'win32' ? 'nsis' : 'deb',
      installation: 'passed',
      upgrade: 'passed',
      projectSettings: 'preserved',
      markdown: 'preserved',
      restart: 'passed',
      isolatedProfile: true,
    }),
  );
} finally {
  await application?.close();
  if (mounted) execFileSync('/usr/bin/hdiutil', ['detach', mounted], { stdio: 'pipe' });
  if (process.platform === 'win32' && existsSync(join(installed, 'Uninstall Kalkidan.exe')))
    execFileSync(join(installed, 'Uninstall Kalkidan.exe'), ['/S', `_?=${installed}`], {
      env: profileEnv(),
      stdio: 'pipe',
      timeout: 180000,
    });
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}
