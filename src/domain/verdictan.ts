import {
  agentMinimumVersions,
  agentVersionRequirement,
  nativeAgentNames,
  type NativeAgentKind,
} from './agent-version';
import { safeProgramPath } from './agent-programs';
import { recommendedRuntime, supportWindow } from './compatibility';
import type { PolicyRecord, PolicyRegion, PolicyReview, ReviewDecision } from './policy-result';
import { settingsAnchors, type SettingsSection } from './settings-route';

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
  /** The plan name of the organization, for example "Team". Only when the service sends it. */
  plan?: string;
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
  /** The SSH hosts that still have no keychain access after Check status. Names only. */
  keychainHosts?: string[];
  /** True while a request waits for keychain access, for example for a macOS prompt. */
  keychainWaiting?: boolean;
  /** Account authentication alone does not authorize agent dispatch. */
  executionReady: boolean;
  /**
   * The browser sign-in that waits for the user. The URL holds only the public PKCE challenge
   * and state, never a token. Undefined when no sign-in waits.
   */
  authorization?: {
    url: string;
    intent: 'login' | 'register';
    startedAt: string;
    expiresAt: string;
  };
}

/** First-run state that the main process keeps, so it survives a cleared renderer storage. */
export interface FirstRunState {
  /** True after the user finished or skipped the Welcome screen once. */
  welcomeDone: boolean;
  /** True after any account signed in on this computer. */
  everSignedIn: boolean;
}

/** Notification choices. Both are on by default. */
export interface NotificationPreferences {
  finished: boolean;
  needsInput: boolean;
}
export interface VerdictanAPI {
  verdictanSetRegion(region: 'eu' | 'us'): Promise<VerdictanStatus>;
  onVerdictanChanged?(listener: () => void): () => void;
  verdictanSetup(): Promise<VerdictanSetup>;
  /** Runs the setup of this computer again: the bootstrap when needed, and its gateway. */
  verdictanSetupRefresh?(): Promise<VerdictanSetup>;
  verdictanSelect(
    agent: 'codex' | 'claude',
    selection: VerdictanSelection,
  ): Promise<VerdictanSetup>;
  /**
   * Sets the agent that new chats on a computer use: 'local' or the SSH host ID. Existing chats
   * keep their agent. Older desktop apps do not have it.
   */
  verdictanSetComputerAgent?(computer: string, agentId: string): Promise<VerdictanSetup>;
  verdictanStatus(): Promise<VerdictanStatus>;
  verdictanCheck(): Promise<VerdictanStatus>;
  verdictanAuthorize(intent: 'login' | 'register'): Promise<VerdictanStatus>;
  verdictanCancel(): Promise<VerdictanStatus>;
  verdictanRenew(): Promise<VerdictanStatus>;
  verdictanLogout(): Promise<VerdictanStatus>;
  /** Opens the waiting sign-in URL in the browser again. Rejects when no sign-in waits. */
  verdictanReopenBrowser(): Promise<void>;
  /** Opens the Verdictan console of the saved region ("Manage account"). */
  verdictanOpenConsole(): Promise<void>;
  /**
   * Opens one account page of the Verdictan console of the saved region: a new verification
   * email, or account recovery. The console and the account service do the work. Kalkidan
   * sends no account data in the address.
   */
  verdictanOpenAccountPage(page: VerdictanAccountPage): Promise<void>;
  /**
   * Saves the recommended setup for every agent that has no saved setup yet, with the same
   * preselection that Settings shows. Returns the new setup.
   */
  verdictanApplyRecommended(): Promise<VerdictanSetup>;
  /** The saved policy results of a chat, oldest first. Older desktop apps do not have it. */
  chatPolicyResults?(agent: string, id: string, hostId?: string): Promise<PolicyRecord[]>;
  /** Reads the current state of a policy review. Older desktop apps do not have it. */
  verdictanReviewInspect?(requestId: string, region: PolicyRegion): Promise<PolicyReview>;
  /** Opens the checked Console record of a policy review. The renderer sends no URL. */
  verdictanReviewOpen?(requestId: string, region: PolicyRegion): Promise<PolicyReview>;
  /** Approves or denies a policy review as the signed-in reviewer. The server checks it. */
  verdictanReviewDecide?(
    requestId: string,
    region: PolicyRegion,
    decision: ReviewDecision,
    reason: string,
    revision: string,
  ): Promise<PolicyReview>;
  firstRunState(): Promise<FirstRunState>;
  setWelcomeDone(): Promise<FirstRunState>;
  notificationPreferences(): Promise<NotificationPreferences>;
  setNotificationPreferences(value: NotificationPreferences): Promise<NotificationPreferences>;
}

