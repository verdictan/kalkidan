import { createContext, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  FilePlus2,
  Folder,
  FolderPlus,
  Layers2,
  ListPlus,
  Loader2,
  Settings2,
  SquareKanban,
} from 'lucide-react';
import type { API, Project, ProjectGroup, RemoteHost, Session } from '../types';
import type { ProjectPage } from '../domain/workspace-route';
import { projectColors } from '../domain/project-colors';
import { trackerConnection } from '../domain/tracker';
import { errorMessage } from '../lib/errors';
import { plural } from '../lib/platform';
import { projectSessions } from '../lib/session-repository';
import { ProjectTabs, openProjectPage } from './project-tabs';
import { NewChatButton } from './new-chat-button';
import { useUncertainWrites } from './github-write-history';
import { Hint } from './hint';
import { Button } from './ui/button';
import { EntityIcon } from './ui/entity-icon';
import { MoreButton } from './ui/more-button';
import { PageHeader } from './ui/page-header';
import { showToast } from './ui/toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

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
 * The one header of a project. It is the same on every tab: the title, "3 code folders ·
 * 2 chats", then New chat, the project menu and Project settings.
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
  const connection = trackerConnection(group);
  const members = repos.filter((repo) => group.repoIds.includes(repo.id));
  const chats = projectSessions(sessions, group, repos).length;
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
  async function newPage() {
    try {
      const page = await api.docsCreate(group.id, 'Untitled', null);
      openProjectPage(group.id, 'docs', { docId: page.id });
    } catch (error) {
      showToast({ message: `Could not create the page: ${errorMessage(error)}`, tone: 'error' });
    }
  }
  return (
    <PageHeader
      className="project-header"
      icon={
        <EntityIcon size="lg" color={group.color ? projectColors[group.color] : undefined}>
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
          <NewChatButton repos={members} sessions={sessions} groupId={group.id} />
          <DropdownMenu>
            <Hint label="Project actions">
              <DropdownMenuTrigger asChild>
                <MoreButton size="md" label="Project actions" />
              </DropdownMenuTrigger>
            </Hint>
            <DropdownMenuContent align="end" className="min-w-56" aria-label="Project actions">
              <DropdownMenuItem
                onSelect={() => event('kalkidan-add-code-folder', { groupId: group.id })}
              >
                <FolderPlus className="size-4" />
                Add a code folder…
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  event('kalkidan-add-code-folder', { groupId: group.id, source: 'github' })
                }
              >
                <span
                  className="tracker-provider-mark size-4"
                  style={{ maskImage: 'url(./icons/github.svg)' }}
                  aria-hidden="true"
                />
                Clone from GitHub…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {connection && (
                <DropdownMenuItem onSelect={() => event('kalkidan-new-task', {})}>
                  <ListPlus className="size-4" />
                  New task
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => void newPage()}>
                <FilePlus2 className="size-4" />
                New page
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {connection ? (
                <DropdownMenuItem
                  onSelect={() => event('kalkidan-open-board-settings', { groupId: group.id })}
                >
                  <Layers2 className="size-4" />
                  Board settings…
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onSelect={() =>
                    event('kalkidan-open-project-settings', {
                      groupId: group.id,
                      section: 'board',
                    })
                  }
                >
                  <SquareKanban className="size-4" />
                  Connect a board…
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Hint label="Project settings">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Project settings"
              onClick={() => event('kalkidan-open-project-settings', { groupId: group.id })}
            >
              <Settings2 />
            </Button>
          </Hint>
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
  const connection = trackerConnection(group);
  const checks = useUncertainWrites(api, group.id, connection?.provider === 'github');
  return (
    <HeaderSlots.Provider value={{ actions, meta }}>
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
          <ProjectTabs groupId={group.id} page={page} checks={checks} />
          <div className="project-toolbar" data-page={page}>
            <div className="project-toolbar-start">
              {/* The board name shows only on Tasks. The mark already says "GitHub". */}
              {page === 'tasks' && connection && (
                <span className="project-toolbar-board" title={connection.project.title}>
                  {connection.provider === 'github' ? (
                    <span
                      className="tracker-provider-mark"
                      style={{ maskImage: 'url(./icons/github.svg)' }}
                      aria-hidden="true"
                    />
                  ) : (
                    <Layers2 size={12} aria-hidden="true" />
                  )}
                  <span className="truncate">
                    {connection.project.title}
                    {connection.project.number ? ` #${connection.project.number}` : ''}
                  </span>
                </span>
              )}
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
