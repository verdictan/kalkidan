import { useRef, useState } from 'react';
import type { API } from '../types';
import type {
  AgentDiagnostics,
  DiagnosticsReport,
  RuntimeDiagnostics,
  SupportBundlePreview,
} from '../domain/diagnostics';
import type { MeasurementName } from '../domain/diagnostics';
import { agentCatalog } from '../config/agents';
import { useRefreshTriggers } from '../hooks/use-refresh-triggers';
import { errorMessage } from '../lib/errors';
import { accountPhaseLabels, displayVersion, type StatusLabel } from '../lib/verdictan-labels';
import {
  CopyValue,
  SettingsGroup,
  SettingsRow,
  SettingsRows,
  StatusBadge,
} from './settings-disclosure';
import { Button } from './ui/button';
import { showToast } from './ui/toast';

const runtimeLabels: Record<RuntimeDiagnostics['support'], StatusLabel> = {
  supported: { label: 'Supported', tone: 'success' },
  deprecated: { label: 'Deprecated', tone: 'warning' },
  unsupported: { label: 'Not supported', tone: 'destructive' },
  unknown: { label: 'Not known', tone: 'muted' },
};
const agentLabels: Record<AgentDiagnostics['support'], StatusLabel> = {
  supported: { label: 'Supported', tone: 'success' },
  outdated: { label: 'Too old', tone: 'destructive' },
  unknown: { label: 'Not known', tone: 'muted' },
  missing: { label: 'Not installed', tone: 'muted' },
};
const measurementLabels: Record<MeasurementName, string> = {
  setup_completion_ms: 'Setup completion',
  first_success_ms: 'Time to the first successful request',
  stream_first_output_ms: 'Time to the first streamed output',
  turn_ms: 'Agent turn',
  broker_request_ms: 'Verdictan broker request',
  recovery_ms: 'Recovery after a lost connection',
};
const agentName = (id: string) => agentCatalog.find((agent) => agent.id === id)?.name || id;
const duration = (ms?: number) =>
  ms === undefined
    ? '—'
    : ms < 1000
      ? `${ms} ms`
      : ms < 120000
        ? `${(ms / 1000).toFixed(1)} s`
        : `${Math.round(ms / 60000)} min`;

/**
 * Settings › Diagnostics: the versions of each component, the connection state, the recent
 * correlation IDs, and the local measurements. The support bundle is redacted. The user
 * previews it first and then exports it to a file. Kalkidan sends nothing.
 */
