import {
  bootstrapReadinessValues,
  isSubscriptionMode,
  policyReadinessValues,
  selectionIssue,
  providerAccessModes,
  recommendedSelection,
  serviceName,
  subscriptionAgent,
  findAgent,
  usesAgentChoice,
  usesDefaultPolicy,
  type BootstrapReadiness,
  type PolicyReadiness,
  type ProviderAccessMode,
  type VerdictanAgent,
  type VerdictanSelection,
  type VerdictanSetup,
} from '../../src/domain/verdictan';
import { parseAccount, parseCapabilities } from './account';
import { DesktopProtocolError, type DesktopClient, type DesktopParameters } from './protocol';
import { BindingStore, identityKey } from './bindings';
import { uuid } from './credentials';
import { policyId } from './policy-id';

/**
 * A display name from the service. A missing, unsafe, or ID-only name stays missing, so the UI
 * shows a generic label. `extra` names other fields that can hold the name.
 */
function displayName(value: Record<string, unknown>, ...extra: string[]) {
  const name = serviceName(value.name, value.display_name, ...extra.map((key) => value[key]));
  return name ? { name } : {};
}
const modelList = (value: unknown) =>
  Array.isArray(value) && value.length <= 200
    ? value.filter(
        (item): item is string =>
          typeof item === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$/.test(item),
      )
    : undefined;
/** Allowed models: one list, or `{ codex, claude }`. Anything else stays missing. */
function allowedModels(value: unknown): Pick<VerdictanSetup, 'allowedModels'> {
  const list = modelList(value);
  if (list) return { allowedModels: list };
  if (!value || typeof value !== 'object') return {};
  const result: Partial<Record<'codex' | 'claude', string[]>> = {};
  for (const agent of ['codex', 'claude'] as const) {
    const models = modelList((value as Record<string, unknown>)[agent]);
    if (models) result[agent] = models;
  }
  return Object.keys(result).length ? { allowedModels: result } : {};
}
const serviceId = (value: unknown) =>
  typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
/** The bootstrap record summary, or undefined when it is missing or not valid. */
function bootstrapRecord(value: unknown): VerdictanSetup['bootstrap'] {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (
    !['bootstrapped', 'adopted'].includes(record.status as string) ||
    !serviceId(record.agent_id) ||
    !['available', 'deleted'].includes(record.configuration_status as string) ||
    !['available', 'inactive', 'deleted'].includes(record.agent_status as string)
  )
    return undefined;
  return {
    status: record.status as 'bootstrapped' | 'adopted',
    agent_id: record.agent_id as string,
    configuration_status: record.configuration_status as 'available' | 'deleted',
    agent_status: record.agent_status as 'available' | 'inactive' | 'deleted',
  };
}
/**
 * The agents that a host can attach to. An entry that `resources.provision` cannot accept (an
 * agent or team ID that is not a UUID, or invalid configuration IDs) is left out. The default
 * agent is first. Missing when the runtime does not send the list.
 */
function agentList(value: unknown): VerdictanAgent[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.length > 50) throw new DesktopProtocolError('desktop.setup_invalid');
  const agents: VerdictanAgent[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const agent = item as Record<string, unknown>;
    if (
      !uuid(agent.agent_id) ||
      !uuid(agent.team_id) ||
      !policyId(agent.configuration_id, 'configuration') ||
      !policyId(agent.configuration_version_id, 'version') ||
      agents.some((other) => other.agent_id === agent.agent_id)
    )
      continue;
    const configurationName = serviceName(agent.configuration_name);
    const versionName = serviceName(agent.version_name);
    agents.push({
      agent_id: agent.agent_id,
      team_id: agent.team_id,
      ...displayName(agent, 'agent_name'),
      configuration_id: agent.configuration_id as string,
      configuration_version_id: agent.configuration_version_id as string,
      ...(configurationName ? { configuration_name: configurationName } : {}),
      ...(versionName ? { version_name: versionName } : {}),
      ...(agent.default === true ? { default: true } : {}),
    });
  }
  // The Kalkidan agent is first.
  return agents.sort((a, b) => Number(!!b.default) - Number(!!a.default));
}
/** Codes that mean the session ended. Then the setup cannot show anything. */
const sessionCodes = new Set([
  'desktop.auth_required',
  'desktop.auth_expired',
  'desktop.session_rejected',
  'desktop.identity_mismatch',
  'desktop.region_required',
]);
/** The fields that the bootstrap check adds to an inspection. A plain read keeps them. */
const outcomeFields = [
  'bootstrapReadiness',
  'policyReadiness',
  'bootstrapIssue',
  'bootstrapped',
  'setupCode',
  'defaultUnavailable',
  'defaultEnsured',
] as const;
type SetupOutcome = Partial<Pick<VerdictanSetup, (typeof outcomeFields)[number]>>;
type Inspection = Awaited<ReturnType<VerdictanSetupService['inspect']>>;
/** The saved choices of an account: the coding agent selections and the computer agents. */
export type VerdictanChoices = Pick<
  VerdictanSetup,
  'selections' | 'computerAgents' | 'defaultAgentId' | 'legacyAgents'
