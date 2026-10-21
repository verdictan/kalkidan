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
  configurationId: string;
  configurationVersionId: string;
  providerConnectionId: string;
  model: string;
}
/** IDs are values for the backend only. The optional names are the only visible text. */
export interface VerdictanSetup {
  providerAccessModes?: ProviderAccessMode[];
  status: string;
  teams: { team_id: string; name?: string }[];
  policies: {
    configuration_id: string;
    configuration_version_id: string;
    name?: string;
    version_name?: string;
  }[];
  providerConnections: { provider_connection_id: string; provider: string; name?: string }[];
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
      const name = serviceName(policy.name);
      const version = serviceName(policy.version_name);
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
/** The visible account name. It never shows an organization or user ID. */
export function accountLabel(account?: Pick<VerdictanAccount, 'organizationName'>) {
  return serviceName(account?.organizationName) || 'Your account';
}

/** The only native Claude Code version qualified for subscription access. */
export const claudeSubscriptionNativeVersion = '2.1.304';

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
const signIn =
  'Sign in to Claude Code on the machine where work runs. Then start a new turn. Kalkidan does not send your prompt again automatically.';
const recoveries: Record<string, [SubscriptionRecoveryAction, string]> = {
  'desktop.claude_subscription_unsupported': [
    'update_runtime',
    'This runtime does not support Claude subscription access. Keep your work and update the managed runtime.',
  ],
  'desktop.claude_subscription_login_required': ['sign_in_native_claude_on_execution_host', signIn],
  'desktop.claude_subscription_native_profile_unsupported': [
    'sign_in_native_claude_on_execution_host',
    'This machine uses a custom Claude Code profile. Use the default Claude Code sign-in on this machine. Then start a new turn.',
  ],
  'desktop.claude_subscription_login_expiring': [
    'sign_in_native_claude_on_execution_host',
    'Your Claude Code sign-in expires soon. Run /login in Claude Code on the machine where work runs. Then start a new turn.',
  ],
  'desktop.claude_subscription_identity_unavailable': [
    'inspect_runtime',
    'Claude account verification is not available. Inspect the runtime before you start the turn again.',
  ],
  'desktop.claude_subscription_route_unsupported': [
    'check_native_compatibility',
    'Claude Code sent a request that Verdictan does not support. Keep your work and check native compatibility.',
  ],
  'desktop.subscription_account_mismatch': [
    'reauthorize_new_session',
    'The Claude account changed. Stop this session and start a new authorized session.',
  ],
  'desktop.subscription_account_required': [
    'verify_native_account',
    'Verify the Claude account on the machine where work runs before you start this session.',
  ],
  'desktop.subscription_credentials_invalid': [
    'repair_managed_launch',
    'The managed launch configuration is not valid. Repair the managed launch configuration.',
  ],
  'desktop.subscription_target_required': [
    'open_authorized_setup',
    'The Verdictan policy does not permit the selected model. Choose an authorized model, or ask your administrator.',
  ],
  'desktop.readiness_required': [
    'inspect_runtime',
    'The Verdictan readiness check did not pass. Inspect the runtime before you start the turn again.',
  ],
  'desktop.readiness_failed': [
    'inspect_runtime',
    'The Verdictan readiness check did not pass. Inspect the runtime before you start the turn again.',
  ],
  'desktop.resume_incompatible': [
    'reauthorize_new_session',
    'This conversation has a different access binding. Start a new authorized session to change it.',
  ],
  'desktop.agent_version_unsupported': [
    'check_native_compatibility',
    `Claude subscription access requires Claude Code ${claudeSubscriptionNativeVersion}. Install that version on the machine where work runs.`,
  ],
};
/** Maps a safe Claude subscription error code to one user recovery action. */
export function claudeSubscriptionRecovery(code: unknown): SubscriptionRecovery | null {
  if (typeof code !== 'string' || !Object.hasOwn(recoveries, code)) return null;
  const [action, message] = recoveries[code];
  return { code, action, message };
}

const subscriptionMarkers = [
  'claude_subscription',
  'codex_subscription',
  'user_claude_subscription',
  'user_codex_subscription',
];
/** True when a usage or billing record says that the user's own subscription pays. */
export function isSubscriptionBilling(source: unknown) {
  if (!source || typeof source !== 'object') return false;
  const record = source as Record<string, unknown>;
  return (
    [
      'payer',
      'credential_origin',
      'usage_category',
      'billing_category',
      'provider_access_mode',
    ].some((key) => subscriptionMarkers.includes(record[key] as string)) ||
    record.pricing === 'subscription'
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
    return 'Paid by your subscription. Provider charge is not known.';
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
export type ManagedSetupStep = 'region' | 'sign-in' | 'status' | 'agent-setup' | 'runtime';
/** Where each step is in Settings: the section, the element that gets focus, and a label. */
export const managedSetupTargets: Record<
  ManagedSetupStep,
  { section: 'accounts' | 'updates'; anchor: string; label: string }
> = {
  region: { section: 'accounts', anchor: 'verdictan-region', label: 'Select Verdictan region' },
  'sign-in': { section: 'accounts', anchor: 'verdictan-account', label: 'Sign in to Verdictan' },
  status: { section: 'accounts', anchor: 'verdictan-account', label: 'Check Verdictan status' },
  'agent-setup': {
    section: 'accounts',
    anchor: 'managed-agent-setup',
    label: 'Open managed agent setup',
  },
  runtime: { section: 'updates', anchor: 'verdictan-runtime', label: 'Open managed runtime' },
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
  'Choose an authorized team, policy, provider access, and model for this agent in managed agent setup.';
const signInAgain = 'Sign in to Verdictan again. Then send your message again.';
const runtimeRepair =
  'Install or update the approved Verdictan runtime on the machine where work runs.';
const supportedAgent =
  'Install the agent version that Verdictan supports on the machine where work runs.';
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
    'Install the managed runtime on this SSH host. Select the host in Updates.',
  ],
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
  'desktop.subscription_agent_required': ['agent-setup', setupChoice],
  'desktop.resource_binding_mismatch': ['agent-setup', setupChoice],
  'desktop.agent_version_unsupported': ['agent-setup', supportedAgent],
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
  check_native_compatibility: 'agent-setup',
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
  const code = /^desktop\.[a-z_]{1,100}$/.test(raw) ? raw : 'desktop.launch_blocked';
  const recovery = claudeSubscriptionRecovery(code);
  const known: [ManagedSetupStep, string] | undefined = recovery
    ? [recoverySteps[recovery.action], recovery.message]
    : launchBlocks[code];
  const own = text && text !== code && !/^desktop\.[a-z_]+$/.test(text) ? text : '';
  const [step, detail] = known || [
    'status',
    own || 'The managed launch checks did not pass. Check Verdictan status in Settings.',
  ];
  return {
    code,
    step,
    message: detail.startsWith(managedOnlyNotice) ? detail : `${managedOnlyNotice} ${detail}`,
  };
}
