import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import type { API } from '../types';
import type { ComponentInventory, DesktopUpdateStatus } from '../domain/updates';
import { Button } from './ui/button';
import { errorMessage } from '../lib/errors';
import { notifyUpdatesChanged } from '../hooks/use-update-status';
import {
  desktopStatusLabel,
  displayVersion,
  helperStatusLabel,
  runtimeInstallable,
  runtimeStatusLabel,
  shortId,
} from '../lib/verdictan-labels';
import type { ComponentUpdateStatus } from '../domain/updates';
import { computerAnchor, helperUpdateAnchor, runtimeAnchor } from '../domain/settings-route';
import { StepError, UpdateCard, type SettingsNavigate } from './verdictan-settings';
import { CopyValue, SettingsDisclosure } from './settings-disclosure';
import { Progress } from './ui/progress';
import type { StatusLabel } from '../lib/verdictan-labels';

const activePhases = ['downloading', 'verifying', 'staging'];
const phaseText: Record<string, string> = {
  downloading: 'Downloading',
  verifying: 'Checking the SHA-256 checksum',
  staging: 'Preparing the update',
  staged: 'Ready to install',
  restarting: 'Restarting',
  failed: 'Update failed',
  canceled: 'Download canceled',
};
const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** The status badge of the desktop app. A running or staged update replaces the check result. */
export function desktopUpdateLabel(desktop: DesktopUpdateStatus): StatusLabel {
  // A development build does not update. A release with the same version is not an update.
  if (desktop.install.kind === 'development')
    return { label: 'Development build; updates are off', tone: 'muted' };
  const phase = desktop.update?.phase;
  if (phase && activePhases.includes(phase)) return { label: phaseText[phase], tone: 'secondary' };
  if (phase === 'staged') return { label: 'Restart to update', tone: 'warning' };
  if (phase === 'restarting') return { label: 'Restarting', tone: 'secondary' };
  return desktopStatusLabel(desktop);
}

/**
 * The Kalkidan card in Settings › Updates. Each step needs a user action: download, verify,
 * then "Restart to update". A copy that cannot update itself links to the release page.
 */
