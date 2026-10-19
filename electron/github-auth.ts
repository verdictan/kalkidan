import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { exec } from './core';
import { githubExecutable } from './github-projects';
import type { GitHubAuthState } from '../src/types';

export function deviceCode(output: string) {
  return output
    .replace(/\x1b\[[0-9;]*m/g, '')
    .match(/one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i)?.[1];
}
export class GitHubAuth {
  private state: GitHubAuthState = { status: 'idle' };
  private child?: ChildProcessWithoutNullStreams;
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private openBrowser: () => Promise<void>,
    private run = exec,
    private launch = spawn,
    private executable = githubExecutable,
  ) {}
  snapshot() {
    return { ...this.state };
  }
  /** Passive permission check: never starts a login or opens a browser. */
  async inspect(): Promise<GitHubAuthState> {
    if (['checking', 'waiting'].includes(this.state.status)) return this.snapshot();
    const generation = this.generation;
    try {
      const gh = await this.executable();
      const result = await this.run(
        gh,
        ['auth', 'status', '--hostname', 'github.com', '--active'],
        { timeout: 15000 },
      );
      if (generation !== this.generation) return this.snapshot();
      const scopes = (result.stdout + result.stderr).match(/Token scopes:([^\n]+)/)?.[1] || '';
      return { status: /(?:^|[\s,'])project(?:$|[\s,'])/.test(scopes) ? 'ready' : 'idle' };
    } catch {
      return generation !== this.generation ? this.snapshot() : { status: 'idle' };
    }
  }
  async start(force = false) {
    if (this.state.status === 'checking' || this.state.status === 'waiting') return this.snapshot();
    const generation = ++this.generation;
    this.state = { status: 'checking' };
    try {
      const gh = await this.executable();
      let loggedIn = false;
      try {
        const result = await this.run(
          gh,
          ['auth', 'status', '--hostname', 'github.com', '--active'],
          { timeout: 15000 },
        );
        loggedIn = true;
        const scopes = (result.stdout + result.stderr).match(/Token scopes:([^\n]+)/)?.[1] || '';
        if (!force && /(?:^|[\s,'])project(?:$|[\s,'])/.test(scopes)) {
          if (generation === this.generation) this.state = { status: 'ready' };
          return this.snapshot();
        }
      } catch (error: any) {
        if (error.code === 'ENOENT') throw error;
      }
      if (generation !== this.generation) return this.snapshot();
      if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN)
        throw new Error(
          'An environment token overrides GitHub CLI login. Remove GH_TOKEN/GITHUB_TOKEN from Kalkidan’s environment and try again, or grant Projects access to that token.',
        );
      const args = loggedIn
        ? ['auth', 'refresh', '-h', 'github.com', '-s', 'project']
        : [
            'auth',
            'login',
            '--hostname',
            'github.com',
            '--web',
            '--git-protocol',
            'https',
            '--scopes',
            'project',
          ];
      const child = this.launch(gh, args, {
        stdio: 'pipe',
        env: {
          ...process.env,
          GH_BROWSER: process.platform === 'win32' ? 'cmd /c exit 0' : '/usr/bin/true',
          BROWSER: process.platform === 'win32' ? 'cmd /c exit 0' : '/usr/bin/true',
          NO_COLOR: '1',
        },
      }) as ChildProcessWithoutNullStreams;
      this.child = child;
      this.state = { status: 'waiting' };
      let output = '';
      const receive = (chunk: Buffer) => {
        if (generation !== this.generation) return;
        output = (output + chunk.toString()).slice(-8192);
        const code = deviceCode(output);
        if (code && !this.state.code) {
          this.state = { status: 'waiting', code };
          void this.openBrowser().catch(() => {
            if (generation === this.generation)
              this.state = {
                ...this.state,
                message: 'Open github.com/login/device in your browser and enter this code.',
              };
          });
        }
      };
      child.stdout.on('data', receive);
      child.stderr.on('data', receive);
      child.stdin.on('error', () => {});
      child.stdin.end('\n');
      child.on('error', (error: NodeJS.ErrnoException) => {
        if (generation !== this.generation) return;
        clearTimeout(this.timer);
        this.state = {
          status: 'error',
          message:
            error.code === 'ENOENT'
              ? 'Install GitHub CLI, then retry.'
              : 'Could not start GitHub authorization. Try again.',
        };
      });
      child.on('close', (code) => {
        if (generation !== this.generation) return;
        clearTimeout(this.timer);
        this.child = undefined;
        if (this.state.status === 'error') return;
        this.state =
          code === 0
            ? { status: 'ready' }
            : {
                status: 'error',
                message: 'GitHub authorization was declined, expired, or interrupted. Try again.',
              };
      });
      this.timer = setTimeout(
        () => {
          if (generation === this.generation) {
            this.cancel();
            this.state = {
              status: 'error',
              message: 'GitHub authorization timed out. Try again for a new code.',
            };
          }
        },
        10 * 60 * 1000,
      );
      this.timer.unref();
    } catch (error: any) {
      if (generation === this.generation)
        this.state = {
          status: 'error',
          message: error.code === 'ENOENT' ? 'Install GitHub CLI, then retry.' : error.message,
        };
    }
    return this.snapshot();
  }
  cancel() {
    ++this.generation;
    clearTimeout(this.timer);
    this.child?.kill('SIGTERM');
    this.child = undefined;
    this.state = { status: 'idle' };
    return this.snapshot();
  }
}
