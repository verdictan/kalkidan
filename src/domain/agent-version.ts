/**
 * The minimum native agent versions for Kalkidan. Kalkidan owns this rule. Verdictan does not
 * pin native agent versions, and its `tested_agents` list is information only.
 *
 * A prerelease counts by its numeric core: `0.163.0-alpha.10.2` is `0.163.0`.
 */
export type NativeAgentKind = 'codex' | 'claude_code';

export const agentMinimumVersions: Readonly<Record<NativeAgentKind, string>> = {
  codex: '0.160.0',
  claude_code: '2.1.300',
};
export const nativeAgentNames: Readonly<Record<NativeAgentKind, string>> = {
  codex: 'Codex',
  claude_code: 'Claude Code',
};

/** The native kind for an agent ID (`codex`, `claude`) or a native kind. */
export function nativeAgentKind(agent: unknown): NativeAgentKind | undefined {
  if (agent === 'codex') return 'codex';
  if (agent === 'claude' || agent === 'claude_code') return 'claude_code';
  return undefined;
}

// Each part has at most 9 digits, so the number is always a safe integer.
const version = String.raw`\d{1,9}\.\d{1,9}\.\d{1,9}(?:-[0-9A-Za-z.-]{1,64})?`;
// Codex prints `codex-cli 0.163.0-alpha.10.2`. Claude Code prints `2.1.306 (Claude Code)`.
const codexLine = new RegExp(String.raw`^(?:(?:codex-cli|codex)\s+)?v?(${version})$`, 'i');
const claudeLine = new RegExp(
  String.raw`^(?:claude(?:-code)?\s+)?v?(${version})(?:\s+\(Claude Code\))?$`,
  'i',
);

/**
 * Reads the version from the `--version` output of a native agent. Returns undefined when the
 * output has no known version line. With `kind`, the output of a different agent is refused.
 */
export function parseAgentVersion(output: unknown, kind?: NativeAgentKind): string | undefined {
  if (typeof output !== 'string' || output.length > 8192) return undefined;
  const patterns = kind ? [kind === 'codex' ? codexLine : claudeLine] : [codexLine, claudeLine];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    for (const pattern of patterns) {
      const match = pattern.exec(line);
      if (match) return match[1];
    }
  }
  return undefined;
}

function core(value: unknown): [number, number, number] | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-[0-9A-Za-z.-]{1,64})?$/.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

/** Compares the numeric cores. Returns undefined when a version is not valid. */
export function compareVersionCores(a: unknown, b: unknown): number | undefined {
  const left = core(a);
  const right = core(b);
  if (!left || !right) return undefined;
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  return 0;
}

export type AgentVersionStatus = 'supported' | 'outdated' | 'unknown';
export interface AgentVersionCheck {
  kind: NativeAgentKind;
  minimum: string;
  version?: string;
  status: AgentVersionStatus;
}

/** Checks one installed version against the minimum. A version that is not valid is unknown. */
export function checkAgentVersion(kind: NativeAgentKind, value: unknown): AgentVersionCheck {
  const minimum = agentMinimumVersions[kind];
  const order = compareVersionCores(value, minimum);
  if (order === undefined) return { kind, minimum, status: 'unknown' };
  return {
    kind,
    minimum,
    version: value as string,
    status: order >= 0 ? 'supported' : 'outdated',
  };
}

/** True only when the version is valid and at least the minimum. */
export function meetsAgentMinimum(kind: NativeAgentKind, value: unknown) {
  return checkAgentVersion(kind, value).status === 'supported';
}

/** The managed error code that refuses a launch, or undefined when the version is supported. */
export function agentVersionErrorCode(check: AgentVersionCheck) {
  if (check.status === 'supported') return undefined;
  return `desktop.${check.kind}_version_${check.status === 'outdated' ? 'unsupported' : 'unknown'}`;
}

/** "Kalkidan needs Claude Code 2.1.300 or later. Update Claude Code, then try again." */
export function agentVersionRequirement(kind: NativeAgentKind) {
  const name = nativeAgentNames[kind];
  return `Kalkidan needs ${name} ${agentMinimumVersions[kind]} or later. Update ${name}, then try again.`;
}

/** The short status for Settings › Agents. */
export function agentVersionLabel(check: AgentVersionCheck) {
  if (check.status === 'supported') return `Meets the minimum ${check.minimum}`;
  if (check.status === 'outdated') return 'Update required';
  return 'Version not known';
}
