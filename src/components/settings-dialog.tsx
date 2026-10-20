import type { GitHubCliStatus } from '../domain/conversation';
import { agentCatalog } from '../config/agents';
import { RemoteHostPicker } from './remote-host-picker';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Tabs as TabsPrimitive } from 'radix-ui';
import { Bot, ExternalLink, Info, RefreshCw, Server, SlidersHorizontal } from 'lucide-react';
import type { API, Agent, AgentInstallation } from '../types';
import { Button } from './ui/button';
import { Hint } from './hint';
import { Choice } from './choice';
import { AgentIcon } from './ui/agent-icon';
import { EntityIcon } from './ui/entity-icon';
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
import { cn } from '../lib/utils';

/** The agent that the user prefers for new sessions. Use readPreferredAgent in new code. */
export const readDefaultAgent = readPreferredAgent;

export type SettingsSectionId = 'general' | 'agents' | 'remote' | 'about';

const sections: { value: SettingsSectionId; label: string; icon: ReactNode }[] = [
  { value: 'general', label: 'General', icon: <SlidersHorizontal /> },
  { value: 'agents', label: 'Agents & tools', icon: <Bot /> },
  { value: 'remote', label: 'Remote hosts', icon: <Server /> },
  { value: 'about', label: 'About', icon: <Info /> },
];

export function SettingsDialog({
  open,
  onOpenChange,
  api,
  onRefresh,
  section = 'general',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: API;
  onRefresh: () => Promise<void>;
  /** The section that shows when the dialog opens. */
  section?: SettingsSectionId;
}) {
  const [tab, setTab] = useState<SettingsSectionId>(section);
  useEffect(() => {
    if (open) setTab(section);
  }, [open, section]);
  const [installations, setInstallations] = useState<AgentInstallation[]>([]);
  const [checkRevision, setCheckRevision] = useState(0);
  const [gh, setGh] = useState<GitHubCliStatus>();
  const [ghChecking, setGhChecking] = useState(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setGhChecking(true);
    Promise.resolve()
      .then(() => api.githubCliCheck())
      .then((value) => {
        if (live) setGh(value);
      })
      .catch(() => {
        if (live) setGh({ status: 'error' });
      })
      .finally(() => {
        if (live) setGhChecking(false);
      });
    return () => {
      live = false;
    };
  }, [open, api, checkRevision]);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  useEffect(() => {
    if (!open) return;
    let live = true;
    setChecking(true);
    setCheckError('');
    Promise.resolve()
      .then(() => api.agentInstallations())
      .then((value) => {
        if (live) setInstallations(value);
      })
      .catch(() => {
        if (live) {
          setInstallations([]);
          setCheckError('Could not check agents. Try again.');
        }
      })
      .finally(() => {
        if (live) setChecking(false);
      });
    return () => {
      live = false;
    };
  }, [open, api, checkRevision]);
  const [remoteId, setRemoteId] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);
  const [defaultAgent, setDefaultAgent] = useState<Agent>(readPreferredAgent);
  // A "New session" menu can change the preference while this dialog is mounted.
  useEffect(() => onPreferredAgentChange(setDefaultAgent), []);
  // Refresh projects only when the selected host becomes ready, not on each render or mount.
  const remoteReady = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  function agentStatus(agent: string) {
    if (checking) return 'Checking…';
    const status = installations.find((item) => item.agent === agent)?.status;
    if (status === 'installed') return 'Installed';
    if (status === 'missing') return 'Not found';
    if (status === 'unavailable') return 'Desktop only';
    return 'Check failed';
  }
  const ghStatus = ghChecking
    ? 'Checking…'
    : gh?.status === 'ready'
      ? 'Signed in'
      : gh?.status === 'signed-out'
        ? 'Sign-in required'
        : gh?.status === 'missing'
          ? 'Not found'
          : gh?.status === 'unavailable'
            ? 'Desktop only'
            : 'Check failed';
  // Remote host work continues on the host after this dialog closes.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        layout="scroll"
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
        <DialogBody className="flex p-0">
          <TabsPrimitive.Root
            value={tab}
            onValueChange={(value) => setTab(value as SettingsSectionId)}
            orientation="vertical"
            className="flex min-h-[min(420px,calc(100dvh-10rem))] min-w-0 flex-1"
          >
            <TabsPrimitive.List
              aria-label="Settings sections"
              className="flex w-44 shrink-0 flex-col gap-0.5 border-r p-3"
            >
              {sections.map((item) => (
                <TabsPrimitive.Trigger
                  key={item.value}
                  value={item.value}
                  className="flex h-[var(--row-height)] items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground outline-none transition-colors hover:bg-[var(--surface-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-[var(--surface-selected)] data-[state=active]:font-medium data-[state=active]:text-foreground [&_svg]:size-4 [&_svg]:shrink-0"
                >
                  {item.icon}
                  {item.label}
                </TabsPrimitive.Trigger>
              ))}
            </TabsPrimitive.List>
            <div className="min-w-0 flex-1 px-6 py-4">
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
                    <span className="text-xs font-normal">
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
                    <span className="text-xs font-normal">
                      The agent for new sessions. When you choose an agent for a new session,
                      Kalkidan remembers it here.
                    </span>
                  </label>
                </div>
              </SettingsSection>
              <SettingsSection value="agents">
                <section aria-label="Local agents and tools" className="grid gap-3">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-xs text-muted-foreground">
                      Kalkidan finds these command-line tools on this computer.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={checking || ghChecking}
                      onClick={() => setCheckRevision((n) => n + 1)}
                    >
                      <RefreshCw className={checking ? 'animate-spin' : ''} />
                      Check again
                    </Button>
                  </div>
                  <ul className="divide-y rounded-lg border">
                    {agentCatalog.map(({ id, name, vendor }) => (
                      <ToolRow
                        key={id}
                        icon={<AgentIcon agent={id} />}
                        name={name}
                        vendor={vendor}
                        path={installations.find((item) => item.agent === id)?.path}
                        status={agentStatus(id)}
                        ready={agentStatus(id) === 'Installed'}
                      />
                    ))}
                    <ToolRow
                      label="GitHub CLI status"
                      icon={
                        <span
                          className="tracker-provider-mark size-4"
                          style={{ maskImage: 'url(./icons/github.svg)' }}
                        />
                      }
                      name="GitHub CLI"
                      vendor="gh · github.com"
                      path={gh?.path}
                      status={ghStatus}
                      ready={ghStatus === 'Signed in'}
                    >
                      {!ghChecking && gh?.status === 'missing' && (
                        <p className="text-xs text-muted-foreground">
                          Install gh, then check again.
                        </p>
                      )}
                      {!ghChecking && gh?.status === 'signed-out' && (
                        <p className="text-xs text-muted-foreground">
                          Run <code>gh auth login</code>, then check again.
                        </p>
                      )}
                    </ToolRow>
                  </ul>
                  {/* One live region announces the result of all checks together. */}
                  <p role="status" className="sr-only">
                    {checking || ghChecking
                      ? 'Checking agents and tools…'
                      : [
                          ...agentCatalog.map(({ id, name }) => `${name}: ${agentStatus(id)}.`),
                          `GitHub CLI: ${ghStatus}.`,
                        ].join(' ')}
                  </p>
                  {checkError && (
                    <p role="alert" className="field-error">
                      {checkError}
                    </p>
                  )}
                </section>
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
                      Projects, repositories, and agent sessions in one workspace.
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
      className="outline-none data-[state=inactive]:hidden"
    >
      {children}
    </TabsPrimitive.Content>
  );
}

