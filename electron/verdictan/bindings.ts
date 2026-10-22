import { mkdir, readFile, lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { writeJSON } from '../storage/atomic-json';
import {
  providerAccessModes,
  type ProviderAccessMode,
  type VerdictanSelection,
} from '../../src/domain/verdictan';
import { uuid } from './credentials';
import { policyId } from './policy-id';
import { DesktopProtocolError } from './protocol';
import {
  decideConversationResume,
  type ResumeDecision,
} from '../../src/domain/conversation-resume';

export interface ConversationBinding {
  project_id?: string;
  task_id?: string;
  provider_access_mode?: ProviderAccessMode;
  schema_version: 1;
  organization_id: string;
  user_id: string;
  region_id: string;
  provider_connection_id: string;
  installation_id: string;
  host_id: string;
  conversation_id: string;
  provider: string;
  model: string;
  agent_kind: 'codex' | 'claude_code';
  agent_version: string;
  context_format_version: number;
  configuration_id: string;
  configuration_version_id: string;
  cwd: string;
  /**
   * The Verdictan agent of the chat. It is set when the chat starts and never changes. A resume
   * uses it, also after the computer changed its agent. Missing in chats from older versions
   * and with the team and policy choice of older runtimes.
   */
  agent_id?: string;
  /** The gateway that Verdictan gave for the agent on this computer. */
  gateway_id?: string;
}
const ids = [
  'organization_id',
  'user_id',
  'region_id',
  'installation_id',
  'host_id',
  'conversation_id',
] as const;
export function validateBinding(value: unknown): asserts value is ConversationBinding {
  const v = value as ConversationBinding;
  if (
    !v ||
    v.schema_version !== 1 ||
    [v.project_id, v.task_id].some(
      (id) => id !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id),
    ) ||
    !ids.every((key) => uuid(v[key])) ||
    (v.agent_id !== undefined && !uuid(v.agent_id)) ||
    (v.gateway_id !== undefined &&
      (typeof v.gateway_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v.gateway_id))) ||
    !providerAccessModes.includes(v.provider_access_mode || 'byok') ||
    (v.provider_access_mode === 'codex_subscription'
      ? v.provider_connection_id !== '' || v.provider !== 'openai' || v.agent_kind !== 'codex'
      : v.provider_access_mode === 'claude_subscription'
        ? v.provider_connection_id !== '' ||
          v.provider !== 'anthropic' ||
          v.agent_kind !== 'claude_code'
        : !uuid(v.provider_connection_id)) ||
    !policyId(v.configuration_id, 'configuration') ||
    !policyId(v.configuration_version_id, 'version') ||
    !['codex', 'claude_code'].includes(v.agent_kind) ||
    !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]{1,64})?$/.test(v.agent_version) ||
    v.context_format_version !== 1 ||
    typeof v.cwd !== 'string' ||
    !v.cwd ||
    typeof v.provider !== 'string' ||
    typeof v.model !== 'string' ||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(v.provider) ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$/.test(v.model)
  )
    throw new DesktopProtocolError('desktop.resume_binding_invalid');
}
/** Carries the decision. It contains field names only, never binding values. */
export class ResumeIncompatibleError extends DesktopProtocolError {
  constructor(readonly decision: ResumeDecision) {
    super(decision.code ?? 'desktop.resume_incompatible');
  }
}
/**
 * Kalkidan owns the resume decision. The requested binding must be a valid current binding.
 * The saved binding only has to satisfy the shared contract, so that a binding from another
 * Kalkidan version gives the changed field names. Verdictan still authorizes every request.
 */
export function assertCompatible(
  previous: ConversationBinding,
  current: ConversationBinding,
  fork = false,
) {
  validateBinding(current);
  const decision = decideConversationResume(previous, current, { fork });
  if (decision.status !== 'compatible') throw new ResumeIncompatibleError(decision);
  return decision;
}
/**
 * The binding fields that the desktop needs to read the usage of a chat on an SSH host. They
 * are identifiers and a folder only, never credentials. The host keeps the full binding.
 */
export type BindingSummary = Pick<
  ConversationBinding,
  'organization_id' | 'user_id' | 'conversation_id' | 'cwd' | 'provider_access_mode'
>;
export function bindingSummary(binding: ConversationBinding | null): BindingSummary | null {
  if (!binding) return null;
  return {
    organization_id: binding.organization_id,
    user_id: binding.user_id,
    conversation_id: binding.conversation_id,
    cwd: binding.cwd,
    ...(binding.provider_access_mode ? { provider_access_mode: binding.provider_access_mode } : {}),
  };
}
/** Reads a summary that an SSH host sent. A value that is not valid gives null. */
export function parseBindingSummary(value: unknown): BindingSummary | null {
  const v = value as BindingSummary;
  if (
    !v ||
    typeof v !== 'object' ||
    !uuid(v.organization_id) ||
    !uuid(v.user_id) ||
    !uuid(v.conversation_id) ||
    typeof v.cwd !== 'string' ||
    !v.cwd ||
    v.cwd.length > 4096 ||
    (v.provider_access_mode !== undefined && !providerAccessModes.includes(v.provider_access_mode))
  )
    return null;
  return bindingSummary(v as ConversationBinding);
}
/** The agents of one account. IDs only. */
export interface AccountAgents {
  /** The agent of each computer that has its own choice: 'local' or the SSH host ID. */
  computers: Record<string, string>;
  /** The agent that Codex and Claude Code both used before each computer had one. */
  default?: string;
  /** The agent of each coding agent before each computer had one. Older chats keep it. */
  legacy: Partial<Record<'codex' | 'claude', string>>;
}
interface Store {
  schema: 1;
  installationId: string;
  hosts: Record<string, string>;
  selections: Record<string, Partial<Record<'codex' | 'claude', VerdictanSelection>>>;
  /** Missing in stores of older versions. The first read of an account adds it. */
  agents?: Record<string, AccountAgents>;
  bindings: Record<string, ConversationBinding>;
}
/**
 * The agents of an account. The first read moves the agents of the earlier coding agent
 * selections: when Codex and Claude Code used the same agent, every computer keeps it. Else
 * the Kalkidan agent applies. Older chats keep the agent of their coding agent.
 */