/** The account pages of the Verdictan console that Kalkidan opens. Fixed paths only. */
export const verdictanAccountPages = {
  verify: '/verify-email?resend=1',
  recover: '/forgot-password',
} as const;
export type VerdictanAccountPage = keyof typeof verdictanAccountPages;
/** The address of an account page. Rejects a page that is not in the fixed list. */
export function verdictanAccountPageUrl(consoleOrigin: string, page: unknown) {
  if (typeof page !== 'string' || !Object.hasOwn(verdictanAccountPages, page))
    throw new Error('Unknown account page.');
  return new URL(verdictanAccountPages[page as VerdictanAccountPage], consoleOrigin).href;
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
   * IDs are empty. A saved selection has no agent: each computer has one agent for Codex and
   * Claude Code (`computerAgents`). A launch adds the agent of the computer or of the chat.
   * Missing in a launch: the team and policy choice of older runtimes.
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
   * `runtime_too_old`: the runtime has neither `setup.bootstrap` nor a usable
   * `setup.ensure_default`, so it cannot run the setup. See `supportWindow.runtime.setupMinimum`.
   */
  bootstrapIssue?: 'team_required' | 'failed' | 'runtime_too_old';
  /** The safe error code of the setup step that failed. Settings shows it with the words. */
  setupCode?: string;
  /**
   * The gateway of this computer that Kalkidan made after sign-in, for the agent of this
   * computer. `skipped`: the setup has no agent for this computer yet. Missing before the run.
   */
  computerGateway?: { status: 'created' | 'existing' | 'skipped' | 'failed'; code?: string };
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
  /** The model access and the default model of each coding agent. */
  selections: Partial<Record<'codex' | 'claude', VerdictanSelection>>;
  /**
   * The agent of each computer, by computer ID: 'local' or the SSH host ID. Codex and Claude
   * Code on the computer both use it for new chats. A computer that is not in the list uses
   * `defaultAgentId`, else the Kalkidan agent.
   */
  computerAgents?: Record<string, string>;
  /**
   * The agent that Codex and Claude Code both used before each computer had its own agent.
   * Missing when they used different agents. Then the Kalkidan agent applies.
   */
  defaultAgentId?: string;
  /**
   * The agent of each coding agent before each computer had its own agent. Chats from that
   * time have no agent in their binding. They keep this agent.
   */
  legacyAgents?: Partial<Record<'codex' | 'claude', string>>;
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
  // With the agent choice, the agent belongs to the computer. See `computerAgentIssue`.
  if (usesAgentChoice(setup) && !selection.agentId) return undefined;
  if (selection.agentId) {
    if (setup.agents?.some((agent) => agent.agent_id === selection.agentId)) return undefined;
    return defaultRemoved(setup) && selection.agentId === setup.bootstrap?.agent_id
      ? 'desktop.setup_default_removed'
      : 'desktop.setup_agent_unavailable';
  }
  if (usesDefaultPolicy(selection) && defaultRemoved(setup)) return 'desktop.setup_default_removed';
  return undefined;
}
/** The fields of a selection that make the setup. A missing value is the same as empty. */
function selectionFields(value: VerdictanSelection) {
  return {
    teamId: value.teamId || '',
    configurationId: value.configurationId || '',
    configurationVersionId: value.configurationVersionId || '',
    // A selection without a mode uses the organization connection.
    providerAccessMode: value.providerAccessMode || 'byok',
    providerConnectionId: value.providerConnectionId || '',
    model: value.model || '',
    agentId: value.agentId || '',
  };
}
/**
 * True when the form `value` is the saved selection. With the agent choice, the agent belongs
 * to the computer, so only the model access and the model count.
 */
export function sameSelection(
  setup: VerdictanSetup,
  saved: VerdictanSelection | undefined,
  value: VerdictanSelection,
) {
  if (!saved) return false;
  const a = selectionFields(saved);
  const b = selectionFields(value);
  const access = ['providerAccessMode', 'providerConnectionId', 'model'] as const;
  const keys: (keyof typeof a)[] = usesAgentChoice(setup)
    ? [...access]
    : [...access, 'teamId', 'configurationId', 'configurationVersionId', 'agentId'];
  return keys.every((key) => a[key] === b[key]);
}
export type ManagedAgentKind = 'codex' | 'claude';
const agentProviders: Record<ManagedAgentKind, string> = { codex: 'openai', claude: 'anthropic' };
const emptySelection: VerdictanSelection = {
  teamId: '',
  configurationId: '',
  configurationVersionId: '',
  providerConnectionId: '',
  model: '',
};
/** The models that the organization allows for an agent, or nothing when it sends no list. */
export function setupAllowedModels(setup: VerdictanSetup | undefined, agent: ManagedAgentKind) {
  const value = setup?.allowedModels as unknown;
  const list = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? (value as Record<string, unknown>)[agent]
      : undefined;
  return Array.isArray(list)
    ? list.filter((item): item is string => typeof item === 'string' && !!item.trim())
    : undefined;
}
/**
 * The selection that Settings shows first for an agent: the saved one, or the only choice of
 * each list. The Kalkidan agent is preselected. The user must still choose when a list has
 * more than one item. Settings and "Use recommended setup" both use it.
 */
export function initialSelection(
  setup: VerdictanSetup,
  agent: ManagedAgentKind,
): VerdictanSelection {
  const saved = setup.selections[agent];
  const issue = saved && selectionIssue(setup, saved);
  const agentChoice = usesAgentChoice(setup);
  if (saved && !issue && !saved.agentId && !agentChoice) return saved;
  const connections = setup.providerConnections.filter((p) => p.provider === agentProviders[agent]);
  // A saved selection that needs a new agent or policy keeps its access and model.
  const { agentId: _agent, ...kept } = saved || {
    ...emptySelection,
    providerConnectionId: connections.length === 1 ? connections[0].provider_connection_id : '',
  };
  // With the agent choice, the agent belongs to the computer. The selection has the access only.
  if (agentChoice) return { ...kept, teamId: '', configurationId: '', configurationVersionId: '' };
  // With a default, empty policy IDs select it. Otherwise the only policy, when there is one.
  const fallback = !defaultRemoved(setup) && !!setup.defaultPolicy;
  const [policy] = !fallback && setup.policies.length === 1 ? setup.policies : [];
  return {
    ...kept,
    teamId: setup.teams.length === 1 ? setup.teams[0].team_id : '',
    configurationId: policy?.configuration_id || '',
    configurationVersionId: policy?.configuration_version_id || '',
  };
}
/** True when a selection has every choice that a save needs. */
export function completeSelection(
  setup: VerdictanSetup,
  agent: ManagedAgentKind,
  value: VerdictanSelection,
) {
  const agentChoice = usesAgentChoice(setup);
  const defaultPolicy = defaultRemoved(setup) ? undefined : setup.defaultPolicy;
  return (
    (agentChoice ||
      (!!value.teamId &&
        (!!value.configurationVersionId || (!!defaultPolicy && usesDefaultPolicy(value))))) &&
    (isSubscriptionMode(value.providerAccessMode)
      ? subscriptionAgent[value.providerAccessMode] === agent &&
        !!setup.providerAccessModes?.includes(value.providerAccessMode)
      : setup.providerConnections.some(
          (p) =>
            p.provider_connection_id === value.providerConnectionId &&
            p.provider === agentProviders[agent],
        )) &&
    !!value.model
  );
}
/**
 * The recommended setup for an agent that has no saved setup: the preselection of Settings,
 * the only provider connection (or the subscription of the agent when there is no
 * connection and the runtime offers it), and the first allowed model. `models` is the model
 * list of the agent, used when the organization sends no allowed list. Returns nothing when
 * the user must choose, for example between two teams.
 */
