import { projectColors } from '../domain/project-colors';
import { trackerConnection } from '../domain/tracker';
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

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import type { API, ProjectGroup, Project, Session } from '../types';
import { sessionRepo } from '../lib/session-repository';
import { plural } from '../lib/platform';
import { fullTime, relativeTime } from '../lib/relative-time';
import { ActivityDot, activityKey, type SessionActivityState } from './activity-dot';

const recentLimit = 5;
/** The relative time moved to src/lib/relative-time.ts. Other modules import it here too. */
export { relativeTime };

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
}: {
  /** Opens the list of all sessions in every project. */
  onAllSessions?: () => void;
  /** Background state of open sessions, by `activityKey`. */
  activity?: Record<string, SessionActivityState>;
  api: API;
  groups: ProjectGroup[];
  repos: Project[];
  sessions: Session[];
  query: string;
  onSelect: (group: ProjectGroup) => void;
  /** Opens a session from the recent sessions list. */
  onResume?: (session: Session) => void;
  onRefresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
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
      {!!visible.length && (
        <div className="project-directory">
          <Table>
            <colgroup>
              <col className="project-name-column" />
              <col className="project-repositories-column" />
              <col className="project-sessions-column" />
            </colgroup>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Project</TableHead>
                <TableHead>Code folders</TableHead>
                <TableHead>Sessions</TableHead>
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
                return (
                  // The whole row opens the project. The button keeps it reachable by keyboard.
                  <TableRow key={group.id} className="project-row" onClick={() => onSelect(group)}>
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
                        {plural(count, 'session')}
                      </span>
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
        <section className="project-recent" aria-label="Recent sessions">
          <SectionHeader
            title="Recent sessions"
            actions={
              onAllSessions && (
                <Button variant="ghost" size="sm" onClick={onAllSessions}>
                  See all sessions
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
                        <ActivityDot state={activity[activityKey(session.agent, session.id)]} />
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
