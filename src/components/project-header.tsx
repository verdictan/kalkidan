import { useState, type ReactNode } from 'react';
import { Folder, Loader2 } from 'lucide-react';
import type { API, Project, ProjectGroup, RemoteHost, Session } from '../types';
import type { ProjectPage } from '../domain/workspace-route';
import { projectColors, type ProjectColor } from '../domain/project-colors';
import { errorMessage } from '../lib/errors';
import { plural } from '../lib/platform';
import { projectSessions } from '../lib/session-repository';
import { ProjectTabs, openProjectPage } from './project-tabs';
import { NewChatButton, requestNewChat } from './new-chat-button';
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
 * The one header of a project: a 28px icon inline with the title, New chat and the project
 * menu, the same on every tab. The line "3 code folders · 2 chats" shows on every tab, so the
 * title and the tabs do not move. The ⋯ menu has the same items as the menu of the project row
 * in the sidebar.
 */
function ProjectHeader({
  api,
  group,
  host,
  repos,
  sessions,
  onRefresh,
}: {
  api: API;
  group: ProjectGroup;
  host?: RemoteHost;
  repos: Project[];
  sessions: Session[];
  onRefresh(): Promise<unknown>;
}) {
  const members = repos.filter((repo) => group.repoIds.includes(repo.id));
  const chats = projectSessions(sessions, group, repos).length;
  const [reconnecting, setReconnecting] = useState(false);
  const [busy, setBusy] = useState(false);
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
  async function setColor(color: ProjectColor | null) {
    setBusy(true);
    try {
      await api.setGroupColor(group.id, color);
      await onRefresh();
    } catch (error) {
      showToast({ message: errorMessage(error), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  const actions = projectMenuActions({
    busy,
    onNewChat: () => requestNewChat({ groupId: group.id }),
    onNewTask: () => event('kalkidan-new-task', {}),
    onNewPage: () => void newPage(),
    onAddFolder: () => event('kalkidan-add-code-folder', { groupId: group.id }),
    onRename: () => event('kalkidan-rename-project', { groupId: group.id }),
    onSettings: () => event('kalkidan-open-project-settings', { groupId: group.id }),
    reconnect:
      host && status !== 'connected'
        ? { host: host.name, disabled: reconnecting, run: () => void reconnect() }
        : undefined,
  });
  // New chat is outline on every tab. The one primary action of a view is in the tab.
  return (
    <PageHeader
      className="project-header"
      reserveSubtitle
      icon={
        <EntityIcon color={group.color ? projectColors[group.color] : undefined}>
          <Folder />
        </EntityIcon>
      }
      title={group.name}
      subtitle={
        <>
          <span className="truncate">
            {plural(members.length, 'code folder')}
            {' · '}
            {plural(chats, 'chat')}
          </span>
          {group.hostId && (
            <span
              className="project-header-host"
              title={host ? `${host.target}${host.error ? ` · ${host.error}` : ''}` : undefined}
            >
              <span aria-hidden="true">·</span>
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
          )}
        </>
      }
      actions={
        <>
          <NewChatButton repos={members} sessions={sessions} groupId={group.id} variant="outline" />
          <TreeActionsMenu
            label="Project actions"
            size="md"
            align="end"
            actions={actions}
            folderColor={{ value: group.color, disabled: busy, onChange: (c) => void setColor(c) }}
          />
        </>
      }
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
  repos,
  sessions,
  onRefresh,
  children,
}: {
  api: API;
  group: ProjectGroup;
  host?: RemoteHost;
  page: ProjectPage;
  /** All code folders. The header counts the code folders of this project. */
  repos: Project[];
  sessions: Session[];
  onRefresh(): Promise<unknown>;
  children: ReactNode;
}) {
  return (
    <div className="project-frame" data-page={page}>
      <div className="project-frame-head">
        <ProjectHeader
          api={api}
          group={group}
          host={host}
          repos={repos}
          sessions={sessions}
          onRefresh={onRefresh}
        />
        <ProjectTabs groupId={group.id} page={page} />
      </div>
      <div className="project-frame-body">{children}</div>
    </div>
  );
}
