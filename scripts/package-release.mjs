import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
const architectures = platform === 'darwin' ? ['arm64', 'x64'] : ['x64'];
for (const arch of architectures) {
  execFileSync(
    process.execPath,
    [
      'node_modules/electron-builder/cli.js',
      `--${target}`,
      `--${arch}`,
      '--publish',
      'never',
      `-c.extraMetadata.version=${version}`,
      ...(platform === 'darwin' ? ['-c.mac.identity=null', '-c.mac.notarize=false'] : []),
    ],
    { stdio: 'inherit', env },
  );
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
