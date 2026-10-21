import { agentMinimumVersions, agentVersionRequirement } from './agent-version';

/** Safe desktop state. Account and runtime credentials never cross renderer IPC. */
export interface VerdictanAccount {
  state: 'signed-out' | 'authorizing' | 'authenticated' | 'expired';
  /** Internal identifiers. The UI must not show them. */
  userId?: string;
  organizationId?: string;
  /** Names that the service sends. The UI shows generic labels until they arrive. */
  organizationName?: string;
  userName?: string;
  apiUrl: string;
  expiresAt?: string;
  /** The user email. Present only when the runtime sends it. */
  userEmail?: string;
}
export interface VerdictanCapabilities {
  cliVersion: string;
  protocolMin: number;
  protocolMax: number;
  capabilities: string[];
  managedExecutionReady: boolean;
  testedAgents: { kind: 'codex' | 'claude_code'; version: string }[];
}
export interface VerdictanStatus {
  /** Undefined until the user selects a region. */
  region?: 'eu' | 'us';
  phase:
    'missing' | 'checking' | 'signed-out' | 'authorizing' | 'authenticated' | 'expired' | 'error';
  account?: VerdictanAccount;
  capabilities?: VerdictanCapabilities;
  error?: string;
  remoteRevocationPending?: boolean;
  /** Account authentication alone does not authorize agent dispatch. */
  executionReady: boolean;
}
export interface VerdictanAPI {
  verdictanSetRegion(region: 'eu' | 'us'): Promise<VerdictanStatus>;
  onVerdictanChanged?(listener: () => void): () => void;
  verdictanSetup(): Promise<VerdictanSetup>;
  verdictanSelect(
    agent: 'codex' | 'claude',
    selection: VerdictanSelection,
  ): Promise<VerdictanSetup>;
  verdictanStatus(): Promise<VerdictanStatus>;
  verdictanCheck(): Promise<VerdictanStatus>;
  verdictanAuthorize(intent: 'login' | 'register'): Promise<VerdictanStatus>;
  verdictanCancel(): Promise<VerdictanStatus>;
  verdictanRenew(): Promise<VerdictanStatus>;
  verdictanLogout(): Promise<VerdictanStatus>;
}

/** Omitted means organization provider connection (BYOK). Unknown values fail validation. */
export type ProviderAccessMode = 'byok' | 'codex_subscription' | 'claude_subscription';
export const providerAccessModes: readonly ProviderAccessMode[] = [
  'byok',
  'codex_subscription',
  'claude_subscription',
];
/** Each subscription mode belongs to exactly one native agent. */
export const subscriptionAgent = {
  codex_subscription: 'codex',
  claude_subscription: 'claude',
} as const;
export const isSubscriptionMode = (
  mode: ProviderAccessMode | undefined,
): mode is keyof typeof subscriptionAgent =>
  mode === 'codex_subscription' || mode === 'claude_subscription';
export interface VerdictanSelection {
  providerAccessMode?: ProviderAccessMode;
  teamId: string;
  /**
   * Both empty: the user did not pick a policy, so Verdictan uses the default Kalkidan
   * configuration. Both set: the picked policy. One without the other is not valid.
   */
  configurationId: string;
  configurationVersionId: string;
  providerConnectionId: string;
  model: string;
  /**
   * An agent from `setup.inspect` `agents`. When it is set, the host attaches to this agent and
   * its deployed configuration applies. `teamId` is then the team of the agent, and both policy
   * IDs are empty. Missing: the team and policy choice of older runtimes.
   */
  agentId?: string;
}
/** The state of the default Kalkidan configuration, from `setup.inspect`. */
export type PolicyReadiness =
  | 'default_available'
  | 'default_creatable'
  | 'default_configuration_required'
  | 'default_permission_required'
  | 'default_removed'
  | 'unknown';
export const policyReadinessValues: readonly PolicyReadiness[] = [
  'default_available',
  'default_creatable',
  'default_configuration_required',
  'default_permission_required',
  'default_removed',
  'unknown',
];
/** The state of the one-time Kalkidan organization bootstrap, from `setup.inspect`. */
export type BootstrapReadiness =
  'bootstrapped' | 'bootstrap_available' | 'bootstrap_requires_admin' | 'unknown';
