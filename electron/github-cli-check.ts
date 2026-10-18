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
    return { status: 'ready', path: binary.path };
  } catch (error) {
    return {
      status: (error as { code?: unknown }).code === 1 ? 'signed-out' : 'error',
      path: binary.path,
    };
  }
}