export function recommendedSelection(
  setup: VerdictanSetup,
  agent: ManagedAgentKind,
  models: readonly string[] = [],
): VerdictanSelection | undefined {
  if (setup.selections[agent]) return undefined;
  const value = initialSelection(setup, agent);
  const connections = setup.providerConnections.filter((p) => p.provider === agentProviders[agent]);
  const mode: ProviderAccessMode = agent === 'codex' ? 'codex_subscription' : 'claude_subscription';
  const access: Partial<VerdictanSelection> =
    !value.providerConnectionId && !connections.length && setup.providerAccessModes?.includes(mode)
      ? { providerAccessMode: mode, providerConnectionId: '' }
      : {};
  const model = value.model || (setupAllowedModels(setup, agent) ?? models)[0] || '';
  const next: VerdictanSelection = { ...value, ...access, model };
  return completeSelection(setup, agent, next) ? next : undefined;
}
/** The computer ID of this computer. An SSH host has its host ID. */
export const localComputer = 'local';
/**
 * The ID of the agent that new chats on a computer use: the choice of the computer, the agent
 * that both coding agents used before, or the Kalkidan agent. Empty when the user must choose.
 */
export function computerAgentId(setup: VerdictanSetup, computer: string) {
  const saved = setup.computerAgents?.[computer] || setup.defaultAgentId;
  if (saved) return saved;
  const agents = setup.agents || [];
  const pick =
    agents.find((a) => a.default) ||
    (agents.length === 1 && !defaultRemoved(setup) ? agents[0] : undefined);
  return pick?.agent_id || '';
}
/** The agent record of an agent ID, or nothing when the user cannot use the agent now. */
export const findAgent = (setup: VerdictanSetup, agentId: string | undefined) =>
  agentId ? setup.agents?.find((a) => a.agent_id === agentId) : undefined;
/** The code that stops new chats on a computer, or nothing when its agent can work. */
export function computerAgentIssue(setup: VerdictanSetup, computer: string): string | undefined {
  if (!usesAgentChoice(setup)) return undefined;
  const id = computerAgentId(setup, computer);
  if (!id)
    return defaultRemoved(setup)
      ? 'desktop.setup_default_removed'
      : 'desktop.setup_selection_required';
  if (findAgent(setup, id)) return undefined;
  return defaultRemoved(setup) && id === setup.bootstrap?.agent_id
    ? 'desktop.setup_default_removed'
    : 'desktop.setup_agent_unavailable';
}
/** The visible name of the agent of a computer, or nothing when it is not available. */
export function computerAgentLabel(setup: VerdictanSetup, computer: string) {
  const agents = setup.agents || [];
  const index = agents.findIndex((a) => a.agent_id === computerAgentId(setup, computer));
  return index >= 0 ? agentLabels(agents)[index] : undefined;
}
/** The selection of a coding agent with an agent. The deployed policy of the agent applies. */
export function withAgent(selection: VerdictanSelection, agent: VerdictanAgent) {
  return {
    ...selection,
    agentId: agent.agent_id,
    teamId: agent.team_id,
    configurationId: '',
    configurationVersionId: '',
  };
}

/**
 * The words of the sign-out confirmation, for example "Sign out stops 2 running agents and
 * disconnects 1 SSH host. Your projects and chats stay on this computer."
 */
