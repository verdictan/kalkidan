import { useEffect, useRef, useState } from 'react';
import {
  MoreHorizontal,
  Pencil,
  Pin,
  MessageSquarePlus,
  GitFork,
  Share2,
  Copy,
  AppWindow,
  ExternalLink,
  Archive,
} from 'lucide-react';
import type { API, Session, SessionOrganization } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuShortcut,
} from './ui/dropdown-menu';
import { ConfirmDialog } from './confirm-dialog';
import {
  fileManagerName,
  hasPrimaryModifier,
  isTypingTarget,
  shortcutLabel,
} from '../lib/platform';
import { errorMessage } from '../lib/errors';

const shortcuts = {
  rename: shortcutLabel(['mod', 'alt'], 'R'),
  pin: shortcutLabel(['mod', 'alt'], 'P'),
  side: shortcutLabel(['mod', 'alt'], 'S'),
  archive: shortcutLabel(['mod', 'shift'], 'A'),
};

export function SessionMenu({
  api,
  session,
  saved,
  running,
  update,
  branch,
  archive,
}: {
  api: API;
  session: Session;
  saved: boolean;
  running: boolean;
  update: (changes: SessionOrganization) => Promise<void>;
  branch: (fork: boolean, worktree?: string) => Promise<void>;
  archive: () => void;
}) {
  const [dialog, setDialog] = useState<'rename' | 'worktree' | 'archive' | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const statusTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(statusTimer.current), []);
  function showStatus(text: string) {
    clearTimeout(statusTimer.current);
    setStatus(text);
    statusTimer.current = setTimeout(() => setStatus(''), 3000);
  }
  async function perform(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      const result = await fn();
      if (typeof result === 'string') showStatus(result);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const rename = () => {
    setValue(session.organization?.title || session.title);
    setDialog('rename');
  };
  const pin = () => perform(() => update({ pinned: !session.organization?.pinned }));
  const doArchive = () =>
    perform(async () => {
      await update({ archived: true });
      setDialog(null);
      archive();
    });
  const confirmArchive = () => setDialog('archive');
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!hasPrimaryModifier(e) || isTypingTarget(e.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.altKey && e.code === 'KeyR') {
        e.preventDefault();
        rename();
      }
      if (e.altKey && e.code === 'KeyP') {
        e.preventDefault();
        void pin();
      }
      if (e.altKey && e.code === 'KeyS') {
        e.preventDefault();
        void perform(() => branch(false));
      }
      if (e.shiftKey && !e.altKey && e.code === 'KeyA' && !running) {
        e.preventDefault();
        confirmArchive();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  const action = (kind: Parameters<API['sessionAction']>[1]) =>
    void perform(() => api.sessionAction(session, kind));
  return (
    <>
      {status && (
        <span role="status" className="session-menu-status text-xs text-muted-foreground">
          {status}
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Session actions" disabled={busy}>
            <MoreHorizontal size={17} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem onSelect={rename}>
            <Pencil />
            Rename…<DropdownMenuShortcut>{shortcuts.rename}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void pin()}>
            <Pin />
            {session.organization?.pinned ? 'Unpin' : 'Pin'}
            <DropdownMenuShortcut>{shortcuts.pin}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void perform(() => branch(false))}>
            <MessageSquarePlus />
            New side session<DropdownMenuShortcut>{shortcuts.side}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!saved || running}>
              <GitFork />
              Fork
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onSelect={() => void perform(() => branch(true))}>
                In current checkout
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setValue('');
                  setDialog('worktree');
                }}
              >
                In a new worktree…
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!saved || running}>
              <Share2 />
              Share
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onSelect={() => action('markdown')}>
                Export Markdown…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => action('html')}>Export HTML…</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!saved}>
              <Copy />
              Copy
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem disabled={running} onSelect={() => action('copy-transcript')}>
                Session as Markdown
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => action('copy-id')}>Session ID</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => action('copy-path')}>
                Repository path
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem disabled={!saved} onSelect={() => action('window')}>
            <AppWindow />
            Open in new window
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!saved || !!session.hostId}>
              <ExternalLink />
              Open in
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {(['finder', 'vscode', 'cursor'] as const).map((target, i) => (
                <DropdownMenuItem key={target} onSelect={() => action(target)}>
                  {[fileManagerName(), 'VS Code', 'Cursor'][i]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={running} onSelect={confirmArchive}>
            <Archive />
            Archive…<DropdownMenuShortcut>{shortcuts.archive}</DropdownMenuShortcut>
          </DropdownMenuItem>
          {!saved && (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              Send the first message to unlock export and fork.
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <Dialog open onOpenChange={() => setError('')}>
          <DialogContent role="alertdialog">
            <DialogHeader>
              <DialogTitle className="text-destructive">Could not complete action</DialogTitle>
              <DialogDescription className="break-words">{error}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => setError('')}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <ConfirmDialog
        open={dialog === 'archive'}
        busy={busy}
        title="Archive session"
        description="Hide this session from the sidebar. You can restore it from the repository’s archived sessions."
        confirmLabel="Archive session"
        onCancel={() => setDialog(null)}
        onConfirm={() => void doArchive()}
      >
        <p className="truncate text-sm font-medium">
          {session.organization?.title || session.title}
        </p>
      </ConfirmDialog>
      <Dialog
        open={dialog === 'rename' || dialog === 'worktree'}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog === 'rename' ? 'Rename session' : 'Fork in a new worktree'}
            </DialogTitle>
            <DialogDescription>
              {dialog === 'rename'
                ? 'This name appears in Kalkidan’s session list.'
                : 'Create a branch and inherit this session’s history. The agent fork is created when you send your first message.'}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                if (dialog === 'rename') await update({ title: value.trim() });
                else await branch(true, value.trim());
                setDialog(null);
              });
            }}
          >
            <Input
              autoFocus
              aria-label={dialog === 'rename' ? 'Session name' : 'Branch name'}
              placeholder={dialog === 'rename' ? 'Session name' : 'feature/new-direction'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button disabled={busy || !value.trim()} type="submit">
                {dialog === 'rename' ? 'Save name' : 'Create fork'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
