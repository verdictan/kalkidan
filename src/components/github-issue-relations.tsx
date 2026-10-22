import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, ExternalLink, RefreshCw, X } from 'lucide-react';
import type { API, TrackerBoard, TrackerItem } from '../types';
import type { IssueRelations, IssueRelationAction, RelatedIssue } from '../domain/github-relations';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { SectionHeader } from './ui/page-header';
import { Alert, AlertDescription } from './ui/alert';
import { showToast } from './ui/toast';
import { Hint } from './hint';
import { Choice } from './choice';
import { errorMessage } from '../lib/errors';
import { itemStateLabel, itemStateTone } from '../lib/github-labels';

type Group = 'parent' | 'subIssues' | 'blockedBy' | 'blocking';
const groups: { key: Group; title: string }[] = [
  { key: 'parent', title: 'Parent issue' },
  { key: 'subIssues', title: 'Child issues' },
  { key: 'blockedBy', title: 'Blocked by' },
  { key: 'blocking', title: 'Blocking' },
];
const URL_CHOICE = '__url';
const sameUrl = (a?: string, b?: string) =>
  !!a && !!b && a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase();

/** Opens a task of the project board in Kalkidan. */
export function openTask(groupId: string, itemId: string) {
  window.dispatchEvent(new CustomEvent('kalkidan-open-task', { detail: { groupId, itemId } }));
}