export const bootstrapReadinessValues: readonly BootstrapReadiness[] = [
  'bootstrapped',
  'bootstrap_available',
  'bootstrap_requires_admin',
  'unknown',
];
/** An agent that the user can attach a host to. IDs are values for the backend only. */
export interface VerdictanAgent {
  agent_id: string;
  team_id: string;
  name?: string;
  configuration_id: string;
  configuration_version_id: string;
  configuration_name?: string;
  version_name?: string;
  /** True for the Kalkidan agent of the organization. It is first in the list. */
  default?: boolean;
}
/** The visible name of the Kalkidan agent when the service sends no name. */
export const kalkidanAgentLabel = 'Kalkidan agent';
/** The visible name of the default Kalkidan configuration. */
export const kalkidanDefaultLabel = 'Kalkidan default';
/** IDs are values for the backend only. The optional names are the only visible text. */
export interface VerdictanSetup {
  providerAccessModes?: ProviderAccessMode[];
  status: string;
  /** Missing when the runtime does not report it. */
  policyReadiness?: PolicyReadiness;
  /** Present only when the default exists and the user can read it. */
  defaultPolicy?: { configuration_id: string; configuration_version_id: string };
  /** Set when Kalkidan made sure that the default exists during this check. */
  defaultEnsured?: 'created' | 'existing';
  /**
   * True when the service reports that it can make the default, but Kalkidan could not make it
   * or read it during this check. The other policies stay available. Refresh tries again.
   */
  defaultUnavailable?: boolean;
  /** Missing when the runtime does not report it (older API). */
  bootstrapReadiness?: BootstrapReadiness;
  /** The bootstrap record. Missing before the bootstrap and with older runtimes. */
  bootstrap?: {
    status: 'bootstrapped' | 'adopted';
    agent_id: string;
    configuration_status: 'available' | 'deleted';
    agent_status: 'available' | 'inactive' | 'deleted';
  };
  /** Set when Kalkidan ran the one-time bootstrap during this check. */
  bootstrapped?: 'bootstrapped' | 'already_bootstrapped';
  /**
   * Why the one-time bootstrap did not run. `team_required`: the administrator has no team
   * that can hold the Kalkidan agent. `failed`: another failure; Refresh tries again.
   */
  bootstrapIssue?: 'team_required' | 'failed';
  /**
   * Agents that the user can attach a host to. Missing when the runtime does not send the
   * list (older runtimes); then the team and policy choice applies.
   */
  agents?: VerdictanAgent[];
  /** `name`, `version` and `allowedModels` are present only when the service sends them. */
  teams: { team_id: string; name?: string }[];
  policies: {
    configuration_id: string;
    configuration_version_id: string;
    name?: string;
    version_name?: string;
    version?: string | number;
    /** True for the default Kalkidan configuration. It is first in the list. */
    default?: boolean;
  }[];
  providerConnections: { provider_connection_id: string; provider: string; name?: string }[];
  /** Models that the organization allows: one list, or one list for each agent. */
  allowedModels?: string[] | Partial<Record<'codex' | 'claude', string[]>>;
  selections: Partial<Record<'codex' | 'claude', VerdictanSelection>>;
}

/**
 * True for text that looks like an internal identifier: a UUID, a prefixed service ID such as
 * `cfg_…`, `cfgv_…`, `gw_…` or `vdt_…`, or a long hexadecimal or random token.
 */
export function isOpaqueId(value: string) {
  const text = value.trim();
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text) ||
    (/^[a-z][a-z0-9]{0,11}_([A-Za-z0-9_-]{6,})$/.test(text) &&
      (/\d/.test(text) || text.length >= 20)) ||
    /^[0-9a-f]{16,}$/i.test(text) ||
    (/^[A-Za-z0-9_-]{20,}$/.test(text) && /\d/.test(text) && !/[\s.]/.test(text))
  );
}
const hiddenCharacter = (code: number) =>
  code < 0x20 ||
  (code >= 0x7f && code <= 0x9f) ||
  (code >= 0x200b && code <= 0x200f) ||
  (code >= 0x2028 && code <= 0x202e) ||
  (code >= 0x2066 && code <= 0x2069);
/** A name from the service, or undefined when it is missing, unsafe, or only an ID. */
export function serviceName(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    // Remove control and direction characters, then collapse white space.
    const text = Array.from(value)
      .filter((character) => !hiddenCharacter(character.codePointAt(0)!))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (text && text.length <= 120 && !isOpaqueId(text)) return text;
  }
  return undefined;
}
/**
 * Visible labels for a list of service records. A record with a name shows its name. A record
 * without a name shows the generic label; when several records need it, each gets a number,
 * for example "Policy 1" and "Policy 2". Repeated names also get a number.
 */
export function labelList<T>(
  items: readonly T[],
  name: (item: T) => string | undefined,
  generic: string,
  single = generic,
): string[] {
  const names = items.map(name);
  const unnamed = names.filter((value) => !value).length;
  let ordinal = 0;
  const labels = names.map((value) => {
    if (value) return value;
    ordinal++;
    return unnamed === 1 && items.length === 1 ? single : `${generic} ${ordinal}`;
  });
  const seen = new Map<string, number>();
  const totals = new Map<string, number>();
  for (const label of labels) totals.set(label, (totals.get(label) || 0) + 1);
  return labels.map((label) => {
    if ((totals.get(label) || 0) < 2) return label;
    const count = (seen.get(label) || 0) + 1;
    seen.set(label, count);
    return `${label} (${count})`;
  });
}
export const teamLabels = (teams: VerdictanSetup['teams']) =>
  labelList(teams, (team) => serviceName(team.name), 'Team', 'Default team');
