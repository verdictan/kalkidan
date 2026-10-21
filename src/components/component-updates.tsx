import { useEffect, useRef, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import type { API } from '../types';
import type { ComponentInventory } from '../domain/updates';
import { Button } from './ui/button';
import { errorMessage } from '../lib/errors';
import { notifyUpdatesChanged } from '../hooks/use-update-status';
import {
  desktopStatusLabel,
  displayVersion,
  helperStatusLabel,
  shortId,
} from '../lib/verdictan-labels';
import { RuntimeUpdateCard, StepError, UpdateCard } from './verdictan-settings';
import { CopyValue, SettingsDisclosure } from './settings-disclosure';

/** Settings › Updates: one card for each component that Kalkidan updates. */
export function ComponentUpdates({
  api,
  open = true,
  onNavigate,
}: {
  api: API;
  open?: boolean;
  /** Switches Settings to another section, for example 'agents'. */
  onNavigate: (section: 'agents' | 'managed-agents' | 'remote') => void;
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
  const release = desktop?.discovery === 'available' ? desktop.release : undefined;
  return (
    <section aria-label="Updates" className="grid gap-3">
      <div className="flex items-center justify-between gap-4">
        <p className="form-help">
          Kalkidan checks for new versions. It does not install the app for you.
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
          <UpdateCard
            name="Kalkidan"
            version={displayVersion(desktop.runningVersion)}
            status={desktopStatusLabel(desktop)}
            action={
              release && (
                <Button asChild size="sm">
                  <a href={release.url} target="_blank" rel="noreferrer">
                    Download {displayVersion(release.version)}
                    <ExternalLink aria-hidden="true" />
                  </a>
                </Button>
              )
            }
          >
            {release && (
              <p>
                Install the download, then restart Kalkidan. The download does not replace the app.
              </p>
            )}
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
        )}
        <RuntimeUpdateCard api={api} open={open} onManage={() => onNavigate('managed-agents')} />
        {inventory?.helpers.map((helper) => (
          <UpdateCard
            key={helper.hostId}
            name={`SSH helper on ${helper.name}`}
            subtitle={helper.installed ? `Build ${shortId(helper.installed)}` : 'Build not known'}
            status={helperStatusLabel(helper)}
            action={
              helper.discovery === 'available' && (
                <Button variant="outline" size="sm" onClick={() => onNavigate('remote')}>
                  Open remote hosts
                </Button>
              )
            }
          >
            {helper.discovery === 'available' && (
              <p>Update the helper in Remote hosts. Active work on the host must finish first.</p>
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
