import { useEffect, useState } from 'react';
import type { API } from '../types';
import { sshWorkSummary, type SshQuitChoice, type SshQuitRequest } from '../domain/ssh-quit';
import { Button } from './ui/button';
import { CheckboxRow } from './ui/checkbox';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

/**
 * The question when Kalkidan quits while agent runs or shells work on SSH hosts. The work
 * continues on the hosts without the app. "Keep running" is the default. Escape and closing
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
  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && answer('keep')}>
      <DialogContent size="sm" layout="scroll">
        <DialogHeader>
          <DialogTitle>Work continues on SSH hosts</DialogTitle>
          <DialogDescription>
            {request ? `${sshWorkSummary(request.hosts)} continue after Kalkidan quits. ` : ''}
            Kalkidan attaches to them again when it opens.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3">
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
          <CheckboxRow
            label="Don't ask again"
            description="Turn the question on again in Preferences › Connections."
            checked={dontAsk}
            disabled={busy}
            onChange={(event) => setDontAsk(event.target.checked)}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="destructive" disabled={busy} onClick={() => answer('stop')}>
            Stop all
          </Button>
          <Button autoFocus disabled={busy} onClick={() => answer('keep')}>
            Keep running
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
