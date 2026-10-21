import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { DesktopProtocolError } from './protocol';

const limit = 65536;
/** Qualified native platforms for managed Claude subscription access. */
const qualified = new Set(['darwin:arm64', 'linux:x64']);
/** The owned child must stop before this margin. A new launch then needs a fresh login. */
export const claudeAccessMargin = 30000;

export interface NativeClaudeAccess {
  /** Short-lived access token. Put it only in the owned native child environment. */
  token: string;
  expiresAt: number;
}
export interface NativeClaudeAccessOptions {
  platform?: string;
  arch?: string;
  now?: () => number;
  uid?: number;
  home?: string;
  account?: string;
  environment?: NodeJS.ProcessEnv;
  readMacSecret?(account: string): Promise<Buffer>;
  readLinuxSecret?(home: string, uid: number | undefined): Promise<Buffer>;
}

function macSecret(account: string) {
  return new Promise<Buffer>((resolve, reject) => {
    execFile(
      '/usr/bin/security',
      ['find-generic-password', '-a', account, '-w', '-s', 'Claude Code-credentials'],
      // The system can ask the user to allow keychain access, so allow time for that answer.
      { timeout: 60000, maxBuffer: limit, encoding: 'buffer', env: { PATH: '/usr/bin:/bin' } },
      (error, stdout) => {
        if (error) {
          stdout?.fill(0);
          reject(new DesktopProtocolError('desktop.secure_storage_unavailable'));
        } else resolve(stdout);
      },
    );
  });
}

/** Pinned Claude Code 2.1.304 file layout. Unsafe ownership or permissions fail closed. */
async function linuxSecret(home: string, uid: number | undefined) {
  const directory = join(home, '.claude');
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== uid || info.mode & 0o022)
    throw new DesktopProtocolError('desktop.secure_storage_unavailable');
  const file = await open(
    join(directory, '.credentials.json'),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      stat.uid !== uid ||
      stat.mode & 0o077 ||
      stat.size > limit ||
      stat.nlink !== 1
    )
      throw new DesktopProtocolError('desktop.secure_storage_unavailable');
    const buffer = Buffer.alloc(limit + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > limit) {
      buffer.fill(0);
      throw new DesktopProtocolError('desktop.secure_storage_unavailable');
    }
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

/**
 * Reads only this execution host's existing Claude Code login. On SSH this code runs on the
 * remote host, so a Mac login never leaves the Mac. The refresh token is never read out or
 * copied. Native `/login` owns renewal. Call this only from the trusted host-local launcher.
 */
export async function readNativeClaudeAccess(
  options: NativeClaudeAccessOptions = {},
): Promise<NativeClaudeAccess> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const now = options.now ?? Date.now;
  const home = options.home ?? homedir();
  const account = options.account ?? userInfo().username;
  if (!qualified.has(`${platform}:${arch}`))
    throw new DesktopProtocolError('desktop.claude_subscription_unsupported');
  if (!/^[A-Za-z0-9._-]+$/.test(account) || !home.startsWith('/'))
    throw new DesktopProtocolError('desktop.claude_subscription_unsupported');
  // Read only the default production profile. Never guess another native profile.
  const environment = options.environment ?? process.env;
  if (environment.CLAUDE_CONFIG_DIR || environment.CLAUDE_SECURESTORAGE_CONFIG_DIR)
    throw new DesktopProtocolError('desktop.claude_subscription_native_profile_unsupported');
  let bytes: Buffer | undefined;
  try {
    bytes =
      platform === 'darwin'
        ? await (options.readMacSecret ?? macSecret)(account)
        : await (options.readLinuxSecret ?? linuxSecret)(home, options.uid ?? process.getuid?.());
    if (!Buffer.isBuffer(bytes) || bytes.length > limit) throw new Error('invalid');
    const parsed = JSON.parse(bytes.toString('utf8'));
    const oauth = parsed?.claudeAiOauth;
    const remaining = Number.isSafeInteger(oauth?.expiresAt) ? oauth.expiresAt - now() : NaN;
    if (
      !oauth ||
      typeof oauth.accessToken !== 'string' ||
      !/^[A-Za-z0-9._~+/=-]{12,16384}$/.test(oauth.accessToken) ||
      !(remaining >= 60000 && remaining <= 86400000) ||
      !Array.isArray(oauth.scopes) ||
      !oauth.scopes.includes('user:inference') ||
      !oauth.scopes.includes('user:profile')
    )
      throw new Error('invalid');
    const access = { token: oauth.accessToken as string, expiresAt: oauth.expiresAt as number };
    // Do not keep the parsed object, refresh token, settings, or account metadata.
    for (const key of Object.keys(oauth)) delete oauth[key];
    for (const key of Object.keys(parsed)) delete parsed[key];
    return access;
  } catch {
    throw new DesktopProtocolError('desktop.claude_subscription_login_required');
  } finally {
    bytes?.fill(0);
  }
}
