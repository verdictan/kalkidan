import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ExternalLink, Folder, Monitor, SlidersHorizontal, UserRound } from 'lucide-react';
import type { API, Project, ProjectGroup } from '../types';
import type { NotificationPreferences } from '../domain/verdictan';
import { projectColors } from '../domain/project-colors';
import {
  paneGroupId,
  projectPane,
  settingsAnchors,
  settingsPane,
  type SettingsPane,
  type SettingsTab,
} from '../domain/settings-route';
import {
  onChatPreferencesChange,
  readEnterToSend,
  readNewChatAccess,
  saveEnterToSend,
  saveNewChatAccess,
  type ChatAccess,
} from '../lib/chat-preferences';
import { accountNames } from '../lib/verdictan-labels';
import { isMac } from '../lib/platform';
import { BrowserSettingsDialog } from './browser-menu';
import { ComputersPanel } from './computers-page';
import { VersionRow } from './about-section';
import { DataDialog, formatBytes } from './data-settings';
import { openDiagnostics } from './diagnostics-section';
import { GitHubRow, useGitHubServices } from './github-account';
import { ProjectSettingsPanel } from './project-settings-dialog';
import { useRemoteHosts } from './remote-host-picker';
import { useComputersAttention } from './settings-attention';
import {
  SettingsRow,
  SettingsRows,
  SettingsShell,
  type SettingsSection,
} from './settings-disclosure';
import { openSettings, startSignIn } from './sign-in-steps';
import { RegionDialog, StepError, regionNames, useAccountStatus } from './verdictan-settings';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { SegmentedControl } from './ui/segmented-control';
import { Switch } from './ui/switch';
import { showToast } from './ui/toast';

/** Opens the one Settings window at a section. Older section names open their new section. */
export { openSettings } from './sign-in-steps';

/** Opens Settings at a project, optionally at a part of it, for example 'board'. */
export function openProjectSettings(groupId: string, tab?: string) {
  openSettings(projectPane(groupId), tab);
}

/** @deprecated The account menu holds no settings now. It opens the account menu. */
export function openAccountMenu() {
  window.dispatchEvent(new Event('kalkidan-open-account-menu'));
}

/**
 * The one Settings window (⌘,): General, Computers, Account, and one section for each project.
 * It replaces Preferences, the Computers page, the version list of Diagnostics, and Project
 * settings. Older requests still work: `section` and `anchor` go through `settingsPane`, so
 * 'agents', 'remote', 'updates' or a computer anchor open Computers, and 'project:<id>' opens
 * that project. A request for the account while nobody is signed in starts the sign-in.
 */
