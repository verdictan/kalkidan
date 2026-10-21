import { createContext, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Folder, Layers2, Loader2, Settings2 } from 'lucide-react';
import type { API, ProjectGroup, RemoteHost } from '../types';
import type { ProjectPage } from '../domain/workspace-route';
import { projectColors } from '../domain/project-colors';
import { trackerConnection } from '../domain/tracker';
import { useTracker } from '../hooks/use-tracker';
import { errorMessage } from '../lib/errors';
import { ProjectTabs } from './project-tabs';
import { Hint } from './hint';
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

/** Puts page actions, such as "New task", in the project header. Outside a frame, renders none. */
export function ProjectHeaderActions({ children }: { children: ReactNode }) {
  const slots = useContext(HeaderSlots);
  return slots?.actions ? createPortal(children, slots.actions) : null;
}

/** Adds page text, such as "12 tasks", to the end of the board line of the project header. */
export function ProjectHeaderMeta({ children }: { children: ReactNode }) {
  const slots = useContext(HeaderSlots);
  return slots?.meta ? createPortal(children, slots.meta) : null;
}

/**
 * The one header of a project: the title, the board and host line, and the actions. Each page
 * adds its actions with `ProjectHeaderActions`. The Project settings button is always last.
 */
function ProjectHeader({
  api,
  group,
  host,
  onRefresh,
  setActions,
  setMeta,
}: {
  api: API;
  group: ProjectGroup;
  host?: RemoteHost;
  onRefresh(): Promise<unknown>;
  setActions(element: HTMLElement | null): void;
  setMeta(element: HTMLElement | null): void;
}) {
  const connection = trackerConnection(group);
  const { name: providerName } = useTracker(api, connection?.provider);
  const board = boardNoun(providerName);
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
          {connection?.provider === 'github' || !connection ? (
            <span
              className="tracker-provider-mark"
              style={{ maskImage: 'url(./icons/github.svg)' }}
              aria-hidden="true"
            />
          ) : (
            <Layers2 size={12} aria-hidden="true" />
          )}
          <span className="truncate">
            {connection ? (
              <>
                {board} · <span>{connection.project.title}</span>
                {connection.project.number ? ` #${connection.project.number}` : ''}
              </>
            ) : (
              `No ${board}`
            )}
          </span>
          <span ref={setMeta} className="project-header-meta" />
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
          <div ref={setActions} className="project-header-slot" />
          <Hint label="Project settings">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Project settings"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent('kalkidan-open-project-settings', {
                    detail: { groupId: group.id },
                  }),
                )
              }
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
 * each tab, then the page. Only the page below the tab bar scrolls.
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
            onRefresh={onRefresh}
            setActions={setActions}
            setMeta={setMeta}
          />
          <ProjectTabs groupId={group.id} page={page} />
        </div>
        <div className="project-frame-body">{children}</div>
      </div>
    </HeaderSlots.Provider>
  );
}
