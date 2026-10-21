import { agentCatalog } from '../config/agents';
import { ManagedAgentsSettings } from './verdictan-settings';
import { ComponentUpdates } from './component-updates';
import { RemoteHostPicker } from './remote-host-picker';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Tabs as TabsPrimitive } from 'radix-ui';
import {
  Bot,
  ExternalLink,
  Info,
  RefreshCw,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
} from 'lucide-react';
import type { API, Agent } from '../types';
import { Choice } from './choice';
import { AgentProgramsSettings } from './agent-programs';
import { GitHubAccount } from './github-account';
import { SegmentedControl } from './ui/segmented-control';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { errorMessage } from '../lib/errors';
import {
  applyAppearance,
  readAppearance,
  saveAppearance,
  type Appearance,
} from '../lib/appearance';
import {
  onPreferredAgentChange,
  readPreferredAgent,
  savePreferredAgent,
} from '../lib/agent-preference';

/** The agent that the user prefers for new sessions. Use readPreferredAgent in new code. */
export const readDefaultAgent = readPreferredAgent;

export type SettingsSectionId =
  'general' | 'agents' | 'managed-agents' | 'accounts' | 'remote' | 'updates' | 'about';

const sections: { value: SettingsSectionId; label: string; icon: ReactNode }[] = [
  { value: 'general', label: 'General', icon: <SlidersHorizontal /> },
  { value: 'agents', label: 'Agents', icon: <Bot /> },
  { value: 'managed-agents', label: 'Managed agents', icon: <ShieldCheck /> },
  { value: 'accounts', label: 'Accounts', icon: <UserRound /> },
  { value: 'remote', label: 'Remote hosts', icon: <Server /> },
  { value: 'updates', label: 'Updates', icon: <RefreshCw /> },
  { value: 'about', label: 'About', icon: <Info /> },
];

export { AgentInstallHelp } from './agent-programs';

function sectionId(value: string | undefined): SettingsSectionId {
  return sections.some((item) => item.value === value) ? (value as SettingsSectionId) : 'general';
}

