import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import type { API } from '../types';
import type { ComponentInventory, DesktopUpdateStatus } from '../domain/updates';
import { settingsAnchors } from '../domain/settings-route';
import { useRefreshTriggers } from '../hooks/use-refresh-triggers';
import { notifyUpdatesChanged } from '../hooks/use-update-status';
import { errorMessage } from '../lib/errors';
import { fullTime, relativeTime } from '../lib/relative-time';
import { desktopStatusLabel, displayVersion, type StatusLabel } from '../lib/verdictan-labels';
import { Hint } from './hint';
import {
  CopyValue,
  SettingsAdvanced,
  SettingsRow,
  SettingsRows,
  StatusBadge,
} from './settings-disclosure';
import { StepError, runtimeView, useRuntimeStatus } from './verdictan-settings';
import { Button } from './ui/button';
import { EntityIcon } from './ui/entity-icon';
import { Progress } from './ui/progress';

export const userGuideUrl = 'https://github.com/verdictan/kalkidan/blob/main/docs/user-guide.md';
export const reportIssueUrl = 'https://github.com/verdictan/kalkidan/issues';

const activePhases = ['downloading', 'verifying', 'staging'];
const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** The status of the desktop app. A running or staged update replaces the check result. */
export function desktopUpdateLabel(desktop: DesktopUpdateStatus): StatusLabel {
  // A development build does not update. The reason shows on the line below.
  if (desktop.install.kind === 'development') return { label: 'Updates off', tone: 'muted' };
  const phase = desktop.update?.phase;
  if (phase && activePhases.includes(phase)) return { label: 'Downloading…', tone: 'secondary' };
  if (phase === 'staged') return { label: 'Ready to restart', tone: 'warning' };
  if (phase === 'restarting') return { label: 'Restarting…', tone: 'secondary' };
  return desktopStatusLabel(desktop);
}

/**
 * The update banner at the top of About: "Kalkidan x.y is ready — Restart". Before that, it
 * shows the download of an available release and its progress. Nothing shows without a
 * release.
 */
