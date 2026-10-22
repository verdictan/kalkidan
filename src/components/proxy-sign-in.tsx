import { useEffect, useState, type FormEvent } from 'react';
import type { API } from '../types';
import type { ProxyLoginRequest } from '../domain/updates';
import { Button } from './ui/button';
import { CheckboxRow } from './ui/checkbox';
import { Input } from './ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

/**
 * Asks for the user name and password of a proxy server when a download of managed agents goes
 * through a proxy that asks for them. The password goes only to the desktop process. Kalkidan
 * saves it only in the secret store of the operating system, when the user selects Remember.
 */
export function ProxySignInDialog({ api }: { api: API }) {
  const [requests, setRequests] = useState<ProxyLoginRequest[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  useEffect(
    () =>
      api.onProxyLogin?.((request) =>
        setRequests((previous) =>
          previous.some((item) => item.id === request.id) ? previous : [...previous, request],
        ),
      ),
    [api],
  );
  const request = requests[0];
  function answer(value: { username: string; password: string; remember: boolean } | null) {
    if (!request) return;
    void api.proxyLoginAnswer?.(request.id, value).catch(() => {});
    setRequests((previous) => previous.slice(1));
    // The password does not stay in the form after the answer.
    setPassword('');
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!username || !password) return;
    answer({ username, password, remember: remember && !!request?.canSave });
  }
  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && answer(null)}>
      <DialogContent size="sm">
        {request && (
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Sign in to the proxy server</DialogTitle>
              <DialogDescription>
                The proxy server {request.host}:{request.port} asks for a user name and password
                before Kalkidan can download managed agents.
                {request.realm ? ` It names "${request.realm}".` : ''}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Input
                aria-label="Proxy user name"
                placeholder="User name"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
              <Input
                aria-label="Proxy password"
                placeholder="Password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <CheckboxRow
                label="Remember on this computer"
                description={
                  request.canSave
                    ? 'Kalkidan keeps the password in the secret store of your system. You can remove it in Computers.'
                    : 'This computer has no secret store, so Kalkidan keeps the password only until it quits.'
                }
                checked={remember && request.canSave}
                disabled={!request.canSave}
                onChange={(event) => setRemember(event.target.checked)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => answer(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!username || !password}>
                Sign in
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
