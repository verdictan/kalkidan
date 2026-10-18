import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { CommandTerminal, repositoryDiff } from '../electron/conversation-tools';
async function finished(terminal: CommandTerminal, id: string) {
  for (let i = 0; i < 200; i++) {
    const run = terminal.status(id);
    if (run.status !== 'running') return run;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('Command did not finish');
}
test('terminal runs in the repository, accepts stdin, reports failures and stops commands', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'kalkidan terminal '));
  const terminal = new CommandTerminal();
  try {
    const run = terminal.start(cwd, 'pwd; read answer; printf "answer:%s" "$answer"');
    terminal.input(run.id, 'hello\n');
    const result = await finished(terminal, run.id);
    assert.equal(result.status, 'completed');
    assert.ok(result.output.includes('kalkidan terminal '));
    assert.match(result.output, /answer:hello/);
    const failure = await finished(terminal, terminal.start(cwd, 'printf error >&2; exit 7').id);
    assert.equal(failure.exitCode, 7);
    assert.equal(failure.status, 'failed');
    assert.match(failure.output, /error/);
    const long = terminal.start(cwd, 'sleep 60');
    terminal.stop(long.id);
    assert.equal(terminal.status(long.id).status, 'stopped');
  } finally {
    terminal.stopAll();
    await rm(cwd, { recursive: true, force: true });
  }
});
test('Git review separates staged and unstaged edits and reports untracked files', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'kalkidan diff '));
  const git = (...args: string[]) => execFileSync('git', ['-C', cwd, ...args]);
  try {
    git('init');
    await writeFile(join(cwd, 'file.txt'), 'original\n');
    git('add', '.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial');
    await writeFile(join(cwd, 'file.txt'), 'staged\n');
    git('add', '.');
    await writeFile(join(cwd, 'file.txt'), 'working\n');
    await writeFile(join(cwd, 'new file.txt'), 'new');
    const diff = await repositoryDiff(cwd);
    assert.match(diff.staged, /\+staged/);
    assert.match(diff.unstaged, /\+working/);
    assert.deepEqual(diff.untracked, ['new file.txt']);
    assert.equal(diff.truncated, false);
    assert.equal(diff.newFiles?.find((file) => file.path === 'new file.txt')?.text, 'new');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('new-file review bounds text and does not read symlinks or binary files', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'kalkidan-preview-'));
  const outside = await mkdtemp(join(tmpdir(), 'kalkidan-outside-'));
  try {
    execFileSync('git', ['-C', cwd, 'init']);
    await writeFile(join(cwd, 'large.txt'), 'a'.repeat(150000));
    await writeFile(join(cwd, 'binary.dat'), Buffer.from([1, 0, 2]));
    await writeFile(join(outside, 'private.txt'), 'outside content');
    await symlink(join(outside, 'private.txt'), join(cwd, 'linked.txt'));
    const result = await repositoryDiff(cwd);
    assert.equal(result.newFiles?.find((f) => f.path === 'large.txt')?.text?.length, 100000);
    assert.equal(result.newFiles?.find((f) => f.path === 'large.txt')?.truncated, true);
    assert.match(result.newFiles?.find((f) => f.path === 'binary.dat')?.reason || '', /Binary/);
    assert.equal(result.newFiles?.find((f) => f.path === 'linked.txt')?.text, undefined);
    assert.doesNotMatch(JSON.stringify(result), /outside content/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
