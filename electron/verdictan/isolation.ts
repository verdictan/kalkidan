import { linuxIsolation } from './linux-isolation';
import { realpath, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ManagedLaunchRequest } from '../agents/managed-launch';
import { DesktopProtocolError } from './protocol';

const exec = promisify(execFile);
const pathWithin = (root: string, path: string) => path === root || path.startsWith(root + '/');
export function sandboxProfile(
  cwd: string,
  home: string,
  temporary: string,
  executablePaths: string[],
  ports: number[],
  userHome: string,
  allowEdits = true,
) {
  if (
    ![cwd, home, temporary, userHome, ...executablePaths].every(
      (p) => isAbsolute(p) && !/[\0\r\n]/.test(p),
    ) ||
    pathWithin(cwd, userHome) ||
    !ports.length ||
    ports.some((p) => !Number.isInteger(p) || p < 1 || p > 65535)
  )
    throw new DesktopProtocolError('desktop.isolation_scope_invalid');
  const q = JSON.stringify;
  return `(version 1)
(allow default)
(deny network*)
${[...new Set(ports)].map((p) => `(allow network-outbound (remote ip "localhost:${p}"))`).join('\n')}
(deny mach-lookup)
(allow mach-lookup (global-name "com.apple.cfprefsd.daemon") (global-name "com.apple.cfprefsd.agent"))
(deny file-read* file-write* (subpath ${q(userHome)}) (subpath "/Users") (subpath "/Volumes") (subpath "/private/tmp") (subpath "/private/var/folders"))
(allow file-read-metadata)
${[home, temporary].map((p) => `(allow file-read* file-write* (subpath ${q(p)}))`).join('\n')}
${allowEdits ? `(allow file-read* file-write* (subpath ${q(cwd)}))` : `(deny file-write* (subpath ${q(cwd)}))\n(allow file-read* (subpath ${q(cwd)}))`}
${executablePaths.map((p) => `(allow file-read* (literal ${q(p)}))`).join('\n')}
`;
}
export function assertIsolationPlatform(platform = process.platform) {
  if (!['darwin', 'linux'].includes(platform))
    throw new DesktopProtocolError('desktop.process_isolation_unavailable');
}
export async function prepareIsolation(
  request: ManagedLaunchRequest,
  home: string,
  address: string,
) {
  assertIsolationPlatform();
  const gateway = new URL(address);
  if (gateway.protocol !== 'http:' || gateway.hostname !== '127.0.0.1')
    throw new DesktopProtocolError('desktop.loopback_required');
  const ports = [Number(gateway.port)];
  if (request.memoryURL) {
    const memory = new URL(request.memoryURL);
    if (memory.protocol !== 'http:' || memory.hostname !== '127.0.0.1')
      throw new DesktopProtocolError('desktop.loopback_required');
    ports.push(Number(memory.port));
  }
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'kalkidan-agent-')));
  let release: (() => Promise<void>) | undefined;
  try {
    const executable = await realpath(request.executable.path);
    const extraPaths = await Promise.all(
      (request.executable.args || []).filter(isAbsolute).map((p) => realpath(p)),
    );
    const profile = sandboxProfile(
      await realpath(request.session.cwd),
      home,
      temporary,
      [executable, ...extraPaths],
      ports,
      await realpath(homedir()),
      request.allowEdits === true,
    );
    const env: NodeJS.ProcessEnv = {
      HOME: home,
      CODEX_HOME: home,
      CLAUDE_CONFIG_DIR: home,
      TMPDIR: temporary,
      CLAUDE_CODE_TMPDIR: temporary,
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      LANG: 'en_US.UTF-8',
      TERM: 'dumb',
      CLAUDE_CODE_MAX_RETRIES: '0',
      CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK: '1',
    };
    let launcher = '/usr/bin/sandbox-exec';
    let prefix = ['-p', profile, executable, ...(request.executable.args || [])];
    if (process.platform === 'linux') {
      const isolated = await linuxIsolation(
        await realpath(request.session.cwd),
        home,
        temporary,
        [executable, ...extraPaths],
        ports,
        request.allowEdits === true,
      );
      launcher = isolated.executable;
      prefix = [...isolated.prefix, executable, ...(request.executable.args || [])];
      release = isolated.close;
    }
    const { stdout } = await exec(launcher, [...prefix, '--version'], {
      env,
      cwd: request.session.cwd,
      timeout: 10000,
      maxBuffer: 8192,
      signal: request.signal,
    });
    const match =
      /^(?:codex(?:-cli)?\s+)?(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)(?:\s+\(Claude Code\))?\s*$/.exec(
        stdout.trim(),
      );
    if (!match) throw new DesktopProtocolError('desktop.agent_version_unsupported');
    return {
      executable: launcher,
      prefix,
      env,
      version: match[1],
      close: async () => {
        await release?.();
        await rm(temporary, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await release?.();
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