function accountAgents(value: Store, account: string) {
  value.agents ||= {};
  if (!value.agents[account]) {
    const picks = value.selections[account] || {};
    const codex = picks.codex?.agentId;
    const claude = picks.claude?.agentId;
    value.agents[account] = {
      computers: {},
      ...(codex && codex === claude ? { default: codex } : {}),
      legacy: { ...(codex ? { codex } : {}), ...(claude ? { claude } : {}) },
    };
    for (const pick of Object.values(picks)) if (pick) delete pick.agentId;
  }
  return value.agents[account];
}
export const identityKey = (...parts: string[]) =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex');
/** One main-process store. It contains identifiers only, never credentials or prompts. */
export class BindingStore {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private root: string) {}
  private async transaction<T>(action: (value: Store) => T | Promise<T>, write = true): Promise<T> {
    const task = this.tail
      .catch(() => {})
      .then(async () => {
        const file = join(this.root, 'verdictan-bindings.json');
        let value: Store;
        try {
          const info = await lstat(file);
          if (!info.isFile() || info.isSymbolicLink() || info.size > 8 * 1024 * 1024)
            throw Error('Invalid binding store');
          value = JSON.parse(await readFile(file, 'utf8'));
          if (
            value.schema !== 1 ||
            !uuid(value.installationId) ||
            !value.hosts ||
            !value.selections ||
            !value.bindings
          )
            throw Error('Invalid binding store');
        } catch (error: any) {
          if (error.code !== 'ENOENT')
            throw new DesktopProtocolError('desktop.binding_store_invalid');
          value = {
            schema: 1,
            installationId: randomUUID(),
            hosts: {},
            selections: {},
            bindings: {},
          };
        }
        const result = await action(value);
        if (write) await writeJSON(file, value);
        return structuredClone(result);
      });
    this.tail = task;
    return task;
  }
  identities(hostKey: string) {
    return this.transaction((value) => {
      const key = identityKey(hostKey);
      value.hosts[key] ||= randomUUID();
      if (!uuid(value.hosts[key])) throw new DesktopProtocolError('desktop.binding_store_invalid');
      return { installationId: value.installationId, hostId: value.hosts[key] };
    });
  }
  /** The identities of a host, or null when Kalkidan never gave the host an identity. */
  knownIdentities(hostKey: string) {
    return this.transaction((value) => {
      const hostId = value.hosts[identityKey(hostKey)];
      return hostId ? { installationId: value.installationId, hostId } : null;
    }, false);
  }
  /** Forgets the identity of a removed host. A new connection gets a new identity. */
  forgetHost(hostKey: string) {
    return this.transaction((value) => {
      delete value.hosts[identityKey(hostKey)];
      for (const agents of Object.values(value.agents || {})) delete agents.computers[hostKey];
    });
  }
  /**
   * Removes all conversation links. The installation identity, the host identities, and the
   * agent selections stay, so that a revoked host stays revoked.
   */
  clearConversations() {
    return this.transaction((value) => {
      value.bindings = {};
    });
  }
  selections(account: string) {
    return this.transaction((v) => v.selections[account] || {}, false);
  }
  /** The agents of the computers of an account. Only the first read writes the store. */
  async agents(account: string): Promise<AccountAgents> {
    const saved = await this.transaction((v) => v.agents?.[account], false);
    return saved ?? this.transaction((v) => accountAgents(v, account));
  }
  /** Sets the agent that new chats on a computer use. Existing chats keep their agent. */
  setComputerAgent(account: string, computer: string, agentId: string) {
    return this.transaction((v) => {
      accountAgents(v, account).computers[computer] = agentId;
    });
  }
  select(account: string, agent: 'codex' | 'claude', selection: VerdictanSelection) {
    return this.transaction((v) => {
      // Move the earlier agent first, so that older chats keep it.
      accountAgents(v, account);
      (v.selections[account] ||= {})[agent] = structuredClone(selection);
    });
  }
  read(agent: string, nativeSession: string) {
    return this.transaction((v) => v.bindings[identityKey(agent, nativeSession)] || null, false);
  }
  // Async so that an invalid binding always rejects, also for callers that use `.catch`.
  async save(agent: string, nativeSession: string, binding: ConversationBinding) {
    validateBinding(binding);
    return this.transaction((v) => {
      const key = identityKey(agent, nativeSession);
      if (v.bindings[key]) assertCompatible(v.bindings[key], binding);
      v.bindings[key] = structuredClone(binding);
    });
  }
  async home(binding: ConversationBinding) {
    validateBinding(binding);
    const home = join(
      this.root,
      'managed-agent-homes',
      identityKey(binding.organization_id, binding.user_id),
      binding.agent_kind === 'codex'
        ? binding.provider_access_mode === 'codex_subscription'
          ? 'codex-subscription'
          : 'codex'
        : binding.provider_access_mode === 'claude_subscription'
          ? 'claude-subscription'
          : 'claude',
    );
    const parent = join(this.root, 'managed-agent-homes');
    for (const path of [
      this.root,
      parent,
      join(parent, identityKey(binding.organization_id, binding.user_id)),
      home,
    ]) {
      await mkdir(path, { recursive: true, mode: 0o700 });
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new DesktopProtocolError('desktop.agent_home_invalid');
    }
    return realpath(home);
  }
}
