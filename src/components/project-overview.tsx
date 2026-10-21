import { projectColors } from '../domain/project-colors';
import { trackerConnection, type TrackerBoard } from '../domain/tracker';
import { agentLabel } from '../config/agents';
import { CreateProject } from './create-project';
import { useState } from 'react';
import { Folder, FolderPlus, Plus, GitBranch, MessageSquare } from 'lucide-react';
import { AgentIcon } from './ui/agent-icon';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { EmptyState } from './ui/empty-state';
import { EntityIcon } from './ui/entity-icon';
import { PageHeader, SectionHeader } from './ui/page-header';
import { SegmentedControl } from './ui/segmented-control';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import type { API, ProjectGroup, Project, Session } from '../types';
import { sessionRepo } from '../lib/session-repository';
import { plural } from '../lib/platform';
import { fullTime, relativeTime } from '../lib/relative-time';
import { doneStatus, itemStatus } from '../hooks/use-project-boards';
import { ProjectPortfolio } from './planning-tools';
import {
  ActivityDot,
  ChatStatusDot,
  activityKey,
  activityLabels,
  useActivityState,
  waitsForUser,
  type SessionActivityState,
} from './activity-dot';

const recentLimit = 5;
/** The relative time moved to src/lib/relative-time.ts. Other modules import it here too. */
export { relativeTime };

/** A chat that waits for the user, or a run that finished and is not seen yet. */
export interface NeedsYouItem {
  session: Session;
  repo: Project;
  /** "Waiting for your approval", "Waiting for your answer" or "Finished". */
  reason: string;
  state?: SessionActivityState;
  at?: string;
}

/**
 * The chats that wait for the user: approvals and questions first, then finished runs that
 * the user did not open yet. `repos` limits the list to some code folders.
 */
export function useNeedsYou(sessions: Session[], repos: Project[]): NeedsYouItem[] {
  const { activity, finished } = useActivityState();
  const find = (agent: string, id: string) =>
    sessions.find((s) => s.agent === agent && s.id === id);
  const items: NeedsYouItem[] = [];
  for (const item of activity) {
    if (!waitsForUser(item.state)) continue;
    const session = find(item.agent, item.id);
    const repo = session && sessionRepo(session, repos);
    if (session && repo)
      items.push({ session, repo, reason: activityLabels[item.state], state: item.state });
  }
  for (const item of finished) {
    if (items.some((entry) => entry.session.agent === item.agent && entry.session.id === item.id))
      continue;
    const session = find(item.agent, item.id);
    const repo = session && sessionRepo(session, repos);
    if (session && repo) items.push({ session, repo, reason: 'Finished', at: item.at });
  }
  return items;
}