export function signOutDetail(agents: number, hosts: number) {
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const stops = agents ? `stops ${count(agents, 'running agent')}` : '';
  const disconnects = hosts ? `disconnects ${count(hosts, 'SSH host')}` : '';
  const actions = [stops, disconnects].filter(Boolean).join(' and ');
  return `${actions ? `Sign out ${actions}. ` : ''}Your projects and chats stay on this computer.`;
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
 * Gateway errors (internal name: managed agent errors). The desktop and the gateway runtime send
 * a stable code, for example `desktop.runtime_missing`. The backend error message is the plain
 * text, then the code in square brackets: "The Verdictan gateway is not installed on this
 * computer. [desktop.runtime_not_found]". Read the code with `managedErrorCode`. Show the message
 * without the brackets, and never show a code alone.
 *
 * `section` is the older Settings section of the fix: 'computers' is the gateway runtime (it
 * installs and repairs by itself, so the fix is "Try again"), 'agents' is the agent CLI in
 * Settings › Tools. `retry` is true when the same action can work a second time without a change.
 *
 * Each chat runs the detected agent CLI, and its model traffic goes through the Verdictan gateway,
 * so the policy and the inference guard always apply.
 */
export interface ManagedErrorInfo {
  message: string;
  section?: SettingsSection;
  retry?: boolean;
  /** True when a sign-in fixes the error. Show a Sign in action, not a Settings link. */
  signIn?: boolean;
}
/** What the app knows about the account when it shows an error. */
export interface ManagedErrorContext {
  /** True when the user saved a region. A missing sign-in is then the real problem. */
  regionSaved?: boolean;
}
/** The words and action when a region is saved but nobody is signed in. */
export const signInToStart: ManagedErrorInfo = {
  message: 'Sign in to Verdictan to start chats.',
  section: 'account',
  signIn: true,
};
const setUp = 'agents' as const;
const signInClaude =
  'Sign in to Claude Code on the machine where work runs. Then send the message again.';
export const managedErrors: Record<string, ManagedErrorInfo> = {
  'desktop.runtime_missing': {
    message:
      'The Verdictan gateway is not ready on this computer. Kalkidan installs it by itself. Wait, then try again.',
    section: 'computers',
  },
  'desktop.remote_runtime_missing': {
    message:
      'The Verdictan gateway is not ready on this host. Kalkidan installs it by itself. Wait, then try again.',
    section: 'computers',
  },
  'desktop.runtime_not_found': {
    message: 'The Verdictan gateway is not installed on this computer.',
    section: 'computers',
  },
  'desktop.executable_invalid': {
    message: 'The Verdictan gateway on this computer is damaged. Try again to repair it.',
    section: 'computers',
  },
  'desktop.auth_required': { message: 'Sign in to Verdictan.', section: 'account' },
  'desktop.auth_expired': {
    message: 'Your Verdictan sign-in expired. Sign in again.',
    section: 'account',
  },
  'desktop.account_invalid': {
    message: 'The Verdictan account is not valid. Sign in again.',
    section: 'account',
  },
  'desktop.identity_mismatch': {
    message: 'The browser account is not the saved account. Use the same account, or sign out.',
    section: 'account',
  },
  'desktop.region_mismatch': {
    message: 'The saved account is in a different region. Sign out, then change the region.',
    section: 'account',
  },
  'desktop.browser_failed': { message: 'The browser did not open. Try again.', retry: true },
  'desktop.authorization_timeout': {
    message:
      'The sign-in did not finish. Kalkidan waited 5 minutes. Nothing changed on your account.',
    section: 'account',
    retry: true,
  },
  'desktop.cancel_failed': { message: 'The sign-in did not stop. Check the status.', retry: true },
  'desktop.setup_invalid': {
    message:
      'Your organization has no complete agent policy in Verdictan. Ask an organization administrator for help.',
    section: 'agents',
  },
  'desktop.setup_selection_required': {
    message:
      'Your organization has no agent policy for this agent in Verdictan. Ask an organization administrator for help.',
    section: 'agents',
  },
  'desktop.setup_default_removed': {
    message: 'An administrator removed the default Kalkidan setup. Choose another agent.',
    section: 'agents',
  },
  'desktop.setup_agent_unavailable': {
    message: 'The agent of this computer is not available now. Choose another agent.',
    section: 'computers',
  },
  'desktop.agent_unavailable': {
    message:
      "This chat's agent is no longer available. Fork the chat to continue it with the agent of this computer.",
  },
  'desktop.resource_conflict': {
    message:
      'Verdictan cannot use the gateway of this agent on this computer. An administrator removed it, or Verdictan cannot run a second agent on this computer yet. Ask an organization administrator for help.',
    section: 'computers',
  },
  'desktop.scope_mismatch': {
    message:
      'Verdictan cannot use this computer for a second project yet. Continue in the first project, or ask an administrator to update Verdictan.',
  },
  'desktop.setup_resource_unavailable': {
    message: 'The agent that you chose is not available now. Choose another agent.',
    section: 'agents',
  },
  'desktop.setup_bootstrap_required': {
    message: 'Ask an organization administrator to finish Kalkidan setup.',
    section: 'agents',
  },
  'desktop.history_invalid': {
    message: 'Kalkidan could not check the history from Verdictan. Load it again.',
    retry: true,
  },
  'desktop.setup_default_configuration_required': {
    message:
      'Your organization has no Kalkidan default policy. Ask an organization administrator to connect Kalkidan once.',
    section: 'agents',
  },
  'desktop.setup_permission_required': {
    message:
      'You cannot read the Kalkidan default policy. Ask an organization administrator for access.',
    section: 'agents',
  },
  'desktop.gateway_limit': {
    message: 'This computer runs chats on 16 agents. Close old chats to use another agent.',
  },
  'desktop.gateway_moved': {
    message:
      'The Verdictan gateway of this agent restarted on a new port. The chat stopped. Send a message to continue the chat.',
    retry: true,
  },
  'desktop.runtime_expired': {
    message: 'Verdictan access for this computer expired. Try again.',
    section: 'computers',
  },
  'desktop.event_buffer_full': {
    message:
      'The event buffer of the Verdictan gateway is full. New requests stop until Verdictan receives the stored events. Check the network connection, then try again.',
    section: 'computers',
  },
  'desktop.clock_skew': {
    message:
      'The clock of this computer is wrong. Set the date and time to update automatically, then try again.',
    section: 'computers',
  },
  'desktop.invalid_runtime_credential': {
    message: 'Verdictan access for this computer is not valid. Try again.',
    section: 'computers',
  },
  'desktop.host_revoked': {
    message: 'This computer cannot use the Verdictan gateway now. Sign in again.',
    section: 'computers',
  },
  'desktop.runtime_reconciliation_required': {
    message: 'The Verdictan gateway must update its records. Try again.',
    section: 'computers',
  },
  'desktop.runtime_version_unsupported': {
    message: `Kalkidan does not support this Verdictan gateway version. Kalkidan updates it to ${recommendedRuntime()} or later by itself. Wait, then try again.`,
    section: 'computers',
  },
  'desktop.protocol_unsupported': {
    message: `This Verdictan gateway does not support desktop protocol ${supportWindow.protocol.current}. Update Kalkidan to its newest version.`,
    section: 'computers',
  },
  'desktop.agent_version_unsupported': {
    message:
      'Kalkidan cannot confirm the version of the installed agent. Check the agent in Settings › Tools, then try again.',
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
    section: 'agents',
  },
  'desktop.resume_incompatible': {
    message: 'The Verdictan gateway cannot continue this chat. Start a new chat.',
  },
  'desktop.resume_binding_required': {
    message: 'The Verdictan gateway cannot continue this chat. Start a new chat.',
  },
  'desktop.resume_binding_invalid': {
    message: 'The Verdictan gateway cannot continue this chat. Start a new chat.',
  },
  'desktop.runtime_binding_mismatch': {
    message: 'This chat belongs to a different Verdictan setup. Start a new chat.',
  },
  'desktop.process_isolation_unavailable': {
    message: 'This computer cannot keep the agent apart from other programs.',
    section: 'computers',
  },
  'desktop.isolation_scope_invalid': {
    message: 'This computer cannot keep the agent apart from other programs.',
    section: 'computers',
  },
  'desktop.protected_pipe_unavailable': {
    message: 'The Verdictan gateway cannot open a private connection on this computer.',
    section: 'computers',
  },
  'desktop.loopback_required': {
    message: 'The Verdictan gateway needs a local network connection that is not available.',
    section: 'computers',
  },
  // Kalkidan does not try again by itself, because each try shows the keychain prompt again.
  'desktop.secure_storage_unavailable': {
    message:
      'Kalkidan did not get access to the system keychain. The access was refused, or the keychain is locked. Select Check status. Then allow access when the system asks.',
    retry: true,
  },
  'desktop.operation_in_progress': {
    message:
      'Another Verdictan gateway operation is running. Wait for it to finish, then try again.',
    retry: true,
  },
  'desktop.runtime_limit': {
    message: 'Too many agent runs are open. Stop a chat, then try again.',
    retry: true,
  },
  'desktop.runtime_already_owned': {
    message: 'This chat already runs. Wait, then try again.',
    retry: true,
  },
  'desktop.connection_limit': {
    message: 'Too many connections to the Verdictan gateway are open. Try again.',
    retry: true,
  },
  'desktop.request_timeout': {
    message: 'The Verdictan gateway did not reply in time. Try again.',
    retry: true,
  },
  'desktop.runtime_starting': {
    message: 'The Verdictan gateway is starting. Wait, then try again.',
    retry: true,
  },
  'desktop.runtime_stopped': { message: 'The Verdictan gateway stopped. Try again.', retry: true },
  'desktop.operation_unsupported': {
    message:
      'The installed Verdictan gateway cannot do this. Kalkidan updates it by itself. Wait, then try again.',
    section: 'computers',
  },
  'desktop.region_required': {
    message: 'Select the EU or US region, then sign in to Verdictan.',
    section: 'account',
  },
  'desktop.region_locked': {
    message: 'Sign out of Verdictan to change the region.',
    section: 'account',
  },
  'desktop.session_rejected': {
    message: 'Verdictan did not accept the sign-in. Sign in again.',
    section: 'account',
  },
  'desktop.readiness_required': {
    message: 'The Verdictan gateway check on the machine where work runs did not pass. Try again.',
    section: 'computers',
    retry: true,
  },
  'desktop.readiness_failed': {
    message: 'The Verdictan gateway check on the machine where work runs did not pass. Try again.',
    section: 'computers',
    retry: true,
  },
  'desktop.readiness_blocked': {
    message:
      'The Verdictan gateway on the machine where work runs is not ready. Try again in a moment.',
    section: 'computers',
    retry: true,
  },
  'desktop.event_authority_unavailable': {
    message: 'The Verdictan service did not answer in time. Try again.',
    retry: true,
  },
  'desktop.evidence_unavailable': {
    message:
      'The Verdictan gateway on the machine where work runs did not send its status. Try again in a moment.',
    section: 'computers',
    retry: true,
  },
  'desktop.claude_subscription_unsupported': {
    message:
      'This Verdictan gateway cannot use your Claude subscription. Your work is safe. Kalkidan updates it by itself. Wait, then try again.',
    section: 'computers',
  },
  'desktop.claude_subscription_login_required': {
    message: `${signInClaude} Kalkidan does not send your message again.`,
    section: 'agents',
  },
  'desktop.claude_subscription_native_profile_unsupported': {
    message:
      'This computer uses a custom Claude Code profile. Use the default Claude Code sign-in on this computer. Then send the message again.',
    section: 'agents',
  },
  'desktop.claude_subscription_credential_format_unsupported': {
    message:
      'Kalkidan cannot read the Claude Code sign-in on the machine where work runs. The format is not supported, or the file is not private. Update Claude Code and run /login. Then send the message again.',
    section: 'agents',
  },
  'desktop.codex_subscription_login_required': {
    message:
      'Codex is not signed in with your ChatGPT subscription on the machine where work runs. Run codex login there. Then send the message again.',
    section: 'agents',
  },
  'desktop.codex_subscription_login_invalid': {
    message:
      'Kalkidan cannot read the Codex sign-in on the machine where work runs. Run codex login there again. Then send the message again.',
    section: 'agents',
  },
  'desktop.codex_gateway_auth_missing': {
    message:
      'Codex did not send its ChatGPT sign-in to the Verdictan gateway, so the gateway refused the request. Try again. If the problem continues, run codex login on the machine where work runs.',
    retry: true,
  },
  'desktop.codex_subscription_catalog_unavailable': {
    message:
      'Codex cannot reach its models through the Verdictan gateway. Try again. If the problem continues, run codex login on the machine where work runs.',
    retry: true,
  },
  'desktop.claude_subscription_login_expiring': {
    message:
      'Your Claude Code sign-in expires soon. Run /login in Claude Code on the machine where work runs. Then send the message again.',
    section: 'agents',
  },
  'desktop.claude_subscription_identity_unavailable': {
    message: 'The Verdictan gateway cannot check your Claude account now. Try again.',
    section: 'agents',
  },
  'desktop.claude_subscription_route_unsupported': {
    message:
      'Claude Code sent a request that the Verdictan gateway does not support. Your work is safe. Check the Claude Code version.',
    section: 'agents',
  },
  'desktop.subscription_account_mismatch': {
    message: 'The Claude account changed. Stop this chat and start a new chat.',
  },
  'desktop.subscription_account_required': {
    message: 'Sign in to Claude Code on the machine where work runs. Then start this chat again.',
    section: 'agents',
  },
  'desktop.subscription_credentials_invalid': {
    message: 'The Verdictan launch settings are not valid. Start a new chat.',
    section: 'agents',
  },
  'desktop.subscription_target_required': {
    message:
      'Your policy does not allow the selected model. Choose an allowed model, or ask your administrator.',
    section: 'agents',
  },
  'desktop.invalid_review': { message: 'This review is not valid. Refresh the chat.' },
  'desktop.review_region_mismatch': {
    message:
      'This review is in a different Verdictan region. Sign in to that region to see the review.',
    section: 'account',
  },
  'desktop.review_link_unavailable': {
    message: 'You do not have permission to open this review in the Console.',
  },
  'desktop.review_forbidden': {
    message: 'You do not have permission to see or decide this review.',
  },
  'desktop.review_conflict': {
    message: 'The review changed. Refresh it, then try again.',
    retry: true,
  },
};
// Codes for a lost or failed connection. The same action can work a second time.
const connectionCodes =
  /^desktop\.(transport_\w+|gateway_\w+|process_failed|protocol_invalid|credential_\w+|readiness_\w+|evidence_\w+|events_\w+|snapshot_\w+)$/;
/** Returns the managed agent code in an error message, or nothing. */
export function managedErrorCode(text: unknown) {
  return typeof text === 'string' ? text.match(/\bdesktop\.[a-z_]{1,100}\b/)?.[0] : undefined;
}
/** Returns plain words and the fix for a managed agent code. Unknown codes get general words. */
export function managedErrorInfo(
  code: string,
  context: ManagedErrorContext = {},
): ManagedErrorInfo {
  if (code === 'desktop.region_required' && context.regionSaved) return signInToStart;
  return (
    managedErrors[code] ||
    (connectionCodes.test(code)
      ? { message: 'The connection to the Verdictan gateway stopped. Try again.', retry: true }
      : {
          message: 'The Verdictan gateway could not complete this operation. Try again.',
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
  'region' | 'sign-in' | 'status' | 'agent-setup' | 'runtime' | 'agents' | 'agent-sign-in';
/**
 * The step that fixes a block. A region step becomes the sign-in step when a region is saved:
 * the region is then not the problem.
 */
export function managedSetupStep(
  step: ManagedSetupStep,
  context: ManagedErrorContext = {},
): ManagedSetupStep {
  return step === 'region' && context.regionSaved ? 'sign-in' : step;
}
/**
 * Where each step is in Settings: the part, the element that gets focus, and a label. Round 11
 * has no agent setup in Kalkidan: the agent CLIs show in Settings › Tools, the gateway runtime
 * installs and repairs by itself (its step is "Try again"), and the agent policy is in Verdictan.
 */
export const managedSetupTargets: Record<
  ManagedSetupStep,
  { section: SettingsSection; anchor: string; label: string }
> = {
  region: { section: 'account', anchor: settingsAnchors.region, label: 'Select the region' },
  'sign-in': {
    section: 'account',
    anchor: settingsAnchors.account,
    label: 'Sign in to Verdictan',
  },
  status: { section: 'tools', anchor: 'settings-tools', label: 'Try again' },
  'agent-setup': {
    section: 'account',
    anchor: settingsAnchors.account,
    label: 'Open account settings',
  },
  runtime: { section: 'tools', anchor: 'settings-tools', label: 'Try again' },
  agents: { section: 'tools', anchor: 'settings-tools', label: 'Open Tools settings' },
  // The row of the coding agent in Tools tells how to sign in to it on that computer.
  'agent-sign-in': { section: 'tools', anchor: 'settings-tools', label: 'Open Tools settings' },
};
/** The first sentence of each message that stops a managed launch. */
export const managedOnlyNotice =
  'Kalkidan runs the agent CLI of this computer through the Verdictan gateway, for policy and usage.';
export interface ManagedLaunchBlock {
  code: string;
  step: ManagedSetupStep;
  message: string;
  /** The agent version that the launch found, for a version refusal. */
  version?: string;
  /** The path of the agent program that the launch checked, for a version refusal. */
  path?: string;
}
const setupChoice =
  'Your organization has no agent policy for this agent in Verdictan. Ask an organization administrator for help.';
const signInAgain = 'Sign in to Verdictan again. Then send your message again.';
const runtimeRepair =
  'The Verdictan gateway on the machine where work runs is not ready. Kalkidan repairs it by itself. Try again.';
const supportedAgent = `Install Codex ${agentMinimumVersions.codex} or later, or Claude Code ${agentMinimumVersions.claude_code} or later, on the machine where work runs.`;
const isolation = 'This machine cannot isolate agents. Use a supported macOS or Linux machine.';
const gateway = 'The Verdictan gateway did not start. Try again.';
const stopped = 'The Verdictan gateway stopped. Try again.';
const resume = 'This chat has no compatible Verdictan binding. Start a new chat to continue.';
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
    'The Verdictan gateway is not ready on this SSH host. Wait, then try again.',
  ],
  'desktop.remote_runtime_missing': [
    'runtime',
    'The Verdictan gateway is not ready on this SSH host. Wait, then try again.',
  ],
  'desktop.runtime_not_found': ['runtime', runtimeRepair],
  'desktop.runtime_starting': [
    'status',
    'The Verdictan gateway is starting. Wait, then try again.',
  ],
  'desktop.managed_launch_unavailable': ['runtime', runtimeRepair],
  'desktop.capabilities_invalid': ['runtime', runtimeRepair],
  'desktop.runtime_version_unsupported': [
    'runtime',
    `The Verdictan gateway on the machine where work runs is too old. Kalkidan updates it to ${recommendedRuntime()} or later by itself. Try again.`,
  ],
  'desktop.protocol_unsupported': ['runtime', runtimeRepair],
  // The runtime is installed, but its connection sent a reply that Kalkidan did not expect.
  'desktop.protocol_invalid': [
    'status',
    'The connection to the Verdictan gateway stopped. Try again.',
  ],
  'desktop.operation_unsupported': ['runtime', runtimeRepair],
  'desktop.process_failed': ['runtime', runtimeRepair],
  'desktop.gateway_protocol_invalid': ['runtime', runtimeRepair],
  'desktop.transport_closed': ['status', stopped],
  'desktop.transport_lost': ['status', stopped],
  'desktop.request_timeout': ['status', 'Verdictan did not respond in time. Try again.'],
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
    'The agent of this computer is not available now. Choose another agent.',
  ],
  'desktop.agent_unavailable': [
    'agent-setup',
    "This chat's agent is no longer available. Fork the chat to continue it with the agent of this computer.",
  ],
  'desktop.resource_conflict': [
    'agent-setup',
    'Verdictan cannot use the gateway of this agent on this computer. An administrator removed it, or Verdictan cannot run a second agent on this computer yet. Ask an organization administrator for help.',
  ],
  'desktop.scope_mismatch': [
    'status',
    'Verdictan cannot use this computer for a second project yet. Continue in the first project, or ask an administrator to update Verdictan.',
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
  'desktop.codex_subscription_login_required': [
    'agent-sign-in',
    'Run codex login on the machine where work runs. Then try again.',
  ],
  'desktop.codex_subscription_login_invalid': [
    'agent-sign-in',
    'Run codex login on the machine where work runs. Then try again.',
  ],
  'desktop.isolation_scope_invalid': ['runtime', isolation],
  'desktop.loopback_required': ['runtime', isolation],
  'desktop.protected_pipe_unavailable': ['runtime', isolation],
  'desktop.gateway_unavailable': ['status', gateway],
  'desktop.gateway_limit': [
    'status',
    'This computer runs chats on 16 agents. Close old chats to use another agent.',
  ],
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
  // Inspect means "check the status". A new install does not repair a failed check.
  inspect_runtime: 'status',
  check_native_compatibility: 'agents',
  reauthorize_new_session: 'agent-setup',
  verify_native_account: 'agent-setup',
  repair_managed_launch: 'agent-setup',
  open_authorized_setup: 'agent-setup',
};
// Codes that a second try can fix. No Settings step helps.
const transientRefusals = new Set([
  'desktop.event_authority_unavailable',
  'desktop.event_buffer_full',
  'desktop.request_timeout',
  'desktop.operation_in_progress',
  'desktop.runtime_starting',
  'desktop.runtime_limit',
  'desktop.runtime_already_owned',
  'desktop.connection_limit',
  'desktop.transport_closed',
  'desktop.transport_lost',
  'desktop.protocol_invalid',
  'desktop.codex_subscription_catalog_unavailable',
  'desktop.codex_gateway_auth_missing',
]);
// Codes of a gateway or check that did not become ready. A second try can fix them. The status
// in Settings shows more.
const statusRefusals = new Set([
  'desktop.readiness_blocked',
  'desktop.readiness_failed',
  'desktop.readiness_required',
  'desktop.evidence_unavailable',
  'desktop.gateway_unavailable',
  'desktop.gateway_failed',
  'desktop.gateway_start_timeout',
  'desktop.gateway_stopped',
  'desktop.runtime_stopped',
  // A refused keychain prompt. Check status starts the account runtime again, so it asks again.
  'desktop.secure_storage_unavailable',
]);
export const keychainRefusedCode = 'desktop.secure_storage_unavailable';
/** The words while a request waits for the person to answer a keychain prompt. */
export const keychainWaitingMessage =
  'Waiting for Keychain access on this computer. Allow access in the macOS dialog.';
/** The words for SSH hosts that still have no keychain access after Check status. */
export function keychainHostsMessage(names: string[]) {
  const hosts = names.join(', ');
  return `Kalkidan did not get access to the system keychain on ${hosts}. The access was refused, or the keychain is locked. Unlock it or allow access on ${hosts}. Then select Check status again.`;
}
// Codes of a computer that cannot isolate agents. No Settings step and no second try helps.
const platformRefusals = new Set([
  'desktop.clock_skew',
  'desktop.process_isolation_unavailable',
  'desktop.isolation_scope_invalid',
  'desktop.loopback_required',
  'desktop.protected_pipe_unavailable',
]);
/** Where the agent runs, for a launch refusal: "this computer" or the name of an SSH host. */
export interface RefusalContext {
  computer?: string;
  /** True when the agent runs on an SSH host. The system prompts there, not on this computer. */
  remote?: boolean;
  /** The agent version that the launch found, when the code is about the version. */
  version?: string;
  /** The path of the agent program that the launch checked, when the code is about the version. */
  path?: string;
  /** True when the user saved a region. */
  regionSaved?: boolean;
}
export interface ManagedRefusal {
  code: string;
  /** Plain words without the managed-only notice and without the code. */
  message: string;
  /** The setup step that can remove the block, or null when no step helps. */
  step: ManagedSetupStep | null;
  /** True when a second try can work. */
  retry: boolean;
}
const capital = (text: string) => text[0].toUpperCase() + text.slice(1);
/** The agent of a version code, for example `desktop.codex_version_unsupported`. */
export function versionAgent(code: string): NativeAgentKind | undefined {
  const kind = /^desktop\.(codex|claude_code)_version_/.exec(code)?.[1];
  return kind as NativeAgentKind | undefined;
}
/** A safe version string, or nothing. Versions come from the agent's `--version` output. */
export function safeVersion(value: unknown) {
  return typeof value === 'string' && /^[0-9][0-9A-Za-z.+-]{0,39}$/.test(value) ? value : undefined;
}
/** The specific words for a refusal code. Nothing for codes without specific words. */
function refusalWords(
  code: string,
  where: string,
  version?: string,
  path?: string,
  remote?: boolean,
): string | undefined {
  const kind = versionAgent(code);
  if (kind) {
    const name = nativeAgentNames[kind];
    const minimum = `Kalkidan needs ${name} ${agentMinimumVersions[kind]} or later.`;
    const at = path ? ` at ${path}` : '';
    const fix = `Update ${name} on ${where}, then try again.`;
    if (code.endsWith('_unknown'))
      return `Kalkidan cannot read the version of ${name}${at} on ${where}. ${minimum} ${fix}`;
    return version
      ? `${capital(where)} has ${name} ${version}${at}. ${minimum} ${fix}`
      : `${name}${at} on ${where} is too old. ${minimum} ${fix}`;
  }
  switch (code) {
    case 'desktop.agent_version_unsupported':
      return `Kalkidan cannot confirm the agent version on ${where}. ${supportedAgent}`;
    case 'desktop.readiness_blocked':
      return `The Verdictan gateway on ${where} is not ready. Try again in a moment.`;
    case 'desktop.evidence_unavailable':
      return `The Verdictan gateway on ${where} did not send its status. Try again in a moment.`;
    case 'desktop.readiness_failed':
    case 'desktop.readiness_required':
      return `The Verdictan gateway check on ${where} did not pass. Try again.`;
    case 'desktop.event_buffer_full':
      return `The event buffer on ${where} is full. New requests stop until Verdictan receives the stored events. Check the network connection of ${where}, then try again.`;
    case 'desktop.clock_skew':
      return `The clock of ${where} is wrong. Set the date and time to update automatically, then try again.`;
    case 'desktop.secure_storage_unavailable':
      if (remote)
        return `Kalkidan did not get access to the system keychain on ${where}. The access was refused, or the keychain on ${where} is locked. Unlock it or allow access on ${where}. Then select Check status, and try again.`;
      return `Kalkidan did not get access to the system keychain on ${where}. The access was refused, or the keychain is locked. Try again, and allow access when the system asks. If the system does not ask, select Check status.`;
    case 'desktop.event_authority_unavailable':
    case 'desktop.operation_in_progress':
      return managedErrors[code].message;
  }
  return undefined;
}
/** Codes that an update of the gateway runtime fixes. */
const runtimeUpdateCodes = new Set([
  'desktop.executable_invalid',
  'desktop.operation_unsupported',
  'desktop.claude_subscription_unsupported',
]);
/** The setup step for a launch refusal code. Null when no Settings step helps. */
function refusalStep(code: string): ManagedSetupStep | null {
  if (transientRefusals.has(code) || platformRefusals.has(code)) return null;
  if (statusRefusals.has(code)) return 'status';
  const recovery = claudeSubscriptionRecovery(code);
  if (recovery) return recoverySteps[recovery.action];
  const section = managedErrors[code]?.section;
  return (
    launchBlocks[code]?.[0] ||
    (runtimeUpdateCodes.has(code) ? 'runtime' : section ? 'agent-setup' : 'status')
  );
}
/**
 * Plain words, the setup step and the retry rule for a code that stopped a managed launch.
 * Only codes of a missing or old runtime get the runtime step. The words name the computer.
 */
export function managedRefusal(code: string, context: RefusalContext = {}): ManagedRefusal {
  const where = context.computer?.trim() || 'the machine where work runs';
  const version = safeVersion(context.version);
  if (code === 'desktop.region_required' && context.regionSaved)
    return { code, message: signInToStart.message, step: 'sign-in', retry: false };
  const message =
    refusalWords(code, where, version, safeProgramPath(context.path), context.remote) ||
    managedErrors[code]?.message ||
    launchBlocks[code]?.[1] ||
    'The Verdictan launch checks did not pass. Try again.';
  return {
    code,
    message,
    step: refusalStep(code),
    retry: transientRefusals.has(code) || statusRefusals.has(code) || !!managedErrors[code]?.retry,
  };
}
/**
 * The message and setup step for an error that stopped a managed launch. Each message starts
 * with the managed-only notice. An unknown error keeps its own text after the notice.
 */
export function managedLaunchBlock(
  error: unknown,
  context: ManagedErrorContext = {},
): ManagedLaunchBlock {
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
  // A block without a helpful step links to the status. The renderer uses the code instead.
  const step: ManagedSetupStep = managedSetupStep(refusalStep(code) || 'status', context);
  // Backend messages end with the code in square brackets. The code is never shown.
  const plain = withoutManagedCode(text)
    .replace(/\bdesktop\.[a-z_]{1,100}\b/g, '')
    .trim();
  const own = plain && !/^[\s.:[\]]*$/.test(plain) ? plain : '';
  const detail =
    (code === 'desktop.region_required' && context.regionSaved && signInToStart.message) ||
    managedErrors[code]?.message ||
    launchBlocks[code]?.[1] ||
    own ||
    'The Verdictan launch checks did not pass. Try again.';
  const version = safeVersion(record.version);
  const path = safeProgramPath(record.path);
  return {
    code,
    step,
    message: detail.startsWith(managedOnlyNotice) ? detail : `${managedOnlyNotice} ${detail}`,
    ...(version ? { version } : {}),
    ...(path ? { path } : {}),
  };
}
