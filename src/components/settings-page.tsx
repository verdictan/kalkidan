import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Tabs as TabsPrimitive } from 'radix-ui';
import { ExternalLink } from 'lucide-react';
import { agentCatalog } from '../config/agents';
import type { API, Agent } from '../types';
import type { DesktopUpdateStatus } from '../domain/updates';
import {
  settingsAnchors,
  settingsTabLabel,
  settingsTabs,
  type SettingsTab,
} from '../domain/settings-route';
import { agentMinimumVersions } from '../domain/agent-version';
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
import { displayVersion, shortId } from '../lib/verdictan-labels';
import { AgentProgramsSettings } from './agent-programs';
import { Choice } from './choice';
import { ComponentUpdates } from './component-updates';
import { ComputersSettings } from './computers-settings';
import { GitHubAccount } from './github-account';
import { SettingsDisclosure, SettingsGroup } from './settings-disclosure';
import { ManagedSetup, VerdictanAccount, type SettingsNavigate } from './verdictan-settings';
import { PageHeader } from './ui/page-header';
import { SegmentedControl } from './ui/segmented-control';
import { showToast } from './ui/toast';

/** A request to move the focus in Settings. A new `request` moves it again. */
export interface SettingsFocus {
  /** The element ID. Empty moves the focus to the page title. */
  id: string;
  request: number;
}

/**
 * Settings as a page in the main area. The tabs are General, Accounts, Agents, Computers, and
 * Updates. The shell keeps the tab in the route, so Back returns to the tab before.
 */
export function SettingsPage({
  api,
  tab,
  focus,
  onTab,
  onNavigate,
  onRefresh,
}: {
  api: API;
  tab: SettingsTab;
  focus?: SettingsFocus;
  /** The user selected a tab in the tab list. The focus stays on the tab. */
  onTab: (tab: SettingsTab) => void;
  /** A link in a tab opens another tab and moves the focus to `anchor`. */
  onNavigate: SettingsNavigate;
  onRefresh: () => Promise<void>;
}) {
  const heading = useRef<HTMLSpanElement>(null);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focus) return;
    if (!focus.id) {
      heading.current?.focus({ preventScroll: true });
      return;
    }
    // Tabs load their data after they show. Wait for the element, then move to it.
    let tries = 0;
    const timer = setInterval(() => {
      const target =
        root.current?.querySelector<HTMLElement>(`[id="${CSS.escape(focus.id)}"]`) ||
        // An element that does not show, for example a host that was removed, falls back to
        // the computer of an agent program, or to the panel of the tab.
        (tries > 20
          ? root.current?.querySelector<HTMLElement>(
              focus.id.startsWith('agent-')
                ? '#settings-agents'
                : '[role="tabpanel"][data-state="active"]',
            )
          : null);
      if (target || ++tries > 40) clearInterval(timer);
      if (!target) return;
      target.scrollIntoView({ block: 'start' });
      target.focus({ preventScroll: true });
    }, 50);
    return () => clearInterval(timer);
  }, [focus]);
  return (
    <section ref={root} className="page settings-page" aria-labelledby="settings-title">
      <PageHeader
        title={
          <span id="settings-title" ref={heading} tabIndex={-1} className="outline-none">
            Settings
          </span>
        }
      />
      <TabsPrimitive.Root
        value={tab}
        onValueChange={(value) => onTab(value as SettingsTab)}
        className="grid min-w-0 gap-6"
      >
        <TabsPrimitive.List aria-label="Settings sections" loop className="settings-tabs">
          {settingsTabs.map((item) => (
            <TabsPrimitive.Trigger key={item.value} value={item.value} className="project-tab">
              {item.label}
            </TabsPrimitive.Trigger>
          ))}
        </TabsPrimitive.List>
        {/* Each tab stays mounted, so forms keep their state. Only the tab that shows reads. */}
        <SettingsPanel value="general">
          <GeneralTab api={api} open={tab === 'general'} />
        </SettingsPanel>
        <SettingsPanel value="accounts">
          <div className="settings-accounts">
            <GitHubAccount api={api} open={tab === 'accounts'} />
            <VerdictanAccount api={api} open={tab === 'accounts'} onNavigate={onNavigate} />
          </div>
        </SettingsPanel>
        <SettingsPanel value="agents">
          <AgentsTab api={api} open={tab === 'agents'} onNavigate={onNavigate} />
        </SettingsPanel>
        <SettingsPanel value="computers">
          <ComputersSettings
            api={api}
            open={tab === 'computers'}
            onNavigate={onNavigate}
            onRefresh={onRefresh}
          />
        </SettingsPanel>
        <SettingsPanel value="updates">
          <ComponentUpdates api={api} open={tab === 'updates'} onNavigate={onNavigate} />
        </SettingsPanel>
      </TabsPrimitive.Root>
    </section>
  );
}

