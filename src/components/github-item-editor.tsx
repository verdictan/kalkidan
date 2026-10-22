import { GitHubContentEditor, PropertyRow, useContentMenu } from './github-content-editor';
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
  Plus,
  Trash2,
} from 'lucide-react';
import { Popover } from 'radix-ui';
import { projectFieldText } from '../domain/project-view';
import { menuCollisionPadding, menuContentClass } from './ui/menu-styles';
import { cn } from '../lib/utils';
import type { API, TrackerBoard, TrackerItem } from '../types';
import type { TrackerField } from '../domain/tracker';
import type { ProjectFieldValue, ProjectItemAction } from '../domain/github-mutations';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { CheckboxRow } from './ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Alert, AlertDescription } from './ui/alert';
import { showToast } from './ui/toast';
import { ConfirmDialog } from './confirm-dialog';
import type { ActionMenuItem } from './action-menu';
import { MoreButton } from './ui/more-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Hint } from './hint';
import { Choice } from './choice';
import { errorMessage } from '../lib/errors';
import { timestamp } from '../lib/github-labels';

/**
 * The GitHub part of the task sheet, folded under "Details": draft conversion, the issue or pull
 * request, and its relationships. The sheet itself edits the title and the description, and
 * shows the project fields as pills (`FieldPills`). With `showFields`, the fields also show
 * here. Fields save on Enter, on blur or on a choice. A failed write keeps the value in the
 * field, so the user can try again.
 */
