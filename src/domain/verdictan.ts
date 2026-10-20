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
  teamId: string;
  configurationId: string;
  configurationVersionId: string;
  providerConnectionId: string;
  model: string;
}
export interface VerdictanSetup {
  status: string;
  teams: { team_id: string }[];
  policies: { configuration_id: string; configuration_version_id: string }[];
  providerConnections: { provider_connection_id: string; provider: string }[];
  selections: Partial<Record<'codex' | 'claude', VerdictanSelection>>;
}