export const policyLabels = (policies: VerdictanSetup['policies']) =>
  labelList(
    policies,
    (policy) => {
      const name = serviceName(policy.name) || (policy.default ? kalkidanDefaultLabel : undefined);
      const number = policy.version;
      const version =
        serviceName(policy.version_name) ||
        (typeof number === 'number' && Number.isFinite(number)
          ? `version ${number}`
          : serviceName(number) && `version ${serviceName(number)}`);
      return name && version ? `${name} · ${version}` : name;
    },
    'Policy',
  );
const providerNames: Record<string, string> = { openai: 'OpenAI', anthropic: 'Anthropic' };
export const connectionLabels = (connections: VerdictanSetup['providerConnections']) =>
  connections.map((connection, index) => {
    const generic = `${providerNames[connection.provider] || 'Provider'} connection`;
    const sameProvider = connections.filter((item) => item.provider === connection.provider);
    return labelList(sameProvider, (item) => serviceName(item.name), generic)[
      sameProvider.indexOf(connections[index])
    ];
  });
/**
 * Visible labels for agents. An agent without a name shows "Kalkidan agent" when it is the
 * default, else "Agent 1", "Agent 2". IDs never show.
 */
export const agentLabels = (agents: readonly VerdictanAgent[]) =>
  labelList(
    agents,
    (agent) => serviceName(agent.name) || (agent.default ? kalkidanAgentLabel : undefined),
    'Agent',
    'Agent 1',
  );
/** The secondary text of an agent: its deployed configuration name and version, or nothing. */
export function agentConfigurationLabel(agent: VerdictanAgent) {
  const name =
    serviceName(agent.configuration_name) || (agent.default ? kalkidanDefaultLabel : undefined);
  const version = serviceName(agent.version_name);
  if (name && version) return `${name} · ${version}`;
  return name || (version ? `Version ${version}` : undefined);
}
/** True when a selection uses the default Kalkidan configuration: both policy IDs are empty. */
export const usesDefaultPolicy = (
  selection: Pick<VerdictanSelection, 'configurationId' | 'configurationVersionId'> & {
    agentId?: string;
  },
) => !selection.agentId && !selection.configurationId && !selection.configurationVersionId;
/**
 * True when an administrator removed the default Kalkidan setup after the bootstrap: the
 * default configuration or the Kalkidan agent. Verdictan does not make it again.
 */
export const defaultRemoved = (
  setup: Pick<VerdictanSetup, 'bootstrap' | 'policyReadiness'> | undefined,
) =>
  !!setup &&
  (setup.policyReadiness === 'default_removed' ||
    setup.bootstrap?.configuration_status === 'deleted' ||
    setup.bootstrap?.agent_status === 'deleted');
/** True when the agent choice applies: the runtime sends agents, and there is one or more. */
export const usesAgentChoice = (setup: Pick<VerdictanSetup, 'agents'> | undefined) =>
  !!setup?.agents?.length;
/**
 * The code that stops a saved selection, or nothing when it can still work. A removed default
 * and an agent that is not in the list need a new choice.
 */
export function selectionIssue(
  setup: VerdictanSetup,
  selection: VerdictanSelection | undefined,
): string | undefined {
  if (!selection) return 'desktop.setup_selection_required';
  if (selection.agentId) {
    if (setup.agents?.some((agent) => agent.agent_id === selection.agentId)) return undefined;
    return defaultRemoved(setup) && selection.agentId === setup.bootstrap?.agent_id
      ? 'desktop.setup_default_removed'
      : 'desktop.setup_agent_unavailable';
  }
  if (usesDefaultPolicy(selection) && defaultRemoved(setup)) return 'desktop.setup_default_removed';
  return undefined;
}
/** The note for an administrator who removed the default Kalkidan setup. */
export const defaultRemovedNotice =
  'An administrator removed the default Kalkidan setup. Choose another agent.';
/** The note when the default is removed and the user has no other agent. */
export const noAgentNotice =
  'An administrator removed the default Kalkidan setup, and you have no other agent. Ask an organization administrator to give you access to an agent.';
/** The note for a member before an administrator connects Kalkidan for the first time. */
export const bootstrapAdminNotice = 'Ask an organization administrator to finish Kalkidan setup.';
/** The text that tells the user how to get the default configuration, or nothing. */
export function policyRecovery(readiness: PolicyReadiness | undefined) {
  if (readiness === 'default_configuration_required')
    return 'Ask an organization administrator to connect Kalkidan once. This makes the Kalkidan default policy for your organization.';
  if (readiness === 'default_permission_required')
    return 'Ask an organization administrator to give you read access to the Kalkidan default policy.';
  return undefined;
}
/** The visible account name. It never shows an organization or user ID. */
export function accountLabel(account?: Pick<VerdictanAccount, 'organizationName'>) {
  return serviceName(account?.organizationName) || 'Your account';
}

