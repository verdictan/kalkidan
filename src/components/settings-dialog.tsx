import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { API } from '../types';
import { settingsAnchors, settingsPlace, type SettingsTab } from '../domain/settings-route';
import {
  onChatPreferencesChange,
  readEnterToSend,
  readNewChatAccess,
  saveEnterToSend,
  saveNewChatAccess,
  type ChatAccess,
} from '../lib/chat-preferences';
import { isMac } from '../lib/platform';
import { BrowserSettingsDialog } from './browser-menu';
import { openComputers } from './computers-page';
import { VersionRow } from './about-section';
import { DataDialog } from './data-settings';
import { GitHubRow, useGitHubServices } from './github-account';
import { SettingsRow, SettingsRows } from './settings-disclosure';
import { startSignIn } from './sign-in-steps';
import { RegionDialog, StepError, regionNames, useAccountStatus } from './verdictan-settings';
import { Button } from './ui/button';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { SegmentedControl } from './ui/segmented-control';
import { Switch } from './ui/switch';
import { showToast } from './ui/toast';

/** Opens the account menu in the sidebar footer. The account menu handles the event. */
export function openAccountMenu() {
  window.dispatchEvent(new Event('kalkidan-open-account-menu'));
}

/**
 * Preferences (⌘,): one short sheet with seven rows in three groups. Chats: the access of new
 * chats and Enter to send. Connections: the region and GitHub. This app: the built-in browser,
 * your data, and the version. The agent and the model are in the composer chip, notifications and
 * sign-out are in the account menu, and the hosts are on the Computers page.
 *
 * Older requests still work. `section` and `anchor` go through `settingsPlace`: a request for
 * Agents or Computers opens the Computers page, a request for notifications opens the account
 * menu, and a request for the account while nobody is signed in starts the sign-in. The
 * dialog then closes at once.
 */
