import { useEffect, useRef, useState } from 'react';
import type { Session, TrackerBoard } from '../types';
import type { GitHubContentSnapshot } from '../domain/github-content';
import type { IssueRelations } from '../domain/github-relations';
import {
  localReadiness,
  readinessRow,
  readinessWaves,
  type ReadinessBlocker,
  type ReadinessRow,
} from '../domain/project-readiness';
import { plural } from '../domain/planning-labels';
import { Button } from './ui/button';
import { DialogBody, DialogFooter } from './ui/dialog';
import { SectionHeader } from './ui/page-header';
import { SegmentedControl } from './ui/segmented-control';
import { GitHubCheckEvidenceView } from './github-check-evidence';
import { repoForTask } from './parallel-dispatch';
import {
  ErrorAlert,
  newChat,
  openChat,
  ReviewRow,
  SelectedTasks,
  StatusBadge,
  TaskTitle,
  ToolSection,
  type PlanningToolProps,
} from './planning-kit';
import { errorMessage } from '../lib/errors';
import { fullTime } from '../lib/relative-time';

export const readinessLimit = 20;

// The last check of each project stays while the app runs, so that a dialog that closes to
// open a task shows the same results when it opens again.
const lastCheck = new Map<string, { rows: ReadinessRow[]; checkedAt: number; ids: string }>();

/** The action for a blocker: one button that fixes it or shows where to fix it. */
function blockerAction(blocker: ReadinessBlocker) {
  switch (blocker.code) {
    case 'no-description':
      return 'Edit description';
    case 'no-repository':
      return 'Set repository';
    case 'linked-chat':
      return 'Open chat';
    case 'blocked':
      return 'Show blockers';
    case 'not-open-issue':
      return 'Open task';
    default:
      return undefined;
  }
}

/**
 * Check readiness: shows which selected tasks can run now, in waves, and what blocks the others.
 * Each wave starts with one button. Each task in a wave runs in its own branch copy.
 */