/**
 * Managed agent errors. The desktop and the runtime send a stable code, for example
 * `desktop.runtime_missing`. The backend error message is the plain text, then the code in
 * square brackets: "Managed agents are not set up. … [desktop.runtime_missing]". Read the code
 * with `managedErrorCode`. Show the message without the brackets, and never show a code alone.
 *
 * `section` is the Settings section that fixes the error. `retry` is true when the same action
 * can work a second time without a change.
 *
 * There is no fallback to an unmanaged local agent. Each local chat starts through managed agents,
 * so the policy and the inference guard always apply. When managed agents are not set up, the chat
 * does not start, and the error tells the user to set them up.
 */
export interface ManagedErrorInfo {
  message: string;
  section?: 'managed-agents' | 'agents' | 'updates';
  retry?: boolean;
}
const setUp = 'managed-agents' as const;
const signInClaude =
  'Sign in to Claude Code on the machine where work runs. Then send the message again.';
export const managedErrors: Record<string, ManagedErrorInfo> = {
  'desktop.runtime_missing': {
    message: 'Managed agents are not set up. Install the runtime in Settings to start a chat.',
    section: setUp,
  },
  'desktop.remote_runtime_missing': {
    message: 'Managed agents are not installed on this host. Install the runtime for this host.',
    section: setUp,
  },
  'desktop.runtime_not_found': {
    message: 'Managed agents are not set up on this computer.',
    section: setUp,
  },
  'desktop.executable_invalid': {
    message: 'The managed agents runtime is damaged. Install it again in Settings.',
    section: 'updates',
  },
  'desktop.auth_required': { message: 'Sign in to managed agents.', section: setUp },
  'desktop.auth_expired': {
    message: 'Your managed agents session expired. Sign in again.',
    section: setUp,
  },
  'desktop.account_invalid': {
    message: 'The managed agents account is not valid. Sign in again.',
    section: setUp,
  },
  'desktop.identity_mismatch': {
    message: 'The browser account is not the saved account. Use the same account, or sign out.',
    section: setUp,
  },
  'desktop.region_mismatch': {
    message: 'The saved account is in a different region. Sign out, then change the region.',
    section: setUp,
  },
  'desktop.browser_failed': { message: 'The browser did not open. Try again.', retry: true },
  'desktop.cancel_failed': { message: 'The sign-in did not stop. Check the status.', retry: true },
  'desktop.setup_invalid': {
    message: 'The managed agents setup is not complete. Finish the setup in Settings.',
    section: setUp,
  },
  'desktop.setup_selection_required': {
    message: 'Choose an agent or a policy, a connection and a model for managed agents.',
    section: setUp,
  },
  'desktop.setup_default_removed': {
    message: 'An administrator removed the default Kalkidan setup. Choose another agent.',
    section: setUp,
  },
  'desktop.setup_agent_unavailable': {
    message: 'The agent that you chose is not available now. Choose another agent.',
    section: setUp,
  },
  'desktop.setup_resource_unavailable': {
    message: 'The agent that you chose is not available now. Choose another agent.',
    section: setUp,
  },
  'desktop.setup_bootstrap_required': {
    message: 'Ask an organization administrator to finish Kalkidan setup.',
    section: setUp,
  },
  'desktop.history_invalid': {
    message: 'Kalkidan could not check the history from Verdictan. Load it again.',
    retry: true,
  },
  'desktop.setup_default_configuration_required': {
    message:
      'Your organization has no Kalkidan default policy. Ask an organization administrator to connect Kalkidan once.',
    section: setUp,
  },
  'desktop.setup_permission_required': {
    message:
      'You cannot read the Kalkidan default policy. Ask an organization administrator for access.',
    section: setUp,
  },
  'desktop.runtime_expired': {
    message: 'Managed agents access for this computer expired. Renew it in Settings.',
    section: setUp,
  },
  'desktop.invalid_runtime_credential': {
    message: 'Managed agents access for this computer is not valid. Renew it in Settings.',
    section: setUp,
  },
  'desktop.host_revoked': {
    message: 'This computer cannot run managed agents now. Connect it again in Settings.',
    section: setUp,
  },
  'desktop.runtime_reconciliation_required': {
    message: 'Managed agents must update their records. Check the status in Settings.',
    section: setUp,
  },
  'desktop.agent_version_unsupported': {
    message:
      'Kalkidan cannot confirm the version of the installed agent. Check the agent in Settings, then try again.',
    section: 'agents',
  },
  'desktop.codex_version_unsupported': {
    message: agentVersionRequirement('codex'),
    section: 'agents',
  },
  'desktop.claude_code_version_unsupported': {
    message: agentVersionRequirement('claude_code'),
    section: 'agents',
  },
  'desktop.codex_version_unknown': {
    message: `Kalkidan cannot read the installed Codex version. ${agentVersionRequirement('codex')}`,
    section: 'agents',
  },
  'desktop.claude_code_version_unknown': {
    message: `Kalkidan cannot read the installed Claude Code version. ${agentVersionRequirement('claude_code')}`,
    section: 'agents',
  },
  'desktop.subscription_agent_required': {
    message: 'Your subscription access works with a different agent. Change the agent.',
    section: setUp,
  },
  'desktop.resume_incompatible': {
    message: 'Managed agents cannot continue this chat. Start a new chat.',
  },
  'desktop.resume_binding_required': {
    message: 'Managed agents cannot continue this chat. Start a new chat.',
  },
  'desktop.resume_binding_invalid': {
    message: 'Managed agents cannot continue this chat. Start a new chat.',
  },
  'desktop.runtime_binding_mismatch': {
    message: 'This chat belongs to a different managed agents setup. Start a new chat.',
  },
  'desktop.process_isolation_unavailable': {
    message: 'This computer cannot keep the agent apart from other programs. Check the setup.',
    section: setUp,
  },
  'desktop.isolation_scope_invalid': {
    message: 'This computer cannot keep the agent apart from other programs. Check the setup.',
    section: setUp,
  },
  'desktop.protected_pipe_unavailable': {
    message: 'Managed agents cannot open a private connection on this computer. Check the setup.',
    section: setUp,
  },
  'desktop.loopback_required': {
    message: 'Managed agents need a local network connection that is not available.',
    section: setUp,
  },
  'desktop.secure_storage_unavailable': {
    message: 'The system keychain is locked. Unlock it, then try again.',
    retry: true,
  },
  'desktop.operation_in_progress': {
    message: 'Another managed agents operation is running. Wait, then try again.',
    retry: true,
  },
  'desktop.runtime_limit': {
    message: 'Too many managed agent runs are open. Stop a chat, then try again.',
    retry: true,
  },
  'desktop.runtime_already_owned': {
    message: 'This chat already runs in managed agents. Wait, then try again.',
    retry: true,
  },
  'desktop.connection_limit': {
    message: 'Too many connections to managed agents are open. Try again.',
    retry: true,
  },
  'desktop.request_timeout': {
    message: 'Managed agents did not reply in time. Try again.',
    retry: true,
  },
  'desktop.runtime_starting': {
    message: 'Managed agents are starting. Wait, then try again.',
    retry: true,
  },
  'desktop.runtime_stopped': { message: 'Managed agents stopped. Try again.', retry: true },
  'desktop.operation_unsupported': {
    message: 'The installed managed agents runtime cannot do this. Update the runtime.',
    section: 'updates',
  },
  'desktop.region_required': {
    message: 'Select the EU or US region, then sign in to managed agents.',
    section: setUp,
  },
  'desktop.session_rejected': {
    message: 'The managed agents service did not accept the sign-in. Sign in again.',
    section: setUp,
  },
  'desktop.readiness_required': {
    message:
      'The managed agents check did not pass. Check the status, then send the message again.',
    section: setUp,
  },
  'desktop.readiness_failed': {
    message:
      'The managed agents check did not pass. Check the status, then send the message again.',
    section: setUp,
  },
  'desktop.claude_subscription_unsupported': {
    message:
      'This runtime cannot use your Claude subscription. Your work is safe. Update the runtime.',
    section: 'updates',
  },
  'desktop.claude_subscription_login_required': {
    message: `${signInClaude} Kalkidan does not send your message again.`,
    section: setUp,
  },
  'desktop.claude_subscription_native_profile_unsupported': {
    message:
      'This computer uses a custom Claude Code profile. Use the default Claude Code sign-in on this computer. Then send the message again.',
    section: setUp,
  },
  'desktop.claude_subscription_credential_format_unsupported': {
    message:
      'Kalkidan cannot read the Claude Code sign-in on the machine where work runs. The format is not supported, or the file is not private. Update Claude Code and run /login. Then send the message again.',
    section: 'agents',
  },
  'desktop.claude_subscription_login_expiring': {
    message:
      'Your Claude Code sign-in expires soon. Run /login in Claude Code on the machine where work runs. Then send the message again.',
    section: setUp,
  },
  'desktop.claude_subscription_identity_unavailable': {
    message:
      'Managed agents cannot check your Claude account now. Check the status, then try again.',
    section: setUp,
  },
  'desktop.claude_subscription_route_unsupported': {
    message:
      'Claude Code sent a request that managed agents do not support. Your work is safe. Check the Claude Code version.',
    section: 'agents',
  },
  'desktop.subscription_account_mismatch': {
    message: 'The Claude account changed. Stop this chat and start a new chat.',
  },
  'desktop.subscription_account_required': {
    message: 'Sign in to Claude Code on the machine where work runs. Then start this chat again.',
    section: setUp,
  },
  'desktop.subscription_credentials_invalid': {
    message: 'The managed agents launch settings are not valid. Choose the setup again.',
    section: setUp,
  },
  'desktop.subscription_target_required': {
    message:
      'Your policy does not allow the selected model. Choose an allowed model, or ask your administrator.',
    section: setUp,
  },
};
// Codes for a lost or failed connection. The same action can work a second time.
const connectionCodes =
  /^desktop\.(transport_\w+|gateway_\w+|process_failed|credential_\w+|readiness_\w+|evidence_\w+|events_\w+|snapshot_\w+)$/;
