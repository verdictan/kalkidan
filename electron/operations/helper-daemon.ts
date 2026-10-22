import { chmod, lstat, mkdir, rm } from 'node:fs/promises';
import { connect, type Server, type Socket } from 'node:net';
import { join } from 'node:path';

/** The time that an idle helper waits for a new connection before it stops. */
export const helperIdleMs = 60 * 1000;
/**
 * The longest life of a runtime credential of a host (900 seconds in the Verdictan runtime
 * contract). Only an app can revoke a runtime, so a helper waits this long for an app.
 */
export const releaseWaitMs = 15 * 60 * 1000;

/** What the helper does next. */
export type HelperDecision = 'keep' | 'exit';

/**
 * The next step of a helper. A helper with a connected app, or with work, continues. Work is a
 * run, a terminal or a PTY: they continue without an app until they end or the user closes
 * them. There is no time limit. A runtime of a run that ended is released on the host at once,
 * but only an app can revoke it, so the helper waits up to `releaseWaitMs` for an app. A helper
 * with no work stops after `idle`. `idleSince` is the last time that the helper had an app or
 * work.
 */
export function helperDecision(input: {
  attached: boolean;
  busy: number;
  releasing: number;
  idleSince: number;
  now: number;
  idle?: number;
}): HelperDecision {
  if (input.attached || input.busy > 0) return 'keep';
  const idle = input.now - input.idleSince;
  if (input.releasing > 0 && idle < releaseWaitMs) return 'keep';
  return idle >= (input.idle ?? helperIdleMs) ? 'exit' : 'keep';
}

/**
 * The socket of the helper of one installed version. It is in the home folder of the user, so
 * the helpers of two users on one host never share a socket. Each version has its own helper, so
 * an update never connects the app to an old helper.
 */
export function helperSocketPath(home: string, version: string) {
  const name = /^[a-f0-9]{20}$/.test(version) ? version : 'development';
  return join(home, '.kalkidan', 'run', `helper-${name}.sock`);
}

/**
 * Makes the private folder of the helper socket. Only the user can open it. A folder that a
 * different user owns, or a link, is an error: then the helper does not start.
 */
export async function prepareHelperDirectory(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error('The helper folder is not a folder.');
  if (typeof process.getuid === 'function' && info.uid !== process.getuid())
    throw new Error('A different user owns the helper folder.');
  if ((info.mode & 0o077) !== 0) await chmod(directory, 0o700);
}

/** Connects to a running helper. Gives undefined when no helper listens. */
export function connectHelper(path: string): Promise<Socket | undefined> {
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    socket.once('connect', () => {
      socket.removeAllListeners('error');
      resolve(socket);
    });
    socket.once('error', (error: NodeJS.ErrnoException) => {
      socket.destroy();
      if (['ENOENT', 'ECONNREFUSED'].includes(error.code || '')) resolve(undefined);
      else reject(error);
    });
  });
}

/**
 * Starts to listen on the helper socket. A socket file of a helper that stopped is removed. When
 * a different helper listens already, the result is false: then this helper must stop, so that
 * each run has one owner.
 */
export async function listenHelper(server: Server, path: string): Promise<boolean> {
  const listen = () =>
    new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => {
        server.removeListener('listening', listening);
        reject(error);
      };
      const listening = () => {
        server.removeListener('error', failed);
        resolve();
      };
      server.once('error', failed);
      server.once('listening', listening);
      server.listen(path);
    });
  try {
    await listen();
    return true;
  } catch (error: any) {
    if (error?.code !== 'EADDRINUSE') throw error;
  }
  const other = await connectHelper(path);
  if (other) {
    other.destroy();
    return false;
  }
  await rm(path, { force: true });
  await listen();
  return true;
}
