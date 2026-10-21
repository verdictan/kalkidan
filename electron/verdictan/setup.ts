import {
  isSubscriptionMode,
  policyReadinessValues,
  providerAccessModes,
  serviceName,
  subscriptionAgent,
  usesDefaultPolicy,
  type PolicyReadiness,
  type ProviderAccessMode,
  type VerdictanSelection,
  type VerdictanSetup,
} from '../../src/domain/verdictan';
import { parseAccount, parseCapabilities } from './account';
import { DesktopProtocolError, type DesktopClient } from './protocol';
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
/** Codes that mean the session ended. Then the setup cannot show anything. */
const sessionCodes = new Set([
  'desktop.auth_required',
  'desktop.auth_expired',
  'desktop.session_rejected',
  'desktop.region_required',
]);
export class VerdictanSetupService {
  constructor(
    private client: () => Promise<DesktopClient>,
    private store: BindingStore,
    private origin: string,
    private selectionSource?: () => Promise<VerdictanSetup['selections']>,
  ) {}
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
    const readiness =
      data.readiness && typeof data.readiness === 'object'
        ? (data.readiness as Record<string, unknown>).policy
        : undefined;
    const policyReadiness = policyReadinessValues.includes(readiness as PolicyReadiness)
      ? (readiness as PolicyReadiness)
      : undefined;
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
      selections: this.selectionSource
        ? await this.selectionSource()
        : await this.store.selections(key),
    };
    return { client, account, key, setup };
  }
  /**
   * The setup for the Settings page. On the first connect of an organization, an administrator
   * makes the default Kalkidan configuration here. Launches use `inspect`, which never creates
   * it. The operation is idempotent, so a second call returns the existing default.
   */
  async status(): Promise<VerdictanSetup> {
    const first = await this.inspect();
    if (first.setup.policyReadiness !== 'default_creatable') return first.setup;
    let ensured: 'created' | 'existing';
    try {
      const { capabilities } = parseCapabilities((await first.client.request('capabilities')).data);
      if (!capabilities.includes('setup.ensure_default')) return first.setup;
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
  validate(setup: VerdictanSetup, agent: 'codex' | 'claude', value: VerdictanSelection) {
    if (
      !value ||
      !['codex', 'claude'].includes(agent) ||
      typeof value.model !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$/.test(value.model) ||
      !setup.teams.some((t) => t.team_id === value.teamId) ||
      typeof value.configurationId !== 'string' ||
      typeof value.configurationVersionId !== 'string' ||
      // No policy IDs: the default Kalkidan configuration. It must exist and be readable.
      (usesDefaultPolicy(value)
        ? !setup.defaultPolicy
        : !setup.policies.some(
            (p) =>
              p.configuration_id === value.configurationId &&
              p.configuration_version_id === value.configurationVersionId,
          )) ||
      !providerAccessModes.includes(value.providerAccessMode || 'byok') ||
      (isSubscriptionMode(value.providerAccessMode)
        ? agent !== subscriptionAgent[value.providerAccessMode] ||
          !!value.providerConnectionId ||
          !setup.providerAccessModes?.includes(value.providerAccessMode)
        : !setup.providerConnections.some(
            (p) =>
              p.provider_connection_id === value.providerConnectionId &&
              p.provider === (agent === 'codex' ? 'openai' : 'anthropic'),
          ))
    )
      throw new DesktopProtocolError('desktop.setup_selection_required');
    return value;
  }
  async select(agent: 'codex' | 'claude', value: VerdictanSelection) {
    const { key, setup } = await this.inspect();
    this.validate(setup, agent, value);
    await this.store.select(key, agent, {
      teamId: value.teamId,
      configurationId: value.configurationId,
      configurationVersionId: value.configurationVersionId,
      providerConnectionId: value.providerConnectionId,
      ...(value.providerAccessMode ? { providerAccessMode: value.providerAccessMode } : {}),
      model: value.model,
    });
    return this.status();
  }
}
