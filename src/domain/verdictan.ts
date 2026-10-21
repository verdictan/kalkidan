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
  region?: 'global' | 'eu';
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
  verdictanSetRegion(region: 'global' | 'eu'): Promise<VerdictanStatus>;
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

export interface VerdictanSelection {
  providerAccessMode?: 'byok' | 'codex_subscription';
  teamId: string;
  configurationId: string;
  configurationVersionId: string;
  providerConnectionId: string;
  model: string;
}
export interface VerdictanSetup {
  providerAccessModes?: ('byok' | 'codex_subscription')[];
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
export interface ManagedErrorInfo {
  message: string;
  section?: 'managed-agents' | 'agents' | 'updates';
  retry?: boolean;
}
const setUp = 'managed-agents' as const;
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
    message: 'Managed agents do not support the installed agent version. Update the agent.',
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