export function DiagnosticsSection({ api, open = true }: { api: API; open?: boolean }) {
  const [report, setReport] = useState<DiagnosticsReport>();
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<SupportBundlePreview>();
  const [busy, setBusy] = useState<'' | 'preview' | 'export'>('');
  const generation = useRef(0);
  const available = typeof api.diagnostics === 'function';
  function read() {
    if (!available) return;
    const token = ++generation.current;
    void Promise.resolve()
      .then(() => api.diagnostics())
      .then(
        (value) => {
          if (token !== generation.current) return;
          setReport(value);
          setError('');
        },
        (reason) => token === generation.current && setError(errorMessage(reason)),
      );
  }
  useRefreshTriggers(api, open, read);
  async function showPreview() {
    setBusy('preview');
    try {
      setPreview(await api.supportBundlePreview());
    } catch (reason) {
      showToast({ message: errorMessage(reason), tone: 'error' });
    } finally {
      setBusy('');
    }
  }
  async function exportBundle() {
    if (!preview) return;
    setBusy('export');
    try {
      if (await api.supportBundleExport(preview.digest))
        showToast('The support bundle is exported.');
    } catch (reason) {
      showToast({ message: errorMessage(reason), tone: 'error' });
    } finally {
      setBusy('');
    }
  }
  if (!available)
    return (
      <SettingsRows label="Diagnostics">
        <SettingsRow label="Diagnostics" help="Diagnostics need the desktop application." />
      </SettingsRows>
    );
  const connection = report?.connection;
  const phase = connection
    ? accountPhaseLabels[connection.phase as keyof typeof accountPhaseLabels]
    : undefined;
  const measurements = report?.measurements;
  return (
    <>
      <SettingsGroup
        title="Versions"
        actions={
          <Button variant="ghost" size="sm" onClick={read}>
            Check again
          </Button>
        }
      >
        <SettingsRows label="Versions">
          <SettingsRow
            label="Kalkidan"
            help={
              report
                ? `Version ${displayVersion(report.app.version)} · ${report.platform} ${report.arch} ${report.osVersion}`
                : error || 'Checking…'
            }
          />
          {report?.runtimes.map((runtime) => (
            <SettingsRow
              key={`runtime-${runtime.hostId}`}
              label={`Verdictan runtime · ${runtime.name}`}
              help={
                <span data-testid={`diagnostics-runtime-${runtime.hostId}`}>
                  {runtimeHelp(runtime, report.supportWindow.runtimeMinimum)}
                </span>
              }
            >
              <StatusBadge status={runtimeLabels[runtime.support]} />
            </SettingsRow>
          ))}
          {report?.agents.map((agent) => (
            <SettingsRow
              key={`agent-${agent.hostId}-${agent.agent}`}
              label={`${agentName(agent.agent)} · ${report.runtimes.find((r) => r.hostId === agent.hostId)?.name || agent.hostId}`}
              help={
                agent.version
                  ? `Version ${agent.version}${agent.minimum ? `. Kalkidan needs ${agent.minimum} or later.` : ''}`
                  : 'Kalkidan did not find this agent.'
              }
            >
              <StatusBadge status={agentLabels[agent.support]} />
            </SettingsRow>
          ))}
        </SettingsRows>
      </SettingsGroup>
      <SettingsGroup title="Connection">
        <SettingsRows label="Connection">
          <SettingsRow
            label="Verdictan"
            help={
              connection
                ? [
                    connection.region ? `Region ${connection.region.toUpperCase()}` : 'No region',
                    connection.executionReady ? 'Managed agents ready' : 'Managed agents not ready',
                    connection.protocolMin === undefined
                      ? ''
                      : connection.protocolMin === connection.protocolMax
                        ? `Protocol ${connection.protocolMin}`
                        : `Protocol ${connection.protocolMin}–${connection.protocolMax}`,
                    connection.error || '',
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : 'Checking…'
            }
          >
            {phase && <StatusBadge status={phase} />}
          </SettingsRow>
        </SettingsRows>
      </SettingsGroup>
      <SettingsGroup title="Correlation IDs">
        <SettingsRows label="Correlation IDs">
          {report && !report.correlations.length && (
            <SettingsRow
              label="No requests yet"
              help="Kalkidan keeps the IDs of the last 50 requests while it runs."
            />
          )}
          {report?.correlations.slice(0, 10).map((record) => (
            <SettingsRow
              key={`${record.kind}-${record.id}`}
              label={`${record.operation} · ${record.outcome}`}
              help={
                <>
                  {new Date(record.at).toLocaleTimeString()}
                  {record.durationMs !== undefined ? ` · ${duration(record.durationMs)}` : ''}
                  {' · '}
                  <CopyValue value={record.id} name="Correlation ID" />
                </>
              }
            />
          ))}
        </SettingsRows>
      </SettingsGroup>
      <SettingsGroup title="Local measurements">
        <SettingsRows label="Local measurements">
          <SettingsRow
            label="Telemetry is off"
            help="Kalkidan keeps these values only on this computer. They go into a support bundle only when you export one."
          />
          {measurements && (
            <SettingsRow
              label="Sessions and crashes"
              help={`${measurements.sessions} sessions · ${measurements.crashes} crashes · ${measurements.turnsCompleted} turns completed · ${measurements.turnsFailed} turns failed`}
            />
          )}
          {measurements &&
            (Object.keys(measurementLabels) as MeasurementName[])
              .filter((name) => measurements.samples[name])
              .map((name) => {
                const sample = measurements.samples[name]!;
                return (
                  <SettingsRow
                    key={name}
                    label={measurementLabels[name]}
                    help={`Median ${duration(sample.p50)} · 95th percentile ${duration(sample.p95)} · ${sample.count} samples`}
                  />
                );
              })}
        </SettingsRows>
      </SettingsGroup>
      <SettingsGroup title="Support bundle">
        <SettingsRows label="Support bundle">
          <SettingsRow
            label="Support bundle"
            help="Kalkidan removes credentials, tokens, keys, e-mail addresses, and your home folder. Look at the bundle before you export it."
            extra={
              preview && (
                <div className="flex w-full min-w-0 flex-col gap-2">
                  <p className="text-xs text-muted-foreground" data-testid="support-bundle-summary">
                    {preview.redactions} values removed · {Math.ceil(preview.bytes / 1024)} KB
                  </p>
                  <pre
                    aria-label="Support bundle preview"
                    data-testid="support-bundle-preview"
                    tabIndex={0}
                    className="max-h-72 min-w-0 overflow-auto rounded-md border bg-muted/40 p-2 text-[11px] leading-4 break-all whitespace-pre-wrap"
                  >
                    {preview.text}
                  </pre>
                </div>
              )
            }
          >
            <Button variant="outline" size="sm" disabled={!!busy} onClick={showPreview}>
              {busy === 'preview' ? 'Preparing…' : preview ? 'Preview again' : 'Preview'}
            </Button>
            <Button size="sm" disabled={!preview || !!busy} onClick={exportBundle}>
              {busy === 'export' ? 'Exporting…' : 'Export…'}
            </Button>
          </SettingsRow>
        </SettingsRows>
      </SettingsGroup>
    </>
  );
}

function runtimeHelp(runtime: RuntimeDiagnostics, minimum: string) {
  const version = runtime.running || runtime.installed;
  const parts = [
    version
      ? `Version ${displayVersion(version)}`
      : runtime.connected
        ? 'Not installed'
        : 'Not connected',
    runtime.latest && runtime.latest !== version ? `Newest ${runtime.latest}` : '',
    runtime.supportMessage || (version ? `Minimum ${minimum}` : ''),
    runtime.error || '',
  ];
  return parts.filter(Boolean).join(' · ');
}
