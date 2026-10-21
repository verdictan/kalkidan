import {
  isSubscriptionMode,
  providerAccessModes,
  subscriptionAgent,
  type ProviderAccessMode,
  type VerdictanSelection,
  type VerdictanSetup,
} from '../../src/domain/verdictan';
import { parseAccount, parseCapabilities } from './account';
import { DesktopProtocolError, type DesktopClient } from './protocol';
import { BindingStore, identityKey } from './bindings';
import { uuid } from './credentials';
import { policyId } from './policy-id';

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
    const setup: VerdictanSetup = {
      providerAccessModes: [
        'byok',
        ...(['codex_subscription', 'claude_subscription'] as const).filter(
          (mode) => advertised.includes(mode) && capabilities.includes(`provider_access.${mode}`),
        ),
      ],
      status: typeof data.status === 'string' ? data.status : 'unavailable',
      teams: data.teams.map((t) => {
        if (!uuid(t.team_id)) throw new DesktopProtocolError('desktop.setup_invalid');
        return { team_id: t.team_id };
      }),
      policies: data.policies.map((p) => {
        if (
          !policyId(p.configuration_id, 'configuration') ||
          !policyId(p.configuration_version_id, 'version')
        )
          throw new DesktopProtocolError('desktop.setup_invalid');
        return {
          configuration_id: p.configuration_id,
          configuration_version_id: p.configuration_version_id,
        };
      }),
      providerConnections: data.provider_connections.map((p) => {
        if (!uuid(p.provider_connection_id) || typeof p.provider !== 'string')
          throw new DesktopProtocolError('desktop.setup_invalid');
        return { provider_connection_id: p.provider_connection_id, provider: p.provider };
      }),
      selections: this.selectionSource
        ? await this.selectionSource()
        : await this.store.selections(key),
    };
    return { client, account, key, setup };
  }
  async status() {
    return (await this.inspect()).setup;
  }
  validate(setup: VerdictanSetup, agent: 'codex' | 'claude', value: VerdictanSelection) {
    if (
      !value ||
      !['codex', 'claude'].includes(agent) ||
      typeof value.model !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$/.test(value.model) ||
      !setup.teams.some((t) => t.team_id === value.teamId) ||
      !setup.policies.some(
        (p) =>
          p.configuration_id === value.configurationId &&
          p.configuration_version_id === value.configurationVersionId,
      ) ||
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
