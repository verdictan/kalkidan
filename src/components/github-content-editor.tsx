import { GitHubCheckEvidenceView } from './github-check-evidence';
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Plus } from 'lucide-react';
import type { API } from '../types';
import type { GitHubContentSnapshot, GitHubContentAction } from '../domain/github-content';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { Tag } from './ui/tag';
import { SectionHeader } from './ui/page-header';
import { SegmentedControl } from './ui/segmented-control';
import { Alert, AlertDescription } from './ui/alert';
import { showToast } from './ui/toast';
import { Choice } from './choice';
import type { ActionMenuItem } from './action-menu';
import { errorMessage } from '../lib/errors';
import {
  itemKindLabel,
  itemStateLabel,
  itemStateTone,
  mergeableLabel,
  relativeTime,
  reviewDecisionLabel,
  reviewDecisionTone,
  reviewStateLabel,
} from '../lib/github-labels';

type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

function ExternalAnchor({ node: _node, ...props }: ComponentProps<'a'> & { node?: unknown }) {
  return (
    <a
      {...props}
      className="text-link underline-offset-2 hover:underline"
      target="_blank"
      rel="noreferrer"
    />
  );
}
function MarkdownBody({ children, empty }: { children: string; empty: string }) {
  return children.trim() ? (
    <div className="prose-ui min-w-0 break-words" data-size="sm">
      <Markdown remarkPlugins={[remarkGfm]} components={{ a: ExternalAnchor }}>
        {children}
      </Markdown>
    </div>
  ) : (
    <p className="form-help m-0">{empty}</p>
  );
}
/** The login of a comment author. GitHub sends null for a deleted account. */
function authorName(author: unknown) {
  if (typeof author === 'string' && author) return author;
  const login = (author as { login?: unknown } | null | undefined)?.login;
  return typeof login === 'string' && login ? login : 'Deleted account';
}
function timeOf(row: unknown) {
  const value = (row as { createdAt?: unknown; submittedAt?: unknown }) || {};
  const time = value.createdAt ?? value.submittedAt;
  return typeof time === 'string' ? time : undefined;
}
/** A label chip in the GitHub label color when GitHub sends one. */
function labelStyle(label: unknown) {
  const color = (label as { color?: unknown })?.color;
  if (typeof color !== 'string' || !/^[0-9a-f]{6}$/i.test(color)) return undefined;
  return {
    backgroundColor: `color-mix(in srgb, #${color} 18%, transparent)`,
    borderColor: `color-mix(in srgb, #${color} 45%, transparent)`,
  };
}

// The task sheet menu is in the sheet header, outside this editor. The editor publishes its
// menu items, such as "Close issue", for each item, and the menu reads them.
const menus = new Map<string, ActionMenuItem[]>();
const menuListeners = new Set<() => void>();
const noItems: ActionMenuItem[] = [];
function publishMenu(itemId: string, items: ActionMenuItem[]) {
  if (items.length) menus.set(itemId, items);
  else menus.delete(itemId);
  menuListeners.forEach((listener) => listener());
}
function subscribeMenu(listener: () => void) {
  menuListeners.add(listener);
  return () => {
    menuListeners.delete(listener);
  };
}
/** The menu items that the content editor of this item gives, such as "Close issue". */
export function useContentMenu(itemId: string) {
  return useSyncExternalStore(subscribeMenu, () => menus.get(itemId) ?? noItems);
}

function Section({
  title,
  count,
  actions,
  children,
}: {
  title: string;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="grid gap-2">
      <SectionHeader size="sm" className="mb-0" title={title} count={count} actions={actions} />
      {children}
    </section>
  );
}

/**
 * One property row of the task sheet: a 12px muted name in a 120px column, then the value. The
 * sheet, its fields and the issue details use it, so all values line up.
 */
export function PropertyRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="tracker-property-row">
      <span className="tracker-property-label">{label}</span>
      <div className="tracker-property-value">{children}</div>
    </div>
  );
}