function DesktopUpdateBanner({
  api,
  desktop,
  onStatus,
}: {
  api: API;
  desktop: DesktopUpdateStatus;
  onStatus(status: DesktopUpdateStatus): void;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const update = desktop.update;
  const active = !!update && activePhases.includes(update.phase);
  const report = useRef(onStatus);
  report.current = onStatus;
  // Read the progress while a download runs.
  useEffect(() => {
    if (!active) return;
    let live = true;
    const timer = setInterval(() => {
      void api.componentUpdates(false).then(
        (value) => live && report.current(value.desktop),
        () => {},
      );
    }, 500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [api, active]);
  async function run(action: () => Promise<DesktopUpdateStatus>) {
    if (busy) return;
    setBusy(true);
    setFailure('');
    try {
      onStatus(await action());
      notifyUpdatesChanged();
    } catch (reason) {
      setFailure(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  if (desktop.install.kind === 'development') return null;
  const release = desktop.discovery === 'available' ? desktop.release : undefined;
  const staged = update?.phase === 'staged';
  const failed = update?.phase === 'failed' || !!failure;
  if (!release && !update) return null;
  const version = displayVersion(update?.version || release?.version || '');
  const selfUpdate = desktop.install.selfUpdate;
  const percent =
    update?.phase === 'downloading' && update.totalBytes > 0
      ? (update.receivedBytes / update.totalBytes) * 100
      : undefined;
  let title: string;
  let help: ReactNode;
  let action: ReactNode = null;
  if (staged) {
    title = `Kalkidan ${version} is ready`;
    help = 'Restart to finish. The agents on this computer stop. Your chats stay.';
    action = (
      <Button size="sm" disabled={busy} onClick={() => void run(() => api.desktopUpdateRestart())}>
        Restart
      </Button>
    );
  } else if (update?.phase === 'restarting') {
    // The app quits and opens the new version. No action is possible until then.
    title = `Restarting Kalkidan ${version}…`;
    help = 'Kalkidan opens again with the new version.';
  } else if (active) {
    title = `Downloading Kalkidan ${version}`;
    help =
      update!.phase === 'downloading' && update!.totalBytes > 0
        ? `${megabytes(update!.receivedBytes)} of ${megabytes(update!.totalBytes)}`
        : update!.phase === 'verifying'
          ? `Verifying version ${version}…`
          : 'Preparing the update…';
    action = (
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => void run(() => api.desktopUpdateCancel())}
      >
        Cancel
      </Button>
    );
  } else if (release && !selfUpdate) {
    title = `Kalkidan ${version} is available`;
    help = desktop.install.reason || 'Install the download, then restart Kalkidan.';
    action = (
      <Button asChild size="sm">
        <a href={release.url} target="_blank" rel="noreferrer">
          Download
          <ExternalLink aria-hidden="true" />
        </a>
      </Button>
    );
  } else if (release) {
    title = `Kalkidan ${version} is available`;
    help = failed ? 'The download did not finish.' : 'Download it now. You restart when you want.';
    action = (
      <Button size="sm" disabled={busy} onClick={() => void run(() => api.desktopUpdateDownload())}>
        {failed ? 'Try again' : 'Download'}
      </Button>
    );
  } else return null;
  return (
    <section aria-label="Kalkidan update" className="grid gap-2">
      <div className="settings-banner">
        <EntityIcon>
          <Download />
        </EntityIcon>
        <div className="settings-row-text" aria-live="polite">
          <span className="settings-row-label">{title}</span>
          <span className="settings-row-help">{help}</span>
        </div>
        {action}
      </div>
      {active && <Progress label="Kalkidan update download" value={percent} />}
      {(failure || update?.error) && <StepError>{failure || update?.error}</StepError>}
    </section>
  );
}

/**
 * Settings › About: the update banner, the Kalkidan version with the one "Check for updates"
 * button, the agent tools, and help links. The Advanced fold has the build, the SHA-256, and
 * the release page.
 */
export function AboutSection({
  api,
  open = true,
  onOpenComputers,
}: {
  api: API;
  open?: boolean;
  /** Opens Settings › Computers, where a runtime or a helper problem shows. */
  onOpenComputers?: () => void;
}) {
  const [inventory, setInventory] = useState<ComponentInventory>();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const runtime = useRuntimeStatus(api, open, 'local');
  function read(force: boolean) {
    // Older desktop builds do not report component versions.
    if (typeof api.componentUpdates !== 'function') return;
    const token = ++generation.current;
    if (force) setChecking(true);
    void Promise.resolve()
      .then(() => api.componentUpdates(force))
      .then(
        (value) => {
          if (token !== generation.current) return;
          setInventory(value);
          setError('');
          if (force) notifyUpdatesChanged();
        },
        (failure) => token === generation.current && setError(errorMessage(failure)),
      )
      .finally(() => token === generation.current && setChecking(false));
  }
  useRefreshTriggers(undefined, open, () => read(false));
  useEffect(() => {
    if (!open) return;
    return api.onRemoteHostsChange?.(() => read(false));
  }, [api, open]);
  const desktop = inventory?.desktop;
  const development = desktop?.install.kind === 'development';
  const checkedAt = desktop?.lastSuccessAt ? new Date(desktop.lastSuccessAt).toISOString() : '';
  const version = !desktop?.runningVersion
    ? 'Version not known'
    : /^\d/.test(desktop.runningVersion)
      ? `Version ${displayVersion(desktop.runningVersion)}`
      : desktop.runningVersion;
  const kalkidanHelp = development
    ? `${version} · Updates are off in a development build.`
    : checking
      ? `${version} · Checking…`
      : checkedAt
        ? `${version} · Checked ${relativeTime(checkedAt)}`
        : version;
  const view = runtimeView(runtime);
  const helperUpdates = (inventory?.helpers || []).filter((h) =>
    ['available', 'waiting-for-idle'].includes(h.discovery),
  );
  const toolsStatus: StatusLabel = !runtime.status
    ? { label: 'Checking…', tone: 'secondary' }
    : view.failure
      ? { label: 'Needs attention', tone: 'destructive' }
      : view.running
        ? { label: 'Updating…', tone: 'secondary' }
        : !runtime.status.installed
          ? { label: 'Not installed', tone: 'warning' }
          : helperUpdates.length
            ? { label: 'Update waiting', tone: 'warning' }
            : { label: 'Up to date', tone: 'success' };
  const toolsAttention = ['destructive', 'warning'].includes(toolsStatus.tone);
  const checkButton = (
    <Button
      variant="outline"
      size="sm"
      disabled={checking || development || !desktop}
      onClick={() => read(true)}
    >
      {checking ? 'Checking…' : 'Check for updates'}
    </Button>
  );
  return (
    <>
      {desktop && (
        <DesktopUpdateBanner
          api={api}
          desktop={desktop}
          onStatus={(next) => setInventory((value) => value && { ...value, desktop: next })}
        />
      )}
      <SettingsRows label="About">
        <SettingsRow
          id={settingsAnchors.about}
          icon={
            <img
              src="./brand/kalkidan-icon.svg"
              alt=""
              width="32"
              height="32"
              className="size-8 shrink-0 rounded-lg"
            />
          }
          label="Kalkidan"
          help={
            <span
              data-testid="settings-version"
              title={checkedAt ? fullTime(checkedAt) : undefined}
            >
              {kalkidanHelp}
            </span>
          }
        >
          {/* The banner shows an update. Only "Updates off" needs a badge here. */}
          {development && <StatusBadge status={desktopUpdateLabel(desktop)} />}
          {development ? (
            <Hint label="A development build does not update. Install a release build to get updates.">
              {checkButton}
            </Hint>
          ) : (
            checkButton
          )}
        </SettingsRow>
        <SettingsRow
          label="Agent tools"
          help={
            toolsAttention
              ? helperUpdates.length && !view.failure
                ? 'An SSH helper update waits for active work to stop.'
                : view.help
              : 'Managed agents and SSH helpers update by themselves.'
          }
        >
          <StatusBadge status={toolsStatus} />
          {toolsAttention && onOpenComputers && (
            <Button variant="ghost" size="sm" onClick={onOpenComputers}>
              Open Computers
            </Button>
          )}
        </SettingsRow>
        <SettingsRow label="Help" help="Guides and problem reports.">
          <ExternalTextLink href={userGuideUrl}>User guide</ExternalTextLink>
          <ExternalTextLink href={reportIssueUrl}>Report an issue</ExternalTextLink>
        </SettingsRow>
      </SettingsRows>
      {error && <StepError>{error}</StepError>}
      {desktop && (
        <SettingsAdvanced>
          <SettingsRows>
            <SettingsRow
              label="Build"
              help={<CopyValue value={desktop.runningBuild} name="Build" />}
            />
            {desktop.release && (
              <>
                <SettingsRow
                  label={`Kalkidan ${displayVersion(desktop.release.version)} SHA-256`}
                  help={<CopyValue value={desktop.release.sha256} name="SHA-256" />}
                />
                <SettingsRow
                  label="Release page"
                  help={`Published ${new Date(desktop.release.publishedAt).toLocaleString()}`}
                >
                  <ExternalTextLink href={desktop.release.url}>Open</ExternalTextLink>
                </SettingsRow>
              </>
            )}
            {desktop.lastSuccessAt && (
              <SettingsRow
                label="Last check"
                help={`${new Date(desktop.lastSuccessAt).toLocaleString()}${
                  desktop.stale ? ' · It may be out of date.' : ''
                }`}
              />
            )}
            {desktop.error && <SettingsRow label="Last check error" help={desktop.error} />}
          </SettingsRows>
        </SettingsAdvanced>
      )}
    </>
  );
}

function ExternalTextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-sm text-xs leading-4 text-link outline-none hover:underline focus-visible:shadow-[var(--focus-ring)]"
    >
      {children}
      <ExternalLink className="size-3" aria-hidden="true" />
    </a>
  );
}
