import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, UserRound, X } from 'lucide-react';
import type { API, Project, ProjectGroup } from '../types';
import type { NotificationPreferences } from '../domain/verdictan';
import { paneGroupId, projectPane, settingsPane, type SettingsTab } from '../domain/settings-route';
import {
  onChatPreferencesChange,
  readEnterToSend,
  newChatAccess,
  saveEnterToSend,
  saveNewChatAccess,
} from '../lib/chat-preferences';
import { accountNames, displayVersion, rejectedSessionText } from '../lib/verdictan-labels';
import { regionNames } from '../lib/region-suggestion';
import { isMac } from '../lib/platform';
import { useVerdictanStatus } from '../hooks/use-verdictan-status';
import { releasesUrl, useAppVersion } from './about-section';
import { initials } from './account-menu';
import { BrowserSettingsDialog } from './browser-menu';
import { DataDialog, formatBytes } from './data-settings';
import { ProjectSettingsPanel } from './project-settings-dialog';
import { addSshHostEvent, HostsPart, ToolsPart } from './settings-tools';
import { openSettings, startSignIn } from './sign-in-steps';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { showToast } from './ui/toast';

/** Opens Settings at a part. Older section names open their new part. */
export { openSettings } from './sign-in-steps';

/** Opens Settings at a project, optionally at a part of it, for example 'board'. */
export function openProjectSettings(groupId: string, tab?: string) {
  openSettings(projectPane(groupId), tab);
}

/** Opens the account menu in the sidebar footer. */
export function openAccountMenu() {
  window.dispatchEvent(new Event('kalkidan-open-account-menu'));
}

/** "this Mac" or "this computer". */
const computerName = isMac ? 'this Mac' : 'this computer';

export interface SettingsBodyProps {
  api: API;
  /** The projects. The project part shows the current one. */
  groups?: ProjectGroup[];
  /** All code folders, for the repos of the project. */
  repos?: Project[];
  /** The part to open: 'account', 'tools', 'preferences', 'project:<id>', or an older name. */
  section?: SettingsTab | string;
  /** The element to move to, for example 'verdictan-region', or a part of a project. */
  anchor?: string;
  /** The project that the user is in. The project part shows it. */
  currentGroupId?: string;
  /** Reads the projects again, for example after a host connects or a project changes. */
  onRefresh?: () => Promise<void>;
  /** A new value moves to the part again, also when the part is the same. */
  request?: number;
  /** The sheet: the account row is the head of the sheet, with a close button. */
  onClose?: () => void;
}

/**
 * The one Settings page (⌘,), with no section nav: the account, Tools (the agent CLIs and the
 * GitHub CLI that Kalkidan finds), Preferences, and the current project. In the sheet
 * (`onClose`), the account row is the head and the other parts scroll under it (ST-C4).
 * Kalkidan does not install, update or set up agents here.
 */
export function SettingsBody({
  api,
  groups = [],
  repos = [],
  section,
  anchor,
  currentGroupId,
  onRefresh,
  request,
  onClose,
}: SettingsBodyProps) {
  const target = settingsPane(section, anchor);
  const root = useRef<HTMLDivElement>(null);
  const requestedGroup = paneGroupId(target.pane);
  const groupId =
    [requestedGroup, currentGroupId].find((id) => id && groups.some((g) => g.id === id)) ||
    (groups.length === 1 ? groups[0].id : undefined);
  const group = groups.find((item) => item.id === groupId);
  // Move to the part, or to the anchor in it, after the rows load.
  useEffect(() => {
    const element = () => {
      const scope = root.current;
      if (!scope) return null;
      const part = requestedGroup ? 'project' : target.pane;
      const found =
        target.anchor && !requestedGroup
          ? scope.querySelector<HTMLElement>(`[id="${CSS.escape(target.anchor)}"]`)
          : null;
      if (found || part === 'general') return found;
      return scope.querySelector<HTMLElement>(`[id="settings-${part}"]`);
    };
    if (target.pane === 'general' && !target.anchor) {
      root.current?.closest('.st-scroll')?.scrollTo({ top: 0 });
      return;
    }
    let tries = 0;
    const timer = setInterval(() => {
      const found = element();
      if (found || ++tries > 40) {
        clearInterval(timer);
        if (!found) return;
        found.scrollIntoView({ block: 'start' });
        if (!found.matches('button, a[href], input, [tabindex]'))
          found.setAttribute('tabindex', '-1');
        found.focus({ preventScroll: true });
      }
    }, 50);
    return () => clearInterval(timer);
  }, [target.pane, target.anchor, requestedGroup, request]);
  const parts = (
    <>
      <ToolsPart api={api} open />
      <PreferencesPart api={api} />
      {group && (
        <ProjectSettingsPanel
          key={group.id}
          api={api}
          group={group}
          groups={groups}
          repos={repos}
          open
          tab={requestedGroup ? target.anchor : undefined}
          onRefresh={onRefresh}
        />
      )}
      <HostsPart api={api} open />
      <AboutLine api={api} />
    </>
  );
  if (!onClose)
    return (
      <div ref={root} className="st-page" data-testid="settings-page">
        <AccountPart api={api} />
        {parts}
      </div>
    );
  return (
    <div ref={root} className="st-page st-sheet-page" data-testid="settings-page">
      <header className="st-sheet-head">
        <AccountPart api={api} />
        <Button variant="ghost" size="icon-sm" aria-label="Close Settings" onClick={onClose}>
          <X />
        </Button>
      </header>
      <div className="st-scroll st-sheet-body">{parts}</div>
    </div>
  );
}

