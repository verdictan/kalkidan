// Planning tools for a project: the tool dialog for selected tasks (⌘K), the docs-to-tasks
// dialog and the portfolio for the Projects overview.
import { useEffect, useState } from 'react';
import type { API, Project, ProjectGroup, Session, TrackerBoard } from '../types';
import { plural } from '../domain/planning-labels';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { FieldsTool } from './project-batch';
import { IterationTool } from './iteration-planner';
import { ReadinessTool } from './project-readiness';
import { DispatchTool } from './parallel-dispatch';
import { ErrorAlert, githubWritesEvent } from './planning-kit';

export { DocsToIssuesDialog } from './docs-to-issues';
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
