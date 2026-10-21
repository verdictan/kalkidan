/** Safe desktop state. Account and runtime credentials never cross renderer IPC. */
export interface VerdictanAccount {
  state: 'signed-out' | 'authorizing' | 'authenticated' | 'expired';
  userId?: string;
  organizationId?: string;
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
export interface VerdictanSetup {
  providerAccessModes?: ProviderAccessMode[];
  status: string;
  teams: { team_id: string }[];
  policies: { configuration_id: string; configuration_version_id: string }[];
  providerConnections: { provider_connection_id: string; provider: string }[];
  selections: Partial<Record<'codex' | 'claude', VerdictanSelection>>;
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