/** A removable chip with a box that adds a value on Enter. */
function ChipList({
  noun,
  values,
  disabled,
  placeholder,
  onAdd,
  onRemove,
}: {
  noun: string;
  values: { id: string; name: string; style?: ComponentProps<'span'>['style'] }[];
  disabled: boolean;
  placeholder: string;
  onAdd(value: string): void;
  onRemove(value: string): void;
}) {
  const [draft, setDraft] = useState('');
  const submit = () => {
    const value = draft.trim();
    if (!value || disabled) return;
    onAdd(value);
    setDraft('');
  };
  return (
    <div className="flex flex-wrap items-center gap-1 py-0.5">
      {values.map((value) => (
        <Tag
          key={value.id}
          style={value.style}
          removeLabel={`Remove ${noun} ${value.name}`}
          onRemove={disabled ? undefined : () => onRemove(value.name)}
        >
          {value.name}
        </Tag>
      ))}
      {!values.length && disabled && <span className="text-sm text-muted-foreground">None</span>}
      {!disabled && (
        <form
          className="relative"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Plus
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            size="sm"
            aria-label={`Add ${noun}`}
            className="h-6 w-40 rounded-sm pl-6 text-xs"
            placeholder={placeholder}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </form>
      )}
    </div>
  );
}

/**
 * The issue or pull request of a task: description, assignees, labels, details, checks, review
 * and comments. The task sheet shows and edits the title and the description.
 */
