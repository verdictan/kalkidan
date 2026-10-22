import { projectColors } from '../domain/project-colors';
import { trackerConnection, type TrackerBoard } from '../domain/tracker';
import { CreateProject } from './create-project';
import { startFirstChat } from './onboarding';
import { useState } from 'react';
import { Folder, FolderOpen, FolderPlus, Inbox, Plus } from 'lucide-react';
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
import { fullTime, relativeTime } from '../lib/relative-time';
import { doneStatus, itemStatus } from '../hooks/use-project-boards';
import { ProjectPortfolio } from './planning-tools';
import { folderName, showFolderImportResult, useFolderImport } from './repository-import';
import { showToast } from './ui/toast';
import { ChatRow } from './chat-row';
import { errorMessage } from '../lib/errors';
import {
  ActivityDot,
  activityKey,
  activityLabels,
  useActivityState,
  waitsForUser,
  type SessionActivityState,
} from './activity-dot';
import { NodeField } from './node-field';

const recentLimit = 5;
/** The views of the Projects page. */
export type OverviewTab = 'projects' | 'waiting';

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
  activity = {},
  boards = {},
  tab = 'projects',
  onTabChange,
}: {
  /** Opens the list of all chats in every project. Not used: the sidebar has All chats. */
  onAllSessions?: () => void;
  /** Background state of open chats, by `activityKey`. */
  activity?: Record<string, SessionActivityState>;
  /** The boards of the connected projects, for the Tasks column. */
  boards?: Record<string, TrackerBoard>;
  /** "projects" shows the projects. "waiting" shows what waits for the user. */
  tab?: OverviewTab;
  onTabChange?: (tab: OverviewTab) => void;
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
  const folderImport = useFolderImport(api, 'overview');
  const [importing, setImporting] = useState(false);
  /** Chooses a folder, makes a project with its name, and adds the Git repositories in it. */
  async function openCodeFolder() {
    if (!folderImport.supported) return setOpen(true);
    setImporting(true);
    try {
      const result = await folderImport.choose('Choose a code folder', 'Choose');
      if (!result) return;
      const name = folderName(result.root);
      const id = await api.createGroup(name, '', undefined, 'github', undefined, undefined, [
        ...result.paths,
      ]);
      await onRefresh();
      const snapshot = await api.snapshot();
      const group = snapshot.groups?.find((g) => g.id === id);
      showFolderImportResult(name, group?.repoIds.length ?? 0);
      if (group) onSelect(group);
      // The first project lands in a chat with a draft, ready to send.
      if (group?.repoIds.length) startFirstChat({ groupId: group.id, repoId: group.repoIds[0] });
    } catch (error) {
      showToast({ message: errorMessage(error), tone: 'error' });
    } finally {
      setImporting(false);
    }
  }
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
    .filter((item): item is { session: Session; repo: Project } => !!item.repo)
    .sort((a, b) => (b.session.updatedAt || '').localeCompare(a.session.updatedAt || ''));
  const portfolio = typeof api.trackerPortfolio === 'function' && groups.length > 0;
  const shownTab: OverviewTab = tab === 'waiting' ? 'waiting' : 'projects';
  const rows = visible.map((group) => {
    const members = repos.filter((r) => group.repoIds.includes(r.id));
    const chats = recent.filter(({ repo }) => group.repoIds.includes(repo.id));
    const board = boards[group.id];
    const openTasks = board
      ? board.items.filter((item) => !doneStatus(itemStatus(board, item))).length
      : undefined;
    const waiting = needsYou.filter((item) => group.repoIds.includes(item.repo.id)).length;
    return { group, members, chats, openTasks, waiting, last: chats[0]?.session.updatedAt };
  });
  // A column that is empty for every project does not show.
  const showTasks = rows.some((row) => row.openTasks !== undefined || trackerConnection(row.group));
  const showFolders = rows.some((row) => row.members.length > 0);
  const muted = <span className="text-muted-foreground">—</span>;
  const placeOf = (repo: Project) => groups.find((g) => g.repoIds.includes(repo.id))?.name;
  return (
    <section className={'page' + (groups.length ? '' : ' focus-page')} aria-label="Projects">
      {/* The empty page has one job, so it gets the quiet node background. */}
      {!groups.length && <NodeField corners="bottom" />}
      <PageHeader
        title="Projects"
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
      {!!groups.length && onTabChange && (
        <SegmentedControl
          className="project-overview-tabs"
          label="Projects view"
          value={shownTab}
          onChange={(value) => onTabChange(value)}
          options={[
            { value: 'projects', label: 'All projects' },
            {
              value: 'waiting',
              label: needsYou.length ? `Waiting for you (${needsYou.length})` : 'Waiting for you',
            },
          ]}
        />
      )}
      {shownTab === 'waiting' && groups.length ? (
        <>
          {needsYou.length ? (
            <div className="chat-list">
              {needsYou.map(({ session, repo, reason, state }) => (
                <ChatRow
                  key={activityKey(session.agent, session.id)}
                  session={session}
                  activity={state}
                  onOpen={(item) => onResume?.(item)}
                  meta={[reason, placeOf(repo), repo.name].filter(Boolean).join(' · ')}
                />
              ))}
            </div>
          ) : (
            !portfolio && <EmptyState icon={<Inbox />} title="Nothing waits for you" />
          )}
          {portfolio && (
            <section className="project-recent" aria-label="Assigned to you">
              <ProjectPortfolio api={api} groups={groups} />
            </section>
          )}
        </>
      ) : (
        <>
          {!!visible.length && (
            <div className="project-directory">
              <Table>
                <colgroup>
                  <col className="project-name-column" />
                  {showFolders && <col className="project-repositories-column" />}
                  <col className="project-sessions-column" />
                  {showTasks && <col className="project-tasks-column" />}
                  <col className="project-waiting-column" />
                </colgroup>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-0">Name</TableHead>
                    {showFolders && <TableHead>Code folders</TableHead>}
                    <TableHead>Chats</TableHead>
                    {showTasks && <TableHead>Open tasks</TableHead>}
                    <TableHead className="pr-0">
                      <span className="sr-only">Last activity</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ group, members, chats, openTasks, waiting, last }) => (
                    // The whole row opens the project. The button keeps it reachable by keyboard.
                    <TableRow
                      key={group.id}
                      className="project-row"
                      onClick={() => onSelect(group)}
                    >
                      <TableCell className="pl-0">
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
                      {showFolders && (
                        <TableCell>
                          <span
                            className="tabular-nums"
                            title={members.map((r) => r.name).join(', ')}
                          >
                            {members.length || muted}
                          </span>
                        </TableCell>
                      )}
                      <TableCell>
                        <span className="inline-flex items-center gap-2 tabular-nums">
                          {chats.length || muted}
                          {waiting > 0 && (
                            <ActivityDot state="approval" label={`${waiting} waiting for you`} />
                          )}
                        </span>
                      </TableCell>
                      {showTasks && (
                        <TableCell>
                          <span className="tabular-nums">
                            {openTasks === undefined
                              ? trackerConnection(group)
                                ? '…'
                                : muted
                              : openTasks || muted}
                          </span>
                        </TableCell>
                      )}
                      <TableCell className="pr-0 text-right">
                        {last && (
                          <time
                            dateTime={last}
                            title={fullTime(last)}
                            className="text-muted-foreground tabular-nums"
                          >
                            {relativeTime(last)}
                          </time>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {!visible.length && (
            <EmptyState
              icon={<FolderPlus />}
              title={groups.length ? 'No matching projects' : 'Open a code folder'}
              action={
                !groups.length && (
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button disabled={importing} onClick={() => void openCodeFolder()}>
                      <FolderOpen />
                      Open a folder…
                    </Button>
                    <Button variant="outline" onClick={() => setOpen(true)}>
                      <Plus />
                      New empty project
                    </Button>
                  </div>
                )
              }
            />
          )}
          {!!recent.length && onResume && (
            <section className="project-recent" aria-label="Recent chats">
              <SectionHeader title="Recent chats" />
              <div className="chat-list">
                {recent.slice(0, recentLimit).map(({ session, repo }) => (
                  <ChatRow
                    key={activityKey(session.agent, session.id)}
                    session={session}
                    activity={activity[activityKey(session.agent, session.id)]}
                    project={placeOf(repo)}
                    folder={repo.name}
                    onOpen={onResume}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
      {folderImport.dialog}
      <CreateProject
        api={api}
        open={open}
        onOpenChange={setOpen}
        onCreated={async (group) => {
          const first = !groups.length;
          await onRefresh();
          onSelect(group);
          if (first && group.repoIds.length)
            startFirstChat({ groupId: group.id, repoId: group.repoIds[0] });
        }}
      />
    </section>
  );
}
