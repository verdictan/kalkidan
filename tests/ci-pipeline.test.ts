import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = resolve('scripts/ci.sh');
for (const fail of ['', 'test:backend:coverage', 'test:ci:ui', 'build']) {
  test(
    `CI preserves checks and propagates ${fail || 'success'}`,
    { skip: process.platform === 'win32' },
    () => {
      const root = mkdtempSync(join(tmpdir(), 'kalkidan-ci-'));
      try {
        mkdirSync(join(root, 'bin'));
        const stub = `#!/bin/sh\nprintf '%s\\n' "$*" >> "$CI_TEST_CALLS"\nif [ -n "$CI_TEST_FAIL" ] && [ "$2" = "$CI_TEST_FAIL" ]; then exit 7; fi\n`;
        for (const name of ['npm', 'node', 'npx']) {
          writeFileSync(join(root, 'bin', name), stub, { mode: 0o755 });
        }
        const calls = join(root, 'calls');
        const result = spawnSync('bash', [script], {
          cwd: root,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${join(root, 'bin')}:${process.env.PATH}`,
            KALKIDAN_CI_CONTAINER: '1',
            CI_TEST_CALLS: calls,
            CI_TEST_FAIL: fail,
          },
        });
        assert.equal(result.status, fail === 'build' ? 7 : fail ? 1 : 0, result.stderr);
        const commands = readFileSync(calls, 'utf8');
        assert.doesNotMatch(commands, /^ci |^playwright install/m);
        assert.equal(commands.split('\n').filter((line) => line === 'run build').length, 1);
        if (fail === 'build') {
          assert.doesNotMatch(commands, /test:backend:coverage|test:ci:ui/);
        } else {
          assert.match(commands, /test:backend:coverage/);
          assert.match(commands, /test:ci:ui/);
          if (fail === 'test:backend:coverage') assert.doesNotMatch(commands, /--test-concurrency/);
          if (fail === 'test:ci:ui') assert.doesNotMatch(commands, /tests\/memory-processes/);
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
}
