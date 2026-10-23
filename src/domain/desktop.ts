import type { Agent } from './conversation';

/**
 * Desktop contracts of round 11: project windows, tool detection and subagent sessions.
 * The main process, the preload bridge and the demo use these types.
 */

/** The scope of one window. A project window shows only the tree of its project. */
export type WindowScope = { kind: 'main' } | { kind: 'project'; groupId: string };

/** The query parameter that gives a project window its project. */
export const projectWindowParameter = 'project';

/** Reads the scope from the query of the window address, for example `?project=g1`. */
export function parseWindowScope(search: string): WindowScope {
  const groupId = new URLSearchParams(search).get(projectWindowParameter)?.trim();
  return groupId && groupId.length <= 200 ? { kind: 'project', groupId } : { kind: 'main' };
}

/** The address query of a project window. */
export function projectWindowQuery(groupId: string) {
  return '?' + new URLSearchParams({ [projectWindowParameter]: groupId }).toString();
}

/** The tools that Kalkidan detects. Kalkidan never installs, updates or signs in to them. */
export type ToolId = 'claude' | 'codex' | 'gh';
export const toolIds: readonly ToolId[] = ['claude', 'codex', 'gh'];

export const toolNames: Record<ToolId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  gh: 'GitHub CLI',
};

/** The official install pages. Kalkidan only links to them. */
export const toolInstallUrls: Record<ToolId, string> = {
  claude: 'https://docs.anthropic.com/en/docs/claude-code',
  codex: 'https://github.com/openai/codex',
  gh: 'https://cli.github.com',
};

/**
 * The state of one tool on one computer.
 * - `ready`: installed, and nothing that Kalkidan can see stops it.
 * - `missing`: not found on the PATH or in the common install folders.
 * - `signed-out`: installed, but its CLI says that nobody is signed in.
 * - `no-access`: GitHub CLI is signed in, but its token has no `repo` access.
 * - `error`: found, but it did not run (for example, no version).
 */
export type ToolState = 'ready' | 'missing' | 'signed-out' | 'no-access' | 'error';

export interface ToolStatus {
  tool: ToolId;
  /** "Claude Code", "Codex" or "GitHub CLI". */
  name: string;
  kind: 'agent' | 'github';
  state: ToolState;
  installed: boolean;
  /** The program that Kalkidan uses. Only when installed. */
  path?: string;
  /** The version that the program reports, for example "2.0.14". */
  version?: string;
  /** `unknown` when the CLI does not tell. */
  signedIn: 'yes' | 'no' | 'unknown';
  /** The GitHub login of the GitHub CLI account. Only for `gh`, only when signed in. */
  account?: string;
  /**
   * GitHub CLI: `granted` when the token has the `repo` scope. Agents: `granted` when the
   * Verdictan gateway can run chats for the signed-in account, else `unknown`.
   */
  access: 'granted' | 'missing' | 'unknown';
  /** True when a chat can start with this agent. Always false for `gh`. */
  usable: boolean;
  installUrl: string;
}

/** The tools of one computer: this computer (`local`) or an SSH host (its host ID). */
export interface ComputerTools {
  computer: 'local' | string;
  /** "This Mac", "This computer" or the name of the SSH host. */
  name: string;
  /** False for an SSH host that is not connected. `tools` is then empty. */
  connected: boolean;
  tools: ToolStatus[];
  /** ISO time of the check. */
  checkedAt: string;
}

/** One entry of the agent picker. */
export interface AgentChoice {
  agent: Agent;
  name: string;
  /** True when the agent is installed and a chat can start with it. */
  available: boolean;
  version?: string;
  /** The official page, for "Not installed ↗". */
  installUrl: string;
}

/**
 * The agents of a computer for the agent picker, Claude Code first. An agent that is not found
 * stays in the list with `available: false`, so the picker can show "Not installed ↗".
 */