function SettingsPanel({ value, children }: { value: SettingsTab; children: ReactNode }) {
  return (
    <TabsPrimitive.Content
      forceMount
      value={value}
      className="min-w-0 outline-none data-[state=inactive]:hidden"
    >
      <h2 className="sr-only">{settingsTabLabel(value)}</h2>
      {children}
    </TabsPrimitive.Content>
  );
}

/** Settings › General: the appearance and information about Kalkidan. */
function GeneralTab({ api, open }: { api: API; open: boolean }) {
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);
  const [desktop, setDesktop] = useState<DesktopUpdateStatus>();
  useEffect(() => {
    // Older desktop builds and the browser demo do not report a version.
    if (!open || typeof api.componentUpdates !== 'function') return;
    let live = true;
    void Promise.resolve()
      .then(() => api.componentUpdates(false))
      .then(
        (value) => live && setDesktop(value.desktop),
        () => {},
      );
    return () => {
      live = false;
    };
  }, [api, open]);
  const version = desktop?.runningVersion
    ? `Version ${displayVersion(desktop.runningVersion)}`
    : 'Version not known';
  const build = desktop?.runningBuild ? `Build ${shortId(desktop.runningBuild)}` : '';
  return (
    <div className="grid gap-8">
      <SettingsGroup title="Appearance">
        <div className="form-label">
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
          <span className="form-help">System uses the light or dark setting of your computer.</span>
        </div>
      </SettingsGroup>
      <SettingsGroup id={settingsAnchors.about} title="About">
        <div className="flex items-center gap-3">
          <img
            src="./brand/kalkidan-icon.svg"
            alt=""
            width="40"
            height="40"
            className="size-10 rounded-lg"
          />
          <div className="min-w-0">
            <p className="text-sm font-medium">Kalkidan</p>
            <p className="text-xs text-muted-foreground" data-testid="settings-version">
              {[version, build, desktop?.install.kind === 'development' ? 'Development build' : '']
                .filter(Boolean)
                .join(' · ')}
            </p>
            <p className="text-xs text-muted-foreground">
              Projects, code folders, and agent chats in one workspace.
            </p>
          </div>
        </div>
        <ul className="mt-3 grid gap-1">
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
      </SettingsGroup>
    </div>
  );
}

/** Settings › Agents: the default agent, the managed setup, and the agent programs. */
function AgentsTab({
  api,
  open,
  onNavigate,
}: {
  api: API;
  open: boolean;
  onNavigate: SettingsNavigate;
}) {
  const [defaultAgent, setDefaultAgent] = useState<Agent>(readPreferredAgent);
  // A "New chat" menu can change the preference while this page shows.
  useEffect(() => onPreferredAgentChange(setDefaultAgent), []);
  return (
    <div className="grid gap-8">
      <SettingsGroup id={settingsAnchors.defaultAgent} title="Default agent">
        <div className="form-label">
          <Choice
            className="w-60 max-w-full"
            label="Default agent"
            value={defaultAgent}
            onChange={(value) => {
              const before = defaultAgent;
              const next = value as Agent;
              setDefaultAgent(next);
              savePreferredAgent(next);
              const name = (id: string) => agentCatalog.find((a) => a.id === id)?.name || id;
              showToast({
                message: `${name(next)} is the default agent`,
                actions: [
                  {
                    label: 'Undo',
                    onClick: () => {
                      setDefaultAgent(before);
                      savePreferredAgent(before);
                    },
                  },
                ],
              });
            }}
            options={agentCatalog.map((agent) => ({ value: agent.id, label: agent.name }))}
          />
          <span className="form-help">
            The agent for new chats. When you choose an agent for a new chat, Kalkidan remembers it
            here.
          </span>
        </div>
      </SettingsGroup>
      <ManagedSetup api={api} open={open} onNavigate={onNavigate} />
      <SettingsGroup id="settings-agent-programs" title="Agent programs">
        <AgentProgramsSettings api={api} open={open} onNavigate={onNavigate} />
        <SettingsDisclosure title="How this works" className="mt-2">
          <div className="grid gap-2 text-xs leading-4 text-muted-foreground">
            <p>
              Managed Verdictan agents use these agent programs on each computer. Kalkidan does not
              start them directly.
            </p>
            <p>
              Kalkidan needs Codex {agentMinimumVersions.codex} or later and Claude Code{' '}
              {agentMinimumVersions.claude_code} or later. Choose a program when Kalkidan finds the
              wrong one.
            </p>
          </div>
        </SettingsDisclosure>
      </SettingsGroup>
    </div>
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
