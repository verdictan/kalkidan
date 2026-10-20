import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
// Native transport tests remain in npm test; this suite must never start application processes.
const nativeTests = new Set([
  'interactive-chat.test.ts',
  'remote-hosts.test.ts',
  'pty-terminal.test.ts',
  'conversation-tools.test.ts',
  'core-native.test.ts',
  'git-working-native.test.ts',
  'remote-node.test.ts',
  'worktree-sessions.test.ts',
]);
const files = readdirSync('tests')
  .filter((name) => name.endsWith('.test.ts') && !nativeTests.has(name))
  .sort()
  .map((name) => 'tests/' + name);
const repeat = process.argv.includes('--repeat');
const zones = repeat ? ['UTC', 'America/Los_Angeles', 'Asia/Tokyo'] : ['UTC'];
for (const [index, zone] of zones.entries()) {
  const ordered = index % 2 ? [...files].reverse() : files;
  console.log(`Deterministic backend tests: TZ=${zone}, ${files.length} files`);
  // Node sorts a batch of test paths. Separate processes preserve the requested order.
  for (const batch of repeat ? ordered.map((file) => [file]) : [ordered]) {
    const result = spawnSync(
      process.execPath,
      [
        '--require',
        './tests/helpers/offline-backend.cjs',
        '--import',
        'tsx',
        '--test',
        '--test-concurrency=1',
        ...batch,
      ],
      {
        stdio: 'inherit',
        env: { ...process.env, TZ: zone },
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
