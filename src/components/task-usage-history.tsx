import { useState } from 'react';
import type { API, TrackerBoard } from '../types';
import type { TaskUsageHistory } from '../domain/conversation';
import { Button } from './ui/button';
import { errorMessage } from '../lib/errors';
export function TaskUsageHistoryPanel({
  api,
  groupId,
  board,
}: {
  api: API;
  groupId: string;
  board: TrackerBoard;
}) {
  const [open, setOpen] = useState(false);
  const [task, setTask] = useState(''),
    [history, setHistory] = useState<TaskUsageHistory[]>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <details className="border-t py-3" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Task usage and policy history</summary>
      {open && (
        <div className="grid gap-3 py-3">
          <label>
            Task{' '}
            <select
              aria-label="History task"
              value={task}
              disabled={busy}
              onChange={(event) => {
                setTask(event.target.value);
                setHistory(undefined);
              }}
            >
              <option value="">Select a task</option>
              {board.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <Button
            disabled={!task || busy}
            onClick={() => {
              setBusy(true);
              setError('');
              void api
                .taskUsageHistory(groupId, task)
                .then(setHistory)
                .catch((failure) => setError(errorMessage(failure)))
                .finally(() => setBusy(false));
            }}
          >
            Load saved evidence
          </Button>
          <p className="help-text">
            Saved observations from this desktop. Up to 20 revisions per run and 100 recent runs.
            Missing usage is unknown. This view is not a complete billing ledger.
          </p>
          {history?.map((run, runIndex) => (
            <article key={run.runId} className="grid gap-2 border-t py-3">
              <strong>
                Run {runIndex + 1} · {run.phase} · {run.hostId ? 'SSH host' : 'This machine'}
              </strong>
              {!run.evidence.length && <p>No governance evidence was captured.</p>}
              {run.evidence.map((snapshot, index) => (
                <details key={index} open={index === run.evidence.length - 1}>
                  <summary>
                    {new Date(snapshot.observedAt).toLocaleString()} · {snapshot.value.status}
                    {snapshot.value.finalized ? ' · Finalized' : ''}
                  </summary>
                  {snapshot.value.requests.map((request, requestIndex) => (
                    <div key={request.id} className="py-2">
                      <p>Request {requestIndex + 1}</p>
                      <p>
                        Policy: {request.policy ?? 'Unknown'} · usage: {request.usage ?? 'Unknown'}
                      </p>
                      <p>
                        Cost:{' '}
                        {request.billing === 'subscription'
                          ? 'Paid by your subscription. Provider charge is not known.'
                          : `${request.actualCost ?? 'Unknown'} ${request.currency ?? ''}`}{' '}
                        · tokens: {request.tokens ?? 'Unknown'}
                      </p>
                      <p>Audit: {request.audit ?? 'Unknown'}</p>
                    </div>
                  ))}
                </details>
              ))}
            </article>
          ))}
          {history?.length === 0 && <p>No saved runs for this task and account.</p>}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </details>
  );
}