export function ReadinessTool({
  api,
  group,
  board,
  items,
  onRemove,
  onOpenTask,
  onClose,
  sessions,
  repos,
  onStartWave,
}: PlanningToolProps & { onStartWave?: (itemIds: string[]) => void }) {
  const ids = items.map((item) => item.id).join(',');
  const saved = lastCheck.get(group.id);
  const [limit, setLimit] = useState(2),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirm, setConfirm] = useState<number>(),
    [checkedAt, setCheckedAt] = useState(saved?.ids === ids ? saved.checkedAt : undefined);
  const [rows, setRows] = useState<ReadinessRow[]>(saved?.ids === ids ? saved.rows : []);
  const generation = useRef(0),
    pending = useRef(false);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const tooMany = items.length > readinessLimit;
  async function check() {
    if (pending.current || tooMany) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setConfirm(undefined);
    const token = ++generation.current;
    const selected = items.map((item) => item.id);
    try {
      const fresh = await api.trackerBoard(group.id, true),
        queue = [...selected],
        results: ReadinessRow[] = [];
      await Promise.all(
        Array.from({ length: Math.min(3, queue.length) }, async () => {
          while (queue.length && token === generation.current) {
            const id = queue.shift()!,
              item = fresh.items.find((item) => item.id === id);
            let evidence:
              { content: GitHubContentSnapshot; relations?: IssueRelations } | { error: string } = {
              error: '',
            };
            if (item)
              try {
                const content = await api.trackerContent(group.id, id);
                const relations =
                  item.kind === 'Issue' ? await api.trackerRelations(group.id, id) : undefined;
                evidence = { content, relations };
              } catch (failure) {
                evidence = { error: errorMessage(failure) };
              }
            results.push(readinessRow(item, id, sessions, evidence));
          }
        }),
      );
      if (token === generation.current) {
        const sorted = results.sort((a, b) => selected.indexOf(a.id) - selected.indexOf(b.id));
        const at = Date.now();
        setRows(sorted);
        setCheckedAt(at);
        lastCheck.set(group.id, { rows: sorted, checkedAt: at, ids: selected.join(',') });
      }
    } catch (failure) {
      if (token === generation.current) setError(errorMessage(failure));
    } finally {
      pending.current = false;
      if (token === generation.current) setBusy(false);
    }
  }
  function act(row: ReadinessRow, blocker: ReadinessBlocker) {
    if (blocker.code === 'linked-chat' && blocker.session) {
      onClose();
      openChat(blocker.session.agent, blocker.session.id);
    } else onOpenTask(row.id);
  }
  function startWave(wave: ReadinessRow[]) {
    if (onStartWave) {
      onStartWave(wave.map((row) => row.id));
      return;
    }
    // Without the parallel run service, each task starts as a new chat in its code folder.
    for (const row of wave) {
      const item = board.items.find((item) => item.id === row.id);
      newChat({
        groupId: group.id,
        repoId: item ? repoForTask(item, repos)?.id : undefined,
        taskId: row.id,
        prompt: item ? `Work on this task: ${item.title}${item.url ? `\n${item.url}` : ''}` : '',
      });
    }
    onClose();
  }
  const waves = readinessWaves(rows, limit);
  const blocked = rows.filter((row) => row.blockers.length);
  return (
    <>
      <DialogBody className="grid content-start gap-4">
        <SelectedTasks
          items={items}
          onRemove={(id) => {
            setRows([]);
            onRemove(id);
          }}
          limit={readinessLimit}
        />
        <div className="form-label">
          <span>Chats at the same time</span>
          <SegmentedControl
            label="Chats at the same time"
            className="w-fit"
            value={String(limit)}
            onChange={(value) => {
              setLimit(Number(value));
              setConfirm(undefined);
            }}
            options={['1', '2', '3', '4'].map((value) => ({ value, label: value }))}
          />
        </div>
        {checkedAt && rows.length > 0 && (
          <p className="form-help">
            Checked {fullTime(new Date(checkedAt).toISOString())}. Check again before you start work
            or release.
          </p>
        )}
        {waves.map((wave, index) => (
          <section key={index} className="grid gap-1" aria-label={`Wave ${index + 1}`}>
            <SectionHeader
              size="sm"
              as="h4"
              title={`Wave ${index + 1}`}
              count={wave.length}
              actions={
                <Button
                  size="sm"
                  variant={index === 0 ? 'default' : 'outline'}
                  disabled={busy}
                  onClick={() => (onStartWave ? startWave(wave) : setConfirm(index))}
                >
                  Start wave ({plural(wave.length, 'agent')})
                </Button>
              }
            />
            {confirm === index && (
              <div className="panel grid gap-2 text-sm">
                <p>
                  Start {plural(wave.length, 'chat')}? Each task opens in a new chat in its code
                  folder.
                </p>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => setConfirm(undefined)}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={() => startWave(wave)}>
                    Start {plural(wave.length, 'chat')}
                  </Button>
                </div>
              </div>
            )}
            <div className="review-list">
              {wave.map((row) => (
                <ReviewRow
                  key={row.id}
                  title={<TaskTitle title={row.title} onOpen={() => onOpenTask(row.id)} />}
                  meta={`${row.repository || 'No repository'} · Own branch copy`}
                  status={{ label: 'Ready', tone: 'success' }}
                >
                  <ReleaseEvidence row={row} />
                </ReviewRow>
              ))}
            </div>
          </section>
        ))}
        {blocked.length > 0 && (
          <section className="grid gap-1" aria-label="Tasks that need work">
            <SectionHeader size="sm" as="h4" title="Needs work" count={blocked.length} />
            <div className="review-list">
              {blocked.map((row) => (
                <ReviewRow
                  key={row.id}
                  title={<TaskTitle title={row.title} onOpen={() => onOpenTask(row.id)} />}
                  meta={row.repository || 'No repository'}
                  status={{ label: 'Not ready', tone: 'warning' }}
                >
                  <ul className="grid gap-1 pt-1">
                    {row.blockers.map((blocker) => {
                      const action = blockerAction(blocker);
                      return (
                        <li
                          key={blocker.code + blocker.message}
                          className="flex flex-wrap items-center justify-between gap-2 text-xs leading-4"
                        >
                          <span className="min-w-0">{blocker.message}</span>
                          {action && (
                            <Button size="xs" variant="outline" onClick={() => act(row, blocker)}>
                              {action}
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <ReleaseEvidence row={row} />
                </ReviewRow>
              ))}
            </div>
          </section>
        )}
        <ErrorAlert>{error}</ErrorAlert>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button
          variant={rows.length ? 'outline' : 'default'}
          disabled={busy || !items.length || tooMany}
          onClick={() => void check()}
        >
          {busy ? 'Checking…' : rows.length ? 'Check again' : 'Check readiness'}
        </Button>
      </DialogFooter>
    </>
  );
}

function ReleaseEvidence({ row }: { row: ReadinessRow }) {
  return (
    <ToolSection
      title="Release evidence"
      aside={
        <StatusBadge
          value={
            row.release.length
              ? { label: 'Not ready to release', tone: 'muted' }
              : { label: 'Ready to release', tone: 'success' }
          }
        />
      }
    >
      <p className="text-xs leading-4 text-muted-foreground">
        {row.release.join(' ') ||
          'The work is closed, the changes are merged and all reported checks passed. Check other release steps outside GitHub.'}
      </p>
      {row.content && <GitHubCheckEvidenceView value={row.content} />}
    </ToolSection>
  );
}

/**
 * A readiness summary for the Insights page. It uses the board only, with no GitHub request.
 * "Check readiness" opens the full check for the tasks that can start.
 */
export function ReadinessOverview({
  board,
  sessions,
  onFilter,
  onCheck,
}: {
  board: TrackerBoard;
  sessions: Session[];
  onFilter: (filter: { repository?: string; query?: string }) => void;
  onCheck: (itemIds: string[]) => void;
}) {
  const value = localReadiness(board, sessions);
  const check = (items: { id: string }[]) => () =>
    onCheck(items.slice(0, readinessLimit).map((item) => item.id));
  const rows = [
    { label: 'Issues that can start', items: value.candidates, action: 'Check' },
    { label: 'Issues with no description', items: value.noDescription, action: 'Review' },
    { label: 'Issues with a chat', items: value.linked, action: 'Review' },
  ].map((row) => ({
    label: row.label,
    count: row.items.length,
    action: row.action,
    run: check(row.items),
  }));
  rows.push({
    label: 'Tasks with no repository',
    count: value.noRepository.length,
    action: 'Show',
    run: () => onFilter({ repository: 'draft' }),
  });
  return (
    <section aria-labelledby="readiness-title">
      <SectionHeader title={<span id="readiness-title">Readiness</span>} />
      <p className="form-help">
        Kalkidan counts what the board shows. "Check" and "Review" also read blockers, pull requests
        and checks on GitHub.
      </p>
      <ul className="count-list">
        {rows.map((row) => (
          <li key={row.label} className="count-item">
            <span className="count-item-label">{row.label}</span>
            <span className="count-item-value">{row.count}</span>
            {row.count > 0 && (
              <Button size="xs" variant="link" onClick={row.run}>
                {row.action}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
