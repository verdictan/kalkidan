import { agentLabel, isAgent } from '../config/agents';
import { checkAgentVersion, nativeAgentKind } from './agent-version';
import type { AgentCandidate, AgentInstallation } from './conversation';

/**
 * The element ID of one computer in Settings › Agents. No host ID means this computer, which
 * keeps the older `settings-agents` ID of the section.
 */
export function agentComputerAnchor(hostId?: string) {
  return hostId ? `agent-computer-${hostId}` : 'settings-agents';
}

/** The element ID of one agent program on one computer in Settings › Agents. */
export function agentProgramAnchor(agent: string, hostId?: string) {
  return `agent-program-${hostId || 'local'}-${agent}`;
}

/** "Choose the Claude Code program". */
export function chooseProgramLabel(agent: string) {
  return `Choose the ${agentLabel(agent)} program`;
}

/** A path that can show: absolute, without control characters, not too long. */
export function safeProgramPath(value: unknown): string | undefined {
  return typeof value === 'string' &&
    value.length <= 4096 &&
    (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) &&
    // oxlint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
    ? value
    : undefined;
}

const safeVersion = (value: unknown) =>
  typeof value === 'string' && /^[0-9][0-9A-Za-z.+-]{0,63}$/.test(value) ? value : undefined;

function candidate(value: unknown): AgentCandidate | undefined {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const path = safeProgramPath(record.path);
  if (!path) return undefined;
  const version = safeVersion(record.version);
  return version ? { path, version } : { path };
}

/**
 * Keeps only the known fields of an agent check from an SSH host. A field that is not valid is
 * removed. An agent that is not known is removed.
 */
export function sanitizeAgentInstallations(value: unknown): AgentInstallation[] {
  if (!Array.isArray(value)) return [];
  const result: AgentInstallation[] = [];
  for (const raw of value.slice(0, 8)) {
    const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    if (!isAgent(record.agent) || result.some((item) => item.agent === record.agent)) continue;
    const status = ['installed', 'missing', 'unavailable'].includes(record.status as string)
      ? (record.status as AgentInstallation['status'])
      : 'missing';
    const item: AgentInstallation = { agent: record.agent, status };
    const path = safeProgramPath(record.path);
    if (path) item.path = path;
    const version = safeVersion(record.version);
    if (version) item.version = version;
    if (['automatic', 'chosen', 'environment'].includes(record.source as string))
      item.source = record.source as AgentInstallation['source'];
    const chosenPath = safeProgramPath(record.chosenPath);
    if (chosenPath) item.chosenPath = chosenPath;
    if (Array.isArray(record.candidates))
      item.candidates = record.candidates
        .slice(0, 8)
        .map(candidate)
        .filter((entry): entry is AgentCandidate => !!entry);
    result.push(item);
  }
  return result;
}

export interface AgentProgramStatus {
  /** The short status: "Meets the minimum", "Update required: needs 2.1.300 or later". */
  label: string;
  /** True when the program can run managed launches. */
  ready: boolean;
}

/** The status of the program of one agent on one computer. */
export function agentProgramStatus(
  installation: AgentInstallation | undefined,
): AgentProgramStatus {
  if (!installation) return { label: 'Not checked', ready: false };
  if (installation.status === 'unavailable') return { label: 'Desktop only', ready: false };
  if (installation.status !== 'installed')
    return {
      label:
        installation.source === 'chosen' || installation.source === 'environment'
          ? 'Chosen program not found'
          : 'Not found',
      ready: false,
    };
  const kind = nativeAgentKind(installation.agent);
  if (!kind) return { label: 'Installed', ready: true };
  const check = checkAgentVersion(kind, installation.version);
  if (check.status === 'supported') return { label: 'Meets the minimum', ready: true };
  if (check.status === 'outdated')
    return { label: `Update required: needs ${check.minimum} or later`, ready: false };
  return { label: 'Version not known', ready: false };
}
