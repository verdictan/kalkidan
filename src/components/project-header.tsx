import { createContext, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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

interface Slots {
  actions: HTMLElement | null;
  meta: HTMLElement | null;
}
const HeaderSlots = createContext<Slots | null>(null);

/**
 * Puts the controls of a tab, such as "New task" or a refresh button, at the end of the toolbar
 * row under the tabs. The project header stays the same on every tab. Outside a frame, it
 * renders nothing.
 */
export function ProjectToolbar({ children }: { children: ReactNode }) {
  const slots = useContext(HeaderSlots);
  return slots?.actions ? createPortal(children, slots.actions) : null;
}

/** Puts tab text, such as "12 tasks", at the start of the toolbar row under the tabs. */
export function ProjectToolbarStart({ children }: { children: ReactNode }) {
  const slots = useContext(HeaderSlots);
  return slots?.meta ? createPortal(children, slots.meta) : null;
}

/** The older names. Tab controls now go to the toolbar row under the tabs. */
export const ProjectHeaderActions = ProjectToolbar;
export const ProjectHeaderMeta = ProjectToolbarStart;

/** True inside a project frame. The frame header already has the one "New chat" button. */
export function useInProjectFrame() {
  return !!useContext(HeaderSlots);
}

const event = (name: string, detail: object) =>
  window.dispatchEvent(new CustomEvent(name, { detail }));

/**
 * The one header of a project: a 28px icon inline with the title, New chat and the project
 * menu. Only Overview shows the line "3 code folders · 2 chats". The ⋯ menu has the same items
 * as the menu of the project row in the sidebar.
 */
function ProjectHeader({
  api,
  group,
  host,
  page,
  repos,
  sessions,
  onRefresh,
}: {
  api: API;
  group: ProjectGroup;
  host?: RemoteHost;
  page: ProjectPage;
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
    onCloneFromGitHub: () =>
      event('kalkidan-add-code-folder', { groupId: group.id, source: 'github' }),
    onRename: () =>
      event('kalkidan-open-project-settings', {
        groupId: group.id,
        section: 'general',
        rename: true,
      }),
    onSettings: () => event('kalkidan-open-project-settings', { groupId: group.id }),
    reconnect:
      host && status !== 'connected'
        ? { host: host.name, disabled: reconnecting, run: () => void reconnect() }
        : undefined,
  });
  // Overview has its own primary action, the composer. Chats has none, so New chat is filled.
  const variant = page === 'chats' ? 'default' : 'outline';
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
        (page === 'board' || group.hostId) && (
          <>
            {page === 'board' && (
              <span className="truncate">
                {plural(members.length, 'code folder')}
                {' · '}
                {plural(chats, 'chat')}
              </span>
            )}
            {group.hostId && (
              <span
                className="project-header-host"
                title={host ? `${host.target}${host.error ? ` · ${host.error}` : ''}` : undefined}
              >
                {page === 'board' && <span aria-hidden="true">·</span>}
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
        )
      }
      actions={
        <>
          <NewChatButton repos={members} sessions={sessions} groupId={group.id} variant={variant} />
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
 * each tab, a toolbar row for the controls of the tab, then the page. Only the page below the
 * toolbar scrolls.
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
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const [meta, setMeta] = useState<HTMLElement | null>(null);
  return (
    <HeaderSlots.Provider value={{ actions, meta }}>
      <div className="project-frame" data-page={page}>
        <div className="project-frame-head">
          <ProjectHeader
            api={api}
            group={group}
            host={host}
            page={page}
            repos={repos}
            sessions={sessions}
            onRefresh={onRefresh}
          />
          <ProjectTabs groupId={group.id} page={page} />
          <div className="project-toolbar" data-page={page}>
            <div className="project-toolbar-start">
              <div ref={setMeta} className="project-toolbar-meta" />
            </div>
            <div ref={setActions} className="project-toolbar-end" />
          </div>
        </div>
        <div className="project-frame-body">{children}</div>
      </div>
    </HeaderSlots.Provider>
  );
}
