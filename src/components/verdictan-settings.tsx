import { ComponentUpdates } from './component-updates';
import { VerdictanSetupForm } from './verdictan-setup';
import { useEffect, useRef, useState } from 'react';
import type { API } from '../api/contracts';
import type { VerdictanStatus } from '../domain/verdictan';
import type { ComponentUpdateStatus } from '../domain/updates';
import { Button } from './ui/button';
import { Choice } from './choice';

export function VerdictanSettings({ api, open }: { api: API; open: boolean }) {
  const [status, setStatus] = useState<VerdictanStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    if (!open) return;
    const id = ++generation.current;
    const update = () => {
      void Promise.resolve()
        .then(() => api.verdictanStatus())
        .then(
          (next) => {
            if (generation.current === id) setStatus(next);
          },
          () => {
            if (generation.current === id) setError('Could not read Verdictan account status.');
          },
        );
    };
    update();
    const timer = setInterval(update, 1000);
    return () => {
      generation.current++;
      clearInterval(timer);
    };
  }, [api, open]);
  async function run(action: () => Promise<VerdictanStatus>) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError('');
    const id = generation.current;
    try {
      const result = await action();
      if (generation.current === id) setStatus(result);
    } catch {
      if (generation.current === id)
        setError('The account operation failed. Check status before retrying.');
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  const account = status?.account;
  return (
    <section className="mt-5 grid gap-3 border-t pt-5" aria-label="Verdictan account">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Verdictan</h3>
        <span className="text-xs text-muted-foreground" role="status">
          {status?.phase.replaceAll('-', ' ') || 'Checking…'}
        </span>
      </div>
      {account?.organizationId && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt>Organization</dt>
          <dd className="break-all">{account.organizationId}</dd>
          <dt>Account</dt>
          <dd className="break-all">{account.userId}</dd>
          <dt>API</dt>
          <dd className="break-all">{account.apiUrl}</dd>
          {account.expiresAt && (
            <>
              <dt>Session expires</dt>
              <dd>{new Date(account.expiresAt).toLocaleString()}</dd>
            </>
          )}
        </dl>
      )}
      {status?.phase === 'missing' && (
        <p className="text-xs text-muted-foreground">
          Install the approved Verdictan runtime in Updates, then check your account.
        </p>
      )}
      {status?.phase === 'authenticated' && !status.executionReady && (
        <p className="text-xs text-muted-foreground">
          Your account is connected. Gateway setup and agent compatibility still need verification.
        </p>
      )}
      {status?.phase === 'authenticated' && <VerdictanSetupForm api={api} />}
      {status?.remoteRevocationPending && (
        <p role="alert" className="field-error">
          Local sign-out finished. Remote access revocation could not be confirmed.
        </p>
      )}
      {(error || status?.error) && (
        <p role="alert" className="field-error">
          {error || accountError(status!.error!)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void run(() => api.verdictanCheck())}
        >
          Check status
        </Button>
        {status?.phase === 'authenticated' || status?.phase === 'expired' ? (
          <>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => api.verdictanRenew())}
            >
              Renew session
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => api.verdictanLogout())}
            >
              Sign out
            </Button>
          </>
        ) : (
          <>
            <Button
              disabled={busy || status?.phase === 'missing'}
              onClick={() => void run(() => api.verdictanAuthorize('login'))}
            >
              Sign in
            </Button>
            <Button
              variant="outline"
              disabled={busy || status?.phase === 'missing'}
              onClick={() => void run(() => api.verdictanAuthorize('register'))}
            >
              Create account
            </Button>
          </>
        )}
        {status?.phase === 'authorizing' && (
          <Button
            variant="outline"
            onClick={() =>
              void api
                .verdictanCancel()
                .then(setStatus, () => setError('Could not cancel authorization. Check status.'))
            }
          >
            Cancel authorization
          </Button>
        )}
      </div>
    </section>
  );
}
function accountError(code: string) {
  const messages: Record<string, string> = {
    'desktop.secure_storage_unavailable': 'Unlock your system keyring, then retry.',
    'desktop.browser_failed': 'The browser could not open. Retry Sign in.',
    'desktop.region_mismatch':
      'The saved account belongs to another region. Sign out before changing regions.',
    'desktop.identity_mismatch':
      'The browser account differs from the saved account. Use the same account or sign out.',
    'desktop.auth_expired': 'Your session expired. Sign in again.',
    'desktop.request_timeout': 'Verdictan did not respond in time. Check status before retrying.',
    'desktop.operation_in_progress': 'Another account operation is in progress.',
  };
  return (
    messages[code] ||
    'Verdictan could not complete this operation. Check the runtime installation and retry.'
  );
}

