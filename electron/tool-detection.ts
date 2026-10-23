import { execFile } from 'node:child_process';
import {
  toolIds,
  toolInstallUrls,
  toolNames,
  type ToolId,
  type ToolStatus,
} from '../src/domain/desktop';

/** A program that Kalkidan found. `args` go before the arguments of each command. */
export interface FoundProgram {
  path: string;
  env: NodeJS.ProcessEnv;
  args?: string[];
}

/** The result of one command. `code` is null when the program did not start or timed out. */
export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface ToolDetectionOptions {
  /** Finds the program of a tool. Undefined when it is not installed. */
  find(tool: ToolId): Promise<FoundProgram | undefined>;
  /** Runs a program. It never rejects. */
  run?(program: FoundProgram, args: string[]): Promise<CommandResult>;
  /**
   * The Claude Code sign-in from its own credentials, when its CLI does not tell. The default
   * gives `unknown`.
   */
  claudeLogin?(): Promise<ToolStatus['signedIn']>;
  /** True when the Verdictan gateway can run chats for the signed-in account. */
  gatewayReady?: boolean;
}

/** Runs a program with a time limit and a small output limit. It never rejects. */
export function runProgram(program: FoundProgram, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    try {
      execFile(
        program.path,
        [...(program.args || []), ...args],
        { env: program.env, timeout: 10000, maxBuffer: 65536, windowsHide: true },
        (error, stdout, stderr) => {
          const code = !error
            ? 0
            : typeof (error as { code?: unknown }).code === 'number'
              ? ((error as { code: number }).code as number)
              : null;
          resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
        },
      );
    } catch {
      resolve({ code: null, stdout: '', stderr: '' });
    }
  });
}

/** The first version number in the output of `--version`, for example "2.0.14". */
export function parseToolVersion(output: string) {
  return output.match(/\b(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.]+)?)\b/)?.[1];
}

/**
 * Reads `gh auth status`. The output can contain account details, so only the login and the
 * scope names leave this function, never the text.
 */