export function SettingsDialog({
  api,
  open,
  onOpenChange,
  section,
  anchor,
  onCloseAutoFocus,
}: {
  api: API;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The section to open. Older names, such as 'accounts' or 'agents', go to their place. */
  section?: SettingsTab | string;
  /** The element to move to, for example 'verdictan-region'. */
  anchor?: string;
  /** Reads the projects again after an SSH host connects. The Computers page uses it now. */
  onRefresh?: () => Promise<void>;
  /** Moves the focus when the dialog closes, for example back to the element that opened it. */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const target = settingsPlace(section, anchor);
  const account = useAccountStatus(api, open);
  const phase = account.status?.phase;
  // A request for the account while nobody is signed in starts the sign-in.
  const signIn = target.anchor === settingsAnchors.account && !!phase && phase !== 'authenticated';
  const elsewhere = target.place !== 'preferences' || signIn;
  useEffect(() => {
    if (!open || !elsewhere) return;
    if (signIn) startSignIn('login');
    else if (target.place === 'computers') openComputers(target.anchor);
    else openAccountMenu();
    onOpenChange(false);
  }, [open, elsewhere]);
  const title = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const focusId = target.place === 'preferences' ? target.anchor : undefined;
  // An anchor moves to its row after the rows load.
  useEffect(() => {
    if (!open || elsewhere || !focusId) return;
    let tries = 0;
    const timer = setInterval(() => {
      const element = body.current?.querySelector<HTMLElement>(`[id="${CSS.escape(focusId)}"]`);
      if (element || ++tries > 40) {
        clearInterval(timer);
        if (!element) return;
        element.scrollIntoView({ block: 'nearest' });
        if (!element.matches('button, a[href], input, [tabindex]'))
          element.setAttribute('tabindex', '-1');
        element.focus({ preventScroll: true });
      }
    }, 50);
    return () => clearInterval(timer);
  }, [open, elsewhere, focusId]);
  return (
    <Dialog open={open && !elsewhere} onOpenChange={onOpenChange}>
      <DialogContent
        size="md"
        layout="scroll"
        className="preferences-dialog"
        aria-describedby={undefined}
        onCloseAutoFocus={onCloseAutoFocus}
        onOpenAutoFocus={(event) => {
          // The title gets the focus, so no focus ring shows on a row when the sheet opens.
          event.preventDefault();
          title.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle ref={title} tabIndex={-1} className="preferences-title">
            Preferences
          </DialogTitle>
        </DialogHeader>
        <DialogBody ref={body} className="preferences-body">
          <PreferenceRows api={api} open={open && !elsewhere} account={account} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/** One group of Preferences with a small label. */
function PreferenceGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="preferences-group" aria-label={label}>
      <h3 className="preferences-group-label">{label}</h3>
      <SettingsRows>{children}</SettingsRows>
    </section>
  );
}

/**
 * Asks before Kalkidan quits while agent runs or shells work on SSH hosts. "Don't ask again" in
 * the question turns it off. This switch turns it on again.
 */
function SshQuitRow({ api, open }: { api: API; open: boolean }) {
  const [ask, setAsk] = useState<boolean>();
  useEffect(() => {
    if (!open || typeof api.sshQuitPrompt !== 'function') return;
    void Promise.resolve()
      .then(() => api.sshQuitPrompt!())
      .then(setAsk, () => {});
  }, [api, open]);
  if (ask === undefined || typeof api.setSshQuitPrompt !== 'function') return null;
  async function choose(next: boolean) {
    const before = ask;
    setAsk(next);
    try {
      setAsk(await api.setSshQuitPrompt!(next));
    } catch {
      setAsk(before);
      showToast({ message: 'Could not save the quit question setting.', tone: 'error' });
    }
  }
  return (
    <SettingsRow
      id="ssh-quit-prompt"
      label="Ask before quitting while SSH work runs"
      help="Agent runs and shells on SSH hosts continue after Kalkidan quits."
    >
      <Switch
        aria-label="Ask before quitting while SSH work runs"
        checked={ask}
        onCheckedChange={(next) => void choose(next)}
      />
    </SettingsRow>
  );
}

/** Shows that a choice was saved, with Undo. */
function savedToast(message: string, undo: () => void) {
  showToast({ message, actions: [{ label: 'Undo', onClick: undo }] });
}

/** The seven rows of Preferences. */
function PreferenceRows({
  api,
  open,
  account,
}: {
  api: API;
  open: boolean;
  account: ReturnType<typeof useAccountStatus>;
}) {
  const [access, setAccess] = useState<ChatAccess>(readNewChatAccess);
  const [enterToSend, setEnterToSend] = useState(readEnterToSend);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [regionOpen, setRegionOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const services = useGitHubServices(api, open);
  const { status, busy, error, changing, run } = account;
  useEffect(
    () =>
      onChatPreferencesChange(() => {
        setAccess(readNewChatAccess());
        setEnterToSend(readEnterToSend());
      }),
    [],
  );
  function chooseAccess(next: ChatAccess) {
    const before = access;
    setAccess(next);
    saveNewChatAccess(next);
    savedToast(`New chats start as ${next === 'edit' ? 'Can edit files' : 'Read only'}`, () => {
      setAccess(before);
      saveNewChatAccess(before);
    });
  }
  function chooseEnter(next: boolean) {
    setEnterToSend(next);
    saveEnterToSend(next);
  }
  const known = status?.phase === 'authenticated' || status?.phase === 'expired';
  const authorizing = status?.phase === 'authorizing';
  return (
    <>
      <PreferenceGroup label="Chats">
        <SettingsRow label="New chats start as">
          <SegmentedControl
            size="sm"
            label="New chats start as"
            value={access}
            onChange={chooseAccess}
            options={[
              { value: 'read', label: 'Read only' },
              { value: 'edit', label: 'Can edit files' },
            ]}
          />
        </SettingsRow>
        <SettingsRow
          label="Enter sends the message"
          help={enterToSend ? undefined : `${isMac ? '⌘Enter' : 'Ctrl+Enter'} sends`}
        >
          <Switch
            aria-label="Enter sends the message"
            checked={enterToSend}
            onCheckedChange={chooseEnter}
          />
        </SettingsRow>
      </PreferenceGroup>
      <PreferenceGroup label="Connections">
        <SettingsRow
          id={settingsAnchors.region}
          label="Region"
          help={changing ? 'Changing the region…' : undefined}
        >
          <span className="settings-row-value">
            {status?.region ? regionNames[status.region] : 'Not chosen'}
          </span>
          <Button
            variant="outline"
            size="sm"
            aria-label="Change the region"
            disabled={busy || authorizing || changing || !status}
            onClick={() => setRegionOpen(true)}
          >
            Change…
          </Button>
        </SettingsRow>
        <GitHubRow services={services} />
        <SshQuitRow api={api} open={open} />
      </PreferenceGroup>
      {error && <StepError>{error}</StepError>}
      <PreferenceGroup label="This app">
        <SettingsRow label="Built-in browser data">
          <Button variant="outline" size="sm" onClick={() => setBrowserOpen(true)}>
            Manage…
          </Button>
        </SettingsRow>
        <SettingsRow
          id={settingsAnchors.data}
          label="Your data"
          help="Where your data goes, disk use, export, and deletion"
        >
          <Button variant="outline" size="sm" onClick={() => setDataOpen(true)}>
            Manage…
          </Button>
        </SettingsRow>
        <VersionRow api={api} open={open} />
      </PreferenceGroup>
      <BrowserSettingsDialog api={api} open={browserOpen} onOpenChange={setBrowserOpen} />
      <DataDialog api={api} open={dataOpen} onOpenChange={setDataOpen} />
      <RegionDialog
        open={regionOpen}
        current={status?.region}
        signedIn={known}
        busy={busy}
        onCancel={() => setRegionOpen(false)}
        onConfirm={(region) =>
          void run(
            () => api.verdictanSetRegion(region),
            `Region set to ${regionNames[region]}`,
          ).then((done) => done && setRegionOpen(false))
        }
      />
    </>
  );
}
