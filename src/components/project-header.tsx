import { useState, type ReactNode } from 'react';
import { AppWindow, Loader2, Unplug } from 'lucide-react';
import type { API, Project, ProjectGroup, RemoteHost, Session } from '../types';
import type { ProjectPage } from '../domain/workspace-route';
import type { IdentityColor } from '../domain/identity';
import { errorMessage } from '../lib/errors';
import { fileManagerName, isMac, shortcutLabel } from '../lib/platform';
import { Hint } from './hint';
import { projectTabs, openProjectPage } from './project-tabs';
import { ProjectUsageMenuItem } from './project-usage';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { menuShortcutClass, menuWideClass } from './ui/menu-styles';
import { MoreButton } from './ui/more-button';
import { PageHeader } from './ui/page-header';
import { showToast } from './ui/toast';

/** The name of the tracker side: "GitHub Projects board", never just "project". */
export function boardNoun(providerName: string) {
  return providerName === 'GitHub' ? 'GitHub Projects board' : `${providerName} board`;
}

const event = (name: string, detail: object) =>
  window.dispatchEvent(new CustomEvent(name, { detail }));

/**
 * The head of a project: the title bar with the project crumb, then the title row (the 16px
 * square, the name and the project menu) and the tabs Overview, Tasks and Knowledge. Knowledge
 * (KN-B) has no title row: its tabs come under the title bar, and the menu is in the title
 * bar. A remote project shows its SSH host after the name. A view can put its own controls in
 * `#project-header-actions`, before the menu.
 */
function ProjectHeader({
  api,
  group,
  color,
  host,
  page,
  usage,
  desktop,
  onOpenWindow,
  onRefresh,
}: {
  api: API;
  group: ProjectGroup;
  color: IdentityColor;
  host?: RemoteHost;
  page: ProjectPage;
  usage?: { sessions: Session[]; repos: Project[] };
  desktop?: boolean;
  onOpenWindow?: () => void;
  onRefresh(): Promise<unknown>;
}) {
  const [reconnecting, setReconnecting] = useState(false);
  const status = host?.status || 'disconnected';
  async function reconnect() {
    if (!host) return;
    setReconnecting(true);
    try {
      await api.remoteConnect(host.id);
      await onRefresh();
    } catch (error) {
      showToast({
        message: `Could not connect to ${host.name}: ${errorMessage(error)}`,
        tone: 'error',
      });
    } finally {
      setReconnecting(false);
    }
  }
  // Open in Finder shows the first repo of a project on this computer, in the desktop app.
  const folder = desktop && !group.hostId ? group.repoIds[0] : undefined;
  function reveal(id: string) {
    api
      .reveal(id)
      .catch((error) =>
        showToast({ message: `Could not open the folder: ${errorMessage(error)}`, tone: 'error' }),
      );
  }
  return (
    <PageHeader
      className="project-header"
      mark={{ kind: 'project', color }}
      title={group.name}
      subtitle={
        group.hostId && (
          <span
            className="project-header-host"
            title={host ? `${host.target}${host.error ? ` · ${host.error}` : ''}` : undefined}
          >
            SSH · {host?.name || 'Remote host'} · {status}
            {host && status !== 'connected' && (
              <Button
                variant="link"
                size="xs"
                className="text-xs"
                disabled={reconnecting || status === 'connecting'}
                onClick={() => void reconnect()}
              >
                {reconnecting && <Loader2 className="animate-spin" />}
                {status === 'error' ? 'Try again' : 'Reconnect'}
              </Button>
            )}
          </span>
        )
      }
      viewsLabel="Project page"
      titleRow={page !== 'knowledge'}
      views={projectTabs.map((tab) => ({
        value: tab.page,
        label: tab.label,
        hint: tab.label,
        shortcut: tab.shortcut,
      }))}
      view={page}
      onViewChange={(next) => next !== page && openProjectPage(group.id, next)}
      actions={
        <>
          <div id="project-header-actions" className="project-header-actions" />
          {/* The short project menu. The tree's right-click menu has all the project actions. */}
          <DropdownMenu>
            <Hint label="Project actions">
              <DropdownMenuTrigger asChild>
                <MoreButton size="sm" label="Project actions" />
              </DropdownMenuTrigger>
            </Hint>
            <DropdownMenuContent align="end" aria-label="Project actions" className={menuWideClass}>
              {onOpenWindow && (
                <DropdownMenuItem onSelect={onOpenWindow}>
                  <AppWindow className="size-4" />
                  <span className="flex-1">Open in new window</span>
                  <span className={menuShortcutClass}>{shortcutLabel(['shift'], '↵')}</span>
                </DropdownMenuItem>
              )}
              {host && status !== 'connected' && (
                <DropdownMenuItem disabled={reconnecting} onSelect={() => void reconnect()}>
                  <Unplug className="size-4" />
                  <span className="flex-1">Reconnect to {host.name}</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={() => event('kalkidan-rename-project', { groupId: group.id })}
              >
                <span className="flex-1">Rename…</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                aria-keyshortcuts={isMac ? 'Meta+,' : 'Control+,'}
                onSelect={() => event('kalkidan-open-project-settings', { groupId: group.id })}
              >
                <span className="flex-1">Settings…</span>
                <span className={menuShortcutClass} aria-hidden="true">
                  {shortcutLabel(['mod'], ',')}
                </span>
              </DropdownMenuItem>
              {usage && (
                <ProjectUsageMenuItem
                  api={api}
                  group={group}
                  sessions={usage.sessions}
                  repos={usage.repos}
                />
              )}
              {folder && (
                <DropdownMenuItem onSelect={() => reveal(folder)}>
                  <span className="flex-1">Open in {fileManagerName()}</span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    />
  );
}

/**
 * The frame of every project view: the title bar and the page head stay in the same place on
 * each view, then the view. Only the view below the header scrolls.
 */
export function ProjectFrame({
  api,
  group,
  color,
  host,
  page,
  usage,
  desktop,
  onOpenWindow,
  onRefresh,
  children,
}: {
  api: API;
  group: ProjectGroup;
  color: IdentityColor;
  host?: RemoteHost;
  page: ProjectPage;
  usage?: { sessions: Session[]; repos: Project[] };
  /** True in the desktop app: the menu then has Open in Finder. */
  desktop?: boolean;
  onOpenWindow?: () => void;
  onRefresh(): Promise<unknown>;
  children: ReactNode;
}) {
  return (
    <div className="project-frame" data-page={page}>
      <ProjectHeader
        api={api}
        group={group}
        color={color}
        host={host}
        page={page}
        usage={usage}
        desktop={desktop}
        onOpenWindow={onOpenWindow}
        onRefresh={onRefresh}
      />
      <div className="project-frame-body">{children}</div>
    </div>
  );
}