export function parseGitHubAuth(result: CommandResult): {
  signedIn: ToolStatus['signedIn'];
  account?: string;
  access: ToolStatus['access'];
} {
  const text = `${result.stdout}\n${result.stderr}`;
  if (result.code === 1 || /not logged in/i.test(text))
    return { signedIn: 'no', access: 'unknown' };
  if (result.code !== 0) return { signedIn: 'unknown', access: 'unknown' };
  const login = text.match(
    /Logged in to \S+ (?:account|as) ([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/,
  )?.[1];
  const scopes = text.match(/Token scopes:\s*(.*)/)?.[1];
  const names = scopes
    ? scopes
        .split(',')
        .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
    : undefined;
  return {
    signedIn: 'yes',
    ...(login ? { account: login } : {}),
    access: !names ? 'unknown' : names.includes('repo') ? 'granted' : 'missing',
  };
}

/** Reads `codex login status`. Codex prints "Logged in using …" or "Not logged in". */
export function parseCodexLogin(result: CommandResult): ToolStatus['signedIn'] {
  const text = `${result.stdout}\n${result.stderr}`;
  if (/not logged in|logged out/i.test(text)) return 'no';
  if (result.code === 0 && /logged in/i.test(text)) return 'yes';
  return 'unknown';
}

/** Checks one tool: installed, version, signed in, access. */
export async function detectTool(tool: ToolId, options: ToolDetectionOptions): Promise<ToolStatus> {
  const run = options.run ?? runProgram;
  const kind = tool === 'gh' ? 'github' : 'agent';
  const base = {
    tool,
    name: toolNames[tool],
    kind,
    installUrl: toolInstallUrls[tool],
  } as const;
  let program: FoundProgram | undefined;
  try {
    program = await options.find(tool);
  } catch {
    program = undefined;
  }
  if (!program)
    return {
      ...base,
      state: 'missing',
      installed: false,
      signedIn: 'unknown',
      access: 'unknown',
      usable: false,
    };
  const versionResult = await run(program, ['--version']);
  const version =
    versionResult.code === 0
      ? parseToolVersion(versionResult.stdout) || parseToolVersion(versionResult.stderr)
      : undefined;
  const found = { ...base, installed: true, path: program.path, ...(version ? { version } : {}) };
  if (!version)
    return {
      ...found,
      state: 'error',
      signedIn: 'unknown',
      access: 'unknown',
      usable: false,
    };
  if (tool === 'gh') {
    const auth = parseGitHubAuth(
      await run(program, ['auth', 'status', '--hostname', 'github.com']),
    );
    return {
      ...found,
      ...auth,
      state:
        auth.signedIn === 'no'
          ? 'signed-out'
          : auth.signedIn === 'unknown'
            ? 'error'
            : auth.access === 'missing'
              ? 'no-access'
              : 'ready',
      usable: false,
    };
  }
  const signedIn =
    tool === 'codex'
      ? parseCodexLogin(await run(program, ['login', 'status']))
      : await (options.claudeLogin?.() ?? Promise.resolve('unknown' as const)).catch(
          () => 'unknown' as const,
        );
  return {
    ...found,
    signedIn,
    access: options.gatewayReady ? 'granted' : 'unknown',
    // Chats go through the Verdictan gateway, so a missing CLI sign-in does not stop a chat.
    usable: true,
    state: signedIn === 'no' ? 'signed-out' : 'ready',
  };
}

/** Checks Claude Code, Codex and GitHub CLI, in that order. */
export function detectTools(options: ToolDetectionOptions): Promise<ToolStatus[]> {
  return Promise.all(toolIds.map((tool) => detectTool(tool, options)));
}

/** Sets agent access from the gateway state of the signed-in account. */
export function withGatewayAccess(tools: ToolStatus[], gatewayReady: boolean): ToolStatus[] {
  return tools.map((tool) =>
    tool.kind === 'agent' && tool.installed
      ? { ...tool, access: gatewayReady ? 'granted' : 'unknown' }
      : tool,
  );
}

/**
 * Keeps each check for a time, so many windows and pickers do not run the CLIs again. A
 * fresh read runs the check again. Two reads at the same time share one check.
 */
export class ToolStatusCache<T> {
  private entries = new Map<string, { at: number; value: Promise<T> }>();
  constructor(
    private maxAgeMs = 5 * 60_000,
    private now: () => number = Date.now,
  ) {}
  get(key: string, check: () => Promise<T>, fresh = false): Promise<T> {
    const entry = this.entries.get(key);
    if (entry && !fresh && this.now() - entry.at < this.maxAgeMs) return entry.value;
    const value = check();
    this.entries.set(key, { at: this.now(), value });
    // A failed check does not stay.
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    return value;
  }
  clear(key?: string) {
    if (key === undefined) this.entries.clear();
    else this.entries.delete(key);
  }
}

/**
 * The tool list from the agent check of an older SSH helper, which has no tool check. GitHub
 * CLI is then unknown.
 */
export function toolsFromInstallations(
  installations: { agent: string; status: string; path?: string; version?: string }[],
): ToolStatus[] {
  return toolIds.map((tool): ToolStatus => {
    const base = { tool, name: toolNames[tool], installUrl: toolInstallUrls[tool] };
    if (tool === 'gh')
      return {
        ...base,
        kind: 'github',
        state: 'error',
        installed: false,
        signedIn: 'unknown',
        access: 'unknown',
        usable: false,
      };
    const item = installations.find((entry) => entry.agent === tool);
    const installed = item?.status === 'installed';
    return {
      ...base,
      kind: 'agent',
      state: !installed ? 'missing' : item?.version ? 'ready' : 'error',
      installed,
      ...(installed && item?.path ? { path: item.path } : {}),
      ...(installed && item?.version ? { version: item.version } : {}),
      signedIn: 'unknown',
      access: 'unknown',
      usable: installed && !!item?.version,
    };
  });
}
