/** Safe desktop state. Account and runtime credentials never cross renderer IPC. */
export interface VerdictanAccount {
  state: 'signed-out' | 'authorizing' | 'authenticated' | 'expired';
  userId?: string;
  organizationId?: string;
  apiUrl: string;
  expiresAt?: string;
  /** Display names. Present only when the runtime sends them. */
  organizationName?: string;
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
  configurationId: string;
  configurationVersionId: string;
  providerConnectionId: string;
  model: string;
}
export interface VerdictanSetup {
  providerAccessModes?: ProviderAccessMode[];
  status: string;
  /** `name`, `version` and `allowedModels` are present only when the service sends them. */
  teams: { team_id: string; name?: string }[];
  policies: {
    configuration_id: string;
    configuration_version_id: string;
    name?: string;
    version?: string | number;
  }[];
  providerConnections: { provider_connection_id: string; provider: string; name?: string }[];
  /** Models that the organization allows: one list, or one list for each agent. */
  allowedModels?: string[] | Partial<Record<'codex' | 'claude', string[]>>;
  selections: Partial<Record<'codex' | 'claude', VerdictanSelection>>;
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
/** The only native Claude Code version qualified for subscription access. */
export const claudeSubscriptionNativeVersion = '2.1.304';
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
    message: 'Choose a team, a policy, a connection and a model for managed agents.',
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
    message: `Managed agents do not support the installed agent version. Claude subscription access needs Claude Code ${claudeSubscriptionNativeVersion}.`,
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
