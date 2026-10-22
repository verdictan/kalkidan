import { useEffect, useState } from 'react';
import type { API } from '../types';
import {
  dataDisclosure,
  lifecycleEffects,
  localDataLabels,
  storePolicies,
  type LocalDataDeletion,
  type LocalDataUsage,
} from '../domain/data-policy';
import { settingsAnchors } from '../domain/settings-route';
import { errorMessage } from '../lib/errors';
import { ConfirmDialog } from './confirm-dialog';
import {
  SettingsDisclosure,
  SettingsGroup,
  SettingsRow,
  SettingsRows,
} from './settings-disclosure';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { showToast } from './ui/toast';

/** A size in bytes as a short text, for example "1.2 GB". */
export function formatBytes(bytes: number) {
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = -1;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** The three parts of the data notice. */
export function DataDisclosure({ headingLevel = 3 }: { headingLevel?: 3 | 4 }) {
  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  return (
    <div className="data-disclosure grid gap-4" data-testid="data-disclosure">
      {dataDisclosure.map((section) => (
        <section key={section.id} aria-labelledby={`data-${section.id}`}>
          <Heading id={`data-${section.id}`} className="mb-1 text-sm font-semibold">
            {section.title}
          </Heading>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {section.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * The state of the data notice. `show` is true when the user has not read the notice and an
 * account is signed in, so that the notice shows before the first request.
 */
export function useDataNotice(api: API, signedIn: boolean) {
  const supported = typeof api.dataNoticeState === 'function';
  const [seen, setSeen] = useState<boolean>();
  useEffect(() => {
    if (!supported || !signedIn || seen !== undefined) return;
    let current = true;
    void api.dataNoticeState!().then(
      (state) => current && setSeen(state.seen),
      () => current && setSeen(true),
    );
    return () => {
      current = false;
    };
  }, [api, supported, signedIn, seen]);
  return {
    show: supported && signedIn && seen === false,
    acknowledge: async () => {
      setSeen(true);
      try {
        await api.setDataNoticeSeen?.();
      } catch {
        // The notice shows again at the next launch. Nothing else depends on it.
      }
    },
  };
}

/** The data notice before the first request. It shows once. Settings › Data keeps it. */
export function DataNoticeDialog({ open, onDone }: { open: boolean; onDone: () => void }) {
  return (
    <Dialog open={open}>
      <DialogContent
        size="md"
        aria-describedby="data-notice-description"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>Where your data goes</DialogTitle>
          <DialogDescription id="data-notice-description">
            Read this before you send the first request. You can read it again in Settings › Data.
          </DialogDescription>
        </DialogHeader>
        <DataDisclosure />
        <DialogFooter>
          <Button autoFocus onClick={onDone}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Settings › Data: the data notice, the disk use of the data folder against the limit, export,
 * deletion, and the retention policy of each store.
 */
export function DataSection({ api, open }: { api: API; open: boolean }) {
  const [usage, setUsage] = useState<LocalDataUsage>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState<LocalDataDeletion>();
  const supported = typeof api.localDataUsage === 'function';
  async function refresh() {
    if (!supported) return;
    try {
      setUsage(await api.localDataUsage!());
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  useEffect(() => {
    if (open) void refresh();
  }, [api, open]);
  async function run(label: string, work: () => Promise<string | undefined>) {
    setBusy(label);
    setError('');
    try {
      const message = await work();
      if (message) showToast({ message });
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  }
  const over = usage ? usage.total > usage.limit : false;
  return (
    <div className="grid gap-6">
      <SettingsGroup id={settingsAnchors.dataNotice} title="Where your data goes">
        <DataDisclosure headingLevel={4} />
      </SettingsGroup>
      <SettingsGroup id={settingsAnchors.localData} title="Data on this computer">
        <SettingsRows label="Data on this computer">
          <SettingsRow
            label="Disk use"
            help={
              usage
                ? `${formatBytes(usage.total)} of ${formatBytes(usage.limit)} in ${usage.root}`
                : supported
                  ? 'Reading…'
                  : 'Available in the desktop app.'
            }
            extra={
              over ? (
                <p role="alert" className="field-error">
                  The data folder is above its limit. Kalkidan removed the logs and caches. Chat
                  history is never removed automatically. Delete chat history to make space.
                </p>
              ) : undefined
            }
          />
          <SettingsRow
            label="Export"
            help="Copies your chat history, project documents, and settings to a folder. Credentials and passwords are not copied."
          >
            <Button
              variant="outline"
              disabled={!supported || !!busy}
              onClick={() =>
                void run('export', async () => {
                  const result = await api.localDataExport!();
                  return result ? `Exported ${result.files} files.` : undefined;
                })
              }
            >
              {busy === 'export' ? 'Exporting…' : 'Export…'}
            </Button>
          </SettingsRow>
          <SettingsRow
            label="Delete caches and logs"
            help="Removes the browser caches, operation logs, and old runtime versions."
          >
            <Button
              variant="outline"
              disabled={!supported || !!busy}
              onClick={() => setConfirm('caches-and-logs')}
            >
              Delete…
            </Button>
          </SettingsRow>
          <SettingsRow
            label="Delete chat history"
            help="Removes the agent conversations, session notes, and run outcomes on this computer."
          >
            <Button
              variant="destructive"
              disabled={!supported || !!busy}
              onClick={() => setConfirm('chat-history')}
            >
              Delete…
            </Button>
          </SettingsRow>
        </SettingsRows>
        {usage && (
          <SettingsDisclosure title="Disk use by kind">
            <ul aria-label="Disk use by kind" className="grid gap-1 text-sm">
              {usage.categories
                .filter((item) => item.bytes > 0)
                .map((item) => (
                  <li key={item.category} className="flex justify-between gap-4">
                    <span>{localDataLabels[item.category]}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatBytes(item.bytes)}
                    </span>
                  </li>
                ))}
            </ul>
          </SettingsDisclosure>
        )}
        {error && (
          <p role="alert" className="field-error whitespace-pre-wrap break-words">
            {error}
          </p>
        )}
      </SettingsGroup>
      <SettingsGroup title="Retention">
        <SettingsDisclosure title="What each store keeps, and for how long">
          <div className="grid gap-3 text-sm">
            {storePolicies.map((store) => (
              <section key={store.id} aria-label={store.name}>
                <h4 className="font-medium">{store.name}</h4>
                <p className="text-muted-foreground">{store.contents}</p>
                <p className="text-muted-foreground">Location: {store.path}</p>
                <p className="text-muted-foreground">Retention: {store.retention}</p>
                <p className="text-muted-foreground">Limit: {store.limit}</p>
                <p className="text-muted-foreground">Delete: {store.deletion}</p>
              </section>
            ))}
          </div>
        </SettingsDisclosure>
        <SettingsDisclosure title="When you remove a host, an account, or the app">
          <ul className="grid gap-2 text-sm">
            {lifecycleEffects.map((item) => (
              <li key={item.action}>
                <span className="font-medium">{item.action}.</span>{' '}
                <span className="text-muted-foreground">{item.effect}</span>
              </li>
            ))}
          </ul>
        </SettingsDisclosure>
      </SettingsGroup>
      <ConfirmDialog
        open={confirm === 'chat-history'}
        title="Delete chat history?"
        description="Kalkidan deletes the agent conversations, session notes, and run outcomes on this computer. Project documents and memory stay. You cannot undo this."
        confirmLabel="Delete chat history"
        destructive
        busy={busy === 'chat-history'}
        onCancel={() => setConfirm(undefined)}
        onConfirm={() =>
          void run('chat-history', async () => {
            await api.localDataDelete!('chat-history');
            setConfirm(undefined);
            return 'Chat history deleted.';
          })
        }
      />
      <ConfirmDialog
        open={confirm === 'caches-and-logs'}
        title="Delete caches and logs?"
        description="Kalkidan deletes the browser caches, operation logs, and old runtime versions. Chat history and projects stay."
        confirmLabel="Delete"
        destructive
        busy={busy === 'caches-and-logs'}
        onCancel={() => setConfirm(undefined)}
        onConfirm={() =>
          void run('caches-and-logs', async () => {
            await api.localDataDelete!('caches-and-logs');
            setConfirm(undefined);
            return 'Caches and logs deleted.';
          })
        }
      />
    </div>
  );
}