/** Returns the managed agent code in an error message, or nothing. */
export function managedErrorCode(text: unknown) {
  return typeof text === 'string' ? text.match(/\bdesktop\.[a-z_]{1,100}\b/)?.[0] : undefined;
}
/** Returns plain words and the fix for a managed agent code. Unknown codes get general words. */
export function managedErrorInfo(code: string): ManagedErrorInfo {
  return (
    managedErrors[code] ||
    (connectionCodes.test(code)
      ? { message: 'The connection to managed agents stopped. Try again.', retry: true }
      : {
          message: 'Managed agents could not complete this operation. Check the setup in Settings.',
          section: setUp,
        })
  );
}
/** The error message for a code: plain words, then the code in square brackets. */
export function managedErrorText(code: string) {
  return `${managedErrorInfo(code).message} [${code}]`;
}
/** Removes the code in square brackets from a message, for display. */
export function withoutManagedCode(text: string) {
  return text.replace(/\s*\[desktop\.[a-z_]{1,100}\]\s*$/, '');
}

export type SubscriptionRecoveryAction =
  | 'update_runtime'
  | 'sign_in_native_claude_on_execution_host'
  | 'inspect_runtime'
  | 'check_native_compatibility'
  | 'reauthorize_new_session'
  | 'verify_native_account'
  | 'repair_managed_launch'
  | 'open_authorized_setup';
