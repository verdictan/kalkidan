import { executable } from './chat';
import { exec } from './core';
import type { GitHubCliStatus } from '../src/domain/conversation';

export async function githubCliCheck(): Promise<GitHubCliStatus> {
  let binary: Awaited<ReturnType<typeof executable>>;
  try {
    binary = await executable('gh');
  } catch {
    return { status: 'missing' };
  }
  try {
    await exec(binary.path, ['--version'], { env: binary.env, timeout: 10000, maxBuffer: 65536 });
  } catch {
    return { status: 'error', path: binary.path };
  }
  try {
    // Never return stdout/stderr: authentication diagnostics may contain account or token details.
    await exec(binary.path, ['auth', 'status', '--hostname', 'github.com'], {
      env: binary.env,
      timeout: 15000,
      maxBuffer: 65536,
    });
  } catch (error) {
    return {
      status: (error as { code?: unknown }).code === 1 ? 'signed-out' : 'error',
      path: binary.path,
    };
  }
  const login = await githubLogin(binary);
  return { status: 'ready', path: binary.path, ...(login ? { login } : {}) };
}

/** The signed-in login stays this long. A check after it reads the login again. */
const loginCacheMs = 10 * 60_000;
let cachedLogin: { path: string; login?: string; at: number } | undefined;

/**
 * The GitHub login of the GitHub CLI account, for "Signed in as @login". Only a value with the
 * GitHub login format returns. A failed read gives nothing and never blocks the status.
 */
async function githubLogin(binary: { path: string; env?: NodeJS.ProcessEnv }) {
  if (cachedLogin?.path === binary.path && Date.now() - cachedLogin.at < loginCacheMs)
    return cachedLogin.login;
  let login: string | undefined;
  try {
    const { stdout } = await exec(binary.path, ['api', 'user', '--jq', '.login'], {
      env: binary.env,
      timeout: 15000,
      maxBuffer: 65536,
    });
    const value = String(stdout ?? '').trim();
    login = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(value) ? value : undefined;
  } catch {
    login = undefined;
  }
  cachedLogin = { path: binary.path, login, at: Date.now() };
  return login;
}