/**
 * @deprecated The shell shows `SettingsPage` from './settings-page' as a page. This keeps older
 * callers working: while `open`, it shows the same page over the main area, with a header and a
 * close button. Escape closes it.
 */
export function SettingsDialog({
  open,
  onOpenChange,
  onCloseAutoFocus,
  ...props
}: SettingsBodyProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    setHost(document.getElementById('main-content') || document.body);
  }, [open]);
  useEffect(() => {
    if (open || !onCloseAutoFocus) return;
    // The focus goes back to the element that opened Settings.
    onCloseAutoFocus(new Event('close'));
  }, [open]);
  if (!open || !host) return null;
  return createPortal(
    <SettingsSurface onClose={() => onOpenChange(false)}>
      <SettingsBody {...props} />
    </SettingsSurface>,
    host,
  );
}

/**
 * The Settings page as a layer over the main area: the 48px header with "Settings" and a close
 * button, then the page. Escape closes it, unless a dialog or a menu is open.
 */
export function SettingsSurface({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}) {
  const close = useCloseOnEscape(onClose);
  const surface = useRef<HTMLElement>(null);
  const left = useSidebarEdge(surface);
  return (
    <section
      ref={surface}
      className="st-surface"
      aria-label="Settings"
      data-sidebar-hidden={left === 0 || undefined}
      style={{ left }}
    >
      <header className="st-header">
        <h1>Settings</h1>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close Settings"
          onClick={() => close.current()}
        >
          <X />
        </Button>
      </header>
      <div className="st-scroll">{children}</div>
    </section>
  );
}

/**
 * The x where the sidebar ends, from the left edge of the parent of `element`. The layer
 * starts there, so the sidebar stays visible and usable. It follows the sidebar width.
 */