export function SettingsDialog({
  open,
  onOpenChange,
  api,
  onRefresh,
  section = 'general',
  anchor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: API;
  onRefresh: () => Promise<void>;
  /** The section that shows when the dialog opens, for example 'accounts'. */
  section?: SettingsSectionId | string;
  /** The element in the section that gets focus, for example one managed setup step. */
  anchor?: { id: string; request: number };
}) {
  const [tab, setTab] = useState<SettingsSectionId>(sectionId(section));
  useEffect(() => {
    if (open) setTab(sectionId(section));
  }, [open, section]);
  useEffect(() => {
    if (!open || !anchor) return;
    // Sections load their data after they open. Wait for the step to show, then move to it.
    let tries = 0;
    const timer = setInterval(() => {
      // A step that is not available yet falls back to the account status. An agent program
      // that does not show falls back to the agents of this computer.
      const fallback = anchor.id.startsWith('agent-') ? 'settings-agents' : 'verdictan-account';
      const target =
        document.getElementById(anchor.id) ||
        (tries > 20 ? document.getElementById(fallback) : null);
      if (target || ++tries > 40) clearInterval(timer);
      if (!target) return;
      target.scrollIntoView({ block: 'start' });
      target.focus({ preventScroll: true });
    }, 50);
    return () => clearInterval(timer);
  }, [open, anchor]);
  const [remoteId, setRemoteId] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);
  const [defaultAgent, setDefaultAgent] = useState<Agent>(readPreferredAgent);
  // A "New session" menu can change the preference while this dialog is mounted.
  useEffect(() => onPreferredAgentChange(setDefaultAgent), []);
  // Refresh projects only when the selected host becomes ready, not on each render or mount.
  const remoteReady = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  // Remote host work continues on the host after this dialog closes.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A fixed height: the dialog does not move when the section changes. */}
      <DialogContent
        size="lg"
        layout="scroll"
        className="h-[min(720px,calc(100dvh-48px))]"
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          heading.current?.focus();
        }}
      >
        <DialogHeader className="border-b">
          <DialogTitle ref={heading} tabIndex={-1} className="outline-none">
            Settings
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="flex overflow-hidden p-0">
          <TabsPrimitive.Root
            value={tab}
            onValueChange={(value) => setTab(value as SettingsSectionId)}
            orientation="vertical"
            className="flex min-h-0 min-w-0 flex-1"
          >
            {/* Only the content pane scrolls. The section list stays in place. */}
            <TabsPrimitive.List
              aria-label="Settings sections"
              loop
              className="flex w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-r px-3 py-4"
            >
              {sections.map((item) => (
                <TabsPrimitive.Trigger
                  key={item.value}
                  value={item.value}
                  className="flex h-[var(--row-height)] items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground outline-none transition-colors hover:bg-[var(--surface-hover)] hover:text-foreground focus-visible:shadow-[var(--focus-ring)] data-[state=active]:bg-[var(--surface-selected)] data-[state=active]:text-foreground [&_svg]:size-4 [&_svg]:shrink-0"
                >
                  {item.icon}
                  {item.label}
                </TabsPrimitive.Trigger>
              ))}
            </TabsPrimitive.List>
            <div className="settings-scroll min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-4">
              {/* Keep each section mounted so that checks and forms keep their state. Each
                  panel takes its name from its tab, so the panels do not repeat it. */}
              <SettingsSection value="general">
                <div className="grid gap-4">
                  <div className="form-label">
                    <span>Appearance</span>
                    <SegmentedControl
                      className="justify-self-start"
                      label="Appearance"
                      value={appearance}
                      onChange={(mode) => {
                        setAppearance(mode);
                        saveAppearance(mode);
                        void api.setAppearance?.(mode);
                        applyAppearance(mode);
                      }}
                      options={[
                        { value: 'system', label: 'System' },
                        { value: 'light', label: 'Light' },
                        { value: 'dark', label: 'Dark' },
                      ]}
                    />
                    <span className="form-help">
                      System uses the light or dark setting of your computer.
                    </span>
                  </div>
                  <label className="form-label">
                    Default agent
                    <Choice
                      className="w-60"
                      label="Default agent"
                      value={defaultAgent}
                      onChange={(value) => {
                        setDefaultAgent(value as Agent);
                        savePreferredAgent(value as Agent);
                      }}
                      options={agentCatalog.map((agent) => ({
                        value: agent.id,
                        label: agent.name,
                      }))}
                    />
                    <span className="form-help">
                      The agent for new chats. When you choose an agent for a new chat, Kalkidan
                      remembers it here.
                    </span>
                  </label>
                </div>
              </SettingsSection>
              <SettingsSection value="agents">
                <AgentProgramsSettings api={api} open={open} onNavigate={setTab} />
              </SettingsSection>
              <SettingsSection value="managed-agents">
                <ManagedAgentsSettings api={api} open={open && tab === 'managed-agents'} />
              </SettingsSection>
              <SettingsSection value="accounts">
                <GitHubAccount api={api} open={open} />
                <p className="form-help mt-4">
                  The sign-in for managed agents is in{' '}
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => setTab('managed-agents')}
                  >
                    Managed agents
                  </button>
                  .
                </p>
              </SettingsSection>
              <SettingsSection value="updates">
                <ComponentUpdates api={api} open={open && tab === 'updates'} onNavigate={setTab} />
              </SettingsSection>
              <SettingsSection value="remote">
                <RemoteHostPicker
                  compact
                  api={api}
                  value={remoteId}
                  onChange={setRemoteId}
                  onReady={(ready) => {
                    const becameReady = ready && !remoteReady.current;
                    remoteReady.current = ready;
                    if (!becameReady) return;
                    setRefreshError('');
                    void onRefresh().catch((error) =>
                      setRefreshError(`Could not refresh projects: ${errorMessage(error)}`),
                    );
                  }}
                />
                {refreshError && (
                  <p role="alert" className="field-error mt-2">
                    {refreshError}
                  </p>
                )}
              </SettingsSection>
              <SettingsSection value="about">
                <div className="flex items-center gap-3">
                  <img
                    src="./brand/kalkidan-icon.svg"
                    alt=""
                    width="40"
                    height="40"
                    className="size-10 rounded-lg"
                  />
                  <div>
                    <p className="text-sm font-medium">Kalkidan</p>
                    <p className="text-xs text-muted-foreground">
                      Projects, code folders, and agent chats in one workspace.
                    </p>
                  </div>
                </div>
                <ul className="mt-4 grid gap-1">
                  <li>
                    <ExternalLinkRow href="https://github.com/verdictan/kalkidan/blob/main/docs/user-guide.md">
                      User guide
                    </ExternalLinkRow>
                  </li>
                  <li>
                    <ExternalLinkRow href="https://github.com/verdictan/kalkidan/issues">
                      Report an issue
                    </ExternalLinkRow>
                  </li>
                </ul>
              </SettingsSection>
            </div>
          </TabsPrimitive.Root>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function SettingsSection({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsPrimitive.Content
      forceMount
      value={value}
      className="min-w-0 outline-none data-[state=inactive]:hidden"
    >
      {children}
    </TabsPrimitive.Content>
  );
}

function ExternalLinkRow({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="-mx-2 inline-flex h-8 items-center gap-2 rounded-md px-2 text-sm text-link outline-none hover:bg-[var(--surface-hover)] focus-visible:shadow-[var(--focus-ring)]"
    >
      {children}
      <ExternalLink className="size-3.5" aria-hidden="true" />
    </a>
  );
}