export function GitHubIssueRelations({
  api,
  groupId,
  itemId,
  board,
}: {
  api: API;
  groupId: string;
  itemId: string;
  /** The board tasks. A related issue on the board opens in Kalkidan, not on GitHub. */
  board?: TrackerBoard;
}) {
  const [value, setValue] = useState<IssueRelations>();
  const [loadError, setLoadError] = useState('');
  const [writeError, setWriteError] = useState('');
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<'add-blocker' | 'add-child'>('add-blocker');
  const [choice, setChoice] = useState('');
  const [url, setURL] = useState('');
  const [revision, setRevision] = useState(0);
  const epoch = useRef(0);
  const pending = useRef(false);
  useEffect(() => {
    const token = ++epoch.current;
    setBusy(true);
    setLoadError('');
    void api
      .trackerRelations(groupId, itemId)
      .then(
        (result) => {
          if (token === epoch.current) setValue(result);
        },
        (failure) => {
          if (token === epoch.current) setLoadError(errorMessage(failure));
        },
      )
      .finally(() => {
        if (token === epoch.current) setBusy(false);
      });
    return () => {
      epoch.current++;
    };
  }, [api, groupId, itemId, revision]);
  const tasks = board?.items || [];
  const taskFor = (issue: RelatedIssue) => tasks.find((task) => sameUrl(task.url, issue.url));
  async function change(action: IssueRelationAction, done: string) {
    if (!value || busy || pending.current || loadError) return;
    pending.current = true;
    setBusy(true);
    setWriteError('');
    const token = epoch.current;
    try {
      const result = await api.trackerRelationChange(groupId, itemId, value.revision, action);
      if (token === epoch.current) {
        setValue(result);
        setURL('');
        setChoice('');
        showToast(done);
      }
    } catch (failure) {
      if (token === epoch.current) {
        setWriteError(
          `${errorMessage(failure).replace(/\.?$/, '.')} Kalkidan loaded the relationships again.`,
        );
        setRevision((n) => n + 1);
      }
    } finally {
      pending.current = false;
      if (token === epoch.current) setBusy(false);
    }
  }
  const disabled = busy || !!loadError || !value?.writable;
  const related = new Set(
    value
      ? [value.parent, ...value.subIssues, ...value.blockedBy, ...value.blocking]
          .filter((issue): issue is RelatedIssue => !!issue)
          .map((issue) => issue.url.toLowerCase())
      : [],
  );
  const candidates = tasks.filter(
    (task) =>
      task.id !== itemId &&
      task.kind === 'Issue' &&
      !!task.url &&
      !related.has(task.url.toLowerCase()),
  );
  const target = choice === URL_CHOICE ? url.trim() : candidates.find((t) => t.id === choice)?.url;
  const rows = (key: Group) =>
    !value ? [] : key === 'parent' ? (value.parent ? [value.parent] : []) : value[key];
  const empty = value && groups.every((group) => !rows(group.key).length);
  return (
    <section aria-label="Issue relationships" className="grid gap-3" aria-busy={busy}>
      <SectionHeader
        size="sm"
        className="mb-0"
        title="Relationships"
        actions={
          <Hint label="Reload relationships">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Reload relationships"
              disabled={busy}
              onClick={() => setRevision((n) => n + 1)}
            >
              <RefreshCw className={busy ? 'animate-spin' : ''} />
            </Button>
          </Hint>
        }
      />
      {loadError && (
        <Alert variant="destructive" size="sm">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}
      {writeError && (
        <Alert variant="destructive" size="sm">
          <AlertDescription>{writeError}</AlertDescription>
        </Alert>
      )}
      {!value && !loadError && (
        <p role="status" className="m-0 text-sm text-muted-foreground">
          Loading relationships…
        </p>
      )}
      {empty && (
        <p className="form-help m-0">This issue has no parent, child issues or blockers.</p>
      )}
      {groups.map(({ key, title }) => {
        const list = rows(key);
        if (!list.length) return null;
        return (
          <div key={key} className="grid gap-1">
            <SectionHeader size="sm" as="h4" className="mb-0" title={title} count={list.length} />
            <ul className="m-0 grid list-none gap-0.5 p-0">
              {list.map((issue, index) => (
                <RelationRow
                  key={issue.id}
                  issue={issue}
                  task={taskFor(issue)}
                  onOpen={(task) => openTask(groupId, task.id)}
                  actions={
                    <>
                      {key === 'subIssues' && index > 0 && (
                        <Hint label="Move up">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Move ${issue.title} up`}
                            disabled={disabled}
                            onClick={() =>
                              void change(
                                {
                                  kind: 'move-child',
                                  id: issue.id,
                                  beforeId: value!.subIssues[index - 1].id,
                                },
                                'Child issue moved.',
                              )
                            }
                          >
                            <ArrowUp />
                          </Button>
                        </Hint>
                      )}
                      {(key === 'subIssues' || key === 'blockedBy') && (
                        <Hint label="Unlink">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Unlink ${issue.title}`}
                            disabled={disabled}
                            onClick={() =>
                              void change(
                                {
                                  kind: key === 'subIssues' ? 'remove-child' : 'remove-blocker',
                                  id: issue.id,
                                },
                                key === 'subIssues' ? 'Child issue unlinked.' : 'Blocker removed.',
                              )
                            }
                          >
                            <X />
                          </Button>
                        </Hint>
                      )}
                    </>
                  }
                />
              ))}
            </ul>
          </div>
        );
      })}
      {value?.writable && (
        <form
          aria-label="Add a relationship"
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (target)
              void change(
                { kind, url: target },
                kind === 'add-blocker' ? 'Blocker added.' : 'Child issue added.',
              );
          }}
        >
          <span className="form-label">Add a relationship</span>
          <div className="grid grid-cols-[9rem_minmax(0,1fr)_auto] gap-2">
            <Choice
              className="w-full"
              label="Relationship"
              value={kind}
              disabled={disabled}
              onChange={(next) => setKind(next as typeof kind)}
              options={[
                { value: 'add-blocker', label: 'Blocked by' },
                { value: 'add-child', label: 'Child issue' },
              ]}
            />
            <Choice
              className="w-full"
              label="Related issue"
              value={choice}
              disabled={disabled}
              onChange={setChoice}
              options={[
                ...candidates.map((task) => ({
                  value: task.id,
                  label: task.number ? `#${task.number} ${task.title}` : task.title,
                })),
                { value: URL_CHOICE, label: 'Other issue (paste a URL)…' },
              ]}
            />
            <Button type="submit" variant="outline" disabled={disabled || !target}>
              Add
            </Button>
          </div>
          {choice === URL_CHOICE && (
            <Input
              aria-label="Related issue URL"
              placeholder="https://github.com/owner/repository/issues/123"
              value={url}
              autoFocus
              onChange={(event) => setURL(event.target.value)}
              disabled={disabled}
            />
          )}
        </form>
      )}
    </section>
  );
}

function RelationRow({
  issue,
  task,
  onOpen,
  actions,
}: {
  issue: RelatedIssue;
  task?: TrackerItem;
  onOpen(task: TrackerItem): void;
  actions?: ReactNode;
}) {
  return (
    <li className="row-hover row-focus flex min-h-8 items-center gap-2 rounded-md px-2">
      {task ? (
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-sm outline-none"
          title={`Open ${issue.title}`}
          onClick={() => onOpen(task)}
        >
          {issue.title}
        </button>
      ) : (
        <Hint label="Not on this board. Opens on GitHub.">
          <a
            className="text-link underline-offset-2 hover:underline inline-flex min-w-0 flex-1 items-center gap-1 text-sm"
            href={issue.url}
            target="_blank"
            rel="noreferrer"
          >
            <span className="truncate">{issue.title}</span>
            <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
          </a>
        </Hint>
      )}
      <Badge size="sm" variant={itemStateTone(issue.state)}>
        {itemStateLabel(issue.state)}
      </Badge>
      {actions}
    </li>
  );
}