export interface SubscriptionRecovery {
  code: string;
  action: SubscriptionRecoveryAction;
  message: string;
}
// The recovery action for each Claude subscription code. The words come from `managedErrors`.
const recoveries: Record<string, SubscriptionRecoveryAction> = {
  'desktop.claude_subscription_unsupported': 'update_runtime',
  'desktop.claude_subscription_login_required': 'sign_in_native_claude_on_execution_host',
  'desktop.claude_subscription_native_profile_unsupported':
    'sign_in_native_claude_on_execution_host',
  'desktop.claude_subscription_login_expiring': 'sign_in_native_claude_on_execution_host',
  'desktop.claude_subscription_credential_format_unsupported': 'check_native_compatibility',
  'desktop.claude_subscription_identity_unavailable': 'inspect_runtime',
  'desktop.claude_subscription_route_unsupported': 'check_native_compatibility',
  'desktop.subscription_account_mismatch': 'reauthorize_new_session',
  'desktop.subscription_account_required': 'verify_native_account',
  'desktop.subscription_credentials_invalid': 'repair_managed_launch',
  'desktop.subscription_target_required': 'open_authorized_setup',
  'desktop.readiness_required': 'inspect_runtime',
  'desktop.readiness_failed': 'inspect_runtime',
  'desktop.resume_incompatible': 'reauthorize_new_session',
  'desktop.agent_version_unsupported': 'check_native_compatibility',
};
/** Maps a safe Claude subscription error code to one user recovery action. */
export function claudeSubscriptionRecovery(code: unknown): SubscriptionRecovery | null {
  if (typeof code !== 'string' || !Object.hasOwn(recoveries, code)) return null;
  return { code, action: recoveries[code], message: managedErrorText(code) };
}

const subscriptionKeys = [
  'payer',
  'credential_origin',
  'usage_category',
  'billing_category',
  'provider_access_mode',
];
const subscriptionMarkers: Record<string, 'claude' | 'codex'> = {
  claude_subscription: 'claude',
  codex_subscription: 'codex',
  user_claude_subscription: 'claude',
  user_codex_subscription: 'codex',
};
/**
 * The user's own subscription that pays, from the payer and access mode fields of usage or
 * billing records. Null when no record names a subscription.
 */
export function subscriptionPayer(...sources: unknown[]): 'claude' | 'codex' | null {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    const record = source as Record<string, unknown>;
    for (const key of subscriptionKeys) {
      const value = record[key];
      if (typeof value === 'string' && Object.hasOwn(subscriptionMarkers, value))
        return subscriptionMarkers[value];
    }
  }
  return null;
}
/** The cost text of a request that the user's own subscription pays. */
export function subscriptionCostLabel(payer: 'claude' | 'codex' | null) {
  return payer === 'claude'
    ? 'Included in your Claude subscription'
    : payer === 'codex'
      ? 'Included in your Codex subscription'
      : 'Included in your subscription';
}
/** True when a usage or billing record says that the user's own subscription pays. */
export function isSubscriptionBilling(source: unknown) {
  if (!source || typeof source !== 'object') return false;
  return (
    subscriptionPayer(source) !== null ||
    (source as Record<string, unknown>).pricing === 'subscription'
  );
}
/**
 * Cost text for one task-history row. Subscription rows and rows without a currency never show
 * a number: an internal zero debit is not a provider charge.
 */
