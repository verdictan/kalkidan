import { useEffect, useRef, useState } from 'react';
import type { API } from '../types';
import type { IssueRelations, IssueRelationAction } from '../domain/github-relations';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { errorMessage } from '../lib/errors';
export function GitHubIssueRelations({
  api,
  groupId,
  itemId,
}: {
  api: API;
  groupId: string;
  itemId: string;
}) {
  const [value, setValue] = useState<IssueRelations>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [url, setURL] = useState('');
  const [revision, setRevision] = useState(0);
  const epoch = useRef(0);
  const pending = useRef(false);
  useEffect(() => {
    const token = ++epoch.current;
    setValue(undefined);
    setBusy(true);
    setError('');
    void api
      .trackerRelations(groupId, itemId)
      .then(
        (result) => {
          if (token === epoch.current) setValue(result);
        },
        (failure) => {
          if (token === epoch.current) setError(errorMessage(failure));
        },
      )
      .finally(() => {
        if (token === epoch.current) setBusy(false);
      });
    return () => {
      epoch.current++;
    };
  }, [api, groupId, itemId, revision]);
  async function change(action: IssueRelationAction) {
    if (!value || busy || pending.current || error) return;
    pending.current = true;
    setBusy(true);
    const token = epoch.current;
    try {
      const result = await api.trackerRelationChange(groupId, itemId, value.revision, action);
      if (token === epoch.current) {
        setValue(result);
        setURL('');
      }
    } catch (failure) {
      if (token === epoch.current) setError(errorMessage(failure));
    } finally {
      pending.current = false;
      if (token === epoch.current) setBusy(false);
    }
  }
  const disabled = busy || !!error || !value?.writable;
  return (
    <section aria-label="Issue relationships" className="grid gap-3 border-t pt-3">
      <div className="flex justify-between">
        <h3>Issue relationships</h3>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRevision((n) => n + 1)}>
          Reload relationships
        </Button>
      </div>
      {error && <p role="alert">{error} Reload before another change.</p>}
      {busy && <p role="status">Loading relationships…</p>}
      {value?.parent && (
        <p>
          Parent:{' '}
          <a href={value.parent.url} target="_blank" rel="noreferrer">
            {value.parent.title}
          </a>
        </p>
      )}
      {value &&
        (['subIssues', 'blockedBy', 'blocking'] as const).map((kind) => (
          <div key={kind} className="grid gap-2">
            <h4>
              {{ subIssues: 'Child issues', blockedBy: 'Blocked by', blocking: 'Blocking' }[kind]} (
              {value[kind].length})
            </h4>
            {value[kind].map((issue, index) => (
              <div className="flex items-center gap-2" key={issue.id}>
                <a className="grow" href={issue.url} target="_blank" rel="noreferrer">
                  {issue.title} · {issue.state.toLowerCase()}
                </a>
                {kind === 'subIssues' && index > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() =>
                      void change({
                        kind: 'move-child',
                        id: issue.id,
                        beforeId: value.subIssues[index - 1].id,
                      })
                    }
                  >
                    Move up
                  </Button>
                )}
                {kind !== 'blocking' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() =>
                      void change({
                        kind: kind === 'subIssues' ? 'remove-child' : 'remove-blocker',
                        id: issue.id,
                      })
                    }
                  >
                    Unlink
                  </Button>
                )}
              </div>
            ))}
          </div>
        ))}
      <Input
        aria-label="Related issue URL"
        placeholder="https://github.com/owner/repository/issues/123"
        value={url}
        onChange={(event) => setURL(event.target.value)}
        disabled={disabled}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !url}
          onClick={() => void change({ kind: 'add-child', url })}
        >
          Add child issue
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !url}
          onClick={() => void change({ kind: 'add-blocker', url })}
        >
          Add blocker
        </Button>
      </div>
    </section>
  );
}