export function GitHubItemEditor({
  api,
  groupId,
  board,
  item,
  onSaved,
  showFields = false,
}: {
  api: API;
  groupId: string;
  board: TrackerBoard;
  item: TrackerItem;
  onSaved: () => Promise<unknown>;
  showFields?: boolean;
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
  const fields = showFields ? editableFields(board) : [];
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
    <Collapsible className="tracker-details" aria-busy={busy}>
      <CollapsibleTrigger className="tracker-details-trigger group">
        <ChevronRight
          size={14}
          aria-hidden="true"
          className="shrink-0 transition-transform duration-[var(--motion-fast)] group-data-[state=open]:rotate-90"
        />
        Details
      </CollapsibleTrigger>
      <CollapsibleContent>
        <section className="grid gap-6 pt-2" aria-label="GitHub item properties">
          {error && (
            <Alert variant="destructive" size="sm">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {!!fields.length && (
            // The project fields continue the property list of the sheet.
            <section aria-label="Project fields" className="grid gap-1">
              {fields.map((field) => (
                <FieldEditor
                  key={`${item.id}:${field.id}`}
                  field={field}
                  item={item}
                  disabled={busy}
                  onSave={(value) => run(() => api.trackerField(groupId, item.id, field.id, value))}
                />
              ))}
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

/** The project fields that the sheet can edit: all but the status and the built-in fields. */
export function editableFields(board: TrackerBoard) {
  return (board.fields || []).filter(
    (field) =>
      field.id !== board.statusField?.id &&
      (field.dataType in valueKeys || field.dataType === 'MULTI_SELECT'),
  );
}

/** The choices of a single select or an iteration field, else undefined. */
export function fieldChoices(field: TrackerField) {
  return field.dataType === 'SINGLE_SELECT'
    ? field.options
    : field.dataType === 'ITERATION'
      ? field.iterations?.map((iteration) => ({ id: iteration.id, name: iteration.title }))
      : undefined;
}

/**
 * The project fields of a task as pills under its title: "Sprint 14", "P1". A pill changes its
 * value; "+" sets an empty field. A choice saves at once. Text, number and date save on Enter.
 */
export function FieldPills({
  api,
  groupId,
  board,
  item,
  disabled,
  onSaved,
}: {
  api: API;
  groupId: string;
  board: TrackerBoard;
  item: TrackerItem;
  disabled: boolean;
  onSaved: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  // The text, number or date field that the "+" menu opened.
  const [typing, setTyping] = useState<TrackerField | null>(null);
  const fields = editableFields(board);
  const filled = fields.filter((field) => projectFieldText(item, field));
  const empty = fields.filter((field) => !projectFieldText(item, field));
  async function save(field: TrackerField, value: ProjectFieldValue) {
    if (busy) return false;
    setBusy(true);
    try {
      await api.trackerField(groupId, item.id, field.id, value);
      await onSaved();
      return true;
    } catch (failure) {
      showToast({
        message: `Could not change ${field.name}. ${errorMessage(failure)}`,
        tone: 'error',
      });
      return false;
    } finally {
      setBusy(false);
    }
  }
  const off = disabled || busy;
  const plus = (
    <Button
      variant="outline"
      size="icon-xs"
      className="field-pill-add"
      aria-label="Set a field"
      disabled={off}
    >
      <Plus />
    </Button>
  );
  return (
    <>
      {filled.map((field) => (
        <FieldPill
          key={field.id}
          field={field}
          item={item}
          disabled={off}
          onSave={(value) => save(field, value)}
        />
      ))}
      {!!empty.length && (
        <Popover.Root open={!!typing} onOpenChange={(open) => !open && setTyping(null)}>
          <DropdownMenu>
            <Popover.Anchor asChild>
              <span className="inline-flex">
                <Hint label="Set a field">
                  <DropdownMenuTrigger asChild>{plus}</DropdownMenuTrigger>
                </Hint>
              </span>
            </Popover.Anchor>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Set a field</DropdownMenuLabel>
              {empty.map((field) => {
                const choices = fieldChoices(field);
                return choices ? (
                  <DropdownMenuSub key={field.id}>
                    <DropdownMenuSubTrigger>{field.name}</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {choices.map((choice) => (
                        <DropdownMenuItem
                          key={choice.id}
                          onSelect={() =>
                            void save(
                              field,
                              field.dataType === 'ITERATION'
                                ? { iterationId: choice.id }
                                : { singleSelectOptionId: choice.id },
                            )
                          }
                        >
                          {choice.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ) : (
                  <DropdownMenuItem
                    key={field.id}
                    disabled={field.dataType === 'MULTI_SELECT'}
                    onSelect={() => setTyping(field)}
                  >
                    {field.name}…
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={6}
              collisionPadding={menuCollisionPadding}
              className={cn(menuContentClass, 'w-64 p-2')}
              aria-label={typing?.name}
            >
              {typing && (
                <FieldInput
                  field={typing}
                  initial=""
                  disabled={off}
                  onSave={async (value) => {
                    if (await save(typing, value)) setTyping(null);
                  }}
                />
              )}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </>
  );
}

/** One field pill. A choice field opens a menu; text, number and date open a small field. */
function FieldPill({
  field,
  item,
  disabled,
  onSave,
}: {
  field: TrackerField;
  item: TrackerItem;
  disabled: boolean;
  onSave: (value: ProjectFieldValue) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const text = projectFieldText(item, field);
  const choices = fieldChoices(field);
  const pill = (
    <Button
      variant="outline"
      size="xs"
      className="field-pill"
      disabled={disabled}
      aria-label={`${field.name}: ${text}`}
    >
      <span className="truncate">{text}</span>
    </Button>
  );
  if (choices)
    return (
      <DropdownMenu>
        <Hint label={field.name}>
          <DropdownMenuTrigger asChild>{pill}</DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>{field.name}</DropdownMenuLabel>
          {choices.map((choice) => (
            <DropdownMenuItem
              key={choice.id}
              onSelect={() =>
                void onSave(
                  field.dataType === 'ITERATION'
                    ? { iterationId: choice.id }
                    : { singleSelectOptionId: choice.id },
                )
              }
            >
              <Check
                className={cn('size-4', choice.name !== text && 'invisible')}
                aria-hidden="true"
              />
              {choice.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void onSave(null)}>Clear {field.name}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  if (field.dataType === 'MULTI_SELECT')
    return (
      <Hint label={field.name}>
        <span className="field-pill field-pill-static" tabIndex={0}>
          {text}
        </span>
      </Hint>
    );
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Hint label={field.name}>
        <Popover.Trigger asChild>{pill}</Popover.Trigger>
      </Hint>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={menuCollisionPadding}
          className={cn(menuContentClass, 'w-64 p-2')}
          aria-label={field.name}
        >
          <FieldInput
            field={field}
            initial={text}
            disabled={disabled}
            onSave={async (value) => {
              if (await onSave(value)) setOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** A text, number or date field that saves on Enter. An empty value clears the field. */
function FieldInput({
  field,
  initial,
  disabled,
  onSave,
}: {
  field: TrackerField;
  initial: string;
  disabled: boolean;
  onSave: (value: ProjectFieldValue) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const key = valueKeys[field.dataType];
  return (
    <Input
      autoFocus
      size="sm"
      aria-label={field.name}
      placeholder={field.name}
      type={field.dataType === 'NUMBER' ? 'number' : field.dataType === 'DATE' ? 'date' : 'text'}
      value={value}
      disabled={disabled}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          void onSave(
            value === ''
              ? null
              : ({
                  [key]: field.dataType === 'NUMBER' ? Number(value) : value,
                } as ProjectFieldValue),
          );
        }
      }}
    />
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
      label: 'Remove from board…',
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
            const row = (
              <DropdownMenuItem
                variant={entry.danger ? 'destructive' : 'default'}
                disabled={entry.disabled}
                onSelect={entry.action}
              >
                {icon}
                {entry.label}
              </DropdownMenuItem>
            );
            return (
              <Fragment key={entry.label}>
                {entry.separator && <DropdownMenuSeparator />}
                {/* A disabled item tells why in a tooltip. */}
                {reason ? (
                  <Hint label={reason} disabled className="flex">
                    {row}
                  </Hint>
                ) : (
                  row
                )}
              </Fragment>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirmRemove}
        title="Remove from board"
        description={
          item.kind === 'DraftIssue'
            ? 'GitHub deletes the draft. You cannot undo this.'
            : 'The issue or pull request stays in its repository. You can add it again later.'
        }
        confirmLabel="Remove from board"
        destructive
        busy={busy}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() =>
          void act({ kind: 'remove' }, 'Task removed from the board.').then(
            (ok) => ok && setConfirmRemove(false),
          )
        }
      />
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
    <span className="flex min-w-0 items-center gap-1">
      <span className="truncate">{field.name}</span>
      <span role="status" className="inline-flex items-center text-success">
        {!!savedAt && (
          <>
            <Check className="size-3" aria-hidden="true" />
            <span className="sr-only">Saved</span>
          </>
        )}
      </span>
    </span>
  );
  if (!key && field.dataType !== 'MULTI_SELECT')
    return (
      <PropertyRow label={label}>
        <span className="text-sm text-muted-foreground">Edit on GitHub</span>
      </PropertyRow>
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
        size={auto ? 'sm' : 'default'}
        variant={auto ? 'ghost' : 'outline'}
        className={auto ? 'tracker-property-choice' : 'w-full'}
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
        size={auto ? 'sm' : undefined}
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
  if (auto) return <PropertyRow label={label}>{control}</PropertyRow>;
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
