import { RuntimeEvidence } from './evidence';
import { inferenceGuard, guardedRoute } from './inference-guard';
import { realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { ManagedLaunch, ManagedLaunchRequest } from '../agents/managed-launch';
import { parseCapabilities } from './account';
import { BindingStore, assertCompatible, identityKey, type ConversationBinding } from './bindings';
import { VerdictanSetupService } from './setup';
import { ManagedRuntimes } from './runtime';
import { DesktopProtocolError } from './protocol';
import { assertIsolationPlatform, prepareIsolation } from './isolation';
import { uuid } from './credentials';

/** Mandatory entry point for native launches, including Memory extraction. */
export class VerdictanLaunchService {
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
  ) {}
  async prepare(request: ManagedLaunchRequest): Promise<ManagedLaunch> {
    this.isolationPolicy.assertPlatform();
    request.signal.throwIfAborted();
    const { client, account, setup } = await this.setup.inspect();
    const selection = this.setup.validate(
      setup,
      request.session.agent,
      setup.selections[request.session.agent]!,
    );
    const registry = parseCapabilities((await client.request('capabilities')).data).testedAgents;
    const kind = request.session.agent === 'codex' ? 'codex' : 'claude_code';
    const agent = registry.find((a) => a.kind === kind);
    if (!agent) throw new DesktopProtocolError('desktop.agent_version_unsupported');
    const identity = await (this.identities
      ? this.identities()
      : this.store.identities(this.hostKey));
    const parameters = {
      installation_id: identity.installationId,
      host_id: identity.hostId,
      team_id: selection.teamId,
      configuration_id: selection.configurationId,
      configuration_version_id: selection.configurationVersionId,
    };
    const resources = (await client.request('resources.provision', { parameters })).data;
    if (
      !['created', 'existing'].includes(String(resources.status)) ||
      !uuid(resources.agent_id) ||
      !uuid(resources.region_id) ||
      typeof resources.gateway_id !== 'string' ||
      resources.installation_id !== parameters.installation_id ||
      resources.host_id !== parameters.host_id ||
      resources.configuration_id !== parameters.configuration_id ||
      resources.configuration_version_id !== parameters.configuration_version_id
    )
      throw new DesktopProtocolError('desktop.resource_binding_mismatch');
    const previous = await this.store.read(kind, request.forkFrom || request.session.id);
    if ((!request.create || request.forkFrom) && !previous)
      throw new DesktopProtocolError('desktop.resume_binding_required');
    const binding: ConversationBinding = {
      schema_version: 1,
      organization_id: account.organizationId!,
      user_id: account.userId!,
      region_id: resources.region_id,
      provider_connection_id: selection.providerConnectionId,
      installation_id: identity.installationId,
      host_id: identity.hostId,
      conversation_id: !request.create && previous ? previous.conversation_id : randomUUID(),
      provider: kind === 'codex' ? 'openai' : 'anthropic',
      model: request.model || previous?.model || selection.model,
      agent_kind: kind,
      agent_version: agent.version,
      context_format_version: 1,
      configuration_id: selection.configurationId,
      configuration_version_id: selection.configurationVersionId,
      cwd: await realpath(request.session.cwd),
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
    const finish = () =>
      (finishTask ??= (async () => {
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
          provider: binding.provider,
          model: binding.model,
          provider_connection_id: binding.provider_connection_id,
        },
        agent,
        request.stop,
      );
      started = true;
      request.signal.throwIfAborted();
      const endpoint = this.runtimes.endpoint(sessionId);
      guard = await inferenceGuard(endpoint);
      isolation = await this.isolationPolicy.prepare(
        request,
        await this.store.home(binding),
        guard.address,
      );
      if (isolation.version !== agent.version)
        throw new DesktopProtocolError('desktop.agent_version_unsupported');
      const route = guardedRoute(
        await this.runtimes.route(sessionId, {
          projectId: identityKey(binding.cwd),
          taskId: request.session.organization?.taskId
            ? identityKey(request.session.organization.taskId)
            : 'conversation',
          conversationId: binding.conversation_id,
          turnId: request.runId,
        }),
        endpoint,
        guard.address,
      );
      request.signal.throwIfAborted();
      const secrets = Object.values(route.env).filter(
        (v): v is string => !!v && v.startsWith('vdt_'),
      );
      return {
        executable: isolation.executable,
        prefix: isolation.prefix,
        args: route.args,
        env: { ...isolation.env, ...route.env },
        model: binding.model,
        bindNativeSession: (id) => this.store.save(kind, id, binding),
        observe: (state) => {
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
