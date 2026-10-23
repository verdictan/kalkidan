import { useState, type ReactNode } from 'react';
import { Folder, Loader2 } from 'lucide-react';
import type { API, ProjectGroup, RemoteHost } from '../types';
import type { ProjectPage } from '../domain/workspace-route';
import { errorMessage } from '../lib/errors';
import { ProjectTabs, openProjectPage } from './project-tabs';
import { requestNewChat } from './new-chat-button';
import { openProjectUsage } from './project-usage';
import { projectMenuActions, TreeActionsMenu } from './tree-context-menu';
import { Button } from './ui/button';
import { EntityIcon } from './ui/entity-icon';
import { PageHeader } from './ui/page-header';
import { showToast } from './ui/toast';

/** The name of the tracker side: "GitHub Projects board", never just "project". */
export function boardNoun(providerName: string) {
  return providerName === 'GitHub' ? 'GitHub Projects board' : `${providerName} board`;
}

const event = (name: string, detail: object) =>
  window.dispatchEvent(new CustomEvent(name, { detail }));

/**
 * The one header of a project: a 28px folder tile, the title and the project menu, the same on
 * every tab. The title has no counts: the page below shows the code folders and the chats. A remote project shows its SSH host under the title. The ⋯ menu has the same items
 * as the menu of the project row in the sidebar. New chat is not here: on Overview the composer
 * starts a chat, and ⌘N works on every tab.
 */
function ProjectHeader({
  api,
  group,
  host,
  onRefresh,
}: {
  api: API;
  group: ProjectGroup;
  host?: RemoteHost;
  onRefresh(): Promise<unknown>;
}) {
  const [reconnecting, setReconnecting] = useState(false);
  const busy = false;
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
  async function newPage() {
    try {
      const doc = await api.docsCreate(group.id, 'Untitled', null);
      openProjectPage(group.id, 'knowledge', { section: 'pages', docId: doc.id });
    } catch (error) {
      showToast({ message: `Could not create the page: ${errorMessage(error)}`, tone: 'error' });
    }
  }
  const actions = projectMenuActions({
    busy,
    onNewChat: () => requestNewChat({ groupId: group.id }),
    onNewTask: () => event('kalkidan-new-task', {}),
    onNewPage: () => void newPage(),
    onAddFolder: () => event('kalkidan-add-code-folder', { groupId: group.id }),
    onRename: () => event('kalkidan-rename-project', { groupId: group.id }),
    onUsage: () => openProjectUsage(group.id),
    onSettings: () => event('kalkidan-open-project-settings', { groupId: group.id }),
    reconnect:
      host && status !== 'connected'
        ? { host: host.name, disabled: reconnecting, run: () => void reconnect() }
        : undefined,
  });
  return (
    <PageHeader
      className="project-header"
      icon={
        <EntityIcon>
          <Folder />
        </EntityIcon>
      }
      title={group.name}
      subtitle={
        group.hostId && (
          <span
            className="project-header-host"
            title={host ? `${host.target}${host.error ? ` · ${host.error}` : ''}` : undefined}
          >
            <span
              className={
                'tree-host-dot' +
                (status === 'connected'
                  ? ' host-connected'
                  : status === 'error'
                    ? ' host-error'
                    : '')
              }
              aria-hidden="true"
            />
            <span className="truncate">
              SSH · {host?.name || 'Remote host'} · {status}
            </span>
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
      actions={<TreeActionsMenu label="Project actions" size="md" align="end" actions={actions} />}
    />
  );
}

/**
 * The frame of every project page: one header and one tab bar that stay in the same place on
 * each tab, then the page. Only the page below the tab bar scrolls. The frame has the edges of
 * `.page`.
 */
export function ProjectFrame({
  api,
  group,
  host,
  page,
  onRefresh,
  children,
}: {
  api: API;
  group: ProjectGroup;
  host?: RemoteHost;
  page: ProjectPage;
  onRefresh(): Promise<unknown>;
  children: ReactNode;
}) {
  return (
    <div className="project-frame" data-page={page}>
      <div className="project-frame-head">
        <ProjectHeader api={api} group={group} host={host} onRefresh={onRefresh} />
        <ProjectTabs groupId={group.id} page={page} />
      </div>
      <div className="project-frame-body">{children}</div>
    </div>
  );
}
