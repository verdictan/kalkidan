import { useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import type { API, Project, ProjectGroup, RemoteHost, Session } from '../types';
import type { ProjectPage } from '../domain/workspace-route';
import { getIdentityOverride, setIdentityOverride, type IdentityColor } from '../domain/identity';
import { errorMessage } from '../lib/errors';
import { projectTabs, openProjectPage } from './project-tabs';
import { requestNewChat } from './new-chat-button';
import { ProjectUsageMenuItem } from './project-usage';
import { projectMenuActions, TreeActionsMenu } from './tree-context-menu';
import { openProjectSettings } from './settings-dialog';
import { Button } from './ui/button';
import { PageHeader } from './ui/page-header';
import { showToast } from './ui/toast';

/** The name of the tracker side: "GitHub Projects board", never just "project". */
export function boardNoun(providerName: string) {
  return providerName === 'GitHub' ? 'GitHub Projects board' : `${providerName} board`;
}

const event = (name: string, detail: object) =>
  window.dispatchEvent(new CustomEvent(name, { detail }));

/**
 * The one 48px header of a project: the project square, the name, the view switch (Overview,
 * Tasks, Knowledge) and the project menu, the same on every view. The active view takes the
 * tint of the project color. A remote project shows its SSH host after the name. A view can
 * put its own controls in `#project-header-actions`, before the menu.
 */
function ProjectHeader({
  api,
  group,
  color,
  host,
  page,
  usage,
  onOpenWindow,
  onRefresh,
}: {
  api: API;
  group: ProjectGroup;
  color: IdentityColor;
  host?: RemoteHost;
  page: ProjectPage;
  usage?: { sessions: Session[]; repos: Project[] };
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
  const actions = projectMenuActions({
    projectName: group.name,
    onOpenWindow,
    onNewChat: () => requestNewChat({ groupId: group.id }),
    onAddFolder: () => event('kalkidan-add-code-folder', { groupId: group.id }),
    onRename: () => event('kalkidan-rename-project', { groupId: group.id }),
    onSettings: () => event('kalkidan-open-project-settings', { groupId: group.id }),
    onRemove: () => openProjectSettings(group.id, 'danger'),
    reconnect:
      host && status !== 'connected'
        ? { host: host.name, disabled: reconnecting, run: () => void reconnect() }
        : undefined,
  });
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
          <TreeActionsMenu
            label="Project actions"
            size="sm"
            align="end"
            actions={actions}
            color={{
              value: color,
              chosen: !!getIdentityOverride('project', group.name),
              onChange: (next) => setIdentityOverride('project', group.name, next),
            }}
            extra={
              usage && (
                <ProjectUsageMenuItem
                  api={api}
                  group={group}
                  sessions={usage.sessions}
                  repos={usage.repos}
                />
              )
            }
          />
        </>
      }
    />
  );
}

/**
 * The frame of every project view: the one header stays in the same place on each view, then
 * the view. Only the view below the header scrolls.
 */
export function ProjectFrame({
  api,
  group,
  color,
  host,
  page,
  usage,
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
        onOpenWindow={onOpenWindow}
        onRefresh={onRefresh}
      />
      <div className="project-frame-body">{children}</div>
    </div>
  );
}