export function GitHubContentEditor({
  api,
  groupId,
  itemId,
  onSaved,
  beforeComments,
}: {
  api: API;
  groupId: string;
  itemId: string;
  onSaved: () => Promise<unknown>;
  /** Content that shows before the comments, such as the relationships of the issue. */
  beforeComments?: ReactNode;
}) {
  const [value, setValue] = useState<GitHubContentSnapshot>();
  const [loadError, setLoadError] = useState('');
  const [writeError, setWriteError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [comment, setComment] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [reviewBody, setReviewBody] = useState('');
  const [reviewEvent, setReviewEvent] = useState<ReviewEvent>('COMMENT');
  const epoch = useRef(0),
    pending = useRef(false);
  useEffect(() => {
    const token = ++epoch.current;
    setBusy(true);
    setLoadError('');
    void api
      .trackerContent(groupId, itemId)
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
  async function change(action: GitHubContentAction, done: string) {
    if (!value || busy || pending.current) return false;
    pending.current = true;
    setBusy(true);
    setWriteError('');
    const token = epoch.current;
    try {
      const result = await api.trackerContentChange(groupId, itemId, value.revision, action);
      if (token === epoch.current) setValue(result);
      showToast(done);
      await onSaved();
      return true;
    } catch (failure) {
      if (token === epoch.current) {
        setWriteError(
          `${errorMessage(failure).replace(/\.?$/, '.')} Kalkidan loaded the ${
            value.kind === 'Issue' ? 'issue' : 'pull request'
          } again.`,
        );
        setRevision((n) => n + 1);
      }
      return false;
    } finally {
      pending.current = false;
      if (token === epoch.current) setBusy(false);
    }
  }
  const noun = value?.kind === 'PullRequest' ? 'pull request' : 'issue';
  const open = value?.state === 'OPEN';
  const canToggle = !!value && (open ? value.permissions.close : value.permissions.reopen);
  // Give the close and reopen action to the menu of the task sheet.
  useEffect(() => {
    publishMenu(
      itemId,
      value && value.state !== 'MERGED'
        ? [
            {
              label: `${open ? 'Close' : 'Reopen'} ${noun}`,
              disabled: busy || !canToggle,
              reason: canToggle ? undefined : 'You do not have permission.',
              action: () =>
                void change(
                  { kind: open ? 'close' : 'reopen' },
                  `${noun[0].toUpperCase()}${noun.slice(1)} ${open ? 'closed' : 'reopened'}.`,
                ),
            },
          ]
        : [],
    );
  }, [itemId, value?.state, value?.revision, busy, canToggle]);
  useEffect(() => () => publishMenu(itemId, []), [itemId]);
  if (!value)
    return (
      <section className="grid gap-2" aria-label="Issue and pull request content">
        {loadError ? (
          <Alert variant="destructive" size="sm">
            <AlertDescription>
              {loadError}
              <Button variant="outline" size="sm" onClick={() => setRevision((n) => n + 1)}>
                Load again
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <p role="status" className="m-0 text-sm text-muted-foreground">
            Loading the issue…
          </p>
        )}
      </section>
    );
  const locked = busy;
  const pr = value.kind === 'PullRequest';
  const comments = [
    ...value.comments.map((row) => ({ ...row, review: undefined as string | undefined })),
    ...(value.reviews || [])
      .filter((row) => row.body.trim() || row.state !== 'COMMENTED')
      .map((row) => ({ ...row, url: '', review: row.state })),
  ];
  return (
    <section className="grid gap-5" aria-label="Issue and pull request content" aria-busy={busy}>
      <div className="flex flex-wrap items-center gap-1">
        <Badge size="sm" variant={itemStateTone(value.state)}>
          {itemKindLabel(value.kind)} · {itemStateLabel(value.state)}
        </Badge>
        {pr && value.mergeable && open && (
          <Badge size="sm" variant={value.mergeable === 'CONFLICTING' ? 'destructive' : 'muted'}>
            {mergeableLabel(value.mergeable)}
          </Badge>
        )}
        {pr && (
          <Badge size="sm" variant={reviewDecisionTone(value.reviewDecision)}>
            {reviewDecisionLabel(value.reviewDecision)}
          </Badge>
        )}
      </div>
      {writeError && (
        <Alert variant="destructive" size="sm">
          <AlertDescription>{writeError}</AlertDescription>
        </Alert>
      )}
      {/* The issue values continue the property list of the sheet. */}
      <div className="grid gap-1">
        <PropertyRow label="Assignees">
          <ChipList
            noun="assignee"
            placeholder="Add a person"
            values={value.assignees.map((user) => ({ id: user.id, name: user.login }))}
            disabled={locked || !value.permissions.assign}
            onAdd={(login) => void change({ kind: 'assign', login }, `Assigned ${login}.`)}
            onRemove={(login) => void change({ kind: 'unassign', login }, `Unassigned ${login}.`)}
          />
        </PropertyRow>
        <PropertyRow label="Labels">
          <ChipList
            noun="label"
            placeholder="Add a label"
            values={value.labels.map((label) => ({
              id: label.id,
              name: label.name,
              style: labelStyle(label),
            }))}
            disabled={locked || !value.permissions.label}
            onAdd={(name) => void change({ kind: 'label', name }, `Added the ${name} label.`)}
            onRemove={(name) =>
              void change({ kind: 'unlabel', name }, `Removed the ${name} label.`)
            }
          />
        </PropertyRow>
        <PropertyRow label="Milestone">
          <Choice
            size="sm"
            variant="ghost"
            className="tracker-property-choice"
            label="Issue milestone"
            value={value.milestone?.id || ''}
            disabled={locked || !value.canSetMilestone}
            onChange={(id) => void change({ kind: 'milestone', id: id || null }, 'Milestone set.')}
            options={[
              { value: '', label: 'No milestone' },
              ...(value.milestones || []).map((choice) => ({
                value: choice.id,
                label: choice.title,
              })),
            ]}
          />
        </PropertyRow>
        {value.kind === 'Issue' && (
          <PropertyRow label="Type">
            <Choice
              size="sm"
              variant="ghost"
              className="tracker-property-choice"
              label="Issue type"
              value={value.issueType?.id || ''}
              disabled={locked || !value.canSetType}
              onChange={(id) =>
                void change({ kind: 'issue-type', id: id || null }, 'Issue type set.')
              }
              options={[
                { value: '', label: 'No type' },
                ...(value.issueTypes || []).map((choice) => ({
                  value: choice.id,
                  label: choice.name,
                })),
              ]}
            />
          </PropertyRow>
        )}
      </div>
      <GitHubCheckEvidenceView value={value} />
      {pr && open && (
        <Section title="Review">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const login = reviewer.trim();
              if (login)
                void change(
                  { kind: 'request-review', login },
                  `Requested a review from ${login}.`,
                ).then((ok) => ok && setReviewer(''));
            }}
          >
            <Input
              aria-label="Reviewer user name"
              className="min-w-0 flex-1"
              placeholder="Reviewer user name"
              value={reviewer}
              disabled={locked || !value.permissions.edit}
              onChange={(event) => setReviewer(event.target.value)}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={locked || !value.permissions.edit || !reviewer.trim()}
            >
              Request review
            </Button>
          </form>
          <SegmentedControl
            size="sm"
            label="Review decision"
            className="justify-self-start"
            value={reviewEvent}
            onChange={setReviewEvent}
            options={[
              { value: 'COMMENT', label: 'Comment', disabled: locked },
              { value: 'APPROVE', label: 'Approve', disabled: locked || value.viewerDidAuthor },
              {
                value: 'REQUEST_CHANGES',
                label: 'Request changes',
                disabled: locked || value.viewerDidAuthor,
              },
            ]}
          />
          {value.viewerDidAuthor && (
            <p className="form-help m-0">You cannot approve your own pull request.</p>
          )}
          <Textarea
            aria-label="Review comment"
            placeholder="Review comment"
            rows={3}
            value={reviewBody}
            maxLength={20000}
            disabled={locked}
            onChange={(event) => setReviewBody(event.target.value)}
          />
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              disabled={
                locked || !value.headOid || (reviewEvent !== 'APPROVE' && !reviewBody.trim())
              }
              onClick={() =>
                void change(
                  {
                    kind: 'review',
                    event: reviewEvent,
                    body: reviewBody,
                    headOid: value.headOid!,
                  },
                  'Review submitted.',
                ).then((ok) => ok && setReviewBody(''))
              }
            >
              Submit review
            </Button>
          </div>
        </Section>
      )}
      {beforeComments}
      <Section title="Comments" count={comments.length}>
        {comments.length ? (
          <ul className="m-0 grid list-none gap-2 p-0">
            {comments.map((row) => {
              const time = timeOf(row);
              return (
                <li key={row.id} className="grid gap-1 rounded-lg border px-3 py-2">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-sm font-medium">{authorName(row.author)}</span>
                    {row.review && (
                      <span className="text-xs text-muted-foreground">
                        {reviewStateLabel(row.review)}
                      </span>
                    )}
                    {time &&
                      (row.url ? (
                        <a
                          className="text-xs leading-4 text-muted-foreground underline-offset-2 hover:underline"
                          href={row.url}
                          target="_blank"
                          rel="noreferrer"
                          title={new Date(time).toLocaleString()}
                        >
                          {relativeTime(time)}
                        </a>
                      ) : (
                        <span
                          className="text-xs leading-4 text-muted-foreground"
                          title={new Date(time).toLocaleString()}
                        >
                          {relativeTime(time)}
                        </span>
                      ))}
                  </div>
                  <MarkdownBody empty="No text.">{row.body}</MarkdownBody>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="form-help m-0">No comments yet.</p>
        )}
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (comment.trim())
              void change({ kind: 'comment', body: comment }, 'Comment posted.').then(
                (ok) => ok && setComment(''),
              );
          }}
        >
          <Textarea
            aria-label="New comment"
            placeholder="Write a comment"
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            maxLength={20000}
            disabled={locked}
          />
          <div className="flex items-center justify-end gap-2">
            <Button type="submit" variant="outline" size="sm" disabled={locked || !comment.trim()}>
              Comment
            </Button>
          </div>
        </form>
      </Section>
    </section>
  );
}