function DesktopUpdateCard({
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
    } catch (reason) {
      setFailure(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  const development = desktop.install.kind === 'development';
  const release = desktop.discovery === 'available' && !development ? desktop.release : undefined;
  const selfUpdate = desktop.install.selfUpdate;
  const releaseLink = release && (
    <Button asChild size="sm" variant={selfUpdate ? 'outline' : 'default'}>
      <a href={release.url} target="_blank" rel="noreferrer">
        {selfUpdate ? 'Open release page' : `Download ${displayVersion(release.version)}`}
        <ExternalLink aria-hidden="true" />
      </a>
    </Button>
  );
  let action: ReactNode = null;
  if (development) action = null;
  else if (!selfUpdate) action = releaseLink;
  else if (update?.phase === 'staged')
    action = (
      <Button size="sm" disabled={busy} onClick={() => void run(() => api.desktopUpdateRestart())}>
        Restart to update
      </Button>
    );
  else if (active)
    action = (
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => void run(() => api.desktopUpdateCancel())}
      >
        Cancel download
      </Button>
    );
  else if (release && (!update || ['failed', 'canceled'].includes(update.phase)))
    action = (
      <Button size="sm" disabled={busy} onClick={() => void run(() => api.desktopUpdateDownload())}>
        Download {displayVersion(release.version)}
      </Button>
    );
  const percent =
    update?.phase === 'downloading' && update.totalBytes > 0
      ? (update.receivedBytes / update.totalBytes) * 100
      : undefined;
  return (
    <UpdateCard
      name="Kalkidan"
      version={displayVersion(desktop.runningVersion)}
      status={desktopUpdateLabel(desktop)}
      action={action}
    >
      {update && update.phase !== 'staged' && (
        <p role="status" aria-live="polite">
          {phaseText[update.phase]} · Kalkidan {displayVersion(update.version)}
          {update.phase === 'downloading' &&
            update.totalBytes > 0 &&
            ` · ${megabytes(update.receivedBytes)} of ${megabytes(update.totalBytes)}`}
        </p>
      )}
      {active && <Progress label="Desktop update download" value={percent} />}
      {update?.phase === 'staged' && (
        <p role="status" aria-live="polite">
          Kalkidan {displayVersion(update.version)} is verified and ready. Restart to install it.
          The agents on this computer stop before the restart. Their chats stay on disk.
        </p>
      )}
      {release && !selfUpdate && (
        <p>Install the download, then restart Kalkidan. The download does not replace the app.</p>
      )}
      {release && !selfUpdate && desktop.install.reason && <p>{desktop.install.reason}</p>}
      {development && <p>Install a release build of Kalkidan to get updates.</p>}
      {(failure || update?.error) && <StepError>{failure || update?.error}</StepError>}
      {update?.phase === 'failed' && selfUpdate && releaseLink}
      {desktop.stale && desktop.lastSuccessAt && <p>The last check may be out of date.</p>}
      {desktop.error && <p>{desktop.error}</p>}
      <SettingsDisclosure title="Verify download">
        <dl className="meta-list">
          <dt>Running build</dt>
          <dd>
            <CopyValue value={desktop.runningBuild} name="Running build" />
          </dd>
          {release && (
            <>
              <dt>New version</dt>
              <dd>
                <CopyValue value={release.version} name="Version" />
              </dd>
              <dt>SHA-256</dt>
              <dd>
                <CopyValue value={release.sha256} name="SHA-256" />
              </dd>
              <dt>Published</dt>
              <dd>{new Date(release.publishedAt).toLocaleString()}</dd>
            </>
          )}
          {desktop.lastSuccessAt && (
            <>
              <dt>Last checked</dt>
              <dd>{new Date(desktop.lastSuccessAt).toLocaleString()}</dd>
            </>
          )}
        </dl>
      </SettingsDisclosure>
    </UpdateCard>
  );
}

/**
 * The managed agents runtime of one computer in Settings › Updates. Install and update it in
 * Settings › Computers.
 */
function RuntimeSummaryCard({
  api,
  open,
  hostId,
  name,
  onOpen,
}: {
  api: API;
  open: boolean;
  /** 'local' or the ID of an SSH host. */
  hostId: string;
  name: string;
  onOpen: () => void;
}) {
  const [status, setStatus] = useState<ComponentUpdateStatus>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void Promise.resolve()
      .then(() => api.runtimeUpdateStatus(hostId))
      .then(
        (value) => live && (setStatus(value), setFailed(false)),
        () => live && setFailed(true),
      );
    return () => {
      live = false;
    };
  }, [api, open, hostId]);
  const label: StatusLabel = failed
    ? { label: 'Check failed', tone: 'destructive' }
    : runtimeStatusLabel(status);
  return (
    <UpdateCard
      name={name}
      version={status?.installed?.version}
      status={label}
      action={
        <Button
          variant={runtimeInstallable(status) ? 'default' : 'outline'}
          size="sm"
          aria-label={`Open ${name} in Computers`}
          onClick={onOpen}
        >
          Open in Computers
        </Button>
      }
    />
  );
}

