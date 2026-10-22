import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Tabs as TabsPrimitive } from 'radix-ui';
import { Bot, CircleUser, Database, Info, Laptop, Settings } from 'lucide-react';
import { agentCatalog } from '../config/agents';
import type { API, Agent } from '../types';
import type { NotificationPreferences } from '../domain/verdictan';
import {
  settingsAnchors,
  settingsSections,
  settingsTarget,
  type SettingsSection,
  type SettingsTab,
} from '../domain/settings-route';
import {
  applyAppearance,
  readAppearance,
  saveAppearance,
  type Appearance,
} from '../lib/appearance';
import {
  agentInstalled,
  onPreferredAgentChange,
  readPreferredAgent,
  savePreferredAgent,
} from '../lib/agent-preference';
import {
  onChatPreferencesChange,
  readEnterToSend,
  readNewChatAccess,
  saveEnterToSend,
  saveNewChatAccess,
  type ChatAccess,
} from '../lib/chat-preferences';
import { displayVersion } from '../lib/verdictan-labels';
import { isMac } from '../lib/platform';
import { BrowserSettingsDialog } from './browser-menu';
import { AboutSection } from './about-section';
import { ComputersSection } from './computers-settings';
import { DataSection } from './data-settings';
import { SettingsRow, SettingsRows } from './settings-disclosure';
import { AccountSection, AgentsSection } from './verdictan-settings';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { SegmentedControl } from './ui/segmented-control';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Switch } from './ui/switch';
import { showToast } from './ui/toast';

const sectionIcons: Record<SettingsSection, ReactNode> = {
  general: <Settings aria-hidden="true" />,
  account: <CircleUser aria-hidden="true" />,
  agents: <Bot aria-hidden="true" />,
  computers: <Laptop aria-hidden="true" />,
  data: <Database aria-hidden="true" />,
  about: <Info aria-hidden="true" />,
};

/**
 * The element that gets the focus when the requested element does not show. A runtime or a
 * helper anchor falls back to its computer, and an agent program to the Agents rows.
 */
function fallbackSelector(id: string) {
  const host = /^(?:runtime|helper-update)-(.+)$/.exec(id);
  if (host) return `[id="${CSS.escape(`computer-${host[1]}`)}"]`;
  if (id.startsWith('agent-') || id === 'settings-agents')
    return `[id="${settingsAnchors.managedSetup}"]`;
  return '';
}

/**
 * The Settings dialog: a 720px modal with a section list on the left (General, Account,
 * Agents, Computers, Data, About) and one column of rows. ↑ and ↓ move between the sections. A
 * section opens at the top, or at `anchor` when it is set. Choices save at once with Undo.
 */
