import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const executablePath = process.env.KALKIDAN_EXECUTABLE;
if (!executablePath) throw new Error('Set KALKIDAN_EXECUTABLE to the packaged app executable');
const root = await mkdtemp(join(tmpdir(), 'kalkidan-package-'));
const repo = join(root, 'repository with spaces');
const env = {
  ...process.env,
  HOME: root,
  USERPROFILE: root,
  APPDATA: join(root, 'appdata'),
  LOCALAPPDATA: join(root, 'localappdata'),
  XDG_CONFIG_HOME: join(root, 'config'),
  KALKIDAN_TEST_DATA: join(root, '.kalkidan'),
  CODEX_HOME: join(root, 'codex'),
  CLAUDE_CONFIG_DIR: join(root, 'claude'),
};
delete env.ELECTRON_RUN_AS_NODE;
for (const folder of [env.APPDATA, env.LOCALAPPDATA, env.XDG_CONFIG_HOME]) {
  await mkdir(folder, { recursive: true });
}
let app;
try {
  execFileSync('git', ['init', repo]);
  await mkdir(env.KALKIDAN_TEST_DATA, { recursive: true });
  await mkdir(join(env.CODEX_HOME, 'sessions'), { recursive: true });
  await writeFile(
    join(env.CODEX_HOME, 'sessions', 'fixture.jsonl'),
    JSON.stringify({ type: 'session_meta', payload: { id: 'package-session', cwd: repo } }) + '\n',
  );
  await writeFile(
    join(env.KALKIDAN_TEST_DATA, 'project-groups.json'),
    JSON.stringify([{ id: 'fixture', name: 'Package test', repoIds: [] }]),
  );
  app = await electron.launch({
    executablePath: resolve(executablePath),
    args: process.platform === 'linux' && !env.DISPLAY ? ['--ozone-platform=headless'] : [],
    env,
    timeout: 60000,
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.workspace);
  assert.equal((await page.evaluate(() => window.workspace.discover('fixture'))).added, 1);
  const snapshot = await page.evaluate(() => window.workspace.snapshot());
  assert.equal(snapshot.projects.length, 1);
  const cwd = snapshot.projects[0].path;
  const command =
    process.platform === 'win32'
      ? '[Console]::Write("package-command-ok")'
      : 'printf package-command-ok';
  const run = await page.evaluate(
    ([cwd, command]) => window.workspace.terminalStart(cwd, command),
    [cwd, command],
  );
  await expect
    .poll(
      () =>
        page.evaluate((id) => window.workspace.terminalStatus(id), run.id).then((s) => s.status),
      { timeout: 15000 },
    )
    .toBe('completed');
  assert.equal(
    (await page.evaluate((id) => window.workspace.terminalStatus(id), run.id)).output,
    'package-command-ok',
  );
  const pty = await page.evaluate((cwd) => window.workspace.ptyOpen(cwd, 80, 24), cwd);
  const input =
    process.platform === 'win32'
      ? "Write-Output ('package-' + 'pty-ok')\r"
      : "printf 'package-%s' 'pty-ok'\r";
  await page.evaluate(([id, input]) => window.workspace.ptyWrite(id, input), [pty.id, input]);
  await expect
    .poll(
      () => page.evaluate((id) => window.workspace.ptyRead(id, 0), pty.id).then((s) => s.data),
      { timeout: 15000 },
    )
    .toContain('package-pty-ok');
  await page.evaluate((id) => window.workspace.ptyClose(id), pty.id);
  console.log(
    `Packaged ${process.platform}/${process.arch}: UI, IPC, repository discovery, command execution, and PTY passed`,
  );
} finally {
  await app?.close();
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
