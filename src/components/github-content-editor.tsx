import { GitHubCheckEvidenceView } from './github-check-evidence';
import { useEffect, useRef, useState } from 'react';
import type { API } from '../types';
import type { GitHubContentSnapshot, GitHubContentAction } from '../domain/github-content';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { errorMessage } from '../lib/errors';
export function GitHubContentEditor({
  api,
  groupId,
  itemId,
  onSaved,
}: {
  api: API;
  groupId: string;
  itemId: string;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<GitHubContentSnapshot>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [comment, setComment] = useState('');
  const [login, setLogin] = useState('');
  const [label, setLabel] = useState('');
  const [reviewEvent, setReviewEvent] = useState<'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'>(
    'COMMENT',
  );
  const epoch = useRef(0),
    pending = useRef(false);
  useEffect(() => {
    if (!open) return;
    const token = ++epoch.current;
    setBusy(true);
    setError('');
    void api
      .trackerContent(groupId, itemId)
      .then(
        (result) => {
          if (token === epoch.current) {
            setValue(result);
            setTitle(result.title);
            setBody(result.body);
          }
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
  }, [api, groupId, itemId, open, revision]);
  async function change(action: GitHubContentAction) {
    if (!value || busy || pending.current || error) return;
    pending.current = true;
    setBusy(true);
    const token = epoch.current;
    try {
      const result = await api.trackerContentChange(groupId, itemId, value.revision, action);
      if (token === epoch.current) {
        setValue(result);
        setComment('');
      }
      await onSaved();
    } catch (failure) {
      if (token === epoch.current) setError(errorMessage(failure));
    } finally {
      pending.current = false;
      if (token === epoch.current) setBusy(false);
    }
  }
  const disabled = busy || !!error;
  return (
    <section className="grid gap-3" aria-label="Issue and pull request content">
      <Button size="sm" variant="outline" onClick={() => setOpen(!open)}>
        {open ? 'Hide issue details' : 'Edit issue or pull request'}
      </Button>
      {open && (
        <>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setRevision((n) => n + 1)}
          >
            Reload content
          </Button>
          {error && <p role="alert">{error} Reload before another write.</p>}
          {busy && <p role="status">Loading content…</p>}
          {value && (
            <>
              <p>
                {value.state} {value.mergeable && `· ${value.mergeable}`}{' '}
                {value.reviewDecision && `· ${value.reviewDecision}`}
              </p>
              <GitHubCheckEvidenceView value={value} />
              <Input
                aria-label="Issue title"
                value={title}
                maxLength={256}
                disabled={disabled || !value.permissions.edit}
                onChange={(e) => setTitle(e.target.value)}
              />
              <Textarea
                aria-label="Issue description"
                value={body}
                maxLength={20000}
                disabled={disabled || !value.permissions.edit}
                onChange={(e) => setBody(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={disabled || !value.permissions.edit || !title.trim()}
                  onClick={() => void change({ kind: 'edit', title, body })}
                >
                  Save content
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    disabled ||
                    !(value.state === 'OPEN' ? value.permissions.close : value.permissions.reopen)
                  }
                  onClick={() => void change({ kind: value.state === 'OPEN' ? 'close' : 'reopen' })}
                >
                  {value.state === 'OPEN' ? 'Close' : 'Reopen'}{' '}
                  {value.kind === 'Issue' ? 'issue' : 'pull request'}
                </Button>
              </div>
              <p>Assignees: {value.assignees.map((user) => user.login).join(', ') || 'None'}</p>
              <div className="flex gap-2">
                <Input
                  aria-label="Assignee login"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  disabled={disabled || !value.permissions.assign}
                />
                {(['assign', 'unassign'] as const).map((kind) => (
                  <Button
                    key={kind}
                    size="sm"
                    variant="outline"
                    disabled={disabled || !value.permissions.assign || !login}
                    onClick={() => void change({ kind, login })}
                  >
                    {kind === 'assign' ? 'Assign' : 'Unassign'}
                  </Button>
                ))}
              </div>
              <p>Labels: {value.labels.map((item) => item.name).join(', ') || 'None'}</p>
              <div className="flex gap-2">
                <Input
                  aria-label="Repository label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  disabled={disabled || !value.permissions.label}
                />
                {(['label', 'unlabel'] as const).map((kind) => (
                  <Button
                    key={kind}
                    size="sm"
                    variant="outline"
                    disabled={disabled || !value.permissions.label || !label}
                    onClick={() => void change({ kind, name: label })}
                  >
                    {kind === 'label' ? 'Add label' : 'Remove label'}
                  </Button>
                ))}
              </div>
              <label className="form-label">
                Milestone
                <select
                  aria-label="Issue milestone"
                  value={value.milestone?.id || ''}
                  disabled={disabled || !value.canSetMilestone}
                  onChange={(event) =>
                    void change({ kind: 'milestone', id: event.target.value || null })
                  }
                >
                  <option value="">No milestone</option>
                  {value.milestones?.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.title}
                    </option>
                  ))}
                </select>
              </label>
              {value.kind === 'Issue' && (
                <label className="form-label">
                  Issue type
                  <select
                    aria-label="Issue type"
                    value={value.issueType?.id || ''}
                    disabled={disabled || !value.canSetType}
                    onChange={(event) =>
                      void change({ kind: 'issue-type', id: event.target.value || null })
                    }
                  >
                    <option value="">No type</option>
                    {value.issueTypes?.map((choice) => (
                      <option key={choice.id} value={choice.id}>
                        {choice.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {value.kind === 'PullRequest' && (
                <>
                  <p>
                    Checks: {value.checks || 'No checks reported'} · Commit:{' '}
                    {value.headOid?.slice(0, 12)}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      disabled || !value.permissions.edit || value.state !== 'OPEN' || !login.trim()
                    }
                    onClick={() => void change({ kind: 'request-review', login })}
                  >
                    Request review from entered user
                  </Button>
                  <label className="form-label">
                    Review decision
                    <select
                      value={reviewEvent}
                      onChange={(event) => setReviewEvent(event.target.value as typeof reviewEvent)}
                      disabled={disabled || value.state !== 'OPEN'}
                    >
                      <option value="COMMENT">Comment</option>
                      <option value="APPROVE" disabled={value.viewerDidAuthor}>
                        Approve
                      </option>
                      <option value="REQUEST_CHANGES" disabled={value.viewerDidAuthor}>
                        Request changes
                      </option>
                    </select>
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      disabled ||
                      value.state !== 'OPEN' ||
                      !value.headOid ||
                      (reviewEvent !== 'APPROVE' && !comment.trim())
                    }
                    onClick={() =>
                      void change({
                        kind: 'review',
                        event: reviewEvent,
                        body: comment,
                        headOid: value.headOid!,
                      })
                    }
                  >
                    Submit review with comment below
                  </Button>
                </>
              )}
              <h4>Comments ({value.comments.length})</h4>
              {value.comments.map((row) => (
                <article key={row.id} className="border-l pl-3">
                  <a href={row.url} target="_blank" rel="noreferrer">
                    {row.author?.login || 'Deleted user'}
                  </a>
                  <p className="whitespace-pre-wrap text-sm">{row.body}</p>
                </article>
              ))}
              {value.reviews?.map((row) => (
                <article key={row.id}>
                  <p>
                    {row.author?.login} · {row.state}
                  </p>
                  <p className="whitespace-pre-wrap text-sm">{row.body}</p>
                </article>
              ))}
              <Textarea
                aria-label="New comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={20000}
                disabled={disabled}
              />
              <Button
                size="sm"
                disabled={disabled || !comment.trim()}
                onClick={() => void change({ kind: 'comment', body: comment })}
              >
                Post comment
              </Button>
            </>
          )}
        </>
      )}
    </section>
  );
}
