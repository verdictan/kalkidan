// Planning tools for a project: the tool dialog for selected tasks, the Insights page body, the
// docs-to-tasks dialog and the portfolio for the Projects overview.
import { useEffect, useState } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';
import type { API, Project, ProjectGroup, Session, TrackerBoard } from '../types';
import { trackerConnection } from '../domain/tracker';
import { plural } from '../domain/planning-labels';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { EmptyState } from './ui/empty-state';
import { Hint } from './hint';
import { FieldsTool } from './project-batch';
import { IterationTool } from './iteration-planner';
import { ReadinessOverview, ReadinessTool } from './project-readiness';
import { DispatchTool } from './parallel-dispatch';
import { ProjectHealth } from './project-health';
import { GitHubWriteHistory } from './github-write-history';
import { TaskUsageHistoryPanel } from './task-usage-history';
import { ProjectServicesPanel } from './project-services';
import { ProjectUsageInsights } from './project-usage';
import { sessionRepo } from '../lib/session-repository';
import { ErrorAlert, githubWritesEvent } from './planning-kit';
import { openConnectBoard } from './tracker-project-picker';
import { errorMessage } from '../lib/errors';

export { DocsToIssuesDialog } from './docs-to-issues';
export { ProjectPortfolio } from './project-portfolio';
export {
  useUncertainWrites,
  useUncertainWritesToast,
  notifyGitHubWrites,
} from './github-write-history';

export type PlanningTool = 'fields' | 'iteration' | 'readiness' | 'dispatch';
/** A task filter for the Tasks page. The values are the same as the filter bar values. */
export interface TaskFilter {
  /** A status option ID, or 'none' for tasks with no status. */
  status?: string;
  /** A repository such as "owner/name", or 'draft' for tasks with no repository. */
  repository?: string;
  query?: string;
}

/** The chats and code folders of a project, read when a tool opens. */
function useProjectContext(api: API, group: ProjectGroup, enabled: boolean) {
  const [value, setValue] = useState<{ sessions: Session[]; repos: Project[] }>({
    sessions: [],
    repos: [],
  });
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    void api
      .snapshot()
      .then((snapshot) => {
        if (disposed) return;
        const repos = snapshot.projects.filter((repo) => group.repoIds.includes(repo.id));
        setValue({ sessions: snapshot.sessions, repos });
      })
      .catch(() => {
        // Without the snapshot, tools do not know linked chats or code folders.
      });
    return () => {
      disposed = true;
    };
  }, [api, group.repoIds, enabled]);
  return value;
}

function toolTitle(tool: PlanningTool, count: number) {
  switch (tool) {
    case 'fields':
      return `Edit fields of ${plural(count, 'task')}`;
    case 'iteration':
      return 'Plan an iteration';
    case 'readiness':
      return 'Check readiness';
    default:
      return `Start ${plural(count, 'chat')}`;
  }
}
function toolDescription(tool: PlanningTool) {
  switch (tool) {
    case 'fields':
      return 'Review each change before it goes to GitHub.';
    case 'iteration':
      return 'Kalkidan proposes the tasks that fit the capacity.';
    case 'readiness':
      return 'Shows which tasks can run at the same time.';
    default:
      return 'Each task gets its own branch copy and its own chat.';
  }
}

/**
 * One dialog for the planning tools. The tasks come from the board selection; the user can
 * remove tasks in the dialog. "Start wave" in the readiness check moves to "Run tasks in
 * parallel" with the tasks of that wave.
 */
