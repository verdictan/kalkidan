import {
  prepareSubscriptionAuth,
  readCodexSubscriptionLogin,
  type CodexSubscriptionLogin,
} from './subscription-auth';
import { RuntimeEvidence } from './evidence';
import { inferenceGuard, guardedRoute } from './inference-guard';
import { realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { ManagedLaunch, ManagedLaunchRequest } from '../agents/managed-launch';
import { BindingStore, assertCompatible, identityKey, type ConversationBinding } from './bindings';
import { VerdictanSetupService } from './setup';
import { ManagedRuntimes } from './runtime';
import { DesktopProtocolError } from './protocol';
import type { VerdictanRegion } from './region';
import { addPolicyRecords } from '../../src/domain/policy-result';
import { assertIsolationPlatform, prepareIsolation } from './isolation';
import { uuid } from './credentials';
import {
  checkNativeClaudeLogin,
  claudeAccessMargin,
  readNativeClaudeAccess,
  type NativeClaudeAccess,
} from './claude-subscription-auth';
import {
  agentVersionErrorCode,
  checkAgentVersion,
  type NativeAgentKind,
} from '../../src/domain/agent-version';
import { installedAgentVersion, type InstalledAgentVersion } from '../agents/installed-version';
import type { NativeAgent } from './gateway';
import {
  claudeSubscriptionRecovery,
  managedErrorText,
  withoutManagedCode,
  computerAgentId,
  computerAgentIssue,
  findAgent,
  usesAgentChoice,
  usesDefaultPolicy,
  withAgent,
  type ProviderAccessMode,
  type VerdictanSelection,
  type VerdictanSetup,
} from '../../src/domain/verdictan';
import { policyId } from './policy-id';
import type { ChatRun } from '../../src/domain/conversation';

/** Keeps the safe code and gives the user one recovery action. Never contains secrets. */
export class SubscriptionRecoveryError extends DesktopProtocolError {
  readonly recoveryAction: string;
  constructor(code: string) {
    super(code);
    const recovery = claudeSubscriptionRecovery(code)!;
    this.message = recovery.message;
    this.recoveryAction = recovery.action;
  }
}
/**
 * True when `resources.provisioned` used the policy that Kalkidan asked for. A picked policy
 * must come back unchanged. A chosen agent must come back attached, with its deployed
 * configuration. The default must come back as the default configuration; its version can be
 * older, because a binding keeps the version that Verdictan deployed first. When the host is
 * attached to the Kalkidan agent, the deployed configuration of that agent applies.
 * Older runtimes do not send `configuration_source`, and they cannot provision the default.
 */
export function provisionedPolicy(
  resources: Record<string, unknown>,
  selection: VerdictanSelection,
  fallback: VerdictanSetup['defaultPolicy'],
  kalkidanAgent?: string,
) {
  const ids =
    policyId(resources.configuration_id, 'configuration') &&
    policyId(resources.configuration_version_id, 'version');
  if (selection.agentId)
    return (
      resources.agent_source === 'selected_agent' &&
      resources.agent_id === selection.agentId &&
      resources.configuration_source === 'agent_deployment' &&
      ids
    );
  if (!usesDefaultPolicy(selection))
    return (
      (resources.configuration_source ?? 'selected') === 'selected' &&
      (resources.agent_source ?? 'host') === 'host' &&
      resources.configuration_id === selection.configurationId &&
      resources.configuration_version_id === selection.configurationVersionId
    );
  if (resources.configuration_source !== 'kalkidan_default' || !fallback) return false;
  if (resources.agent_source === 'kalkidan_default_agent')
    return ids && (!kalkidanAgent || resources.agent_id === kalkidanAgent);
  return (
    (resources.agent_source ?? 'host') === 'host' &&
    resources.configuration_id === fallback.configuration_id &&
    policyId(resources.configuration_version_id, 'version')
  );
}
/** Variables that select API billing instead of the native subscription login. */
const apiCredentialVariables = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];

