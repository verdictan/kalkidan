import { discoverRuntime } from '../updates/runtime-feed';
import { verdictanRegion, type VerdictanRegion } from './region';
import { RemoteAccountBroker } from './remote-broker';
import type { DesktopClient } from './protocol';
import { BindingStore } from './bindings';
import { VerdictanSetupService } from './setup';
import { VerdictanLaunchService } from './launch';
import { join } from 'node:path';
import { hostSystemVersion } from './system-version';
import { ManagedRuntimes } from './runtime';
import { DesktopProtocol, DesktopProtocolError } from './protocol';
import { desktopVersion } from './release';
import {
  VerdictanAccountService,
  assertRuntimeVersionSupported,
  parseCapabilities,
} from './account';
import { RuntimeInstaller } from './install';
import { probeRuntime } from './runtime-probe';
import { proxyConfigured, withReleaseErrors } from './network';
import { hostDisplayName, hostNameCapability } from './host-name';
import { GatewayInstances } from './instances';
import { multiGatewayCapability } from './supervisor';

export function createVerdictanServices(options: {
  root: string;
  desktopVersion: string;
  hostId: string;
  region?: string;
  busy(): boolean;
  openBrowser(url: string): Promise<unknown>;
  changed?(): void;
  client?: () => Promise<DesktopClient>;
  /** On an SSH host: the saved choices that the desktop sends. See `VerdictanChoices`. */
  selections?: () => Promise<unknown>;
  identities?: () => Promise<{ installationId: string; hostId: string }>;
  /**
   * The visible name of a computer: 'local' or an SSH host ID. Verdictan names each gateway
   * "<computer name> · <agent name>". Only the desktop has it.
   */
  hostName?: (hostId: string) => string | undefined;
  /**
   * The fetch for release discovery and downloads. The desktop uses the Chromium network stack,
   * which uses the system proxy and certificate settings. An SSH host uses Node.js fetch.
   */
  request?: typeof fetch;
  /** True on an SSH host. A host that cannot reach the release server can get a copy. */
  transferable?: boolean;
}) {
  const request = options.request ?? withReleaseErrors(fetch, proxyConfigured());
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
    discover: () => discoverRuntime(process.platform, process.arch, request),
    request,
    transferable: options.transferable,
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
        await probeRuntime(executable, version, {
          capabilities: async () => parseCapabilities((await client.request('capabilities')).data),
        });
        // Do not activate a release outside the support window. The probe confirmed that the
        // executable reports this version, also on a host without a keyring.
        assertRuntimeVersionSupported(version);
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
  // Undelivered usage records must survive a restart, so the queue is not in a temporary folder.
  const eventDirectory = join(options.root, 'runtime', 'verdictan', 'events');
  const managed = new ManagedRuntimes({
    apiOrigin,
    eventDirectory,
    client: () => account.runtimeClient(),
    executable: () => installer.executable(),
    // One supervisor for this computer with one gateway instance for each agent. A runtime
    // without the multi mode starts one process for each chat runtime.
    instances: new GatewayInstances({
      apiOrigin,
      client: () => account.runtimeClient(),
      supervisor: { executable: () => installer.executable(), eventDirectory },
    }),
    multi: () => !!account.status().capabilities?.capabilities.includes(multiGatewayCapability),
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
  // The name goes only to a runtime that accepts it. An older runtime refuses unknown fields.
  const hostName = (hostId: string) =>
    account.status().capabilities?.capabilities.includes(hostNameCapability)
      ? hostDisplayName(options.hostName?.(hostId))
      : undefined;
  const launch = new VerdictanLaunchService(
    bindings,
    setup,
    managed,
    options.hostId,
    options.identities,
  );
  launch.region = region;
  launch.hostName = () => hostName(options.hostId);
  const remoteBroker = new RemoteAccountBroker(setup, bindings, hostName);
  return { installer, account, managed, setup, launch, bindings, remoteBroker, region };
}