export function PlanningToolDialog({
  tool,
  open,
  onOpenChange,
  api,
  group,
  board,
  selectedIds,
  allTasks = false,
  onOpenTask,
  onSaved,
}: {
  tool: PlanningTool;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: API;
  group: ProjectGroup;
  board: TrackerBoard;
  selectedIds: string[];
  /** True when no task was selected, so the tool acts on all visible tasks. */
  allTasks?: boolean;
  onOpenTask: (itemId: string) => void;
  /** Called after a write to GitHub. Without it, the dialog sends kalkidan-github-writes. */
  onSaved?: () => void;
}) {
  const [current, setCurrent] = useState(tool);
  const [ids, setIds] = useState(selectedIds);
  const [wave, setWave] = useState(false);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    if (!open) return;
    setCurrent(tool);
    setIds(selectedIds);
    setWave(false);
    setEpoch((value) => value + 1);
    // The selection is read when the dialog opens. Later board changes do not reset the tool.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tool]);
  const context = useProjectContext(api, group, open);
  const items = board.items.filter((item) => ids.includes(item.id));
  const props = {
    api,
    group,
    board,
    items,
    allTasks: allTasks && !wave,
    sessions: context.sessions,
    repos: context.repos,
    onRemove: (id: string) => setIds((values) => values.filter((value) => value !== id)),
    onOpenTask: (id: string) => {
      onOpenChange(false);
      onOpenTask(id);
    },
    onClose: () => onOpenChange(false),
    onSaved: () => {
      window.dispatchEvent(new CustomEvent(githubWritesEvent, { detail: { groupId: group.id } }));
      onSaved?.();
    },
  };
  const available: Record<PlanningTool, boolean> = {
    fields: typeof api.trackerBatch === 'function',
    iteration: typeof api.trackerBatch === 'function' && typeof api.trackerRelations === 'function',
    readiness:
      typeof api.trackerContent === 'function' && typeof api.trackerRelations === 'function',
    dispatch: typeof api.dispatchPrepare === 'function',
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        layout="scroll"
        onOpenAutoFocus={(event) => {
          // The first stop is the first real input, never a remove button or a link.
          const target = (event.currentTarget as HTMLElement).querySelector<HTMLElement>(
            '[data-slot="dialog-body"] :is(input:not([type="checkbox"]), textarea, ' +
              'button[role="combobox"], .segmented-item[aria-pressed="true"])',
          );
          if (target) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {toolTitle(
              current,
              current === 'dispatch'
                ? items.filter((item) => item.kind === 'Issue').length
                : items.length,
            )}
          </DialogTitle>
          <DialogDescription>{toolDescription(current)}</DialogDescription>
        </DialogHeader>
        {!available[current] ? (
          <div className="px-6 pb-6">
            <ErrorAlert>This tool needs the desktop app.</ErrorAlert>
          </div>
        ) : current === 'fields' ? (
          <FieldsTool key={epoch} {...props} />
        ) : current === 'iteration' ? (
          <IterationTool key={epoch} {...props} />
        ) : current === 'readiness' ? (
          <ReadinessTool
            key={epoch}
            {...props}
            onStartWave={
              available.dispatch
                ? (waveIds) => {
                    setIds(waveIds);
                    setWave(true);
                    setCurrent('dispatch');
                  }
                : undefined
            }
          />
        ) : (
          <DispatchTool key={`${epoch}:${wave}`} {...props} autoPrepare={wave} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The body of the Insights page of a project: health, readiness, GitHub changes, usage and
 * managed-agent services. Counts open the Tasks page with a filter.
 */
export function ProjectInsights({
  api,
  group,
  sessions: givenSessions,
  board: givenBoard,
  onOpenTask,
  onFilter,
  initialTaskId,
}: {
  api: API;
  group: ProjectGroup;
  /** The chats of the project. Without them, the page reads the chats itself. */
  sessions?: Session[];
  board?: TrackerBoard;
  /** Selects this task in the Usage section and scrolls the section into view. */
  initialTaskId?: string;
  onOpenTask: (itemId: string) => void;
  onFilter: (filter: TaskFilter) => void;
}) {
  const connection = trackerConnection(group);
  const [loaded, setLoaded] = useState<TrackerBoard>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<{ ids: string[] }>();
  const board = givenBoard || loaded;
  const context = useProjectContext(api, group, !!connection || !givenSessions);
  const projectSessions =
    givenSessions || context.sessions.filter((session) => !!sessionRepo(session, context.repos));
  const usage = <ProjectUsageInsights api={api} groupId={group.id} sessions={projectSessions} />;
  async function load(force = false) {
    if (!connection) return;
    setBusy(true);
    setError('');
    try {
      setLoaded(await api.trackerBoard(group.id, force));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!givenBoard) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id, !!givenBoard, !!connection]);
  const github = connection?.provider === 'github';
  return (
    <section className="project-insights" aria-label="Project insights">
      {connection && board && (
        <div className="flex items-center justify-between gap-2 pb-4">
          <p className="form-help m-0">
            {plural(board.items.length, 'task')} on {board.project.title}. Counts open the Tasks
            page with a filter.
          </p>
          {!givenBoard && (
            <Hint label="Load the board again">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Load the board again"
                disabled={busy}
                onClick={() => void load(true)}
              >
                <RefreshCw size={16} className={busy ? 'animate-spin' : undefined} />
              </Button>
            </Hint>
          )}
        </div>
      )}
      {!connection ? (
        <div className="project-insights-sections">
          {usage}
          <EmptyState
            compact
            icon={<BarChart3 />}
            title="Task insights"
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => openConnectBoard({ groupId: group.id })}
              >
                Connect board
              </Button>
            }
          >
            Health, readiness and GitHub changes use the tasks of a GitHub Projects board.
          </EmptyState>
        </div>
      ) : !board ? (
        error ? (
          <ErrorAlert>{error}</ErrorAlert>
        ) : (
          <EmptyState compact>Loading the board…</EmptyState>
        )
      ) : (
        <div className="project-insights-sections">
          <ErrorAlert>{error}</ErrorAlert>
          {github && typeof api.trackerResources === 'function' ? (
            <ProjectHealth api={api} groupId={group.id} board={board} onFilter={onFilter} />
          ) : null}
          {typeof api.trackerContent === 'function' && (
            <ReadinessOverview
              board={board}
              sessions={context.sessions}
              onFilter={onFilter}
              onCheck={(ids) => setTool({ ids })}
            />
          )}
          {github && typeof api.trackerMutationHistory === 'function' && (
            <GitHubWriteHistory
              api={api}
              groupId={group.id}
              board={board}
              onOpenTask={onOpenTask}
            />
          )}
          {typeof api.taskUsageHistory === 'function' && (
            <TaskUsageHistoryPanel
              api={api}
              groupId={group.id}
              board={board}
              initialTaskId={initialTaskId}
            />
          )}
          {typeof api.projectServicesStatus === 'function' && (
            <ProjectServicesPanel api={api} groupId={group.id} board={board} />
          )}
          {usage}
        </div>
      )}
      {board && (
        <PlanningToolDialog
          tool="readiness"
          open={!!tool}
          onOpenChange={(open) => !open && setTool(undefined)}
          api={api}
          group={group}
          board={board}
          selectedIds={tool?.ids || []}
          onOpenTask={onOpenTask}
        />
      )}
    </section>
  );
}
