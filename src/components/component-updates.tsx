import { useEffect, useRef, useState } from 'react';
import type { API } from '../types';
import type { ComponentInventory } from '../domain/updates';
import { Button } from './ui/button';
import { errorMessage } from '../lib/errors';
import type { DesktopUpdateStatus } from '../domain/updates';

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

/**
 * Download, verify, and restart controls for the desktop app. Each step needs a user action.
 * The release page shows only when this copy cannot update itself.
 */
function DesktopUpdate({
  api,
  status,
  onStatus,
}: {
  api: API;
  status: DesktopUpdateStatus;
  onStatus(status: DesktopUpdateStatus): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const update = status.update;
  const active = !!update && activePhases.includes(update.phase);
  const report = useRef(onStatus);
  report.current = onStatus;
  // Read progress while a download runs.
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
    setError('');
    try {
      onStatus(await action());
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  const release = status.release;
  const newer = status.discovery === 'available' && !!release;
  if (!newer && !update && !error) return null;
  if (!status.install.selfUpdate)
    return (
      <div className="grid gap-1" role="group" aria-label="Desktop update">
        {release && newer && (
          <a href={release.url} target="_blank" rel="noreferrer">
            Open the Kalkidan {release.version} release page
          </a>
        )}
        {status.install.reason && <p className="help-text">{status.install.reason}</p>}
        {release && newer && <code className="break-all text-xs">SHA-256: {release.sha256}</code>}
      </div>
    );
  return (
    <div className="grid gap-2" role="group" aria-label="Desktop update">
      {update && (
        <p role="status" aria-live="polite">
          {phaseText[update.phase]} · Kalkidan {update.version}
          {update.phase === 'downloading' &&
            ` · ${megabytes(update.receivedBytes)} of ${megabytes(update.totalBytes)}`}
        </p>
      )}
      {update?.phase === 'downloading' && (
        <progress
          aria-label="Desktop update download"
          className="w-full"
          value={update.receivedBytes}
          max={update.totalBytes || 1}
        />
      )}
      {update?.phase === 'staged' && (
        <p className="help-text">
          Kalkidan verified the download. Restart to install it. The agents on this computer stop
          before the restart. Their sessions stay on disk.
        </p>
      )}
      {(update?.error || error) && (
        <p role="alert" className="field-error">
          {error || update?.error}
        </p>
      )}
      {update?.phase === 'failed' && update.error?.includes('release page') && release && (
        <a href={release.url} target="_blank" rel="noreferrer">
          Open the Kalkidan {release.version} release page
        </a>
      )}
      <div className="flex flex-wrap gap-2">
        {newer && (!update || ['failed', 'canceled'].includes(update.phase)) && (
          <Button disabled={busy} onClick={() => void run(() => api.desktopUpdateDownload())}>
            Download Kalkidan {release!.version}
          </Button>
        )}
        {active && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void run(() => api.desktopUpdateCancel())}
          >
            Cancel download
          </Button>
        )}
        {update?.phase === 'staged' && (
          <Button disabled={busy} onClick={() => void run(() => api.desktopUpdateRestart())}>
            Restart to update
          </Button>
        )}
      </div>
    </div>
  );
}
export function ComponentUpdates({ api }: { api: API }) {
  const [inventory, setInventory] = useState<ComponentInventory>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    let live = true;
    const refresh = (force: boolean) => {
      const token = ++generation.current;
      setBusy(true);
      void api
        .componentUpdates(force)
        .then(
          (value) => {
            if (live && token === generation.current) {
              setInventory(value);
              setError('');
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
  }, [api, revision]);
  return (
    <section aria-label="Application and helper updates" className="grid gap-3">
      <div className="flex items-center justify-between">
        <h3>Application and SSH helpers</h3>
        <Button variant="outline" disabled={busy} onClick={() => setRevision((value) => value + 1)}>
          {busy ? 'Checking…' : 'Check components'}
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {inventory && (
        <>
          <p>
            Kalkidan {inventory.desktop.runningVersion} · {inventory.desktop.discovery}
            {inventory.desktop.stale ? ' · stale' : ''}
          </p>
          <p className="help-text">Running build: {inventory.desktop.runningBuild.slice(0, 20)}</p>
          {inventory.desktop.lastSuccessAt && (
            <p className="help-text">
              Last verified: {new Date(inventory.desktop.lastSuccessAt).toLocaleString()}
            </p>
          )}
          {inventory.desktop.error && <p role="status">{inventory.desktop.error}</p>}
          <DesktopUpdate
            api={api}
            status={inventory.desktop}
            onStatus={(desktop) => setInventory((value) => value && { ...value, desktop })}
          />
          {inventory.helpers.map((helper) => (
            <div key={helper.hostId} className="grid gap-1 border-t pt-2">
              <h4>
                {helper.name} · {helper.discovery}
              </h4>
              <p className="help-text">
                Installed: {helper.installed?.slice(0, 20) || 'Unknown'} · Running:{' '}
                {helper.running?.slice(0, 20) || (helper.connected ? 'Unknown' : 'Disconnected')}
              </p>
              <p className="help-text">Bundled helper: {helper.approved.slice(0, 20)}</p>
              <p className="help-text">
                Use the host’s Update helper action in Settings. Active work must finish first.
              </p>
            </div>
          ))}
          <p className="help-text">
            Managed Verdictan agents use the Codex and Claude Code versions installed on each
            machine. Their installer or package manager updates them.
          </p>
        </>
      )}
    </section>
  );
}