/** The "Needs you" list. Each row opens its chat. */
export function NeedsYouList({
  items,
  groups,
  onOpen,
  showProject = true,
}: {
  items: NeedsYouItem[];
  groups: ProjectGroup[];
  onOpen: (session: Session) => void;
  showProject?: boolean;
}) {
  return (
    <ul className="needs-you-list">
      {items.map(({ session, repo, reason, state, at }) => {
        const title = session.organization?.title || session.title;
        const project = groups.find((g) => g.repoIds.includes(repo.id))?.name;
        return (
          <li key={session.agent + ':' + session.id} className="needs-you-row">
            <EntityIcon>
              <AgentIcon agent={session.agent} />
            </EntityIcon>
            <span className="needs-you-text">
              <span className="needs-you-title" title={title}>
                {title}
              </span>
              <span className="needs-you-meta">
                {[reason, showProject ? project : undefined, repo.name].filter(Boolean).join(' · ')}
                {at && ` · ${relativeTime(at)}`}
              </span>
            </span>
            <ActivityDot state={state} />
            <Button
              variant="outline"
              size="xs"
              aria-label={`Open ${title}`}
              onClick={() => onOpen(session)}
            >
              Open
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

export function ProjectOverview({
  api,
  groups,
  repos,
  sessions,
  query,
  onSelect,
  onResume,
  onRefresh,
  onAllSessions,
  activity = {},
  boards = {},
  tab = 'projects',
  onTabChange,
}: {
  /** Opens the list of all chats in every project. */
  onAllSessions?: () => void;
  /** Background state of open chats, by `activityKey`. */
  activity?: Record<string, SessionActivityState>;
  /** The boards of the connected projects, for the Open tasks column. */
  boards?: Record<string, TrackerBoard>;
  /** "projects" shows the projects. "my-work" shows the portfolio across projects. */
  tab?: 'projects' | 'my-work';
  onTabChange?: (tab: 'projects' | 'my-work') => void;
  api: API;
  groups: ProjectGroup[];
  repos: Project[];
  sessions: Session[];
  query: string;
  onSelect: (group: ProjectGroup) => void;
  /** Opens a chat from the recent chats list. */
  onResume?: (session: Session) => void;
  onRefresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const needsYou = useNeedsYou(sessions, repos);
  const visible = groups.filter((g) =>
    `${g.name} ${trackerConnection(g)?.project.title || ''} ${repos
      .filter((r) => g.repoIds.includes(r.id))
      .map((r) => r.name)
      .join(' ')}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const recent = sessions
    .filter((s) => !s.organization?.archived && !s.id.startsWith('draft-'))
    .map((session) => ({ session, repo: sessionRepo(session, repos) }))
    .filter((item) => item.repo)
    .sort((a, b) => (b.session.updatedAt || '').localeCompare(a.session.updatedAt || ''))
    .slice(0, recentLimit);
  const portfolio = typeof api.trackerPortfolio === 'function' && groups.length > 0;
  return (
    <section className="page" aria-label="Project overview">
      <PageHeader
        title="Projects"
        subtitle="Your projects, their code folders and the agent chats in progress."
        actions={
          // With no projects, the empty state shows the only "New project" action.
          !!groups.length && (
            <Button onClick={() => setOpen(true)}>
              <Plus />
              New project
            </Button>
          )
        }
      />
      {portfolio && onTabChange && (
        <SegmentedControl
          className="project-overview-tabs"
          label="Projects overview view"
          value={tab}
          onChange={(value) => onTabChange(value as 'projects' | 'my-work')}
          options={[
            { value: 'projects', label: 'Projects' },
            { value: 'my-work', label: 'My work' },
          ]}
        />
      )}
      {portfolio && tab === 'my-work' ? (
        <ProjectPortfolio api={api} groups={groups} />
      ) : (
        <>
          {!!needsYou.length && onResume && (
            <section className="project-needs-you" aria-label="Needs you">
              <SectionHeader title="Needs you" count={needsYou.length} />
              <NeedsYouList items={needsYou} groups={groups} onOpen={onResume} />
            </section>
          )}
          {!!visible.length && (
            <div className="project-directory">
              <Table>
                <colgroup>
                  <col className="project-name-column" />
                  <col className="project-repositories-column" />
                  <col className="project-sessions-column" />
                  <col className="project-tasks-column" />
                  <col className="project-waiting-column" />
                </colgroup>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Project</TableHead>
                    <TableHead>Code folders</TableHead>
                    <TableHead>Chats</TableHead>
                    <TableHead>Open tasks</TableHead>
                    <TableHead>Waiting on you</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((group) => {
                    const repositories = repos.filter((r) => group.repoIds.includes(r.id));
                    const count = sessions.filter(
                      (s) =>
                        !s.organization?.archived &&
                        repositories.some((r) => r.id === sessionRepo(s, repos)?.id),
                    ).length;
                    const board = boards[group.id];
                    const openTasks = board
                      ? board.items.filter((item) => !doneStatus(itemStatus(board, item))).length
                      : undefined;
                    const waiting = needsYou.filter((item) =>
                      group.repoIds.includes(item.repo.id),
                    ).length;
                    return (
                      // The whole row opens the project. The button keeps it reachable by keyboard.
                      <TableRow
                        key={group.id}
                        className="project-row"
                        onClick={() => onSelect(group)}
                      >
                        <TableCell>
                          <Button
                            variant="bare"
                            className="project-open max-w-full justify-start gap-3 text-left whitespace-normal"
                            onClick={(event) => {
                              event.stopPropagation();
                              onSelect(group);
                            }}
                          >
                            <EntityIcon
                              className="project-symbol"
                              color={group.color ? projectColors[group.color] : undefined}
                            >
                              <Folder />
                            </EntityIcon>
                            <span className="min-w-0 break-words font-medium">{group.name}</span>
                            {group.hostId && (
                              <Badge variant="outline" size="sm">
                                SSH
                              </Badge>
                            )}
                          </Button>
                        </TableCell>
                        <TableCell>
                          <span
                            className="inline-flex items-center gap-1.5 text-muted-foreground"
                            title={repositories.map((r) => r.name).join(', ')}
                          >
                            <GitBranch size={14} />
                            {plural(repositories.length, 'code folder')}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                            <MessageSquare size={14} />
                            {plural(count, 'chat')}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-muted-foreground tabular-nums">
                            {openTasks === undefined
                              ? trackerConnection(group)
                                ? '…'
                                : 'No board'
                              : openTasks}
                          </span>
                        </TableCell>
                        <TableCell>
                          {waiting ? (
                            <Badge variant="warning" size="sm">
                              {waiting}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground tabular-nums">0</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {!visible.length && (
            <EmptyState
              icon={<FolderPlus />}
              title={groups.length ? 'No matching projects' : 'Create your first project'}
              action={
                !groups.length && (
                  <Button size="lg" onClick={() => setOpen(true)}>
                    <Plus />
                    New project
                  </Button>
                )
              }
            >
              {groups.length
                ? 'Try another project or code folder name.'
                : 'A project holds your code folders, agent chats and notes. Create one to start. You can connect GitHub later.'}
            </EmptyState>
          )}
          {!!recent.length && onResume && (
            <section className="project-recent" aria-label="Recent chats">
              <SectionHeader
                title="Recent chats"
                actions={
                  onAllSessions && (
                    <Button variant="ghost" size="sm" onClick={onAllSessions}>
                      See all chats
                    </Button>
                  )
                }
              />
              <ul className="project-recent-list">
                {recent.map(({ session, repo }) => {
                  const title = session.organization?.title || session.title;
                  return (
                    <li key={session.agent + ':' + session.id}>
                      <button
                        type="button"
                        className="project-recent-row row-hover"
                        title={title}
                        onClick={() => onResume(session)}
                      >
                        <EntityIcon>
                          <AgentIcon agent={session.agent} />
                        </EntityIcon>
                        <span className="project-recent-text">
                          <span className="project-recent-title">
                            <span className="truncate">{title}</span>
                            <ChatStatusDot
                              session={session}
                              live={activity[activityKey(session.agent, session.id)]}
                            />
                          </span>
                          <span className="project-recent-meta">
                            {agentLabel(session.agent)} · {repo!.name}
                          </span>
                        </span>
                        <time
                          dateTime={session.updatedAt}
                          title={fullTime(session.updatedAt)}
                          className="project-recent-time"
                        >
                          {relativeTime(session.updatedAt)}
                        </time>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}
      <CreateProject
        api={api}
        open={open}
        onOpenChange={setOpen}
        onCreated={async (group) => {
          await onRefresh();
          onSelect(group);
        }}
      />
    </section>
  );
}
