import { useEffect, useState } from 'react';
import { AppWindow, Globe, MessageSquare } from 'lucide-react';
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
import {
  SettingsRow,
  SettingsRows,
  SettingsShell,
  type SettingsSection,
} from './settings-disclosure';
import { startSignIn } from './sign-in-steps';
import { RegionDialog, StepError, regionNames, useAccountStatus } from './verdictan-settings';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { SegmentedControl } from './ui/segmented-control';
import { Switch } from './ui/switch';
import { showToast } from './ui/toast';

/** Opens the account menu in the sidebar footer. The account menu handles the event. */
export function openAccountMenu() {
  window.dispatchEvent(new Event('kalkidan-open-account-menu'));
}

type PreferencesSection = 'chats' | 'connections' | 'app';

const preferenceSections: SettingsSection<PreferencesSection>[] = [
  { value: 'chats', label: 'Chats', icon: <MessageSquare /> },
  { value: 'connections', label: 'Connections', icon: <Globe /> },
  { value: 'app', label: 'This app', icon: <AppWindow /> },
];

/** The section of a Preferences anchor. */
function sectionOfAnchor(anchor: string | undefined): PreferencesSection {
  if (anchor === settingsAnchors.region || anchor === settingsAnchors.github) return 'connections';
  if (anchor === settingsAnchors.data || anchor === settingsAnchors.about) return 'app';
  return 'chats';
}

/**
 * Preferences (⌘,) in the one settings shell, with three sections. Chats: the access of new
 * chats and Enter to send. Connections: the region, GitHub, and a link to the Computers page.
 * This app: the built-in browser, your data, and the version. The agent and the model are in
 * the composer chip, notifications and sign-out are in the account menu, and the agents and
 * the SSH hosts are on the Computers page.
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
  const focusId = target.place === 'preferences' ? target.anchor : undefined;
  const [active, setActive] = useState<PreferencesSection>(sectionOfAnchor(focusId));
  useEffect(() => {
    if (open) setActive(sectionOfAnchor(focusId));
  }, [open, focusId]);
  // An anchor moves to its row after the rows load.
  useEffect(() => {
    if (!open || elsewhere || !focusId) return;
    let tries = 0;
    const timer = setInterval(() => {
      const element = document.querySelector<HTMLElement>(
        `.preferences-dialog [id="${CSS.escape(focusId)}"]`,
      );
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
  const visible = open && !elsewhere;
  return (
    <Dialog open={visible} onOpenChange={onOpenChange}>
      <SettingsShell<PreferencesSection>
        className="preferences-dialog"
        title="Preferences"
        description="Chats, connections, and this app."
        navLabel="Preferences sections"
        sections={preferenceSections}
        value={active}
        onValueChange={setActive}
        onCloseAutoFocus={onCloseAutoFocus}
        panels={{
          chats: <ChatPreferences />,
          connections: (
            <ConnectionPreferences
              api={api}
              open={visible}
              account={account}
              onClose={() => onOpenChange(false)}
            />
          ),
          app: <AppPreferences api={api} open={visible} />,
        }}
      />
    </Dialog>
  );
}

/** Shows that a choice was saved, with Undo. */
function savedToast(message: string, undo: () => void) {
  showToast({ message, actions: [{ label: 'Undo', onClick: undo }] });
}

/** Preferences › Chats: the access of new chats and Enter to send. */
function ChatPreferences() {
  const [access, setAccess] = useState<ChatAccess>(readNewChatAccess);
  const [enterToSend, setEnterToSend] = useState(readEnterToSend);
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
  return (
    <SettingsRows label="Chats">
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
    </SettingsRows>
  );
}

/** Preferences › Connections: the region, GitHub, and the Computers page. */
function ConnectionPreferences({
  api,
  open,
  account,
  onClose,
}: {
  api: API;
  open: boolean;
  account: ReturnType<typeof useAccountStatus>;
  onClose: () => void;
}) {
  const [regionOpen, setRegionOpen] = useState(false);
  const services = useGitHubServices(api, open);
  const { status, busy, error, changing, run } = account;
  const known = status?.phase === 'authenticated' || status?.phase === 'expired';
  const authorizing = status?.phase === 'authorizing';
  return (
    <>
      {error && <StepError>{error}</StepError>}
      <SettingsRows label="Connections">
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
        <SettingsRow label="Agents and SSH hosts" help="On the Computers page">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onClose();
              openComputers();
            }}
          >
            Open Computers
          </Button>
        </SettingsRow>
      </SettingsRows>
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

/** Preferences › This app: the built-in browser, your data, and the version. */
function AppPreferences({ api, open }: { api: API; open: boolean }) {
  const [browserOpen, setBrowserOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  return (
    <>
      <SettingsRows label="This app">
        <SettingsRow label="Built-in browser data" help="Home page, history, and sign-in data">
          <Button variant="outline" size="sm" onClick={() => setBrowserOpen(true)}>
            Manage…
          </Button>
        </SettingsRow>
        <SettingsRow
          id={settingsAnchors.data}
          label="Your data"
          help="Disk use, export, deletion, and where your data goes"
        >
          <Button variant="outline" size="sm" onClick={() => setDataOpen(true)}>
            Manage…
          </Button>
        </SettingsRow>
        <VersionRow api={api} open={open} />
      </SettingsRows>
      <BrowserSettingsDialog api={api} open={browserOpen} onOpenChange={setBrowserOpen} />
      <DataDialog api={api} open={dataOpen} onOpenChange={setDataOpen} />
    </>
  );
}
