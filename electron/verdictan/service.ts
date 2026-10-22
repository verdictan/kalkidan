import { discoverRuntime } from '../updates/runtime-feed';
import { verdictanRegion, type VerdictanRegion } from './region';
import { RemoteAccountBroker } from './remote-broker';
import type { VerdictanSetup } from '../../src/domain/verdictan';
import type { DesktopClient } from './protocol';
import { BindingStore } from './bindings';
import { VerdictanSetupService } from './setup';
import { VerdictanLaunchService } from './launch';
import { join } from 'node:path';
import { hostSystemVersion } from './system-version';
import { ManagedRuntimes } from './runtime';
import { DesktopProtocol, DesktopProtocolError } from './protocol';
import { desktopVersion } from './release';
import { VerdictanAccountService, assertRuntimeSupported, parseCapabilities } from './account';
import { RuntimeInstaller } from './install';

export function createVerdictanServices(options: {
  root: string;
  desktopVersion: string;
  hostId: string;
  region?: string;
  busy(): boolean;
  openBrowser(url: string): Promise<unknown>;
  changed?(): void;
  client?: () => Promise<DesktopClient>;
  selections?: () => Promise<VerdictanSetup['selections']>;
  identities?: () => Promise<{ installationId: string; hostId: string }>;
}) {
  const selected = options.region === undefined ? undefined : verdictanRegion(options.region);
  const region = selected ? (options.region as VerdictanRegion) : undefined;
  // Without a selected region, no account client starts. The EU origins then only configure
  // the signed-out version probe, which makes no account request.
  const { apiOrigin, consoleOrigin } = selected ?? verdictanRegion('eu');
  const profile = selected?.profile ?? 'kalkidan';
  // The CLI compatibility contract accepts the core version, without build metadata.
  if (!desktopVersion(options.desktopVersion)) throw new Error('Invalid desktop version.');
  const compatibilityVersion = options.desktopVersion.split('-')[0];
  const args = [
    '--desktop-version',
    compatibilityVersion,
    '--api-url',
    apiOrigin,
    '--console-url',
    consoleOrigin,
    '--profile',
    profile,
  ];
  const installer = new RuntimeInstaller({
    root: join(options.root, 'runtime', 'verdictan'),
    hostId: options.hostId,
    desktopVersion: options.desktopVersion,
    os: process.platform,
    arch: process.arch,
    systemVersion: hostSystemVersion(),
    discover: () => discoverRuntime(process.platform, process.arch),
    busy: () => options.busy() || managed.busy() || account.status().phase === 'authorizing',
    beforeActivate: async () => {
      account.reset();
    },
    changed: options.changed,
    probe: async (executable, version) => {
      // A separate secure profile prevents a compatibility probe from owning account state.
      // This profile is always signed out, so the probe checks only the version. Session
      // capabilities, such as project services, come from the account profile.
      const client = new DesktopProtocol(executable, [...args.slice(0, -1), `${profile}-probe`]);
      try {
        const capabilities = parseCapabilities((await client.request('capabilities')).data);
        if (capabilities.cliVersion !== version)
          throw new Error('Runtime executable version does not match the signed release.');
        // Do not activate a release below the minimum of the support window.
        assertRuntimeSupported(capabilities);
      } finally {
        client.close();
      }
    },
  });
  const account = new VerdictanAccountService({
    apiOrigin,
    consoleOrigin,
    openBrowser: options.openBrowser,
    changed: options.changed,
    connect: async () => {
      if (!selected) throw new DesktopProtocolError('desktop.region_required');
      if (options.client) return options.client();
      const executable = await installer.executable();
      return executable ? new DesktopProtocol(executable, args) : null;
    },
  });
  const managed = new ManagedRuntimes({
    apiOrigin,
    client: () => account.runtimeClient(),
    executable: () => installer.executable(),
    changed: options.changed,
    // The account session of this device was revoked. Remove the local session at once.
    revoked: (reason) => {
      if (reason === 'session_revoked') void account.revokedRemotely();
    },
  });
  const bindings = new BindingStore(options.root);
  const setup = new VerdictanSetupService(
    () => account.runtimeClient(),
    bindings,
    apiOrigin,
    options.selections,
  );
  const launch = new VerdictanLaunchService(
    bindings,
    setup,
    managed,
    options.hostId,
    options.identities,
  );
  const remoteBroker = new RemoteAccountBroker(setup, bindings);
  return { installer, account, managed, setup, launch, bindings, remoteBroker, region };
}