export function SettingsDialog({
  api,
  open,
  onOpenChange,
  section = 'general',
  anchor,
  onRefresh,
  onCloseAutoFocus,
}: {
  api: API;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The section to open. Older names, such as 'accounts' or 'updates', open their section. */
  section?: SettingsTab | string;
  /** The element to move to, for example 'verdictan-region'. */
  anchor?: string;
  /** Reads the projects again after an SSH host connects. */
  onRefresh?: () => Promise<void>;
  /** Moves the focus when the dialog closes, for example back to the element that opened it. */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const target = settingsTarget(section, anchor);
  const [active, setActive] = useState<SettingsSection>(target.tab);
  const [focusId, setFocusId] = useState(target.anchor);
  const [version, setVersion] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  // A new request opens its section. Reopening the dialog uses the request again. The state
  // changes during the render, so the dialog opens at the right section without a flash.
  const request = `${open}:${target.tab}:${target.anchor || ''}`;
  const [lastRequest, setLastRequest] = useState(request);
  if (request !== lastRequest) {
    setLastRequest(request);
    if (open) {
      setActive(target.tab);
      setFocusId(target.anchor);
    }
  }
  // A request while the dialog shows moves the focus to its section in the list.
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const item = nav.current?.querySelector<HTMLElement>(`[data-section="${active}"]`);
    if (open && nav.current?.contains(document.activeElement) && item) item.focus();
  }, [lastRequest]);
  useEffect(() => {
    // Some test stubs do not report a version.
    if (!open || version || typeof api.appVersion !== 'function') return;
    void Promise.resolve()
      .then(() => api.appVersion())
      .then(
        (value) => value.version && setVersion(displayVersion(value.version)),
        () => {},
      );
  }, [api, open]);
  // A section opens at the top. An anchor moves to its element after the section loads.
  useEffect(() => {
    if (!open) return;
    scroller.current?.scrollTo({ top: 0 });
    if (!focusId) return;
    let tries = 0;
    const timer = setInterval(() => {
      const root = scroller.current;
      const fallback = tries > 20 ? fallbackSelector(focusId) : '';
      const element =
        root?.querySelector<HTMLElement>(`[id="${CSS.escape(focusId)}"]`) ||
        (fallback ? root?.querySelector<HTMLElement>(fallback) : null);
      if (element || ++tries > 40) {
        clearInterval(timer);
        if (!element) return;
        element.scrollIntoView({ block: 'start' });
        if (!element.matches('button, a[href], input, [tabindex]'))
          element.setAttribute('tabindex', '-1');
        element.focus({ preventScroll: true });
      }
    }, 50);
    return () => clearInterval(timer);
  }, [open, active, focusId]);
  function select(next: SettingsSection) {
    setActive(next);
    setFocusId(undefined);
  }
  const label = settingsSections.find((item) => item.value === active)?.label || 'General';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        className="settings-dialog gap-0 overflow-hidden p-0"
        aria-describedby="settings-dialog-description"
        onCloseAutoFocus={onCloseAutoFocus}
        onOpenAutoFocus={(event) => {
          // The active section in the list gets the focus, so ↑ and ↓ work at once.
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)
            ?.querySelector<HTMLElement>(`.settings-nav-item[data-section="${target.tab}"]`)
            ?.focus();
        }}
      >
        <TabsPrimitive.Root
          value={active}
          onValueChange={(value) => select(value as SettingsSection)}
          orientation="vertical"
          className="contents"
        >
          <nav ref={nav} className="settings-nav" aria-label="Settings">
            <DialogTitle className="settings-nav-title">Settings</DialogTitle>
            <DialogDescription id="settings-dialog-description" className="sr-only">
              Choices save at once.
            </DialogDescription>
            <TabsPrimitive.List aria-label="Settings sections" loop className="contents">
              {settingsSections.map((item) => (
                <TabsPrimitive.Trigger
                  key={item.value}
                  value={item.value}
                  data-section={item.value}
                  className="settings-nav-item"
                >
                  {sectionIcons[item.value]}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </TabsPrimitive.Trigger>
              ))}
            </TabsPrimitive.List>
            {version && <p className="settings-nav-version">Kalkidan {version}</p>}
          </nav>
          <div className="settings-main">
            <h2 ref={title} tabIndex={-1} className="settings-main-title">
              {label}
            </h2>
            <div ref={scroller} className="settings-scroll">
              {settingsSections.map((item) => (
                <TabsPrimitive.Content
                  key={item.value}
                  value={item.value}
                  className="settings-panel"
                  aria-label={item.label}
                >
                  {item.value === 'general' && (
                    <GeneralSection api={api} open={open && active === 'general'} />
                  )}
                  {item.value === 'account' && (
                    <AccountSection api={api} open={open && active === 'account'} />
                  )}
                  {item.value === 'agents' && (
                    <AgentsSection
                      api={api}
                      open={open && active === 'agents'}
                      anchor={focusId}
                      onOpenComputers={() => select('computers')}
                    />
                  )}
                  {item.value === 'computers' && (
                    <ComputersSection
                      api={api}
                      open={open && active === 'computers'}
                      onRefresh={onRefresh}
                    />
                  )}
                  {item.value === 'data' && (
                    <DataSection api={api} open={open && active === 'data'} />
                  )}
                  {item.value === 'about' && (
                    <AboutSection
                      api={api}
                      open={open && active === 'about'}
                      onOpenComputers={() => select('computers')}
                    />
                  )}
                </TabsPrimitive.Content>
              ))}
            </div>
          </div>
        </TabsPrimitive.Root>
      </DialogContent>
    </Dialog>
  );
}

/** Shows that a choice was saved, with Undo. */
function savedToast(message: string, undo: () => void) {
  showToast({ message, actions: [{ label: 'Undo', onClick: undo }] });
}

const agentName = (id: string) => agentCatalog.find((a) => a.id === id)?.name || id;

/**
 * Settings › General: the appearance, the default agent, the access of new chats, Enter to
 * send, notifications, the built-in browser, and the keyboard shortcuts.
 */