function useSidebarEdge(element: RefObject<HTMLElement | null>) {
  const [left, setLeft] = useState(0);
  useLayoutEffect(() => {
    const parent = element.current?.parentElement;
    const nav = document.querySelector<HTMLElement>('.app-shell > nav');
    if (!parent || !nav) return;
    const measure = () => {
      const edge = nav.getBoundingClientRect().right - parent.getBoundingClientRect().left;
      setLeft(nav.offsetWidth > 0 && edge > 0 ? Math.round(edge) : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [element]);
  return left;
}

/** Calls `onClose` on Escape, unless a dialog, a menu or a form field has the key. */
export function useCloseOnEscape(onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]'))
        return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      if (target?.closest('input, textarea, [contenteditable="true"]') && target.closest('form'))
        return;
      close.current();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  return close;
}

/**
 * The account at the top of Settings: the avatar, the name, the organization and the region,
 * and Sign out. Signed out: "Not signed in" and Sign in. "Manage account" is in the account
 * menu and at the end of the page.
 */
function AccountPart({ api }: { api: API }) {
  const { status, setStatus, supported } = useVerdictanStatus(api);
  const [signingOut, setSigningOut] = useState(false);
  if (!supported) return null;
  const names = accountNames(status);
  const signedIn = status?.phase === 'authenticated';
  const expired = status?.phase === 'expired';
  const authorizing = status?.phase === 'authorizing';
  const region = status?.region ? regionNames[status.region] : '';
  const name = signedIn
    ? names.user || names.email || 'Signed in'
    : expired
      ? 'Your session ended'
      : 'Not signed in';
  const detail = signedIn
    ? [names.organization, region].filter(Boolean)
    : expired
      ? [rejectedSessionText(status) || names.organization, region].filter(Boolean)
      : [region].filter(Boolean);
  async function signOut() {
    setSigningOut(true);
    try {
      const result = await api.verdictanLogout();
      setStatus(result);
      if (result.phase !== 'authenticated') showToast('Signed out');
    } catch {
      showToast({ message: 'Kalkidan could not sign out. Try again.', tone: 'error' });
    } finally {
      setSigningOut(false);
    }
  }
  return (
    <section className="st-account" id="settings-account" aria-label="Account">
      <span className="st-avatar" aria-hidden="true">
        {signedIn ? initials(names.user || names.email) || <UserRound /> : <UserRound />}
      </span>
      <h2 className="st-account-name" id="verdictan-account">
        {name}
        {detail.length > 0 && (
          <span className="st-account-detail" id="verdictan-region">
            {' · '}
            {detail.join(' · ')}
          </span>
        )}
      </h2>
      {signedIn ? (
        <>
          <Button variant="ghost" size="sm" disabled={signingOut} onClick={() => void signOut()}>
            Sign out
          </Button>
        </>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          disabled={authorizing}
          onClick={() => startSignIn('login')}
        >
          {authorizing ? 'Finish signing in…' : expired ? 'Sign in again' : 'Sign in'}
        </Button>
      )}
    </section>
  );
}

/** One setting: the label on the left, the switch on the right. */
function SwitchRow({
  id,
  label,
  checked,
  onChange,
}: {
  id?: string;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <li className="st-row st-setting" id={id}>
      <span className="st-row-title">{label}</span>
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
    </li>
  );
}

/**
 * Preferences: "New chats can edit files", "Enter sends", and "Notify me when a chat needs me".
 * Each switch saves at once.
 */
function PreferencesPart({ api }: { api: API }) {
  const [canEdit, setCanEdit] = useState(() => newChatAccess() === 'edit');
  const [enterToSend, setEnterToSend] = useState(readEnterToSend);
  useEffect(
    () =>
      onChatPreferencesChange(() => {
        setCanEdit(newChatAccess() === 'edit');
        setEnterToSend(readEnterToSend());
      }),
    [],
  );
  return (
    <section
      className="st-section"
      id="settings-preferences"
      aria-labelledby="settings-preferences-label"
    >
      <div className="st-section-head">
        <h2 id="settings-preferences-label">Preferences</h2>
      </div>
      <ul className="st-rows">
        <SwitchRow
          label="New chats can edit files"
          checked={canEdit}
          onChange={(next) => {
            setCanEdit(next);
            saveNewChatAccess(next ? 'edit' : 'read');
          }}
        />
        <SwitchRow
          label="Enter sends"
          checked={enterToSend}
          onChange={(next) => {
            setEnterToSend(next);
            saveEnterToSend(next);
          }}
        />
        <NotificationRow api={api} />
      </ul>
    </section>
  );
}

/**
 * One switch for notifications: a chat needs you while Kalkidan is in the background. A
 * finished chat also needs you (for a review), so the switch sets both flags of the desktop.
 */
function NotificationRow({ api }: { api: API }) {
  const [preferences, setPreferences] = useState<NotificationPreferences>();
  useEffect(() => {
    if (typeof api.notificationPreferences !== 'function') return;
    void Promise.resolve()
      .then(() => api.notificationPreferences())
      .then(setPreferences, () => {});
  }, [api]);
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
    <SwitchRow
      id="settings-notifications"
      label="Notify me when a chat needs me"
      checked={on}
      onChange={(next) => void toggle(next)}
    />
  );
}

/**
 * The quiet last line, under the fold of the sheet: the version with a link to the releases,
 * the data on this computer (Manage…), Clear browsing data…, Add SSH host… and Manage account.
 */
function AboutLine({ api }: { api: API }) {
  const app = useAppVersion(api);
  const signedIn = useVerdictanStatus(api).status?.phase === 'authenticated';
  const [disk, setDisk] = useState<number>();
  const [dataOpen, setDataOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  useEffect(() => {
    if (typeof api.localDataUsage !== 'function') return;
    void Promise.resolve()
      .then(() => api.localDataUsage!())
      .then(
        (usage) => setDisk(usage.total),
        () => {},
      );
  }, [api, dataOpen]);
  const version = app?.version
    ? /^\d/.test(app.version)
      ? `Kalkidan ${displayVersion(app.version)}`
      : `Kalkidan ${app.version}`
    : 'Kalkidan';
  return (
    <footer className="st-about" id="settings-about">
      <a href={releasesUrl} target="_blank" rel="noreferrer" data-testid="settings-version">
        {version}
      </a>
      <span aria-hidden="true">·</span>
      <button
        type="button"
        id="settings-data"
        onClick={() => setDataOpen(true)}
        aria-label={
          disk === undefined
            ? 'Manage data'
            : `Manage data, ${formatBytes(disk)} on ${computerName}`
        }
      >
        {disk === undefined ? 'Data' : `Data · ${formatBytes(disk)} on ${computerName}`}
      </button>
      <span aria-hidden="true">·</span>
      <button type="button" onClick={() => setBrowserOpen(true)}>
        Clear browsing data…
      </button>
      <span aria-hidden="true">·</span>
      <button type="button" onClick={() => window.dispatchEvent(new Event(addSshHostEvent))}>
        Add SSH host…
      </button>
      {signedIn && typeof api.verdictanOpenConsole === 'function' && (
        <>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={() =>
              void api
                .verdictanOpenConsole()
                .catch(() =>
                  showToast({ message: 'The browser did not open. Try again.', tone: 'error' }),
                )
            }
          >
            Manage account
            <ExternalLink aria-label="Opens in the browser" />
          </button>
        </>
      )}
      <DataDialog api={api} open={dataOpen} onOpenChange={setDataOpen} />
      <BrowserSettingsDialog api={api} open={browserOpen} onOpenChange={setBrowserOpen} />
    </footer>
  );
}
