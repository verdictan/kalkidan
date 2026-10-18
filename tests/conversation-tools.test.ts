import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { CommandTerminal, repositoryDiff } from '../electron/conversation-tools';
async function finished(terminal: CommandTerminal, id: string) {
  for (let i = 0; i < 200; i++) { const run = terminal.status(id); if (run.status !== 'running') return run; await new Promise(r => setTimeout(r, 20)); }
  throw new Error('Command did not finish');
}
test('terminal runs in the repository, accepts stdin, reports failures and stops commands', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'kalkidan terminal ')); const terminal = new CommandTerminal();
  try {
    const run = terminal.start(cwd, 'pwd; read answer; printf "answer:%s" "$answer"');
    terminal.input(run.id, 'hello\n');
    const result = await finished(terminal, run.id);
    assert.equal(result.status, 'completed'); assert.ok(result.output.includes('kalkidan terminal ')); assert.match(result.output, /answer:hello/);
    const failure = await finished(terminal, terminal.start(cwd, 'printf error >&2; exit 7').id);
    assert.equal(failure.exitCode, 7); assert.equal(failure.status, 'failed'); assert.match(failure.output, /error/);
    const long = terminal.start(cwd, 'sleep 60'); terminal.stop(long.id); assert.equal(terminal.status(long.id).status, 'stopped');
  } finally { terminal.stopAll(); await rm(cwd, { recursive: true, force: true }); }
});
test('Git review separates staged and unstaged edits and reports untracked files', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'kalkidan diff '));
  const git = (...args: string[]) => execFileSync('git', ['-C', cwd, ...args]);
  try {
    git('init'); await writeFile(join(cwd, 'file.txt'), 'original\n'); git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial');
    await writeFile(join(cwd, 'file.txt'), 'staged\n'); git('add', '.'); await writeFile(join(cwd, 'file.txt'), 'working\n'); await writeFile(join(cwd, 'new file.txt'), 'new');
    const diff = await repositoryDiff(cwd); assert.match(diff.staged, /\+staged/); assert.match(diff.unstaged, /\+working/); assert.deepEqual(diff.untracked, ['new file.txt']); assert.equal(diff.truncated, false);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
