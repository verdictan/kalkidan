import { useEffect, useRef, useState } from 'react';
import type { API } from '../types';
import type { ComponentInventory } from '../domain/updates';
import { Button } from './ui/button';
import { errorMessage } from '../lib/errors';
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
          {inventory.desktop.release && (
            <div className="grid gap-1">
              <a href={inventory.desktop.release.url} target="_blank" rel="noreferrer">
                Open Kalkidan {inventory.desktop.release.version} downloads
              </a>
              <p className="help-text">
                Install the desktop download, then restart Kalkidan. Downloads do not replace the
                running app.
              </p>
              <code className="break-all text-xs">SHA-256: {inventory.desktop.release.sha256}</code>
            </div>
          )}
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
            Codex and Claude Code are externally managed. Check their installed versions in Local
            agents.
          </p>
        </>
      )}
    </section>
  );
}
