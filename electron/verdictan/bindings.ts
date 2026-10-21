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
interface Store {
  schema: 1;
  installationId: string;
  hosts: Record<string, string>;
  selections: Record<string, Partial<Record<'codex' | 'claude', VerdictanSelection>>>;
  bindings: Record<string, ConversationBinding>;
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
  selections(account: string) {
    return this.transaction((v) => v.selections[account] || {}, false);
  }
  select(account: string, agent: 'codex' | 'claude', selection: VerdictanSelection) {
    return this.transaction((v) => {
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
