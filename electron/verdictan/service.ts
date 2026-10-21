import { discoverRuntime } from '../updates/runtime-feed';
import { verdictanRegion } from './region';
import bundledPolicy from './runtime-policy.json';
import { RemoteAccountBroker } from './remote-broker';
import type { VerdictanSetup } from '../../src/domain/verdictan';
import type { DesktopClient } from './protocol';
import { BindingStore } from './bindings';
import { VerdictanSetupService } from './setup';
import { VerdictanLaunchService } from './launch';
import { join } from 'node:path';
import { hostSystemVersion } from './system-version';
import { ManagedRuntimes } from './runtime';
import { DesktopProtocol } from './protocol';
import { desktopVersion } from './release';
import { VerdictanAccountService, parseCapabilities } from './account';
import { RuntimeInstaller, readRuntimePolicy, type RuntimePolicy } from './install';

export function createVerdictanServices(options: {
  root: string;
  desktopVersion: string;
  hostId: string;
  region?: string;
  policy: () => Promise<RuntimePolicy | null>;
  busy(): boolean;
  openBrowser(url: string): Promise<unknown>;
  changed?(): void;
  client?: () => Promise<DesktopClient>;
  selections?: () => Promise<VerdictanSetup['selections']>;
  identities?: () => Promise<{ installationId: string; hostId: string }>;
}) {
  const { apiOrigin, consoleOrigin, profile } = verdictanRegion(options.region);
  const region = profile === 'kalkidan-eu' ? 'eu' : 'global';
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
    policy: options.policy,
    discover: () => discoverRuntime(process.platform, process.arch),
    busy: () => options.busy() || managed.busy() || account.status().phase === 'authorizing',
    beforeActivate: async () => {
      account.reset();
    },
    changed: options.changed,
    probe: async (executable, version) => {
      // A separate secure profile prevents a compatibility probe from owning account state.
      const client = new DesktopProtocol(executable, [...args.slice(0, -1), `${profile}-probe`]);
      try {
        const capabilities = parseCapabilities((await client.request('capabilities')).data);
        if (capabilities.cliVersion !== version)
          throw new Error('Runtime executable version does not match the approved release.');
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

/** Configuration comes from the desktop distribution or its operator, never renderer input. */
export function runtimePolicyReader(bundleDirectory: string) {
  const path =
    process.env.KALKIDAN_VERDICTAN_RELEASE_FILE || join(bundleDirectory, 'verdictan-runtime.json');
  return async () => {
    const configured = await readRuntimePolicy(path);
    return (
      configured ||
      (process.env.KALKIDAN_VERDICTAN_RELEASE_FILE ? null : (bundledPolicy as RuntimePolicy))
    );
  };
}