export function RuntimeUpdates({ api, open }: { api: API; open: boolean }) {
  const [hosts, setHosts] = useState<{ value: string; label: string }[]>([
    { value: 'local', label: 'This computer' },
  ]);
  const [host, setHost] = useState('local');
  const [status, setStatus] = useState<ComponentUpdateStatus>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void Promise.resolve()
      .then(() => api.remoteHosts())
      .then((list) => {
        if (live)
          setHosts([
            { value: 'local', label: 'This computer' },
            ...list.map((item) => ({ value: item.id, label: item.name })),
          ]);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api, open]);
  useEffect(() => {
    if (!open) return;
    const id = ++generation.current;
    setStatus(undefined);
    setError('');
    let reading = false;
    const update = () => {
      if (reading) return;
      reading = true;
      void Promise.resolve()
        .then(() => api.runtimeUpdateStatus(host))
        .then(
          (next) => {
            if (generation.current === id) setStatus(next);
          },
          () => {
            if (generation.current === id)
              setError('This host is unavailable. Connect it before checking updates.');
          },
        )
        .finally(() => {
          reading = false;
        });
    };
    update();
    const timer = setInterval(update, 1500);
    return () => {
      generation.current++;
      clearInterval(timer);
    };
  }, [api, open, host]);
  async function action(
    method: 'runtimeUpdateCheck' | 'runtimeUpdateInstall' | 'runtimeUpdateCancel',
  ) {
    if (pending.current && method !== 'runtimeUpdateCancel') return;
    pending.current = true;
    setBusy(true);
    setError('');
    const id = generation.current;
    try {
      const result = await api[method](host);
      if (id === generation.current) setStatus(result);
    } catch {
      if (id === generation.current)
        setError('The update operation could not finish. Check host status before retrying.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const operation = status?.operation;
  const installing =
    !!operation &&
    ['requested', 'downloading', 'verifying', 'activating', 'validating', 'rolling-back'].includes(
      operation.phase,
    );
  return (
    <section className="grid gap-4" aria-label="Runtime updates">
      {typeof api.componentUpdates === 'function' && <ComponentUpdates api={api} />}
      <Choice label="Execution host" value={host} onChange={setHost} options={hosts} />
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Verdictan runtime</h3>
        <span role="status" className="text-xs text-muted-foreground">
          {status?.discovery || 'Checking…'}
          {status?.stale ? ' · last result may be stale' : ''}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt>Installed</dt>
        <dd>{status?.installed?.version || 'Not installed'}</dd>
        <dt>Running</dt>
        <dd>{status?.running?.version || 'Not confirmed'}</dd>
        <dt>Available</dt>
        <dd>{status?.discovered?.version || 'Unknown'}</dd>
        <dt>Approved</dt>
        <dd>{status?.approved?.version || 'No approved release'}</dd>
        {status?.lastSuccessAt && (
          <>
            <dt>Last checked</dt>
            <dd>{new Date(status.lastSuccessAt).toLocaleString()}</dd>
          </>
        )}
      </dl>
      {operation && (
        <div className="grid gap-2 text-xs" aria-live="polite">
          <p>{operation.phase.replaceAll('-', ' ')}</p>
          {operation.phase === 'downloading' && (
            <progress
              aria-label="Runtime download"
              value={operation.receivedBytes}
              max={operation.totalBytes}
              className="w-full"
            />
          )}
          {operation.phase === 'waiting-for-idle' && (
            <p>
              Stop active work, then select Install approved update to activate the staged runtime.
            </p>
          )}
          {operation.error && (
            <p role="alert" className="field-error">
              {operation.error}
            </p>
          )}
        </div>
      )}
      {(error || status?.error) && (
        <p role="alert" className="field-error">
          {error || status?.error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => void action('runtimeUpdateCheck')}>
          Check for updates
        </Button>
        <Button
          disabled={busy || installing || !status?.approved || status.discovery === 'blocked'}
          onClick={() => void action('runtimeUpdateInstall')}
        >
          Install approved update
        </Button>
        {(installing || operation?.phase === 'waiting-for-idle') && (
          <Button
            variant="outline"
            disabled={
              busy || ['activating', 'validating', 'rolling-back'].includes(operation!.phase)
            }
            onClick={() => void action('runtimeUpdateCancel')}
          >
            Cancel update
          </Button>
        )}
      </div>
      {!!status?.history.length && (
        <details>
          <summary className="text-sm">Update history</summary>
          <ul className="mt-2 grid gap-2 text-xs">
            {status.history
              .slice()
              .reverse()
              .map((item) => (
                <li key={item.id}>
                  {item.target.version} · {item.phase.replaceAll('-', ' ')} ·{' '}
                  {new Date(item.updatedAt).toLocaleString()}
                  {item.error && <p>{item.error}</p>}
                </li>
              ))}
          </ul>
        </details>
      )}
    </section>
  );
}
