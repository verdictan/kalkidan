import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { exec } from './core';
import type { TerminalRun, RepositoryDiff } from '../src/types';

export class CommandTerminal {
  private runs = new Map<string, { state: TerminalRun; child: ChildProcess }>();
  start(cwd: string, command: string): TerminalRun {
    if (typeof command !== 'string' || !command.trim() || command.length > 10000) throw new Error('Enter a command of at most 10,000 characters.');
    if ([...this.runs.values()].filter(r => r.state.status === 'running').length >= 8) throw new Error('Stop an existing command before starting another.');
    for (const [id, run] of this.runs) if (this.runs.size >= 40 && run.state.status !== 'running') this.runs.delete(id);
    const child = spawn(process.env.SHELL || '/bin/sh', ['-lc', command], { cwd, detached: process.platform !== 'win32', env: { ...process.env, TERM: 'dumb', NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    const state: TerminalRun = { id: randomUUID(), command, cwd, output: '', status: 'running', truncated: false };
    this.runs.set(state.id, { state, child });
    const append = (chunk: string) => { state.output += chunk; if (state.output.length > 100000) { state.output = state.output.slice(-100000); state.truncated = true; } };
    child.stdout?.setEncoding('utf8').on('data', append); child.stderr?.setEncoding('utf8').on('data', append);
    child.stdin?.on('error', () => {});
    child.on('error', error => { append(error.message); state.status = 'failed'; });
    child.on('close', code => { state.exitCode = code; if (state.status === 'running') state.status = code === 0 ? 'completed' : 'failed'; });
    return { ...state };
  }
  status(id: string) { const run = this.runs.get(id); if (!run) throw new Error('Command no longer available.'); return { ...run.state }; }
  input(id: string, value: string) { const run = this.runs.get(id); if (!run || run.state.status !== 'running') throw new Error('Command is not running.'); if (typeof value !== 'string' || value.length > 10000) throw new Error('Input is too long.'); run.child.stdin?.write(value); }
  stop(id: string) {
    const run = this.runs.get(id); if (!run || run.state.status !== 'running') return;
    run.state.status = 'stopped';
    const kill = (signal: NodeJS.Signals) => { try { if (process.platform !== 'win32' && run.child.pid) process.kill(-run.child.pid, signal); else run.child.kill(signal); } catch {} };
    kill('SIGTERM'); const timer = setTimeout(() => kill('SIGKILL'), 1000); timer.unref();
  }
  stopAll() { for (const id of this.runs.keys()) this.stop(id); }
}

export async function repositoryDiff(cwd: string): Promise<RepositoryDiff> {
  const git = async (args: string[]) => (await exec('git', ['-C', cwd, ...args], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 })).stdout;
  const [unstaged, staged, untracked] = await Promise.all([
    git(['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--']),
    git(['diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-color', '--']),
    git(['ls-files', '--others', '--exclude-standard', '-z']),
  ]);
  return { unstaged: unstaged.slice(0, 100000), staged: staged.slice(0, 100000), untracked: untracked.split('\0').filter(Boolean), truncated: unstaged.length > 100000 || staged.length > 100000 };
}
