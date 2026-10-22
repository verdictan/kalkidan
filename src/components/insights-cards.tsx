import { useMemo, useState, type ReactNode } from 'react';
import { BarChart3 } from 'lucide-react';
import type { API, ProjectGroup, Session, TrackerBoard } from '../types';
import { trackerConnection } from '../domain/tracker';
import { localReadiness } from '../domain/project-readiness';
import { trackerClient } from '../lib/tracker-client';
import { useProjectBoard } from '../hooks/use-project-board';
import { plural } from '../lib/platform';
import { Button } from './ui/button';
import { EmptyState } from './ui/empty-state';
import { ProjectHealth } from './project-health';
import { GitHubWriteHistory } from './github-write-history';
import { ProjectUsageInsights } from './project-usage';
import { TaskUsageHistoryPanel } from './task-usage-history';
import { ProjectServicesPanel } from './project-services';
import { readinessLimit } from './project-readiness';
import { ErrorAlert, FormSelect, openTask, openTasksPage } from './planning-kit';
import { PlanningToolDialog } from './planning-tools';

/** The four insight views, in the fixed order of the Knowledge rail. */
export type InsightView = 'board' | 'github' | 'usage' | 'knowledge';

export const insightViews: { view: InsightView; label: string; keywords: string }[] = [
  {
    view: 'board',
    label: 'Board',
    keywords: 'board health status report todo progress done repository description readiness',
  },
  { view: 'github', label: 'GitHub checks', keywords: 'github changes check confirm undo' },
  { view: 'usage', label: 'Agent usage', keywords: 'usage requests tokens cost models runs' },
  {
    view: 'knowledge',
    label: 'Agent knowledge',
    keywords: 'services reviews approvals shared knowledge history policy',
  },
];

/** The board of a project for the insight views. Undefined without a board. */
export function useInsightsBoard(api: API, group: ProjectGroup) {
  const connection = trackerConnection(group);
  const provider = connection?.provider || 'github';
  const client = useMemo(() => trackerClient(api, provider), [api, provider]);
  const board = useProjectBoard(api, client, provider, group.id, connection?.project);
  return { connection, board };
}

/** Opens the Tasks page with a filter. The board applies the filter after the page opens. */
function showTasks(groupId: string, filter: Record<string, string | undefined>) {
  openTasksPage(groupId);
  setTimeout(
    () =>
      window.dispatchEvent(
        new CustomEvent('kalkidan-board-filter', { detail: { groupId, ...filter } }),
      ),
    60,
  );
}

const connectBoard = (groupId: string) =>
  window.dispatchEvent(
    new CustomEvent('kalkidan-open-project-settings', { detail: { groupId, section: 'board' } }),
  );

/** The header of a Knowledge pane: the switcher, a 16px title, a count and actions. */
export function PaneHeader({
  switcher,
  title,
  count,
  actions,
}: {
  switcher?: ReactNode;
  title: string;
  count?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="knowledge-pane-header">
      {switcher}
      <h2 className="knowledge-pane-title">{title}</h2>
      {count && <span className="knowledge-pane-count">{count}</span>}
      <span className="flex-1" />
      {actions}
    </div>
  );
}

/** One insight view of the Knowledge tab. */
export function InsightsView({
  api,
  group,
  sessions,
  view,
  taskId,
  switcher,
}: {
  api: API;
  group: ProjectGroup;
  /** The chats of the project. */
  sessions: Session[];
  view: InsightView;
  /** Agent usage opens at this task. */
  taskId?: string;
  switcher?: ReactNode;
}) {
  const { connection, board: boardState } = useInsightsBoard(api, group);
  const board = boardState.state.value;
  const [task, setTask] = useState(taskId || '');
  const [review, setReview] = useState<string[]>();
  const label = insightViews.find((item) => item.view === view)!.label;
  const needsBoard = view === 'board' || view === 'github';
  const noBoard = (
    <EmptyState
      icon={<BarChart3 />}
      title="No board connected"
      action={
        <Button variant="outline" onClick={() => connectBoard(group.id)}>
          Connect a board
        </Button>
      }
    />
  );
  let body: ReactNode;
  if (needsBoard && !connection) body = noBoard;
  else if (needsBoard && !board)
    body =
      boardState.state.status === 'error' ? (
        <ErrorAlert>{boardState.state.error}</ErrorAlert>
      ) : (
        <EmptyState compact>Loading the board…</EmptyState>
      );
  else if (view === 'board' && board) {
    const readiness = localReadiness(board, sessions);
    body = (
      <ProjectHealth
        api={api}
        groupId={group.id}
        board={board}
        onFilter={(filter) => showTasks(group.id, filter)}
        extraTiles={[
          {
            label: 'No description',
            count: readiness.noDescription.length,
            run: () =>
              setReview(readiness.noDescription.slice(0, readinessLimit).map((item) => item.id)),
          },
        ]}
      />
    );
  } else if (view === 'github' && board)
    body = (
      <GitHubWriteHistory
        api={api}
        groupId={group.id}
        board={board}
        onOpenTask={(id) => openTask(group.id, id)}
      />
    );
  else if (view === 'usage')
    body = task ? (
      board ? (
        <TaskUsageHistoryPanel api={api} groupId={group.id} board={board} taskId={task} />
      ) : null
    ) : (
      <ProjectUsageInsights api={api} groupId={group.id} sessions={sessions} />
    );
  else body = <ProjectServicesPanel api={api} groupId={group.id} board={board} />;
  return (
    <section className="knowledge-insight" aria-label={label}>
      <PaneHeader
        switcher={switcher}
        title={view === 'github' ? 'Check on GitHub' : label}
        count={view === 'board' && board ? plural(board.items.length, 'task') : undefined}
        actions={
          view === 'usage' && board?.items.length ? (
            <FormSelect
              label="Task"
              size="sm"
              variant="filled"
              className="max-w-60"
              value={task}
              onChange={setTask}
              options={[
                { value: '', label: 'All tasks' },
                ...board.items.map((item) => ({ value: item.id, label: item.title })),
              ]}
            />
          ) : undefined
        }
      />
      {body}
      {board && (
        <PlanningToolDialog
          tool="readiness"
          open={!!review}
          onOpenChange={(open) => !open && setReview(undefined)}
          api={api}
          group={group}
          board={board}
          selectedIds={review || []}
          onOpenTask={(id) => openTask(group.id, id)}
        />
      )}
    </section>
  );
}

/** Insight rows for the Knowledge search: the board numbers, with the view that shows each. */
export function insightSearchItems(board: TrackerBoard | undefined, sessions: Session[]) {
  const items: { view: InsightView; title: string; detail: string }[] = insightViews.map(
    (item) => ({ view: item.view, title: item.label, detail: item.keywords }),
  );
  if (!board) return items;
  const readiness = localReadiness(board, sessions);
  const counts = [
    [readiness.noRepository.length, 'with no repository'],
    [readiness.noDescription.length, 'with no description'],
    [readiness.candidates.length, 'that can start'],
  ] as const;
  for (const [count, text] of counts)
    if (count) items.push({ view: 'board', title: `${plural(count, 'task')} ${text}`, detail: '' });
  return items;
}
