import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const platform = process.platform;
const target = { darwin: 'mac', linux: 'linux', win32: 'win' }[platform];
if (!target) throw new Error(`Unsupported build host: ${platform}`);
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
let version = process.env.RELEASE_VERSION;
if (!version) {
  const tag = process.env.TAG_NAME;
  if (
    tag !== `v${manifest.version}` ||
    git('rev-parse', `refs/tags/${tag}^{commit}`) !== git('rev-parse', 'HEAD')
  ) {
    throw new Error('Release tag must match package.json and the checkout');
  }
  version = manifest.version;
}
if (!/^\d+\.\d+\.\d+(?:-build\.\d+\.[0-9a-f]{12})?$/.test(version))
  throw new Error('Invalid release version');
const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
for (const key of [
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID',
])
  delete env[key];
// The NSIS target writes a stub installer to the final path, runs it to make the
// uninstaller, and then writes the final installer to the same path. On Windows the
// stub can stay locked for a short time after it runs (for example, by a malware
// scan), and makensis then stops with "Can't open output file". Try again for that
// error only.
const lockedOutput = "Can't open output file";
const windowsAttempts = 3;
const lockWaitMs = 15_000;
const wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const removeWindowsOutput = () => {
  for (const name of readdirSync('release'))
    if (name.startsWith(`Kalkidan-${version}-win-`) && name.endsWith('.exe'))
      rmSync(`release/${name}`, { force: true });
};
const build = (args) => {
  if (platform !== 'win32') {
    execFileSync(process.execPath, args, { stdio: 'inherit', env });
    return;
  }
  for (let attempt = 1; ; attempt += 1) {
    const result = spawnSync(process.execPath, args, {
      stdio: ['inherit', 'pipe', 'pipe'],
      env,
      maxBuffer: 256 * 1024 * 1024,
    });
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    if (result.error) throw result.error;
    if (result.status === 0) return;
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    if (!output.includes(lockedOutput) || attempt === windowsAttempts)
      throw new Error(`electron-builder failed with exit code ${result.status}`);
    console.error(
      `The installer file was locked (attempt ${attempt} of ${windowsAttempts}). Trying again in ${lockWaitMs / 1000} s.`,
    );
    removeWindowsOutput();
    wait(lockWaitMs);
  }
};
const architectures = platform === 'darwin' ? ['arm64'] : ['x64'];
for (const arch of architectures) {
  build([
    'node_modules/electron-builder/cli.js',
    `--${target}`,
    `--${arch}`,
    '--publish',
    'never',
    `-c.extraMetadata.version=${version}`,
    ...(platform === 'win32' ? ['-c.npmRebuild=false'] : []),
    ...(platform === 'darwin' ? ['-c.mac.identity=null', '-c.mac.notarize=false'] : []),
  ]);
}
const files = readdirSync('release')
  .filter(
    (name) => name.startsWith(`Kalkidan-${version}-`) && /\.(dmg|zip|exe|AppImage|deb)$/.test(name),
  )
  .sort();
if (!files.length) throw new Error('No installers produced');
writeFileSync(
  'release/SHA256SUMS.txt',
  files
    .map(
      (name) =>
        `${createHash('sha256')
          .update(readFileSync(`release/${name}`))
          .digest('hex')}  ${name}\n`,
    )
    .join(''),
);