export function GeneralSection({ api, open }: { api: API; open: boolean }) {
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);
  const [defaultAgent, setDefaultAgent] = useState<Agent>(readPreferredAgent);
  const [access, setAccess] = useState<ChatAccess>(readNewChatAccess);
  const [enterToSend, setEnterToSend] = useState(readEnterToSend);
  const [notifications, setNotifications] = useState<NotificationPreferences>();
  const [browserOpen, setBrowserOpen] = useState(false);
  // A "New chat" menu can change the default agent while Settings shows.
  useEffect(() => onPreferredAgentChange(setDefaultAgent), []);
  useEffect(
    () =>
      onChatPreferencesChange(() => {
        setAccess(readNewChatAccess());
        setEnterToSend(readEnterToSend());
      }),
    [],
  );
  useEffect(() => {
    if (!open || typeof api.notificationPreferences !== 'function') return;
    void Promise.resolve()
      .then(() => api.notificationPreferences())
      .then(setNotifications, () => {});
  }, [api, open]);
  function appear(mode: Appearance) {
    setAppearance(mode);
    saveAppearance(mode);
    void api.setAppearance?.(mode);
    applyAppearance(mode);
  }
  function chooseAgent(next: Agent) {
    const before = defaultAgent;
    setDefaultAgent(next);
    savePreferredAgent(next);
    savedToast(`${agentName(next)} is the default agent`, () => {
      setDefaultAgent(before);
      savePreferredAgent(before);
    });
  }
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
    savedToast(
      next ? 'Enter sends a message' : `${isMac ? '⌘' : 'Ctrl+'}Enter sends a message`,
      () => {
        setEnterToSend(!next);
        saveEnterToSend(!next);
      },
    );
  }
  async function notify(next: NotificationPreferences, undo?: NotificationPreferences) {
    const before = notifications;
    setNotifications(next);
    try {
      setNotifications(await api.setNotificationPreferences(next));
      if (undo) savedToast('Notification setting saved', () => void notify(undo));
    } catch {
      setNotifications(before);
      showToast({ message: 'Could not save the notification setting.', tone: 'error' });
    }
  }
  const sendKey = isMac ? '⌘Enter' : 'Ctrl+Enter';
  return (
    <>
      <SettingsRows label="General">
        <SettingsRow label="Appearance" help="Match your computer, or choose light or dark.">
          <SegmentedControl
            size="sm"
            label="Appearance"
            value={appearance}
            onChange={appear}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </SettingsRow>
        <SettingsRow
          id={settingsAnchors.defaultAgent}
          label="Default agent"
          help="The agent for new chats."
        >
          <Select value={defaultAgent} onValueChange={(value) => chooseAgent(value as Agent)}>
            <SelectTrigger aria-label="Default agent" size="sm" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {agentCatalog.map((agent) => (
                <SelectItem
                  key={agent.id}
                  value={agent.id}
                  disabled={!agentInstalled(agent.id)}
                  description={agentInstalled(agent.id) ? undefined : 'Not installed'}
                >
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow label="New chats start as" help="You can change it in each chat.">
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
          label="Enter to send"
          help={enterToSend ? 'Shift+Enter adds a line.' : `Enter adds a line. ${sendKey} sends.`}
        >
          <Switch aria-label="Enter to send" checked={enterToSend} onCheckedChange={chooseEnter} />
        </SettingsRow>
        {notifications && (
          <>
            <SettingsRow
              id={settingsAnchors.notifications}
              label="When an agent finishes"
              help="Show a notification when Kalkidan is not in front."
            >
              <Switch
                aria-label="Notify when an agent finishes"
                checked={notifications.finished}
                onCheckedChange={(finished) =>
                  void notify({ ...notifications, finished }, notifications)
                }
              />
            </SettingsRow>
            <SettingsRow
              label="When an agent needs input"
              help="Approvals and questions from an agent."
            >
              <Switch
                aria-label="Notify when an agent needs input"
                checked={notifications.needsInput}
                onCheckedChange={(needsInput) =>
                  void notify({ ...notifications, needsInput }, notifications)
                }
              />
            </SettingsRow>
          </>
        )}
        <SettingsRow label="Built-in browser" help="Home page, history, and saved sign-ins.">
          <Button variant="outline" size="sm" onClick={() => setBrowserOpen(true)}>
            Manage…
          </Button>
        </SettingsRow>
        <SettingsRow
          label="Keyboard shortcuts"
          help={`See all shortcuts. Press ${isMac ? '⌘/' : 'Ctrl+/'} at any time.`}
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.dispatchEvent(new Event('kalkidan-show-shortcuts'))}
          >
            Show
          </Button>
        </SettingsRow>
      </SettingsRows>
      <BrowserSettingsDialog api={api} open={browserOpen} onOpenChange={setBrowserOpen} />
    </>
  );
}