export function historyCostLabel(row: Record<string, unknown>) {
  const usage =
    row.usage && typeof row.usage === 'object' ? (row.usage as Record<string, unknown>) : {};
  if (isSubscriptionBilling(row) || isSubscriptionBilling(usage))
    return subscriptionCostLabel(subscriptionPayer(row, usage));
  const valid = (cost: unknown, currency: unknown) =>
    (typeof cost === 'number' || (typeof cost === 'string' && /^-?\d+(?:\.\d+)?$/.test(cost))) &&
    typeof currency === 'string' &&
    /^[A-Z]{3}$/.test(currency);
  if (valid(usage.measured_cost, usage.currency))
    return `${String(usage.measured_cost)} ${String(usage.currency)}`;
  if (valid(row.actual_cost, row.currency))
    return `${String(row.actual_cost)} ${String(row.currency)}`;
  return 'Unknown';
}

/** The setup step that can remove a launch block. Each step has one place in Settings. */
export type ManagedSetupStep =
  'region' | 'sign-in' | 'status' | 'agent-setup' | 'runtime' | 'agents';
/** Where each step is in Settings: the section, the element that gets focus, and a label. */
export const managedSetupTargets: Record<
  ManagedSetupStep,
  { section: 'managed-agents' | 'agents'; anchor: string; label: string }
> = {
  region: { section: 'managed-agents', anchor: 'verdictan-region', label: 'Select the region' },
  'sign-in': {
    section: 'managed-agents',
    anchor: 'verdictan-account',
    label: 'Sign in to managed agents',
  },
  status: {
    section: 'managed-agents',
    anchor: 'verdictan-account',
    label: 'Check managed agent status',
  },
  'agent-setup': {
    section: 'managed-agents',
    anchor: 'managed-agent-setup',
    label: 'Open managed agent setup',
  },
  runtime: {
    section: 'managed-agents',
    anchor: 'verdictan-runtime',
    label: 'Install managed runtime',
  },
  agents: { section: 'agents', anchor: 'settings-agents', label: 'Open agent settings' },
};
/** The first sentence of each message that stops a managed launch. */
export const managedOnlyNotice =
  'Kalkidan runs agents only through managed Verdictan agents. It does not start a local agent CLI directly.';
export interface ManagedLaunchBlock {
  code: string;
  step: ManagedSetupStep;
  message: string;
}
const setupChoice =
  'Choose an authorized agent or policy, provider access, and model for this agent in managed agent setup.';
const signInAgain = 'Sign in to Verdictan again. Then send your message again.';
const runtimeRepair = 'Install or update the Verdictan runtime on the machine where work runs.';
const supportedAgent = `Install Codex ${agentMinimumVersions.codex} or later, or Claude Code ${agentMinimumVersions.claude_code} or later, on the machine where work runs.`;
const isolation =
  'This machine cannot isolate managed agents. Use a supported macOS or Linux machine.';
const gateway = 'The managed gateway did not start. Check Verdictan status. Then try again.';
const stopped = 'The Verdictan runtime stopped. Check Verdictan status.';
const resume =
  'This conversation has no compatible managed binding. Start a new session to continue.';
