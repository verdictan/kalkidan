import { GitHubContentEditor, useContentMenu } from './github-content-editor';
import { GitHubIssueRelations } from './github-issue-relations';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowUpToLine,
  Check,
  CircleCheck,
  CircleDot,
  ChevronRight,
  Trash2,
} from 'lucide-react';
import type { API, TrackerBoard, TrackerItem } from '../types';
import type { TrackerField } from '../domain/tracker';
import type { ProjectFieldValue, ProjectItemAction } from '../domain/github-mutations';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { CheckboxRow } from './ui/checkbox';
import { SectionHeader } from './ui/page-header';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Alert, AlertDescription } from './ui/alert';
import { showToast } from './ui/toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import type { ActionMenuItem } from './action-menu';
import { MoreButton } from './ui/more-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Hint } from './hint';
import { Choice } from './choice';
import { errorMessage } from '../lib/errors';
import { timestamp } from '../lib/github-labels';

/**
 * The GitHub part of the task sheet, folded under "Details": project fields, draft conversion,
 * the issue or pull request, and its relationships. The sheet itself edits the title and the
 * description. Fields save on Enter, on blur or on a choice. A failed write keeps the
 * value in the field, so the user can try again.
 */
export function GitHubItemEditor({
  api,
  groupId,
  board,
  item,
  onSaved,
}: {
  api: API;
  groupId: string;
  board: TrackerBoard;
  item: TrackerItem;
  onSaved: () => Promise<unknown>;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [repository, setRepository] = useState(item.repository || '');
  async function run(action: () => Promise<void>, done?: string) {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
      if (done) showToast(done);
      await onSaved();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const act = (action: ProjectItemAction, done: string) =>
    run(() => api.trackerItemAction(groupId, item.id, action), done);
  const content = ['Issue', 'PullRequest'].includes(item.kind || '');
  const fields = (board.fields || []).filter((field) => field.id !== board.statusField?.id);
  const relations = item.kind === 'Issue' && typeof api.trackerRelations === 'function' && (
    <GitHubIssueRelations
      key={item.id}
      api={api}
      groupId={groupId}
      itemId={item.id}
      board={board}
    />
  );
  return (
    <Collapsible className="tool-section tracker-details" aria-busy={busy}>
      <CollapsibleTrigger className="tool-section-trigger group">
        <ChevronRight
          size={14}
          aria-hidden="true"
          className="shrink-0 transition-transform duration-[var(--motion-fast)] group-data-[state=open]:rotate-90"
        />
        <span className="tool-section-title">Details</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <section className="grid gap-5 pt-2" aria-label="GitHub item properties">
          {error && (
            <Alert variant="destructive" size="sm">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {!!fields.length && (
            <section aria-label="Project fields" className="grid gap-2">
              <SectionHeader size="sm" as="h4" className="mb-0" title="Fields" />
              <div className="grid gap-2">
                {fields.map((field) => (
                  <FieldEditor
                    key={`${item.id}:${field.id}`}
                    field={field}
                    item={item}
                    disabled={busy}
                    onSave={(value) =>
                      run(() => api.trackerField(groupId, item.id, field.id, value))
                    }
                  />
                ))}
              </div>
            </section>
          )}
          {item.kind === 'DraftIssue' && (
            <form
              className="grid gap-2"
              aria-label="Convert to an issue"
              onSubmit={(event) => {
                event.preventDefault();
                if (/^[\w.-]+\/[\w.-]+$/.test(repository.trim()))
                  void act(
                    { kind: 'convert', repository: repository.trim() },
                    'Draft converted to an issue.',
                  );
              }}
            >
              <span className="form-label">Convert to an issue</span>
              <div className="flex gap-2">
                <Input
                  aria-label="Issue repository"
                  className="min-w-0 flex-1"
                  placeholder="owner/repository"
                  value={repository}
                  disabled={busy}
                  onChange={(e) => setRepository(e.target.value)}
                />
                <Button
                  type="submit"
                  variant="outline"
                  disabled={busy || !/^[\w.-]+\/[\w.-]+$/.test(repository.trim())}
                >
                  Convert to issue
                </Button>
              </div>
            </form>
          )}
          {content && typeof api.trackerContent === 'function' ? (
            <GitHubContentEditor
              key={item.id}
              api={api}
              groupId={groupId}
              itemId={item.id}
              onSaved={onSaved}
              beforeComments={relations}
            />
          ) : (
            relations
          )}
        </section>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * The "Task actions" menu of a board item for the header of the task sheet: close or reopen the
 * issue, archive or restore, move to the top, and remove from the board after a confirmation.
 */
export function ItemActionsMenu({
  api,
  groupId,
  item,
  onSaved,
  size = 'sm',
}: {
  api: API;
  groupId: string;
  item: TrackerItem;
  onSaved: () => Promise<unknown>;
  size?: 'md' | 'sm' | 'xs';
}) {
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const contentMenu = useContentMenu(item.id);
  async function act(action: ProjectItemAction, done: string) {
    if (busy) return false;
    setBusy(true);
    try {
      await api.trackerItemAction(groupId, item.id, action);
      showToast(done);
      await onSaved();
      return true;
    } catch (failure) {
      showToast({ message: errorMessage(failure), tone: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  }
  const items: (ActionMenuItem & { icon?: ReactNode })[] = [
    ...contentMenu,
    {
      label: item.archived ? 'Restore item' : 'Archive item',
      icon: item.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />,
      disabled: busy,
      separator: contentMenu.length > 0,
      action: () =>
        void act(
          { kind: item.archived ? 'unarchive' : 'archive' },
          item.archived ? 'Task restored.' : 'Task archived.',
        ),
    },
    ...(!item.archived
      ? [
          {
            label: 'Move to top',
            icon: <ArrowUpToLine className="size-4" />,
            disabled: busy,
            action: () => void act({ kind: 'reorder', afterId: null }, 'Task moved to the top.'),
          },
        ]
      : []),
    {
      label: 'Remove from project…',
      icon: <Trash2 className="size-4" />,
      danger: true,
      separator: true,
      disabled: busy,
      action: () => setConfirmRemove(true),
    },
  ];
  return (
    <>
      <DropdownMenu>
        <Hint label="Task actions" disabled={busy}>
          <DropdownMenuTrigger asChild>
            <MoreButton size={size} label="Task actions" disabled={busy} />
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent align="end">
          {items.map((entry) => {
            const reason = entry.disabled && entry.reason;
            // The issue items of the content editor have no icon. Close and reopen get one.
            const icon =
              entry.icon ??
              (/^Close/.test(entry.label) ? (
                <CircleCheck className="size-4" />
              ) : /^Reopen/.test(entry.label) ? (
                <CircleDot className="size-4" />
              ) : null);
            return (
              <Fragment key={entry.label}>
                {entry.separator && <DropdownMenuSeparator />}
                <DropdownMenuItem
                  variant={entry.danger ? 'destructive' : 'default'}
                  disabled={entry.disabled}
                  className={reason ? 'h-auto items-start py-1.5' : undefined}
                  onSelect={entry.action}
                >
                  {icon}
                  <span className="grid min-w-0 gap-0.5">
                    {entry.label}
                    {reason && <span className="text-xs text-muted-foreground">{reason}</span>}
                  </span>
                </DropdownMenuItem>
              </Fragment>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={confirmRemove} onOpenChange={(open) => !busy && setConfirmRemove(open)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Remove this task from the board?</DialogTitle>
            <DialogDescription>
              {item.kind === 'DraftIssue'
                ? 'GitHub deletes the draft. You cannot undo this.'
                : 'The issue or pull request stays in its repository. You can add it again later.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void act({ kind: 'remove' }, 'Task removed from the board.').then(
                  (ok) => ok && setConfirmRemove(false),
                )
              }
            >
              {busy ? 'Removing…' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const valueKeys: Record<string, string> = {
  TEXT: 'text',
  NUMBER: 'number',
  DATE: 'date',
  SINGLE_SELECT: 'optionId',
  ITERATION: 'iterationId',
};

/**
 * One project field. Without `saveLabel`, the field saves on Enter, on blur or when the user makes
 * a choice, and shows "Saved". With `saveLabel`, a button submits the value, for example in the
 * batch editor.
 */
export function FieldEditor({
  field,
  item,
  disabled,
  onSave,
  saveLabel,
}: {
  field: TrackerField;
  item: TrackerItem;
  disabled: boolean;
  /** Return false when the write fails. The value then stays in the field. */
  onSave: (value: ProjectFieldValue) => Promise<void | boolean>;
  saveLabel?: string;
}) {
  const existing = item.fieldValues?.find(
    (value) => (value.field as { id?: string })?.id === field.id,
  );
  const key = valueKeys[field.dataType];
  const initial = String(existing?.[key] ?? '');
  const initialOptions =
    (existing?.options as { id: string }[] | undefined)?.map((option) => option.id) || [];
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [options, setOptions] = useState<string[]>(initialOptions);
  const [savedAt, setSavedAt] = useState(0);
  const auto = saveLabel === undefined;
  useEffect(() => {
    if (!savedAt) return;
    const timer = window.setTimeout(() => setSavedAt(0), 2500);
    return () => window.clearTimeout(timer);
  }, [savedAt]);
  const label = (
    <span className="flex min-h-8 items-center gap-2 text-xs font-medium text-muted-foreground">
      <span className="truncate">{field.name}</span>
      <span role="status" className="inline-flex items-center gap-0.5 text-success">
        {!!savedAt && (
          <>
            <Check className="size-3" aria-hidden="true" />
            Saved
          </>
        )}
      </span>
    </span>
  );
  if (!key && field.dataType !== 'MULTI_SELECT')
    return (
      <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-3">
        {label}
        <span className="text-sm text-muted-foreground">Edit on GitHub</span>
      </div>
    );
  function input(next: string, multi: string[]): ProjectFieldValue {
    if (field.dataType === 'MULTI_SELECT')
      return multi.length ? { multiSelectOptionIds: multi } : null;
    if (next === '') return null;
    const inputKey = field.dataType === 'SINGLE_SELECT' ? 'singleSelectOptionId' : key;
    return { [inputKey]: field.dataType === 'NUMBER' ? Number(next) : next } as ProjectFieldValue;
  }
  async function commit(next = value, multi = options) {
    if (disabled) return;
    if (auto && field.dataType !== 'MULTI_SELECT' && next === saved) return;
    const ok = await onSave(input(next, multi));
    if (ok === false) return;
    setSaved(next);
    if (auto) setSavedAt(timestamp());
  }
  const choices =
    field.dataType === 'SINGLE_SELECT'
      ? field.options
      : field.iterations?.map((iteration) => ({ id: iteration.id, name: iteration.title }));
  const control =
    field.dataType === 'MULTI_SELECT' ? (
      <div className="flex flex-wrap gap-x-4 gap-y-1 py-1.5">
        {field.options?.map((option) => (
          <CheckboxRow
            key={option.id}
            label={option.name}
            disabled={disabled}
            checked={options.includes(option.id)}
            onChange={(event) => {
              const next = event.target.checked
                ? [...options, option.id]
                : options.filter((id) => id !== option.id);
              setOptions(next);
              if (auto) void commit(value, next);
            }}
          />
        ))}
      </div>
    ) : choices ? (
      <Choice
        className="w-full"
        label={field.name}
        value={value}
        disabled={disabled}
        onChange={(next) => {
          setValue(next);
          if (auto) void commit(next);
        }}
        options={[
          { value: '', label: 'No value' },
          ...choices.map((option) => ({ value: option.id, label: option.name })),
        ]}
      />
    ) : (
      <Input
        aria-label={field.name}
        type={field.dataType === 'NUMBER' ? 'number' : field.dataType === 'DATE' ? 'date' : 'text'}
        value={value}
        disabled={disabled}
        placeholder={auto ? 'Empty' : undefined}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => auto && void commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void commit();
          }
        }}
      />
    );
  if (auto)
    return (
      <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-start gap-3">
        {label}
        {control}
      </div>
    );
  return (
    <div className="grid gap-2">
      <span className="form-label">{field.name}</span>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">{control}</div>
        <Button variant="outline" disabled={disabled} onClick={() => void commit()}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