>;
/** Reads the choices that the desktop sent to an SSH host. Older desktops send selections only. */
function choices(value: unknown): VerdictanChoices {
  const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  if (!('selections' in record)) return { selections: record as VerdictanSetup['selections'] };
  const ids = (item: unknown) =>
    Object.fromEntries(
      Object.entries(item && typeof item === 'object' ? item : {}).filter(([, id]) => uuid(id)),
    );
  return {
    selections: (record.selections || {}) as VerdictanSetup['selections'],
    computerAgents: ids(record.computerAgents),
    ...(uuid(record.defaultAgentId) ? { defaultAgentId: record.defaultAgentId } : {}),
    legacyAgents: ids(record.legacyAgents),
  };
}
export class VerdictanSetupService {
  constructor(
    private client: () => Promise<DesktopClient>,
    private store: BindingStore,
    private origin: string,
    private selectionSource?: () => Promise<unknown>,
  ) {}
  /** The saved choices of an account. On an SSH host, the desktop sends them. */
  async choices(key: string): Promise<VerdictanChoices> {
    if (this.selectionSource) return choices(await this.selectionSource());
    // Read the agents first. The first read moves the agents of older selections.
    const agents = await this.store.agents(key);
    return {
      selections: await this.store.selections(key),
      computerAgents: agents.computers,
      ...(agents.default ? { defaultAgentId: agents.default } : {}),
      legacyAgents: agents.legacy,
    };
  }
  async inspect() {
    const client = await this.client();
    const account = parseAccount((await client.request('status')).data, this.origin);
    if (account.state !== 'authenticated') throw new DesktopProtocolError('desktop.auth_required');
    const data = (await client.request('setup.inspect')).data;
    if (
      data.schema_version !== 1 ||
      data.org_id !== account.organizationId ||
      data.user_id !== account.userId ||
      data.dispatch_allowed !== false ||
      !Array.isArray(data.teams) ||
      !Array.isArray(data.policies) ||
      !Array.isArray(data.provider_connections) ||
      [data.teams, data.policies, data.provider_connections].some((a) => a.length > 50)
    )
      throw new DesktopProtocolError('desktop.setup_invalid');
    const key = identityKey(account.apiUrl, account.organizationId!, account.userId!);
    // A subscription mode needs both the deployed API and the local runtime to advertise it.
    const advertised = Array.isArray(data.provider_access_modes)
      ? data.provider_access_modes.filter((mode): mode is Exclude<ProviderAccessMode, 'byok'> =>
          isSubscriptionMode(mode as ProviderAccessMode),
        )
      : [];
    const capabilities = advertised.length
      ? parseCapabilities((await client.request('capabilities')).data).capabilities
      : [];
    const readinessRecord =
      data.readiness && typeof data.readiness === 'object'
        ? (data.readiness as Record<string, unknown>)
        : {};
    const readiness = readinessRecord.policy;
    const policyReadiness = policyReadinessValues.includes(readiness as PolicyReadiness)
      ? (readiness as PolicyReadiness)
      : undefined;
    const bootstrapReadiness = bootstrapReadinessValues.includes(
      readinessRecord.bootstrap as BootstrapReadiness,
    )
      ? (readinessRecord.bootstrap as BootstrapReadiness)
      : undefined;
    const bootstrap = bootstrapRecord(data.bootstrap);
    const agents = agentList(data.agents);
    const fallback = data.default_configuration as Record<string, unknown> | null | undefined;
    if (
      fallback != null &&
      (typeof fallback !== 'object' ||
        fallback.marker !== 'kalkidan_default' ||
        !policyId(fallback.configuration_id, 'configuration') ||
        !policyId(fallback.configuration_version_id, 'version'))
    )
      throw new DesktopProtocolError('desktop.setup_invalid');
    const setup: VerdictanSetup = {
      providerAccessModes: [
        'byok',
        ...(['codex_subscription', 'claude_subscription'] as const).filter(
          (mode) => advertised.includes(mode) && capabilities.includes(`provider_access.${mode}`),
        ),
      ],
      status: typeof data.status === 'string' ? data.status : 'unavailable',
      ...(policyReadiness ? { policyReadiness } : {}),
      ...(bootstrapReadiness ? { bootstrapReadiness } : {}),
      ...(bootstrap ? { bootstrap } : {}),
      ...(agents ? { agents } : {}),
      // Provision without policy IDs only when the default exists and the user can read it.
      ...(fallback && policyReadiness !== 'default_permission_required'
        ? {
            defaultPolicy: {
              configuration_id: fallback.configuration_id as string,
              configuration_version_id: fallback.configuration_version_id as string,
            },
          }
        : {}),
      teams: data.teams.map((t) => {
        if (!uuid(t.team_id)) throw new DesktopProtocolError('desktop.setup_invalid');
        return { team_id: t.team_id, ...displayName(t, 'team_name') };
      }),
      policies: data.policies.map((p) => {
        if (
          !policyId(p.configuration_id, 'configuration') ||
          !policyId(p.configuration_version_id, 'version')
        )
          throw new DesktopProtocolError('desktop.setup_invalid');
        const version = p.version_number ?? p.version;
        const versionName = serviceName(
          p.version_name,
          p.version_label,
          p.configuration_version_name,
        );
        return {
          configuration_id: p.configuration_id,
          configuration_version_id: p.configuration_version_id,
          ...displayName(p, 'configuration_name'),
          ...(versionName ? { version_name: versionName } : {}),
          ...((typeof version === 'number' && Number.isSafeInteger(version)) ||
          (typeof version === 'string' && !!version.trim() && version.length <= 40)
            ? { version }
            : {}),
          ...(p.default === true ? { default: true } : {}),
        };
      }),
      providerConnections: data.provider_connections.map((p) => {
        if (!uuid(p.provider_connection_id) || typeof p.provider !== 'string')
          throw new DesktopProtocolError('desktop.setup_invalid');
        return {
          provider_connection_id: p.provider_connection_id,
          provider: p.provider,
          ...displayName(p),
        };
      }),
      ...allowedModels(data.allowed_models),
      ...(await this.choices(key)),
    };
    return { client, account, key, setup };
  }
  private pending?: Promise<VerdictanSetup>;
  /**
   * The bootstrap that this app session ran, by account. Another view can read the setup
   * first, so the Settings page still shows the result after that.
   */
  private ran?: { key: string; result: 'bootstrapped' | 'already_bootstrapped' };
  /**
   * The setup for the Settings page. On the first connect of an organization, an administrator
   * runs the one-time Kalkidan bootstrap here: Verdictan makes the default configuration and
   * the Kalkidan agent. Kalkidan sends it only when `readiness.bootstrap` is
   * `bootstrap_available`, so it runs once. Launches use `inspect`, which never sends it.
   * Concurrent calls share one check.
   */
  status(): Promise<VerdictanSetup> {
    this.pending ??= this.check()
      .then((setup) => {
        const result =
          setup.bootstrapped || !this.ran || this.ran.key !== this.lastKey
            ? setup
            : { ...setup, bootstrapped: this.ran.result };
        this.keepOutcome(result);
        return result;
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
  /**
   * The result of the last bootstrap check, by account. A plain read adds it while the
   * readiness that the check started from does not change.
   */
  private outcome?: {
    key: string;
    from: Pick<VerdictanSetup, 'bootstrapReadiness' | 'policyReadiness'>;
    fields: SetupOutcome;
    gateway?: VerdictanSetup['computerGateway'];
  };
  private firstReadiness?: Pick<VerdictanSetup, 'bootstrapReadiness' | 'policyReadiness'>;
  private keepOutcome(setup: VerdictanSetup) {
    if (!this.lastKey || !this.firstReadiness) return;
    const fields: SetupOutcome = {};
    for (const field of outcomeFields)
      if (setup[field] !== undefined) Object.assign(fields, { [field]: setup[field] });
    this.outcome = {
      key: this.lastKey,
      from: this.firstReadiness,
      fields,
      gateway: this.outcome?.key === this.lastKey ? this.outcome.gateway : undefined,
    };
  }
  /** Keeps the result of the gateway of this computer for the account. See `SignInSetup`. */
  keepGateway(key: string, gateway: NonNullable<VerdictanSetup['computerGateway']>) {
    if (this.outcome?.key === key) this.outcome.gateway = gateway;
    else this.outcome = { key, from: {}, fields: {}, gateway };
  }
  /**
   * The setup for Settings, without the bootstrap. It adds the result of the last bootstrap
   * check and of the gateway of this computer. `SignInSetup` runs the bootstrap after sign-in.
   */
  async current(): Promise<VerdictanSetup> {
    const { key, setup } = await this.inspect();
    const outcome = this.outcome?.key === key ? this.outcome : undefined;
    if (!outcome) return setup;
    const same =
      outcome.from.bootstrapReadiness === setup.bootstrapReadiness &&
      outcome.from.policyReadiness === setup.policyReadiness;
    return {
      ...setup,
      ...(same
        ? outcome.fields
        : outcome.fields.bootstrapped
          ? { bootstrapped: outcome.fields.bootstrapped }
          : {}),
      ...(outcome.gateway ? { computerGateway: outcome.gateway } : {}),
    };
  }
  private lastKey?: string;
  private async check(): Promise<VerdictanSetup> {
    const first = await this.inspect();
    this.lastKey = first.key;
    this.firstReadiness = {
      bootstrapReadiness: first.setup.bootstrapReadiness,
      policyReadiness: first.setup.policyReadiness,
    };
    const bootstrap = first.setup.bootstrapReadiness === 'bootstrap_available';
    // Older APIs do not report the bootstrap. Then the earlier default check applies.
    if (!bootstrap && first.setup.policyReadiness !== 'default_creatable') return first.setup;
    let capabilities: string[];
    try {
      capabilities = parseCapabilities(
        (await first.client.request('capabilities')).data,
      ).capabilities;
    } catch (error) {
      const code = error instanceof DesktopProtocolError ? error.code : '';
      if (sessionCodes.has(code)) throw error;
      return bootstrap
        ? { ...first.setup, bootstrapIssue: 'failed', ...(code ? { setupCode: code } : {}) }
        : { ...first.setup, defaultUnavailable: true };
    }
    if (capabilities.includes('setup.bootstrap'))
      return bootstrap ? this.bootstrap(first) : first.setup;
    // Older runtimes have no `setup.bootstrap`. `setup.ensure_default` runs the same bootstrap.
    if (
      first.setup.policyReadiness === 'default_creatable' &&
      capabilities.includes('setup.ensure_default')
    )
      return this.ensureDefault(first);
    // A deprecated runtime still runs until its end of support, but it cannot run the setup.
    return { ...first.setup, bootstrapIssue: 'runtime_too_old' };
  }
  /** The team for the Kalkidan agent: the team of a saved selection, when there is one. */
  private bootstrapTeam(setup: VerdictanSetup): DesktopParameters | undefined {
    const team = [setup.selections.codex?.teamId, setup.selections.claude?.teamId].find(
      (id) => !!id && setup.teams.some((t) => t.team_id === id),
    );
    return team ? { parameters: { team_id: team } } : undefined;
  }
  private async bootstrap(first: Inspection): Promise<VerdictanSetup> {
    let result: 'bootstrapped' | 'already_bootstrapped';
    try {
      const data = (await first.client.request('setup.bootstrap', this.bootstrapTeam(first.setup)))
        .data;
      if (
        data.schema_version !== 1 ||
        !['bootstrapped', 'already_bootstrapped'].includes(String(data.status)) ||
        data.marker !== 'kalkidan_default' ||
        data.mandatory_gateway !== true ||
        !serviceId(data.agent_id) ||
        !policyId(data.configuration_id, 'configuration') ||
        !policyId(data.configuration_version_id, 'version')
      )
        throw new DesktopProtocolError('desktop.setup_invalid');
      result = data.status as 'bootstrapped' | 'already_bootstrapped';
    } catch (error) {
      const code = error instanceof DesktopProtocolError ? error.code : '';
      if (sessionCodes.has(code)) throw error;
      // A member: an administrator must connect once. This is not an error.
      if (code === 'desktop.setup_bootstrap_required' || code === 'desktop.permission_denied')
        return { ...first.setup, bootstrapReadiness: 'bootstrap_requires_admin' };
      if (
        code === 'desktop.setup_team_required' ||
        code === 'desktop.setup_team_membership_required'
      )
        return { ...first.setup, bootstrapIssue: 'team_required' };
      if (code === 'desktop.setup_permission_required')
        return { ...first.setup, policyReadiness: 'default_permission_required' };
      // The inspection is still correct. Refresh tries again.
      return { ...first.setup, bootstrapIssue: 'failed', ...(code ? { setupCode: code } : {}) };
    }
    this.ran = { key: first.key, result };
    try {
      return { ...(await this.inspect()).setup, bootstrapped: result };
    } catch (error) {
      const code = error instanceof DesktopProtocolError ? error.code : '';
      if (sessionCodes.has(code)) throw error;
      // The bootstrap is done. The next Refresh shows the agent.
      return { ...first.setup, bootstrapReadiness: 'bootstrapped', bootstrapped: result };
    }
  }
  private async ensureDefault(first: Inspection): Promise<VerdictanSetup> {
    let ensured: 'created' | 'existing';
    try {
      const data = (await first.client.request('setup.ensure_default')).data;
      if (
        data.schema_version !== 1 ||
        !['created', 'existing'].includes(String(data.status)) ||
        data.marker !== 'kalkidan_default' ||
        data.mandatory_gateway !== true ||
        !policyId(data.configuration_id, 'configuration') ||
        !policyId(data.configuration_version_id, 'version')
      )
        throw new DesktopProtocolError('desktop.setup_invalid');
      ensured = data.status as 'created' | 'existing';
    } catch (error) {
      // The inspection is still correct. A failure to make the default never hides the
      // policies that exist. The user can choose one of them, and Refresh tries again.
      const code = error instanceof DesktopProtocolError ? error.code : '';
      // The session ended between the two calls. Sign-in must come first.
      if (sessionCodes.has(code)) throw error;
      // Another administrator can remove the permission between the two calls. The service
      // can also report a default that it cannot make for this user.
      if (
        code === 'desktop.setup_default_configuration_required' ||
        code === 'desktop.permission_denied'
      )
        return { ...first.setup, policyReadiness: 'default_configuration_required' };
      if (code === 'desktop.setup_permission_required')
        return { ...first.setup, policyReadiness: 'default_permission_required' };
      // An administrator removed the default after the bootstrap. Verdictan does not make it.
      if (code === 'desktop.setup_policy_required')
        return { ...first.setup, policyReadiness: 'default_removed' };
      return { ...first.setup, defaultUnavailable: true };
    }
    try {
      return { ...(await this.inspect()).setup, defaultEnsured: ensured };
    } catch (error) {
      const code = error instanceof DesktopProtocolError ? error.code : '';
      if (sessionCodes.has(code)) throw error;
      // The default exists now. The next Refresh shows it.
      return { ...first.setup, defaultEnsured: ensured };
    }
  }
  /** True when the model access and the model of a coding agent selection can work. */
  private validAccess(setup: VerdictanSetup, agent: 'codex' | 'claude', value: VerdictanSelection) {
    return (
      ['codex', 'claude'].includes(agent) &&
      typeof value.model === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$/.test(value.model) &&
      providerAccessModes.includes(value.providerAccessMode || 'byok') &&
      (isSubscriptionMode(value.providerAccessMode)
        ? agent === subscriptionAgent[value.providerAccessMode] &&
          !value.providerConnectionId &&
          !!setup.providerAccessModes?.includes(value.providerAccessMode)
        : setup.providerConnections.some(
            (p) =>
              p.provider_connection_id === value.providerConnectionId &&
              p.provider === (agent === 'codex' ? 'openai' : 'anthropic'),
          ))
    );
  }
  /**
   * Checks a saved coding agent selection. With the agent choice, it has the model access only:
   * the agent belongs to the computer or to the chat.
   */
  validateSaved(setup: VerdictanSetup, agent: 'codex' | 'claude', value: VerdictanSelection) {
    if (!usesAgentChoice(setup)) return this.validate(setup, agent, value);
    if (!value || value.agentId || !this.validAccess(setup, agent, value))
      throw new DesktopProtocolError('desktop.setup_selection_required');
    return value;
  }
  validate(setup: VerdictanSetup, agent: 'codex' | 'claude', value: VerdictanSelection) {
    // A removed default or a missing agent has its own code, so the user knows what to do.
    const issue = value && selectionIssue(setup, value);
    if (issue) throw new DesktopProtocolError(issue);
    const chosen = value?.agentId
      ? setup.agents?.find((a) => a.agent_id === value.agentId)
      : undefined;
    if (
      !value ||
      !this.validAccess(setup, agent, value) ||
      // With the agent choice, a launch always has the agent of the computer or of the chat.
      (usesAgentChoice(setup) && !value.agentId) ||
      !setup.teams.some((t) => t.team_id === value.teamId) ||
      typeof value.configurationId !== 'string' ||
      typeof value.configurationVersionId !== 'string' ||
      // An agent: its team, and no policy IDs. Its deployed configuration applies.
      (value.agentId !== undefined &&
        (!chosen ||
          chosen.team_id !== value.teamId ||
          !!value.configurationId ||
          !!value.configurationVersionId)) ||
      // No policy IDs: the default Kalkidan configuration. It must exist and be readable.
      (chosen
        ? false
        : usesDefaultPolicy(value)
          ? !setup.defaultPolicy
          : !setup.policies.some(
              (p) =>
                p.configuration_id === value.configurationId &&
                p.configuration_version_id === value.configurationVersionId,
            ))
    )
      throw new DesktopProtocolError('desktop.setup_selection_required');
    return value;
  }
  /**
   * Saves the recommended setup for each agent that has no saved setup. An agent that needs a
   * choice of the user keeps no setup. `models` returns the model list of an agent.
   */
  async applyRecommended(models: (agent: 'codex' | 'claude') => Promise<string[]>) {
    let setup = await this.status();
    for (const agent of ['codex', 'claude'] as const) {
      const value = recommendedSelection(
        setup,
        agent,
        await models(agent).catch(() => [] as string[]),
      );
      if (!value) continue;
      try {
        setup = await this.select(agent, value);
      } catch (error) {
        const code = error instanceof DesktopProtocolError ? error.code : '';
        // The session ended. Sign-in must come first.
        if (sessionCodes.has(code)) throw error;
        // The choices changed. Settings shows the choice to the user.
      }
    }
    return setup;
  }
  async select(agent: 'codex' | 'claude', value: VerdictanSelection) {
    const { key, setup } = await this.inspect();
    this.validateSaved(setup, agent, value);
    await this.store.select(key, agent, {
      teamId: value.teamId,
      configurationId: value.configurationId,
      configurationVersionId: value.configurationVersionId,
      providerConnectionId: value.providerConnectionId,
      ...(value.providerAccessMode ? { providerAccessMode: value.providerAccessMode } : {}),
      model: value.model,
    });
    // A plain read: saving a choice never starts the bootstrap.
    return this.current();
  }
  /**
   * Sets the agent that new chats on a computer use: 'local' or the SSH host ID. Codex and
   * Claude Code both use it. Existing chats keep their agent.
   */
  async setComputerAgent(computer: string, agentId: string) {
    const { key, setup } = await this.inspect();
    if (typeof computer !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(computer))
      throw new DesktopProtocolError('desktop.invalid_request');
    if (!findAgent(setup, agentId))
      throw new DesktopProtocolError('desktop.setup_agent_unavailable');
    await this.store.setComputerAgent(key, computer, agentId);
    return this.current();
  }
}
