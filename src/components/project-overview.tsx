import { trackerConnection, type TrackerBoard } from '../domain/tracker';
import { CreateProject } from './create-project';
import { startFirstChat } from './onboarding';
import { useState } from 'react';
import { FolderOpen, Loader2, Plus } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { EmptyState } from './ui/empty-state';
import { PageHeader, SectionHeader } from './ui/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import type { API, ProjectGroup, Project, Session } from '../types';
import { sessionRepo } from '../lib/session-repository';
import { fullTime, relativeTime } from '../lib/relative-time';
import { ProjectPortfolio } from './planning-tools';
import { folderName, showFolderImportResult, useFolderImport } from './repository-import';
import { showToast } from './ui/toast';
import { ChatRow } from './chat-row';
import { errorMessage } from '../lib/errors';
import {
  StatusMark,
  activityKey,
  activityLabels,
  useActivityState,
  waitsForUser,
  type SessionActivityState,
} from './activity-dot';
import { plural } from '../lib/platform';

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

/**
 * The one "Waiting for you" page: the chats that wait for an approval or an answer, or that
 * finished and are not seen yet, then the tasks of the connected boards that are assigned to
 * the user. The sidebar row opens it.
 */
export function WaitingPage({
  api,
  groups,
  repos,
  sessions,
  onResume,
}: {
  api: API;
  groups: ProjectGroup[];
  repos: Project[];
  sessions: Session[];
  onResume: (session: Session) => void;
}) {
  const needsYou = useNeedsYou(sessions, repos);
  const boards =
    typeof api.trackerPortfolio === 'function' &&
    groups.some((group) => trackerConnection(group)?.provider === 'github');
  const placeOf = (repo: Project) => groups.find((g) => g.repoIds.includes(repo.id))?.name;
  return (
    <section className="page" aria-label="Waiting for you">
      <PageHeader title="Waiting for you" reserveSubtitle />
      {(needsYou.length > 0 || boards) && (
        <section className="waiting-section" aria-label="Chats">
          {/* With tasks below, the chats get their own header. */}
          {boards && <SectionHeader title="Chats" count={needsYou.length} />}
          {needsYou.length > 0 ? (
            <div className="chat-list">
              {needsYou.map(({ session, repo, reason, state }) => (
                <ChatRow
                  key={activityKey(session.agent, session.id)}
                  session={session}
                  activity={state}
                  onOpen={onResume}
                  meta={[reason, placeOf(repo), repo.name].filter(Boolean).join(' · ')}
                  trailing={
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Review ${session.organization?.title || session.title}`}
                      onClick={() => onResume(session)}
                    >
                      Review
                    </Button>
                  }
                />
              ))}
            </div>
          ) : (
            <EmptyState compact title="No chats wait for you." />
          )}
        </section>
      )}
      {!needsYou.length && !boards && <EmptyState title="Nothing waits for you." />}
      {boards && (
        <section className="waiting-section" aria-label="Tasks">
          <SectionHeader title="Tasks" />
          <ProjectPortfolio api={api} groups={groups} />
        </section>
      )}
    </section>
  );
}

export function ProjectOverview({
  api,
  groups,
  repos,
  sessions,
  query,
  onSelect,
  onRefresh,
}: {
  /** @deprecated The table has no Tasks column any more. */
  boards?: Record<string, TrackerBoard>;
  api: API;
  groups: ProjectGroup[];
  repos: Project[];
  sessions: Session[];
  query: string;
  onSelect: (group: ProjectGroup) => void;
  onRefresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const needsYou = useNeedsYou(sessions, repos);
  const { activity } = useActivityState();
  const folderImport = useFolderImport(api, 'overview');
  const [importing, setImporting] = useState(false);
  /** Chooses a folder, makes a project with its name, and adds the Git repositories in it. */
  async function openCodeFolder() {
    if (!folderImport.supported) return setOpen(true);
    if (importing) return;
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
  const rows = visible.map((group) => {
    const inGroup = (repo?: Project) => !!repo && group.repoIds.includes(repo.id);
    const chats = recent.filter(({ repo }) => inGroup(repo));
    const waiting = needsYou.filter((item) => inGroup(item.repo)).length;
    const running = activity.filter(
      (item) => item.state === 'running' && inGroup(sessionRepo(item, repos)),
    ).length;
    return { group, chats, waiting, running, last: chats[0]?.session.updatedAt };
  });
  return (
    <section className="page" aria-label="Projects">
      <PageHeader
        title="Projects"
        reserveSubtitle
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus />
            New project
          </Button>
        }
      />
      {!!visible.length && (
        <div className="project-directory">
          <Table>
            <colgroup>
              <col className="project-name-column" />
              <col className="project-activity-column" />
              <col className="project-updated-column" />
            </colgroup>
            <TableHeader className="[&_tr]:border-0">
              <TableRow className="border-0 hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Activity</TableHead>
                <TableHead className="text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ group, chats, waiting, running, last }) => (
                // The whole row opens the project. The button keeps it reachable by keyboard.
                <TableRow
                  key={group.id}
                  className="project-row border-0"
                  onClick={() => onSelect(group)}
                >
                  <TableCell>
                    <Button
                      variant="bare"
                      className="project-open max-w-full justify-start gap-2 text-left whitespace-normal"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelect(group);
                      }}
                    >
                      <span className="min-w-0 break-words font-medium">{group.name}</span>
                      {group.hostId && (
                        <Badge variant="outline" size="sm">
                          SSH
                        </Badge>
                      )}
                    </Button>
                  </TableCell>
                  {/* One column: what needs the user, what runs, else the number of chats. */}
                  <TableCell>
                    <span className="project-activity">
                      {waiting > 0 && (
                        <span className="project-activity-item" data-tone="waiting">
                          <StatusMark state="approval" label={`${waiting} waiting for you`} />
                          {waiting} waiting
                        </span>
                      )}
                      {running > 0 && (
                        <span className="project-activity-item">
                          <StatusMark state="running" label={`${running} running`} />
                          {running} running
                        </span>
                      )}
                      {!waiting && !running && (
                        <span className="project-activity-item">
                          {chats.length ? plural(chats.length, 'chat') : 'No chats yet'}
                        </span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
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
          title={groups.length ? 'No matching projects.' : 'No projects yet.'}
          action={
            !groups.length && (
              <Button variant="outline" size="sm" onClick={() => void openCodeFolder()}>
                {importing ? <Loader2 className="animate-spin" /> : <FolderOpen />}
                Open a folder…
              </Button>
            )
          }
        />
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