/** Settings › Updates: one card for each component that Kalkidan updates. */
export function ComponentUpdates({
  api,
  open = true,
  onNavigate,
}: {
  api: API;
  open?: boolean;
  /** Moves Settings to another tab, for example to one computer in Computers. */
  onNavigate: SettingsNavigate;
}) {
  const [inventory, setInventory] = useState<ComponentInventory>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    // Older desktop builds do not report component versions.
    if (!open || typeof api.componentUpdates !== 'function') return;
    let live = true;
    const refresh = (force: boolean) => {
      const token = ++generation.current;
      setBusy(true);
      void Promise.resolve()
        .then(() => api.componentUpdates(force))
        .then(
          (value) => {
            if (live && token === generation.current) {
              setInventory(value);
              setError('');
              if (force) notifyUpdatesChanged();
            }
          },
          (failure) => {
            if (live && token === generation.current) setError(errorMessage(failure));
          },
        )
        .finally(() => {
          if (live && token === generation.current) setBusy(false);
        });
    };
    refresh(revision > 0);
    const unsubscribe = api.onRemoteHostsChange?.(() => refresh(false));
    return () => {
      live = false;
      unsubscribe?.();
    };
  }, [api, open, revision]);
  const desktop = inventory?.desktop;
  return (
    <section aria-label="Updates" className="grid gap-3">
      <div className="flex items-center justify-between gap-4">
        <p className="form-help">
          Kalkidan checks for new versions. It installs a desktop update only after you select
          Restart to update.
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw className={busy ? 'animate-spin' : ''} />
          {busy ? 'Checking…' : 'Check for updates'}
        </Button>
      </div>
      {error && <StepError>{error}</StepError>}
      <ul className="grid gap-2" aria-label="Components">
        {desktop && (
          <DesktopUpdateCard
            api={api}
            desktop={desktop}
            onStatus={(next) => setInventory((value) => value && { ...value, desktop: next })}
          />
        )}
        <RuntimeSummaryCard
          api={api}
          open={open}
          hostId="local"
          name="Managed agents runtime"
          onOpen={() => onNavigate('computers', runtimeAnchor())}
        />
        {inventory?.helpers
          .filter((helper) => helper.connected)
          .map((helper) => (
            <RuntimeSummaryCard
              key={`runtime-${helper.hostId}`}
              api={api}
              open={open}
              hostId={helper.hostId}
              name={`Managed agents runtime on ${helper.name}`}
              onOpen={() => onNavigate('computers', runtimeAnchor(helper.hostId))}
            />
          ))}
        {inventory?.helpers.map((helper) => (
          <UpdateCard
            key={helper.hostId}
            name={`SSH helper on ${helper.name}`}
            subtitle={helper.installed ? `Build ${shortId(helper.installed)}` : 'Build not known'}
            status={helperStatusLabel(helper)}
            action={
              <Button
                variant={helper.discovery === 'available' ? 'default' : 'outline'}
                size="sm"
                aria-label={`Open ${helper.name} in Computers`}
                onClick={() =>
                  onNavigate(
                    'computers',
                    // Move to the update button when the update waits for the user.
                    helper.discovery === 'available' || helper.discovery === 'waiting-for-idle'
                      ? helperUpdateAnchor(helper.hostId)
                      : computerAnchor(helper.hostId),
                  )
                }
              >
                Open in Computers
              </Button>
            }
          >
            {helper.discovery === 'available' && (
              <p>Update the helper in Computers. Active work on the host must finish first.</p>
            )}
            <SettingsDisclosure title="Verify helper">
              <dl className="meta-list">
                <dt>Installed</dt>
                <dd>
                  {helper.installed ? (
                    <CopyValue value={helper.installed} name="Digest" />
                  ) : (
                    'Not known'
                  )}
                </dd>
                <dt>Running</dt>
                <dd>
                  {helper.running ? (
                    <CopyValue value={helper.running} name="Digest" />
                  ) : helper.connected ? (
                    'Not known'
                  ) : (
                    'Disconnected'
                  )}
                </dd>
                <dt>In this app</dt>
                <dd>
                  <CopyValue value={helper.approved} name="Digest" />
                </dd>
              </dl>
            </SettingsDisclosure>
          </UpdateCard>
        ))}
      </ul>
      <p className="form-help">
        Codex and Claude Code update separately. See their versions in{' '}
        <button type="button" className="text-link" onClick={() => onNavigate('agents')}>
          Settings › Agents
        </button>
        .
      </p>
    </section>
  );
}