export function SettingsDialog({
  api,
  open,
  onOpenChange,
  section,
  anchor,
  groups = [],
  repos = [],
  onRefresh,
  onCloseAutoFocus,
}: {
  api: API;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The section to open: 'general', 'computers', 'account', 'project:<id>', or an older name. */
  section?: SettingsTab | string;
  /** The element to move to, for example 'verdictan-region', or a part of a project. */
  anchor?: string;
  /** The projects. Each one has a section. */
  groups?: ProjectGroup[];
  /** All code folders, for the code folders of each project. */
  repos?: Project[];
  /** Reads the projects again, for example after a host connects or a project changes. */
  onRefresh?: () => Promise<void>;
  /** Moves the focus when the dialog closes, for example back to the element that opened it. */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const target = settingsPane(section, anchor);
  const account = useAccountStatus(api, open);
  const phase = account.status?.phase;
  // A request for the account while nobody is signed in starts the sign-in.
  const signIn = target.anchor === settingsAnchors.account && !!phase && phase !== 'authenticated';
  useEffect(() => {
    if (!open || !signIn) return;
    startSignIn('login');
    onOpenChange(false);
  }, [open, signIn]);
  const attention = useComputersAttention(api);
  const { hosts } = useRemoteHosts(api, open);
  // A request for a project that is gone opens General.
  const requested: SettingsPane =
    paneGroupId(target.pane) && !groups.some((g) => g.id === paneGroupId(target.pane))
      ? 'general'
      : target.pane;
  const [active, setActive] = useState<SettingsPane>(requested);
  useEffect(() => {
    if (open) setActive(requested);
  }, [open, requested, target.anchor]);
  // A removed project closes its section.
  useEffect(() => {
    const id = paneGroupId(active);
    if (id && !groups.some((g) => g.id === id)) setActive('general');
  }, [groups, active]);
  const focusId = paneGroupId(active) ? undefined : target.anchor;
  // An anchor moves to its row after the rows load. Computers and projects move by themselves.
  useEffect(() => {
    if (!open || signIn || !focusId || active === 'computers') return;
    let tries = 0;
    const timer = setInterval(() => {
      const element = document.querySelector<HTMLElement>(
        `.one-settings [id="${CSS.escape(focusId)}"]`,
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
  }, [open, signIn, focusId, active]);
  const visible = open && !signIn;
  const sections = useMemo<SettingsSection<SettingsPane>[]>(
    () => [
      { value: 'general', label: 'General', icon: <SlidersHorizontal /> },
      { value: 'computers', label: 'Computers', icon: <Monitor />, attention },
      { value: 'account', label: 'Account', icon: <UserRound /> },
      ...groups.map((group) => ({
        value: projectPane(group.id),
        label: group.name,
        group: 'Projects',
        icon: <Folder style={group.color ? { color: projectColors[group.color] } : undefined} />,
      })),
    ],
    [groups, attention],
  );
  const panels: Partial<Record<SettingsPane, ReactNode>> = {
    general: <GeneralPanel api={api} open={visible} />,
    computers: (
      <ComputersPanel
        api={api}
        open={visible && active === 'computers'}
        onRefresh={onRefresh}
        anchor={active === 'computers' ? target.anchor : undefined}
      />
    ),
    account: <AccountPanel api={api} open={visible} account={account} />,
  };
  for (const group of groups)
    panels[projectPane(group.id)] = (
      <ProjectSettingsPanel
        api={api}
        group={group}
        repos={repos}
        host={hosts.find((host) => host.id === group.hostId)}
        open={visible && active === projectPane(group.id)}
        tab={active === target.pane ? target.anchor : undefined}
        onRefresh={onRefresh}
      />
    );
  return (
    <Dialog open={visible} onOpenChange={onOpenChange}>
      <SettingsShell<SettingsPane>
        // Utilities, so that they replace the width and the height of the shell.
        className="one-settings h-[min(560px,calc(100dvh-2rem))] min-h-0 sm:max-w-[820px]"
        title="Settings"
        hideTitle
        description="General, computers, account, and project settings."
        navLabel="Settings sections"
        sections={sections}
        value={active}
        onValueChange={setActive}
        onCloseAutoFocus={onCloseAutoFocus}
        panels={panels}
      />
    </Dialog>
  );
}

/** Shows that a choice was saved, with Undo. */
function savedToast(message: string, undo: () => void) {
  showToast({ message, actions: [{ label: 'Undo', onClick: undo }] });
}

/**
 * Settings › General: the access of new chats, Enter to send, notifications, the built-in
 * browser, your data, and the version.
 */
function GeneralPanel({ api, open }: { api: API; open: boolean }) {
  const [access, setAccess] = useState<ChatAccess>(readNewChatAccess);
  const [enterToSend, setEnterToSend] = useState(readEnterToSend);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [disk, setDisk] = useState<number>();
  useEffect(
    () =>
      onChatPreferencesChange(() => {
        setAccess(readNewChatAccess());
        setEnterToSend(readEnterToSend());
      }),
    [],
  );
  useEffect(() => {
    if (!open || typeof api.localDataUsage !== 'function') return;
    void Promise.resolve()
      .then(() => api.localDataUsage!())
      .then(
        (usage) => setDisk(usage.total),
        () => {},
      );
  }, [api, open]);
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
    <>
      <SettingsRows label="General">
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
          label="Enter sends"
          help={enterToSend ? undefined : `${isMac ? '⌘Enter' : 'Ctrl+Enter'} sends`}
        >
          <Switch aria-label="Enter sends" checked={enterToSend} onCheckedChange={chooseEnter} />
        </SettingsRow>
        <NotificationRow api={api} open={open} />
        <SettingsRow label="Built-in browser">
          <Button variant="outline" size="sm" onClick={() => setBrowserOpen(true)}>
            Manage…
          </Button>
        </SettingsRow>
        <SettingsRow
          id={settingsAnchors.data}
          label="Your data"
          help={disk === undefined ? undefined : `${formatBytes(disk)} on this computer`}
        >
          <Button variant="outline" size="sm" onClick={() => setDataOpen(true)}>
            Manage…
          </Button>
        </SettingsRow>
        <VersionRow api={api} open={open} />
        <SettingsRow label="Diagnostics">
          <Button variant="ghost" size="sm" onClick={openDiagnostics}>
            Support bundle…
          </Button>
        </SettingsRow>
      </SettingsRows>
      <BrowserSettingsDialog api={api} open={browserOpen} onOpenChange={setBrowserOpen} />
      <DataDialog api={api} open={dataOpen} onOpenChange={setDataOpen} />
    </>
  );
}

/**
 * One switch for notifications: an agent finished or needs you, while Kalkidan is in the
 * background. The desktop keeps two flags (finished and needs input). The switch sets both.
 */
function NotificationRow({ api, open }: { api: API; open: boolean }) {
  const [preferences, setPreferences] = useState<NotificationPreferences>();
  useEffect(() => {
    if (!open || typeof api.notificationPreferences !== 'function') return;
    void Promise.resolve()
      .then(() => api.notificationPreferences())
      .then(setPreferences, () => {});
  }, [api, open]);
  if (!preferences) return null;
  const on = preferences.finished || preferences.needsInput;
  async function toggle(next: boolean) {
    if (!preferences) return;
    const before = preferences;
    const value = { ...preferences, finished: next, needsInput: next };
    setPreferences(value);
    try {
      setPreferences(await api.setNotificationPreferences(value));
    } catch {
      setPreferences(before);
      showToast({ message: 'Could not save the notification setting.', tone: 'error' });
    }
  }
  return (
    <SettingsRow id={settingsAnchors.notifications} label="Notify me when a chat waits or ends">
      <Switch
        aria-label="Notify me when a chat waits or ends"
        checked={on}
        onCheckedChange={(next) => void toggle(next)}
      />
    </SettingsRow>
  );
}

/**
 * Settings › Account: who is signed in with Sign out, the region, and GitHub. Signed out, the
 * account row has "Sign in".
 */
function AccountPanel({
  api,
  open,
  account,
}: {
  api: API;
  open: boolean;
  account: ReturnType<typeof useAccountStatus>;
}) {
  const [regionOpen, setRegionOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const services = useGitHubServices(api, open);
  const { status, busy, error, changing, run } = account;
  const known = status?.phase === 'authenticated' || status?.phase === 'expired';
  const signedIn = status?.phase === 'authenticated';
  const authorizing = status?.phase === 'authorizing';
  const names = accountNames(status);
  async function signOut() {
    setSigningOut(true);
    try {
      const result = await api.verdictanLogout();
      account.setStatus(result);
      if (result.phase !== 'authenticated') showToast('Signed out');
    } catch {
      showToast({ message: 'Kalkidan could not sign out. Try again.', tone: 'error' });
    } finally {
      setSigningOut(false);
    }
  }
  return (
    <>
      {error && <StepError>{error}</StepError>}
      <SettingsRows label="Account">
        <SettingsRow
          id={settingsAnchors.account}
          label={signedIn ? names.user || names.email || 'Signed in' : 'Not signed in'}
          help={
            signedIn
              ? [names.email !== names.user ? names.email : '', names.organization]
                  .filter(Boolean)
                  .join(' · ') || undefined
              : undefined
          }
        >
          {signedIn ? (
            <>
              {typeof api.verdictanOpenConsole === 'function' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void api.verdictanOpenConsole().catch(() =>
                      showToast({
                        message: 'The browser did not open. Try again.',
                        tone: 'error',
                      }),
                    )
                  }
                >
                  Manage account
                  <ExternalLink aria-label="Opens in the browser" />
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={signingOut}
                onClick={() => void signOut()}
              >
                Sign out
              </Button>
            </>
          ) : (
            <Button size="sm" disabled={authorizing} onClick={() => startSignIn('login')}>
              {authorizing ? 'Finish signing in…' : 'Sign in'}
            </Button>
          )}
        </SettingsRow>
        <SettingsRow
          id={settingsAnchors.region}
          label="Region"
          help={
            changing ? 'Changing the region…' : known ? 'Sign out to change the region.' : undefined
          }
        >
          <span className="settings-row-value">
            {status?.region ? regionNames[status.region] : 'Not chosen'}
          </span>
          {!known && (
            <Button
              variant="outline"
              size="sm"
              aria-label="Change the region"
              disabled={busy || authorizing || changing || !status}
              onClick={() => setRegionOpen(true)}
            >
              Change…
            </Button>
          )}
        </SettingsRow>
        <GitHubRow services={services} />
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
