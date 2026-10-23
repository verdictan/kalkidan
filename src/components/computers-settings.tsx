import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { API, RemoteHost } from '../types';
import { errorMessage } from '../lib/errors';
import { Button } from './ui/button';
import { Input } from './ui/input';

// Settings › Tools lists the SSH hosts and the tools on each one. Kalkidan does not install,
// update or set up agents on a host. This file keeps the form that adds a host.

/**
 * The inline form of "Add SSH host": one field for the SSH target, Add, and Cancel. The new host
 * shows as a row at once and checks its connection in the row. Escape cancels.
 */
export function AddHostForm({
  api,
  onAdded,
  onCancel,
}: {
  api: API;
  onAdded: (host: RemoteHost) => void;
  onCancel: () => void;
}) {
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const form = useRef<HTMLFormElement>(null);
  // Escape closes the form, not the Settings page. The form reads Escape on the window in the
  // capture phase, which comes first.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || busy || !form.current?.contains(event.target as Node)) return;
      event.stopPropagation();
      onCancel();
    }
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [busy, onCancel]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = target.trim();
    if (busy || !value) return;
    setBusy(true);
    setError('');
    try {
      onAdded(await api.remoteAdd(value, value));
      setTarget('');
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="computers-add">
      <form
        ref={form}
        className="computers-add-form"
        aria-label="Add SSH host"
        onSubmit={(event) => void submit(event)}
      >
        <Input
          aria-label="SSH target"
          placeholder="user@host"
          value={target}
          disabled={busy}
          autoFocus
          aria-invalid={!!error || undefined}
          onChange={(event) => {
            setTarget(event.target.value);
            setError('');
          }}
        />
        <Button type="submit" size="sm" variant="secondary" disabled={busy || !target.trim()}>
          {busy ? 'Adding…' : 'Add'}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </form>
      {error && (
        <p role="alert" className="field-error whitespace-pre-wrap break-words">
          {error}
        </p>
      )}
    </div>
  );
}
