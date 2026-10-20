import { useEffect, useRef, useState } from 'react';
import type { API, TrackerBoard, Session } from '../types';
import type { GitHubContentSnapshot } from '../domain/github-content';
import type { IssueRelations } from '../domain/github-relations';
import { Button } from './ui/button';
import { GitHubCheckEvidenceView } from './github-check-evidence';
import { errorMessage } from '../lib/errors';
export function ProjectReadiness({
  api,
  groupId,
  board,
  sessions,
  onOpen,
}: {
  api: API;
  groupId: string;
  board: TrackerBoard;
  sessions: Session[];
  onOpen: (id: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [limit, setLimit] = useState(2),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [checkedAt, setCheckedAt] = useState<number>();
  const [rows, setRows] = useState<
    {
      id: string;
      title: string;
      repository?: string;
      ready: string[];
      release: string[];
      content?: GitHubContentSnapshot;
    }[]
  >([]);
  const generation = useRef(0),
    pending = useRef(false);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  async function inspect() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setRows([]);
    const token = ++generation.current;
    try {
      const fresh = await api.trackerBoard(groupId, true),
        queue = [...selected],
        results: typeof rows = [];
      await Promise.all(
        Array.from({ length: Math.min(3, queue.length) }, async () => {
          while (queue.length && token === generation.current) {
            const id = queue.shift()!,
              item = fresh.items.find((item) => item.id === id);
            const ready: string[] = [],
              release: string[] = [];
            let content: GitHubContentSnapshot | undefined, relations: IssueRelations | undefined;
            if (!item) {
              results.push({
                id,
                title: id,
                ready: ['Task removed or archived.'],
                release: ['No current task evidence.'],
              });
              continue;
            }
            try {
              content = await api.trackerContent(groupId, id);
              if (item.kind === 'Issue') relations = await api.trackerRelations(groupId, id);
              if (item.kind !== 'Issue' || content.state !== 'OPEN')
                ready.push('Select an open issue for agent work.');
              if (!item.repository) ready.push('No repository is linked.');
              if (!item.body.trim()) ready.push('Add a description and acceptance criteria.');
              if (relations?.blockedBy.some((issue) => issue.state !== 'CLOSED'))
                ready.push('Open or unknown blockers remain.');
              if (
                sessions.some(
                  (session) =>
                    !session.organization?.archived && session.organization?.taskId === id,
                )
              )
                ready.push('A linked session exists. Review overlapping work.');
              if (content.kind === 'Issue' && content.state !== 'CLOSED')
                release.push('Issue remains open.');
              if (relations?.blockedBy.some((issue) => issue.state !== 'CLOSED'))
                release.push('Unresolved dependencies remain.');
              const prs =
                content.kind === 'PullRequest'
                  ? [
                      {
                        merged: content.state === 'MERGED',
                        checks: content.checks,
                        checkEvidence: content.checkEvidence,
                      },
                    ]
                  : content.linkedPullRequests || [];
              if (!prs.length) release.push('No closing pull request evidence.');
              if (prs.some((pr) => !pr.merged)) release.push('A pull request is not merged.');
              if (
                prs.some(
                  (pr) =>
                    pr.checks !== 'SUCCESS' ||
                    !pr.checkEvidence?.length ||
                    pr.checkEvidence.some((check) => check.state !== 'SUCCESS'),
                )
              )
                release.push('Successful build/check evidence is incomplete.');
            } catch (failure) {
              const message = errorMessage(failure);
              ready.push(message);
              release.push('Evidence could not be verified.');
            }
            results.push({
              id,
              title: item.title,
              repository: item.repository,
              ready,
              release,
              content,
            });
          }
        }),
      );
      if (token === generation.current) {
        setRows(results.sort((a, b) => selected.indexOf(a.id) - selected.indexOf(b.id)));
        setCheckedAt(Date.now());
      }
    } catch (failure) {
      if (token === generation.current) setError(errorMessage(failure));
    } finally {
      pending.current = false;
      if (token === generation.current) setBusy(false);
    }
  }
  const ready = rows.filter((row) => !row.ready.length);
  return (
    <details className="border-t py-3" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Agent and release readiness</summary>
      {open && (
        <div className="grid gap-3 py-3">
          <p className="help-text">
            Review up to 20 tasks. Independent issues are proposed in bounded waves. Start each from
            its inspector with a separate worktree. A snapshot is not an exclusive task lock.
            Jenkins and other check results are shown only when GitHub reports them.
          </p>
          <label className="form-label">
            Maximum parallel agents
            <select
              aria-label="Maximum parallel agents"
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
            >
              {[1, 2, 3, 4].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <div className="grid max-h-64 gap-2 overflow-auto">
            {board.items.map((item) => (
              <label key={item.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(item.id)}
                  disabled={busy || (!selected.includes(item.id) && selected.length >= 20)}
                  onChange={(event) => {
                    setRows([]);
                    setSelected(
                      event.target.checked
                        ? [...selected, item.id]
                        : selected.filter((id) => id !== item.id),
                    );
                  }}
                />
                {item.title}
              </label>
            ))}
          </div>
          <Button disabled={busy || !selected.length} onClick={() => void inspect()}>
            {busy ? 'Checking evidence…' : 'Inspect selected tasks'}
          </Button>
          {checkedAt && rows.length > 0 && (
            <p className="help-text">
              Snapshot: {new Date(checkedAt).toLocaleString()}. Refresh before starting work or
              releasing.
            </p>
          )}
          {ready.length > 0 && (
            <div className="grid gap-2">
              <h4>Proposed independent work</h4>
              {ready.map((row, index) => (
                <p key={row.id}>
                  Wave {Math.floor(index / limit) + 1}: {row.repository} · {row.title} · separate
                  worktree
                </p>
              ))}
            </div>
          )}
          {rows.map((row) => (
            <article key={row.id} className="grid gap-2 border-t pt-3">
              <Button variant="bare" className="justify-start" onClick={() => onOpen(row.id)}>
                {row.title}
              </Button>
              <p>Agent readiness: {row.ready.join(' ') || 'No blockers found in this snapshot.'}</p>
              <p>
                Release evidence:{' '}
                {row.release.join(' ') ||
                  'Closed work and merged changes have successful reported checks. Review external release requirements.'}
              </p>
              {row.content && <GitHubCheckEvidenceView value={row.content} />}
            </article>
          ))}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </details>
  );
}
