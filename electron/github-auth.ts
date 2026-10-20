import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { exec } from './core';
import { githubExecutable } from './github-projects';
import type { GitHubAuthState } from '../src/types';

export function deviceCode(output: string) {
  return (
    output
      // Remove ANSI color codes from CLI output.
      // oxlint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;]*m/g, '')
      .match(/one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i)?.[1]
  );
}
function failure(error: unknown): GitHubAuthState {
  const value = error as { code?: string; message?: string; stderr?: string };
  // Classify diagnostics, but never send CLI output or command arguments to the renderer.
  const diagnostic = `${value?.message || ''}\n${value?.stderr || ''}`;
  if (value?.code === 'ENOENT')
    return { status: 'error', reason: 'missing-cli', message: 'Install GitHub CLI, then retry.' };
  if (/SAML|single.sign.on|SSO/i.test(diagnostic))
    return {
      status: 'permission-required',
      reason: 'sso',
      message: 'Authorize your GitHub token for your organization’s SSO, then check again.',
    };
  if (/invalid.*token|token.*invalid|expired.*token|token.*expired|HTTP 401/i.test(diagnostic))
    return { status: 'expired', message: 'Your GitHub authorization has expired. Sign in again.' };
  if (/not logged|logged out|not authenticated|no.*accounts/i.test(diagnostic))
    return { status: 'signed-out', message: 'Sign in to GitHub to continue.' };
  if (/ENOTFOUND|EAI_AGAIN|ECONN|ETIMEDOUT|network|connect|timed out|HTTP 5\d\d/i.test(diagnostic))
    return {
      status: 'error',
      reason: 'network',
      message: 'Could not reach GitHub. Check your connection, then try again.',
    };
  return {
    status: 'error',
    reason: 'verification',
    message: 'Could not verify GitHub access. Check again before you continue.',
  };
}
export class GitHubAuth {
  private state: GitHubAuthState = { status: 'idle' };
  private child?: ChildProcessWithoutNullStreams;
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private inspection?: Promise<GitHubAuthState>;
  constructor(
    private openBrowser: () => Promise<void>,
    private run = exec,
    private launch = spawn,
    private executable = githubExecutable,
  ) {}
  snapshot() {
    return { ...this.state };
  }
  private async access(gh: string): Promise<GitHubAuthState> {
    try {
      const result = await this.run(
        gh,
        ['auth', 'status', '--hostname', 'github.com', '--active'],
        { timeout: 15000 },
      );
      const scopes = (result.stdout + result.stderr).match(/Token scopes:([^\n]+)/)?.[1] || '';
      return /(?:^|[\s,'])project(?:$|[\s,'])/.test(scopes)
        ? { status: 'ready' }
        : {
            status: 'permission-required',
            reason: 'permissions',
            message:
              'Allow GitHub Projects access to continue. Each project also requires permission to make changes.',
          };
    } catch (error) {
      return failure(error);
    }
  }
  /** Observers share a check. Closing a view never cancels the login process. */
  inspect(): Promise<GitHubAuthState> {
    if (this.inspection) return this.inspection;
    if (['checking', 'waiting', 'verifying'].includes(this.state.status))
      return Promise.resolve(this.snapshot());
    const generation = this.generation;
    this.state = { status: 'checking' };
    const inspection = (async () => {
      let state: GitHubAuthState;
      try {
        state = await this.access(await this.executable());
      } catch (error) {
        state = failure(error);
      }
      if (generation === this.generation) this.state = state;
      return this.snapshot();
    })();
    this.inspection = inspection;
    void inspection.finally(() => {
      if (this.inspection === inspection) this.inspection = undefined;
    });
    return inspection;
  }
  async start(force = false) {
    // A user action waits for a passive check; another login joins the current attempt.
    const observed = this.generation;
    if (this.inspection) await this.inspection;
    if (
      observed !== this.generation ||
      ['checking', 'waiting', 'verifying'].includes(this.state.status)
    )
      return this.snapshot();
    const generation = ++this.generation;
    const attemptId = randomUUID();
    this.state = { status: 'checking', attemptId };
    try {
      const gh = await this.executable();
      if (generation !== this.generation) return this.snapshot();
      const access = await this.access(gh);
      if (generation !== this.generation) return this.snapshot();
      if (access.status === 'error' || access.reason === 'sso') {
        this.state = { ...access, attemptId };
        return this.snapshot();
      }
      if (!force && access.status === 'ready') {
        this.state = { ...access, attemptId };
        return this.snapshot();
      }
      if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) {
        this.state = {
          status: 'permission-required',
          attemptId,
          reason: 'token-override',
          message:
            'An environment token overrides GitHub CLI login. Remove GH_TOKEN/GITHUB_TOKEN from Kalkidan’s environment and try again, or grant Projects access to that token.',
        };
        return this.snapshot();
      }
      const loggedIn = access.status === 'ready' || access.status === 'permission-required';
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
      this.state = { status: 'waiting', attemptId };
      let output = '';
      const receive = (chunk: Buffer) => {
        if (generation !== this.generation || this.state.status !== 'waiting') return;
        output = (output + chunk.toString()).slice(-8192);
        const code = deviceCode(output);
        if (code && !this.state.code) {
          this.state = { status: 'waiting', attemptId, code };
          void this.openBrowser().catch(() => {
            if (generation === this.generation && this.state.status === 'waiting')
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
      child.on('error', (error: NodeJS.ErrnoException) => {
        if (generation !== this.generation) return;
        clearTimeout(this.timer);
        this.child = undefined;
        this.state = { ...failure(error), attemptId };
      });
      child.on('close', (code) => {
        if (generation !== this.generation || this.state.status !== 'waiting') return;
        clearTimeout(this.timer);
        this.child = undefined;
        if (code !== 0) {
          this.state = {
            status: 'error',
            attemptId,
            message: 'GitHub authorization was declined, expired, or interrupted. Try again.',
          };
          return;
        }
        this.state = { status: 'verifying', attemptId };
        // A successful device flow does not prove that the requested scope was granted.
        void this.access(gh).then((state) => {
          if (generation === this.generation) this.state = { ...state, attemptId };
        });
      });
      this.timer = setTimeout(
        () => {
          if (generation !== this.generation) return;
          this.cancel(attemptId);
          this.state = {
            status: 'expired',
            attemptId,
            message: 'GitHub authorization timed out. Try again for a new code.',
          };
        },
        10 * 60 * 1000,
      );
      this.timer.unref();
      child.stdin.end('\n');
    } catch (error) {
      if (generation === this.generation) {
        this.cancel(attemptId);
        this.state = { ...failure(error), attemptId };
      }
    }
    return this.snapshot();
  }
  /** An IPC cancel must identify the attempt. No ID is reserved for application shutdown. */
  cancel(attemptId?: string) {
    if (attemptId !== undefined && (!attemptId || attemptId !== this.state.attemptId))
      return this.snapshot();
    ++this.generation;
    clearTimeout(this.timer);
    this.child?.kill('SIGTERM');
    this.child = undefined;
    this.inspection = undefined;
    this.state = attemptId === undefined ? { status: 'idle' } : { status: 'canceled', attemptId };
    return this.snapshot();
  }
}