/** One agent or tool: icon, name, vendor, installed path, and status. */
function ToolRow({
  label,
  icon,
  name,
  vendor,
  path,
  status,
  ready,
  children,
}: {
  label?: string;
  icon: ReactNode;
  name: string;
  vendor: string;
  path?: string;
  status: string;
  ready: boolean;
  children?: ReactNode;
}) {
  return (
    <li
      className="flex min-h-[var(--row-height-2line)] items-center gap-3 px-3 py-2"
      role={label ? 'group' : undefined}
      aria-label={label}
    >
      <EntityIcon>{icon}</EntityIcon>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{name}</p>
        <p className="text-xs text-muted-foreground">{vendor}</p>
        <InstalledPath path={path} />
        {children}
      </div>
      <span className={cn('shrink-0 text-xs', ready ? 'text-success' : 'text-muted-foreground')}>
        {status}
      </span>
    </li>
  );
}

/** The installed binary path, truncated, with the full path in a tooltip. */
function InstalledPath({ path }: { path?: string }) {
  if (!path) return null;
  return (
    <Hint label={path}>
      <p tabIndex={0} className="mt-0.5 truncate font-mono text-2xs text-muted-foreground">
        {path}
      </p>
    </Hint>
  );
}

function ExternalLinkRow({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-8 items-center gap-2 -mx-2 rounded-md px-2 text-sm text-link outline-none hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
      <ExternalLink className="size-3.5" aria-hidden="true" />
    </a>
  );
}