export function agentChoices(computer: ComputerTools | undefined): AgentChoice[] {
  return (['claude', 'codex'] as const).map((agent) => {
    const tool = computer?.tools.find((item) => item.tool === agent);
    return {
      agent,
      name: toolNames[agent],
      available: !!tool?.usable,
      ...(tool?.version ? { version: tool.version } : {}),
      installUrl: toolInstallUrls[agent],
    };
  });
}

/** True when at least one agent can start a chat on this computer. */
export function hasUsableAgent(computer: ComputerTools | undefined) {
  return !!computer?.tools.some((tool) => tool.kind === 'agent' && tool.usable);
}

/** True when a tool is not ready. The first-run tools check shows only then. */
export function toolsNeedAttention(computer: ComputerTools | undefined) {
  return !computer || computer.tools.some((tool) => tool.state !== 'ready');
}

/**
 * The detail line of a tool row, for example "2.0.14 · Signed in" or
 * "2.62.0 · Signed in as dana-kim · repo access".
 */
export function toolDetail(tool: ToolStatus) {
  if (!tool.installed) return 'Not installed';
  const parts = [tool.version || 'Version unknown'];
  if (tool.state === 'error') parts.push('Does not run');
  else if (tool.signedIn === 'yes')
    parts.push(tool.account ? `Signed in as ${tool.account}` : 'Signed in');
  else if (tool.signedIn === 'no') parts.push('Not signed in');
  if (tool.kind === 'github' && tool.signedIn === 'yes')
    parts.push(
      tool.access === 'granted' ? 'repo access' : tool.access === 'missing' ? 'No repo access' : '',
    );
  return parts.filter(Boolean).join(' · ');
}

/** The state of the managed gateway runtime. It is never a user task. */
export interface GatewayRuntimeState {
  /**
   * `ready`: installed. `working`: an automatic install or repair runs. `failed`: the last
   * automatic install failed; `message` says what the user can do. `unknown`: not checked yet.
   */
  state: 'ready' | 'working' | 'failed' | 'unknown';
  /** Plain words. Only with `failed`. */
  message?: string;
}

/** One child run of a session: a Claude Code Task subagent or a Codex sub-agent thread. */
export interface SubagentSession {
  /** Stable within its session: the Claude agent ID or tool use ID, or the Codex thread ID. */
  id: string;
  /** The task description, for example "Explore auth module". */
  title: string;
  status: 'running' | 'done' | 'failed' | 'stopped';
  /** The subagent type, for example "Explore", when the agent tells. */
  type?: string;
  /** ISO time of the last activity, when known. */
  updatedAt?: string;
  /** Live runs only: what the subagent does now, for example "Using Bash". */
  activity?: string;
}

export interface DesktopAPI {
  /**
   * Opens the project in its own window, or focuses that window when it is open. The window
   * loads the app with `?project=<groupId>`.
   */
  openProjectWindow?(groupId: string): Promise<void>;
  /** The projects that have their own window now. */
  projectWindows?(): Promise<string[]>;
  /** Sends the project IDs that have their own window each time a window opens or closes. */
  onProjectWindowsChange?(callback: (groupIds: string[]) => void): () => void;
  /**
   * The tools of this computer and of each saved SSH host. Results stay for 5 minutes;
   * `fresh` checks again ("Check again").
   */
  computerTools?(options?: { fresh?: boolean }): Promise<ComputerTools[]>;
  /** The tools of one computer: `local` or an SSH host ID. */
  toolStatus?(computer?: string, options?: { fresh?: boolean }): Promise<ComputerTools>;
  /** Sent after each new check of a computer. */
  onToolsChange?(callback: (computer: ComputerTools) => void): () => void;
  /** Restarts Kalkidan, so it finds tools that the user installed. */
  restartApp?(): Promise<void>;
  /** The managed gateway runtime. It installs and repairs itself after sign-in. */
  gatewayRuntime?(): Promise<GatewayRuntimeState>;
  /** Tries the automatic install again after a failure. */
  gatewayRuntimeRetry?(): Promise<GatewayRuntimeState>;
}