const launchBlocks: Record<string, [ManagedSetupStep, string]> = {
  'desktop.region_required': ['region', 'Select the region of your Verdictan organization.'],
  'desktop.region_mismatch': ['region', 'The saved account belongs to another region.'],
  'desktop.auth_required': ['sign-in', 'Sign in to Verdictan.'],
  'desktop.auth_expired': ['sign-in', signInAgain],
  'desktop.session_rejected': ['sign-in', signInAgain],
  'desktop.account_invalid': ['sign-in', signInAgain],
  'desktop.identity_mismatch': ['sign-in', signInAgain],
  'desktop.secure_storage_unavailable': ['sign-in', 'Unlock your system keyring. Then try again.'],
  'desktop.operation_in_progress': [
    'status',
    'Another account operation is in progress. Wait for it to finish. Then try again.',
  ],
  'desktop.runtime_missing': ['runtime', runtimeRepair],
  'desktop.host_runtime_missing': [
    'runtime',
    'Install the managed runtime on this SSH host. Select the host in Managed agents.',
  ],
  'desktop.remote_runtime_missing': [
    'runtime',
    'Install the managed runtime on this SSH host. Select the host in Managed agents.',
  ],
  'desktop.runtime_not_found': ['runtime', runtimeRepair],
  'desktop.runtime_starting': ['status', 'The managed runtime is starting. Wait, then try again.'],
  'desktop.managed_launch_unavailable': ['runtime', runtimeRepair],
  'desktop.capabilities_invalid': ['runtime', runtimeRepair],
  'desktop.protocol_invalid': ['runtime', runtimeRepair],
  'desktop.operation_unsupported': ['runtime', runtimeRepair],
  'desktop.process_failed': ['runtime', runtimeRepair],
  'desktop.gateway_protocol_invalid': ['runtime', runtimeRepair],
  'desktop.transport_closed': ['status', stopped],
  'desktop.transport_lost': ['status', stopped],
  'desktop.request_timeout': [
    'status',
    'Verdictan did not respond in time. Check Verdictan status. Then try again.',
  ],
  'desktop.setup_invalid': ['agent-setup', setupChoice],
  'desktop.setup_selection_required': ['agent-setup', setupChoice],
  'desktop.setup_default_configuration_required': [
    'agent-setup',
    'Ask an organization administrator to connect Kalkidan once.',
  ],
  'desktop.setup_permission_required': [
    'agent-setup',
    'Ask an organization administrator for access to the Kalkidan default policy.',
  ],
  'desktop.setup_default_removed': [
    'agent-setup',
    'An administrator removed the default Kalkidan setup. Choose another agent.',
  ],
  'desktop.setup_agent_unavailable': [
    'agent-setup',
    'The agent that you chose is not available now. Choose another agent.',
  ],
  'desktop.setup_resource_unavailable': [
    'agent-setup',
    'The agent that you chose is not available now. Choose another agent.',
  ],
  'desktop.setup_bootstrap_required': [
    'agent-setup',
    'Ask an organization administrator to finish Kalkidan setup.',
  ],
  'desktop.subscription_agent_required': ['agent-setup', setupChoice],
  'desktop.resource_binding_mismatch': ['agent-setup', setupChoice],
  'desktop.agent_version_unsupported': ['agents', supportedAgent],
  'desktop.codex_version_unsupported': ['agents', agentVersionRequirement('codex')],
  'desktop.claude_code_version_unsupported': ['agents', agentVersionRequirement('claude_code')],
  'desktop.codex_version_unknown': ['agents', agentVersionRequirement('codex')],
  'desktop.claude_code_version_unknown': ['agents', agentVersionRequirement('claude_code')],
  'desktop.agent_not_found': ['agent-setup', supportedAgent],
  'desktop.executable_invalid': ['agent-setup', supportedAgent],
  'desktop.agent_home_invalid': ['agent-setup', supportedAgent],
  'desktop.process_isolation_unavailable': ['runtime', isolation],
  'desktop.isolation_scope_invalid': ['runtime', isolation],
  'desktop.loopback_required': ['runtime', isolation],
  'desktop.protected_pipe_unavailable': ['runtime', isolation],
  'desktop.gateway_unavailable': ['status', gateway],
  'desktop.gateway_failed': ['status', gateway],
  'desktop.gateway_start_timeout': ['status', gateway],
  'desktop.gateway_stopped': ['status', gateway],
  'desktop.runtime_stopped': ['status', gateway],
  'desktop.runtime_expired': ['status', gateway],
  'desktop.resume_binding_required': ['agent-setup', resume],
  'desktop.resume_binding_invalid': ['agent-setup', resume],
  'desktop.binding_store_invalid': ['agent-setup', resume],
};
const recoverySteps: Record<SubscriptionRecoveryAction, ManagedSetupStep> = {
  update_runtime: 'runtime',
  sign_in_native_claude_on_execution_host: 'agent-setup',
  inspect_runtime: 'runtime',
  check_native_compatibility: 'agents',
  reauthorize_new_session: 'agent-setup',
  verify_native_account: 'agent-setup',
  repair_managed_launch: 'agent-setup',
  open_authorized_setup: 'agent-setup',
};
/**
 * The message and setup step for an error that stopped a managed launch. Each message starts
 * with the managed-only notice. An unknown error keeps its own text after the notice.
 */
export function managedLaunchBlock(error: unknown): ManagedLaunchBlock {
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const text =
    typeof record.message === 'string'
      ? record.message.trim()
      : typeof error === 'string'
        ? error.trim()
        : '';
  const raw = typeof record.code === 'string' ? record.code : text;
  const code = /^desktop\.[a-z_]{1,100}$/.test(raw)
    ? raw
    : managedErrorCode(raw) || managedErrorCode(text) || 'desktop.launch_blocked';
  const recovery = claudeSubscriptionRecovery(code);
  const section = managedErrors[code]?.section;
  const step: ManagedSetupStep = recovery
    ? recoverySteps[recovery.action]
    : launchBlocks[code]?.[0] ||
      (section === 'updates' ? 'runtime' : section ? 'agent-setup' : 'status');
  // Backend messages end with the code in square brackets. The code is never shown.
  const plain = withoutManagedCode(text)
    .replace(/\bdesktop\.[a-z_]{1,100}\b/g, '')
    .trim();
  const own = plain && !/^[\s.:[\]]*$/.test(plain) ? plain : '';
  const detail =
    managedErrors[code]?.message ||
    launchBlocks[code]?.[1] ||
    own ||
    'The managed launch checks did not pass. Check the managed agent status in Settings.';
  return {
    code,
    step,
    message: detail.startsWith(managedOnlyNotice) ? detail : `${managedOnlyNotice} ${detail}`,
  };
}