/** Mandatory entry point for native launches, including Memory extraction. */
export class VerdictanLaunchService {
  /** The account region. A policy result keeps it, so its review link uses that Console. */
  region?: VerdictanRegion;
  /** The visible name of this computer, when the runtime accepts it. See `host-name.ts`. */
  hostName?: () => string | undefined;
  constructor(
    private store: BindingStore,
    private setup: VerdictanSetupService,
    private runtimes: ManagedRuntimes,
    private hostKey: string,
    private identities?: () => Promise<{ installationId: string; hostId: string }>,
    private isolationPolicy = {
      assertPlatform: assertIsolationPlatform,
      prepare: prepareIsolation,
    },
    private claudeAccess: () => Promise<NativeClaudeAccess> = () => readNativeClaudeAccess(),
    private now = Date.now,
    private installedVersion: InstalledAgentVersion = installedAgentVersion,
    /** The sign-in checks of the coding agents on this host. See `checkAgentLogin`. */
    private agentLogin: {
      codex(): Promise<CodexSubscriptionLogin>;
      claude(): Promise<void>;
    } = { codex: () => readCodexSubscriptionLogin(), claude: () => checkNativeClaudeLogin() },
  ) {}
  /**
   * The selection of a launch. With the agent choice, a new chat uses the agent of this
   * computer. A resumed or natively forked chat keeps its own agent, also after the computer
   * changed its agent. A chat from an older version keeps the agent of its coding agent.
   */
  private launchSelection(
    setup: VerdictanSetup,
    agent: 'codex' | 'claude',
    previous: ConversationBinding | null,
  ) {
    const saved = this.setup.validateSaved(setup, agent, setup.selections[agent]!);
    if (!usesAgentChoice(setup)) return saved;
    const own = previous ? previous.agent_id || setup.legacyAgents?.[agent] : undefined;
    if (own) {
      const chosen = findAgent(setup, own);
      if (!chosen) throw new DesktopProtocolError('desktop.agent_unavailable');
      return this.setup.validate(setup, agent, withAgent(saved, chosen));
    }
    const issue = computerAgentIssue(setup, this.hostKey);
    if (issue) throw new DesktopProtocolError(issue);
    const chosen = findAgent(setup, computerAgentId(setup, this.hostKey))!;
    return this.setup.validate(setup, agent, withAgent(saved, chosen));
  }
  /**
   * Makes the gateway of this computer for the agent of this computer, without a chat. The
   * first chat then has its gateway at once. `resources.provision` is idempotent: a second call
   * returns the same gateway with `existing`. Without the agent choice, a policy choice makes the
   * gateway at the first chat, so this does nothing.
   */
  async provisionComputer(): Promise<NonNullable<VerdictanSetup['computerGateway']>> {
    const { client, setup } = await this.setup.inspect();
    if (!usesAgentChoice(setup)) return { status: 'skipped' };
    const issue = computerAgentIssue(setup, this.hostKey);
    if (issue) return { status: 'skipped', code: issue };
    const agent = findAgent(setup, computerAgentId(setup, this.hostKey))!;
    const identity = await (this.identities
      ? this.identities()
      : this.store.identities(this.hostKey));
    const hostName = this.hostName?.();
    const resources = (
      await client.request('resources.provision', {
        parameters: {
          installation_id: identity.installationId,
          host_id: identity.hostId,
          team_id: agent.team_id,
          agent_id: agent.agent_id,
          ...(hostName ? { host_name: hostName } : {}),
        },
      })
    ).data;
    if (
      !['created', 'existing'].includes(String(resources.status)) ||
      typeof resources.gateway_id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(resources.gateway_id) ||
      resources.installation_id !== identity.installationId ||
      resources.host_id !== identity.hostId
    )
      throw new DesktopProtocolError('desktop.resource_binding_mismatch');
    return { status: resources.status as 'created' | 'existing' };
  }
  async prepare(request: ManagedLaunchRequest): Promise<ManagedLaunch> {
    const context: { mode?: ProviderAccessMode } = {};
    try {
      return await this.prepareOnce(request, context);
    } catch (error) {
      if (
        context.mode === 'claude_subscription' &&
        error instanceof DesktopProtocolError &&
        !(error instanceof SubscriptionRecoveryError) &&
        claudeSubscriptionRecovery(error.code)
      )
        throw new SubscriptionRecoveryError(error.code);
      throw error;
    }
  }
  private async prepareOnce(
    request: ManagedLaunchRequest,
    context: { mode?: ProviderAccessMode },
  ): Promise<ManagedLaunch> {
    this.isolationPolicy.assertPlatform();
    request.signal.throwIfAborted();
    const { client, account, setup } = await this.setup.inspect();
    const kind: NativeAgentKind = request.session.agent === 'codex' ? 'codex' : 'claude_code';
    const resume = !request.create || !!request.forkFrom;
    const previous = await this.store.read(kind, request.forkFrom || request.session.id);
    if (resume && !previous) throw new DesktopProtocolError('desktop.resume_binding_required');
    const selection = this.launchSelection(setup, request.session.agent, resume ? previous : null);
    context.mode = selection.providerAccessMode;
    const claudeSubscription = selection.providerAccessMode === 'claude_subscription';
    // Kalkidan's minimum applies to each managed launch: new, resumed, forked, local, SSH, and
    // background. Verdictan does not pin agent versions, so `tested_agents` is not a gate.
    const check = checkAgentVersion(
      kind,
      await this.installedVersion(kind, request.executable, request.signal),
    );
    const refused = agentVersionErrorCode(check);
    // The path tells the user which program the launch found when several are installed.
    if (refused)
      throw new DesktopProtocolError(refused, {
        version: check.version,
        path: request.executable.path,
      });
    request.signal.throwIfAborted();
    const agent: NativeAgent = { kind, version: check.version! };
    // Kalkidan checks that the coding agent is signed in for its access mode on this host, before
    // Verdictan provisions anything. The gateway does not check the login of the coding agent.
    const codexLogin =
      kind === 'codex' && selection.providerAccessMode === 'codex_subscription'
        ? await this.agentLogin.codex()
        : undefined;
    const claudeLogin =
      kind === 'claude_code' &&
      (claudeSubscription || previous?.provider_access_mode === 'claude_subscription');
    if (claudeLogin) await this.agentLogin.claude();
    request.signal.throwIfAborted();
    const identity = await (this.identities
      ? this.identities()
      : this.store.identities(this.hostKey));
    const fallback = usesDefaultPolicy(selection);
    const parameters = {
      installation_id: identity.installationId,
      host_id: identity.hostId,
      team_id: selection.teamId,
      // An agent, both policy IDs, or nothing. Without them, Verdictan uses the default.
      ...(selection.agentId
        ? { agent_id: selection.agentId }
        : fallback
          ? {}
          : {
              configuration_id: selection.configurationId,
              configuration_version_id: selection.configurationVersionId,
            }),
    };
    const hostName = this.hostName?.();
    const resources = (
      await client
        .request('resources.provision', {
          parameters: { ...parameters, ...(hostName ? { host_name: hostName } : {}) },
        })
        .catch((error) => {
          // A new chat uses the agent of this computer. The user changes that agent.
          if (
            !resume &&
            error instanceof DesktopProtocolError &&
            error.code === 'desktop.agent_unavailable'
          )
            throw new DesktopProtocolError('desktop.setup_agent_unavailable');
          throw error;
        })
    ).data;
    if (
      !['created', 'existing'].includes(String(resources.status)) ||
      !uuid(resources.agent_id) ||
      !uuid(resources.region_id) ||
      typeof resources.gateway_id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(resources.gateway_id) ||
      resources.installation_id !== parameters.installation_id ||
      resources.host_id !== parameters.host_id ||
      !provisionedPolicy(resources, selection, setup.defaultPolicy, setup.bootstrap?.agent_id)
    )
      throw new DesktopProtocolError('desktop.resource_binding_mismatch');
    if (previous?.provider_access_mode === 'claude_subscription')
      context.mode = 'claude_subscription';
    const binding: ConversationBinding = {
      schema_version: 1,
      ...(request.session.governanceScope?.projectId || previous?.project_id
        ? { project_id: request.session.governanceScope?.projectId || previous!.project_id }
        : {}),
      ...(request.session.governanceScope?.taskId || previous?.task_id
        ? { task_id: request.session.governanceScope?.taskId || previous!.task_id }
        : {}),
      organization_id: account.organizationId!,
      user_id: account.userId!,
      region_id: resources.region_id,
      provider_connection_id: selection.providerConnectionId,
      ...(selection.providerAccessMode === 'codex_subscription' || claudeSubscription
        ? { provider_access_mode: selection.providerAccessMode }
        : {}),
      installation_id: identity.installationId,
      host_id: identity.hostId,
      conversation_id: !request.create && previous ? previous.conversation_id : randomUUID(),
      provider: kind === 'codex' ? 'openai' : 'anthropic',
      model: request.model || previous?.model || selection.model,
      agent_kind: kind,
      agent_version: agent.version,
      context_format_version: 1,
      // The resolved policy. With the default, this is the version that Verdictan deployed.
      configuration_id: resources.configuration_id as string,
      configuration_version_id: resources.configuration_version_id as string,
      cwd: await realpath(request.session.cwd),
      ...(selection.agentId ? { agent_id: selection.agentId } : {}),
      gateway_id: resources.gateway_id,
    };
    if (previous && (!request.create || request.forkFrom))
      assertCompatible(previous, binding, !!request.forkFrom);
    await this.store.save(kind, request.session.id, binding);
    const sessionId = randomUUID();
    let isolation: Awaited<ReturnType<typeof prepareIsolation>> | undefined;
    let evidence: RuntimeEvidence | undefined;
    let guard: Awaited<ReturnType<typeof inferenceGuard>> | undefined;
    let started = false,
      finishTask: Promise<void> | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let observed: ChatRun | undefined;
    let env: NodeJS.ProcessEnv | undefined;
    const scrub = () => {
      if (env) delete env.CLAUDE_CODE_OAUTH_TOKEN;
    };
    const finish = () =>
      (finishTask ??= (async () => {
        clearTimeout(expiry);
        scrub();
        try {
          await guard?.close();
          await evidence?.stop();
          if (started) await this.runtimes.release(sessionId);
        } finally {
          await isolation?.close();
        }
      })());
    try {
      request.signal.throwIfAborted();
      await this.runtimes.start(
        {
          installation_id: identity.installationId,
          host_id: identity.hostId,
          session_id: sessionId,
          agent_id: resources.agent_id,
          gateway_id: resources.gateway_id,
          ...(binding.project_id ? { project_id: binding.project_id } : {}),
          provider: binding.provider,
          model: binding.model,
          // Subscription modes omit the provider connection; the runtime rejects a non-null one.
          ...(binding.provider_access_mode === 'codex_subscription' ||
          binding.provider_access_mode === 'claude_subscription'
            ? { provider_access_mode: binding.provider_access_mode }
            : { provider_connection_id: binding.provider_connection_id }),
        },
        agent,
        async (code) => {
          // The chat shows why it stopped. A moved gateway never replays the request.
          if (code === 'desktop.gateway_moved' && observed)
            observed.error = withoutManagedCode(managedErrorText(code));
          await request.stop();
        },
        { agentLoginChecked: !!codexLogin || claudeLogin },
      );
      started = true;
      request.signal.throwIfAborted();
      const turn = {
        projectId: binding.project_id || identityKey(binding.cwd),
        taskId: binding.task_id || 'conversation',
        conversationId: binding.conversation_id,
        // A project-bound runtime needs the run. The history reads requests by run.
        runId: request.runId,
        turnId: request.runId,
      };
      // Before Codex starts, check that it reaches its models with the login of this host.
      if (codexLogin) await this.runtimes.verifyCodexCatalog(sessionId, turn, codexLogin);
      request.signal.throwIfAborted();
      const endpoint = this.runtimes.endpoint(sessionId);
      // Each policy result of a refused or escalated request shows in the chat and is saved.
      guard = await inferenceGuard(endpoint, binding.provider_access_mode || 'byok', (policy) => {
        if (!observed) return;
        observed.policies = addPolicyRecords(observed.policies, [
          {
            ...policy,
            ...(this.region ? { region: this.region } : {}),
            at: new Date(this.now()).toISOString(),
          },
        ]);
      });
      const home = await this.store.home(binding);
      if (binding.provider_access_mode === 'codex_subscription')
        await prepareSubscriptionAuth(home, codexLogin);
      isolation = await this.isolationPolicy.prepare(request, home, guard.address);
      if (isolation.version !== agent.version)
        throw new DesktopProtocolError('desktop.agent_version_unsupported');
      const route = guardedRoute(
        await this.runtimes.route(sessionId, turn),
        endpoint,
        guard.address,
      );
      request.signal.throwIfAborted();
      env = { ...isolation.env, ...route.env };
      const args = [...route.args];
      let access: NativeClaudeAccess | undefined;
      if (binding.provider_access_mode === 'claude_subscription') {
        for (const name of apiCredentialVariables) delete env[name];
        // Strict and empty unless the owned Memory server is the only configured MCP server.
        if (!request.memoryURL) args.push('--mcp-config', '{"mcpServers":{}}');
        // Read the host-local login last, so that the token exists for the shortest time.
        access = await this.claudeAccess();
        const lifetime = access.expiresAt - this.now() - claudeAccessMargin;
        if (lifetime <= 0)
          throw new DesktopProtocolError('desktop.claude_subscription_login_expiring');
        request.signal.throwIfAborted();
        env.CLAUDE_CODE_OAUTH_TOKEN = access.token;
        // Stop the owned child before the token expires. Never replay the pending prompt.
        expiry = setTimeout(() => {
          if (observed)
            observed.error = claudeSubscriptionRecovery(
              'desktop.claude_subscription_login_expiring',
            )!.message;
          void request.stop().catch(() => {});
        }, lifetime);
        expiry.unref?.();
      }
      const secrets = [
        ...new Set(
          [
            ...Object.values(route.env).flatMap((v) => v?.match(/vdt_[A-Za-z0-9_-]+/g) || []),
            access?.token,
          ].filter((v): v is string => !!v),
        ),
      ];
      return {
        executable: isolation.executable,
        prefix: isolation.prefix,
        args,
        env,
        launched: scrub,
        model: binding.model,
        ...(route.modelProvider ? { modelProvider: route.modelProvider } : {}),
        bindNativeSession: (id) => this.store.save(kind, id, binding),
        observe: (state) => {
          observed = state;
          const runtime = this.runtimes.status().find((r) => r.sessionId === sessionId)!;
          evidence = new RuntimeEvidence(
            runtime.runtimeId!,
            sessionId,
            (kind, cursor, signal) => this.runtimes.evidence(sessionId, kind, cursor, signal),
            (value) => {
              state.governance = value;
            },
          );
          state.governance = evidence.status();
          evidence.start();
        },
        redact: (text) =>
          secrets.reduce(
            (result, secret) => result.replaceAll(secret, '[private credential]'),
            text,
          ),
        finish,
      };
    } catch (error) {
      // A failed provision may still own a runtime that needs explicit revocation.
      started ||= this.runtimes.status().some((s) => s.sessionId === sessionId && s.runtimeId);
      await finish().catch(() => {});
      throw error;
    }
  }
}
