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
          // 44 is errSecItemNotFound: Claude Code has no sign-in on this Mac.
          reject(
            new DesktopProtocolError(
              (error as { code?: unknown }).code === 44
                ? 'desktop.claude_subscription_login_required'
                : 'desktop.secure_storage_unavailable',
            ),
          );
        } else resolve(stdout);
      },
    );
  });
}

const unsupported = 'desktop.claude_subscription_credential_format_unsupported';
const loginRequired = 'desktop.claude_subscription_login_required';
const missing = (error: unknown) => (error as { code?: unknown })?.code === 'ENOENT';

/**
 * The Linux file layout of Claude Code 2.1.300 and later: `~/.claude/.credentials.json`. A
 * missing file means no sign-in. Unsafe ownership, permissions, or links fail closed.
 */
async function linuxSecret(home: string, uid: number | undefined) {
  const directory = join(home, '.claude');
  const info = await lstat(directory).catch((error) => {
    throw new DesktopProtocolError(missing(error) ? loginRequired : unsupported);
  });
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== uid || info.mode & 0o022)
    throw new DesktopProtocolError(unsupported);
  const file = await open(
    join(directory, '.credentials.json'),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  ).catch((error) => {
    throw new DesktopProtocolError(missing(error) ? loginRequired : unsupported);
  });
  try {
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      stat.uid !== uid ||
      stat.mode & 0o077 ||
      stat.size > limit ||
      stat.nlink !== 1
    )
      throw new DesktopProtocolError(unsupported);
    const buffer = Buffer.alloc(limit + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > limit) {
      buffer.fill(0);
      throw new DesktopProtocolError(unsupported);
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
    return recognizeCredentials(bytes, now());
  } catch (error) {
    // Pass on only the known safe codes. Any other failure means no usable sign-in.
    if (
      error instanceof DesktopProtocolError &&
      [unsupported, loginRequired, 'desktop.secure_storage_unavailable'].includes(error.code)
    )
      throw new DesktopProtocolError(error.code);
    throw new DesktopProtocolError(loginRequired);
  } finally {
    if (Buffer.isBuffer(bytes)) bytes.fill(0);
  }
}

/** True when the macOS Keychain has the Claude Code login item. It reads no secret. */
function macItemExists(account: string) {
  return new Promise<boolean>((resolve, reject) => {
    // Without `-w`, `security` reads only the attributes. The system does not ask for access.
    execFile(
      '/usr/bin/security',
      ['find-generic-password', '-a', account, '-s', 'Claude Code-credentials'],
      { timeout: 10000, maxBuffer: limit, env: { PATH: '/usr/bin:/bin' } },
      (error) => {
        if (!error) resolve(true);
        else if ((error as { code?: unknown }).code === 44) resolve(false);
        else reject(new DesktopProtocolError('desktop.secure_storage_unavailable'));
      },
    );
  });
}

/**
 * Checks before a launch that this host has a Claude Code subscription login, without the
 * token where possible. On macOS it checks only that the Keychain item exists, so the system
 * does not ask for access. On Linux it reads the file and drops the token. The launch reads the
 * token again, last, and checks its expiry.
 */
export async function checkNativeClaudeLogin(
  options: NativeClaudeAccessOptions & { macItemExists?(account: string): Promise<boolean> } = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin') {
    await readNativeClaudeAccess(options);
    return;
  }
  const arch = options.arch ?? process.arch;
  const account = options.account ?? userInfo().username;
  const environment = options.environment ?? process.env;
  if (!qualified.has(`${platform}:${arch}`) || !/^[A-Za-z0-9._-]+$/.test(account))
    throw new DesktopProtocolError('desktop.claude_subscription_unsupported');
  if (environment.CLAUDE_CONFIG_DIR || environment.CLAUDE_SECURESTORAGE_CONFIG_DIR)
    throw new DesktopProtocolError('desktop.claude_subscription_native_profile_unsupported');
  if (!(await (options.macItemExists ?? macItemExists)(account)))
    throw new DesktopProtocolError(loginRequired);
}

/** Thrown for a credential layout that Kalkidan does not know. */
const format = () => new DesktopProtocolError(unsupported);

/**
 * Recognizes the Claude Code credential layout by its structure, not by the Claude Code version.
 * Claude Code 2.1.300 and later store the same JSON in the macOS Keychain item
 * `Claude Code-credentials` and in the Linux file:
 * `{"claudeAiOauth":{"accessToken","refreshToken","expiresAt","scopes",...},...}`.
 * `expiresAt` is in milliseconds. `security -w` prints hexadecimal for data that is not plain
 * text, so hexadecimal JSON is also accepted. A signed-out layout needs a new sign-in. A layout
 * with unknown types fails closed with the unsupported format code.
 */
function recognizeCredentials(bytes: unknown, now: number): NativeClaudeAccess {
  if (!Buffer.isBuffer(bytes) || bytes.length > limit) throw format();
  let text = bytes.toString('utf8').trim();
  let decoded: Buffer | undefined;
  if (/^(?:[0-9a-fA-F]{2})+$/.test(text)) {
    decoded = Buffer.from(text, 'hex');
    text = decoded.toString('utf8').trim();
  }
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw format();
  } finally {
    decoded?.fill(0);
  }
  try {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw format();
    const oauth = parsed.claudeAiOauth;
    // No Claude.ai sign-in. The file can still hold other data, for example MCP sign-ins.
    if (oauth === undefined || oauth === null) throw new DesktopProtocolError(loginRequired);
    if (
      typeof oauth !== 'object' ||
      Array.isArray(oauth) ||
      typeof oauth.accessToken !== 'string' ||
      !Number.isSafeInteger(oauth.expiresAt) ||
      oauth.expiresAt < 0 ||
      !Array.isArray(oauth.scopes) ||
      !oauth.scopes.every((scope: unknown) => typeof scope === 'string')
    )
      throw format();
    // Claude Code clears a token that its server refused: empty token, expiry zero.
    if (oauth.accessToken === '' || oauth.expiresAt === 0)
      throw new DesktopProtocolError(loginRequired);
    // An expiry in seconds is not the known layout.
    if (oauth.expiresAt < 1e11 || !/^[A-Za-z0-9._~+/=-]{12,16384}$/.test(oauth.accessToken))
      throw format();
    const remaining = oauth.expiresAt - now;
    if (
      !(remaining >= 60000 && remaining <= 86400000) ||
      !oauth.scopes.includes('user:inference') ||
      !oauth.scopes.includes('user:profile')
    )
      throw new DesktopProtocolError(loginRequired);
    return { token: oauth.accessToken as string, expiresAt: oauth.expiresAt as number };
  } finally {
    // Do not keep the parsed object, refresh token, settings, or account metadata.
    if (parsed && typeof parsed === 'object') {
      const oauth = parsed.claudeAiOauth;
      if (oauth && typeof oauth === 'object')
        for (const key of Object.keys(oauth)) delete oauth[key];
      for (const key of Object.keys(parsed)) delete parsed[key];
    }
  }
}
