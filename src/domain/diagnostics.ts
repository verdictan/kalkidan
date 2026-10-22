import { checkAgentVersion, nativeAgentKind, type AgentVersionStatus } from './agent-version';
import { runtimeCompatibility, supportWindow, type RuntimeSupport } from './compatibility';
import { redactValue } from './redaction';

/**
 * Diagnostics: component versions, connection state, correlation IDs, and local measurements.
 * Kalkidan keeps all of it on this computer. Nothing leaves the computer until the user previews
 * a support bundle and then exports it to a file. Kalkidan sends no telemetry.
 */
export interface RuntimeDiagnostics {
  /** `local` or the ID of an SSH host. */
  hostId: string;
  name: string;
  connected: boolean;
  installed?: string;
  running?: string;
  latest?: string;
  support: RuntimeSupport;
  /** Plain words for a deprecated, unsupported, or unknown version. */
  supportMessage?: string;
  /** The SSH helper digest on a host, as Settings › Computers shows it. */
  helper?: string;
  error?: string;
}
export interface AgentDiagnostics {
  hostId: string;
  agent: string;
  status: 'installed' | 'missing' | 'unavailable';
  version?: string;
  minimum?: string;
  support: AgentVersionStatus | 'missing';
}
export interface CorrelationRecord {
  /**
   * A broker request, a request that the gateway recorded for an agent turn, or a gateway or
   * supervisor step that failed.
   */
  kind: 'broker' | 'request' | 'gateway';
  id: string;
  /** The broker operation, or the agent turn for a gateway request. */
  operation: string;
  /** `ok`, or a safe error code. */
  outcome: string;
  at: string;
  durationMs?: number;
  /** Why a gateway step failed: safe codes and redacted stderr. Never a credential. */
  detail?: string;
}
export type MeasurementName =
  | 'setup_completion_ms'
  | 'first_success_ms'
  | 'stream_first_output_ms'
  | 'turn_ms'
  | 'broker_request_ms'
  | 'recovery_ms';
export interface MeasurementSummary {
  count: number;
  last?: number;
  p50?: number;
  p95?: number;
}
export interface LocalMeasurements {
  /** Kalkidan never sends these values. They go only into a support bundle that the user exports. */
  telemetry: 'off';
  since: string;
  sessions: number;
  crashes: number;
  turnsCompleted: number;
  turnsFailed: number;
  samples: Partial<Record<MeasurementName, MeasurementSummary>>;
}
export interface DiagnosticsReport {
  schemaVersion: 1;
  createdAt: string;
  app: { version: string; build: string; packaged: boolean };
  platform: string;
  arch: string;
  osVersion: string;
  supportWindow: {
    protocol: number;
    runtimeMinimum: string;
    runtimeNewestVerified: string;
  };
  connection: {
    region?: string;
    phase: string;
    executionReady: boolean;
    error?: string;
    protocolMin?: number;
    protocolMax?: number;
    capabilities: string[];
  };
  runtimes: RuntimeDiagnostics[];
  agents: AgentDiagnostics[];
  correlations: CorrelationRecord[];
  measurements: LocalMeasurements;
}
export interface SupportBundlePreview {
  /** The exact text that Export writes. */
  text: string;
  /** The SHA-256 digest of `text`. Export refuses a different text. */
  digest: string;
  redactions: number;
  bytes: number;
}
export interface DiagnosticsAPI {
  diagnostics(): Promise<DiagnosticsReport>;
  supportBundlePreview(): Promise<SupportBundlePreview>;
  /** Shows a save dialog and writes the previewed bundle. False when the user cancels. */
  supportBundleExport(digest: string): Promise<boolean>;
}

/** Fills the support fields of a runtime record. */
export function runtimeSupport(
  record: Omit<RuntimeDiagnostics, 'support' | 'supportMessage'>,
  now = Date.now(),
): RuntimeDiagnostics {
  const version = record.running || record.installed;
  if (!version) return { ...record, support: 'unknown' };
  const result = runtimeCompatibility(version, now);
  return {
    ...record,
    support: result.status,
    ...(result.message ? { supportMessage: result.message } : {}),
  };
}

/** Fills the support fields of an agent record. */
export function agentSupport(
  record: Omit<AgentDiagnostics, 'support' | 'minimum'>,
): AgentDiagnostics {
  const kind = nativeAgentKind(record.agent);
  if (record.status !== 'installed' || !kind) return { ...record, support: 'missing' };
  const check = checkAgentVersion(kind, record.version);
  return { ...record, minimum: check.minimum, support: check.status };
}

const semver = (value: unknown) =>
  typeof value === 'string' && /^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(value) ? value : undefined;
const uuid = (value: unknown) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined;
const componentState = (phase: string) =>
  phase === 'authenticated'
    ? 'ready'
    : phase === 'expired'
      ? 'expired'
      : phase === 'error'
        ? 'blocked'
        : phase === 'missing'
          ? 'unavailable'
          : 'unknown';
const versionCode = new Set([
  'desktop.runtime_version_unsupported',
  'desktop.protocol_unsupported',
]);

/**
 * The Verdictan part of the bundle. It uses the shared `desktop-support-bundle.v1` contract, so
 * Verdictan support can read it with its own tools.
 */
export function verdictanSupportSection(report: DiagnosticsReport) {
  const local = report.runtimes.find((runtime) => runtime.hostId === 'local');
  const lastBroker = report.correlations.find((record) => uuid(record.id));
  const cli = semver(local?.running || local?.installed);
  const desktop = semver(report.app.version.split('-')[0]);
  const state = componentState(report.connection.phase);
  return {
    schema_version: 1 as const,
    kind: 'desktop.support_bundle' as const,
    uploaded: false as const,
    capture: 'minimal_metadata' as const,
    identifiers: lastBroker ? { correlation_id: lastBroker.id } : {},
    versions: { ...(cli ? { cli } : {}), ...(desktop ? { desktop } : {}) },
    components: [
      { component: 'desktop', state: 'ready', error_code: null },
      {
        component: 'cli',
        state: !local?.installed
          ? 'unavailable'
          : local.support === 'unsupported'
            ? 'blocked'
            : state,
        error_code:
          local?.support === 'unsupported' || versionCode.has(report.connection.error || '')
            ? 'desktop.version_unsupported'
            : null,
      },
      ...report.runtimes
        .filter((runtime) => runtime.hostId !== 'local')
        .slice(0, 1)
        .map((runtime) => ({
          component: 'ssh',
          state: runtime.connected ? 'ready' : 'unavailable',
          error_code: null,
        })),
    ],
    platform: ['darwin', 'linux', 'win32'].includes(report.platform) ? report.platform : null,
    architecture: ['arm64', 'x64'].includes(report.arch) ? report.arch : null,
  };
}

/**
 * The support bundle: the report, the Verdictan section, and the support window. All of it is
 * redacted. `home` is the home folder, which becomes `~`.
 */
export function supportBundle(report: DiagnosticsReport, home?: string) {
  const bundle = {
    schema_version: 1,
    kind: 'kalkidan.support_bundle',
    uploaded: false,
    telemetry: 'off',
    created_at: report.createdAt,
    support_window: {
      source: 'verdictan/cli/docs/contracts/desktop-support-window.v1.json',
      protocol: supportWindow.protocol.current,
      runtime_minimum: supportWindow.runtime.minimum,
      runtime_newest_verified: supportWindow.runtime.newestVerified,
    },
    verdictan: verdictanSupportSection(report),
    diagnostics: report,
  };
  return redactValue(bundle, home);
}
