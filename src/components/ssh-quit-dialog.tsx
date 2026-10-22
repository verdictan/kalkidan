import { useEffect, useState } from 'react';
import type { API } from '../types';
import {
  sshDisconnectedNote,
  sshWorkSummary,
  type SshQuitChoice,
  type SshQuitRequest,
} from '../domain/ssh-quit';
import { ConfirmDialog } from './confirm-dialog';
import { CheckboxRow } from './ui/checkbox';

/**
 * The question when Kalkidan quits while agent runs or shells work on SSH hosts. The work
 * continues on the hosts without the app. "Keep running" has the focus. Escape and closing
 * the question also keep the work. "Stop all" stops it. Kalkidan quits after each answer.
 */
export function SshQuitDialog({ api }: { api: API }) {
  const [request, setRequest] = useState<SshQuitRequest>();
  const [dontAsk, setDontAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(
    () =>
      api.onSshQuitRequest?.((next) => {
        setRequest(next);
        setDontAsk(false);
        setBusy(false);
      }),
    [api],
  );
  function answer(choice: SshQuitChoice) {
    if (!request || busy) return;
    setBusy(true);
    void Promise.resolve()
      .then(() => api.sshQuitAnswer?.({ id: request.id, choice, dontAsk }))
      .catch(() => {})
      .finally(() => setRequest(undefined));
  }
  // With work only on disconnected hosts, nothing can stop now.
  const stoppable = !!request?.hosts.length;
  const note = request ? sshDisconnectedNote(request.disconnected ?? []) : '';
  return (
    <ConfirmDialog
      open={!!request}
      title="Work continues on SSH hosts"
      description={
        stoppable
          ? `${sshWorkSummary(request!.hosts)} continue after Kalkidan quits. Kalkidan attaches to them again when it opens.`
          : 'Work may continue on SSH hosts after Kalkidan quits.'
      }
      // Cancel, Escape and the close button keep the work. Kalkidan quits after each answer.
      cancelLabel="Keep running"
      confirmLabel={stoppable ? 'Stop all' : 'Quit'}
      destructive={stoppable}
      busy={busy}
      onCancel={() => answer('keep')}
      onConfirm={() => answer(stoppable ? 'stop' : 'keep')}
    >
      {request?.hosts.map((host) => (
        <section key={host.hostId} aria-label={host.hostName} className="grid gap-1">
          <h3 className="text-sm font-medium">{host.hostName}</h3>
          <ul className="grid gap-0.5 text-sm text-muted-foreground">
            {host.runs.map((run) => (
              <li key={'run:' + run.id} className="truncate">
                Agent run: {run.label}
              </li>
            ))}
            {host.shells.map((shell) => (
              <li key={'shell:' + shell.id} className="truncate">
                {shell.label}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {note && (
        <p role="note" className="text-sm">
          {note}
        </p>
      )}
      <CheckboxRow
        label="Don't ask again"
        description="Turn the question on again in Computers › SSH hosts."
        checked={dontAsk}
        disabled={busy}
        onChange={(event) => setDontAsk(event.target.checked)}
      />
    </ConfirmDialog>
  );
}
