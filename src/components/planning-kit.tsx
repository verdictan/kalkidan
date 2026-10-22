// Small parts that the planning tools share: review rows, the selected-task list, sections and
// events to other pages. Each tool uses these parts, so that all tools look the same.
import { useState, type ReactNode } from 'react';
import { ChevronRight, ExternalLink } from 'lucide-react';
import type {
  Agent,
  API,
  Project,
  ProjectGroup,
  Session,
  TrackerBoard,
  TrackerItem,
} from '../types';
import type { PlanningLabel } from '../domain/planning-labels';
import { plural } from '../domain/planning-labels';
import type { TrackerField } from '../domain/tracker';
import type { ProjectFieldValue } from '../domain/github-mutations';
import { cn } from '../lib/utils';
import { Alert, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Count } from './ui/count';
import { Tag } from './ui/tag';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { showToast } from './ui/toast';

/** The props of each tool in the planning tool dialog. Each tool renders DialogBody and DialogFooter. */
export interface PlanningToolProps {
  api: API;
  group: ProjectGroup;
  board: TrackerBoard;
  /** The selected tasks, in board order. */
  items: TrackerItem[];
  onRemove: (id: string) => void;
  /** True when no task was selected, so the tool acts on all visible tasks. */
  allTasks?: boolean;
  /** Closes the dialog and opens the task sheet. */
  onOpenTask: (id: string) => void;
  onClose: () => void;
  /** Called after a write to GitHub, so that the board can load again. */
  onSaved: () => void;
  sessions: Session[];
  /** The code folders of the project. */
  repos: Project[];
}

/** One row in a review list: title 13/500, meta 12 muted, a status badge on the right. */
export function ReviewRow({
  title,
  meta,
  status,
  leading,
  aside,
  children,
  className,
}: {
  title: ReactNode;
  meta?: ReactNode;
  status?: PlanningLabel;
  /** A check box or icon before the title. */
  leading?: ReactNode;
  /** Text or controls after the badge, for example a time. */
  aside?: ReactNode;
  /** Actions or details below the meta line. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('review-row', className)}>
      {leading && <div className="review-row-leading">{leading}</div>}
      <div className="review-row-text">
        <div className="review-row-title">{title}</div>
        {meta && <div className="review-row-meta">{meta}</div>}
        {children}
      </div>
      {(status || aside) && (
        <div className="review-row-aside">
          {status && <StatusBadge value={status} />}
          {aside}
        </div>
      )}
    </div>
  );
}

export function StatusBadge({ value }: { value: PlanningLabel }) {
  return (
    <Badge variant={value.tone} size="sm">
      {value.label}
    </Badge>
  );
}

/** A task title that opens the task. */
export function TaskTitle({ title, onOpen }: { title: string; onOpen?: () => void }) {
  if (!onOpen) return <span className="truncate">{title}</span>;
  return (
    <button type="button" className="review-row-link" onClick={onOpen}>
      {title}
    </button>
  );
}

/**
 * The tasks of a tool: one summary line ("All tasks 14" or "Selected tasks 3"), and the tasks as
 * removable tags behind "Edit". A short selection shows its tags at once.
 */
export function SelectedTasks({
  items,
  onRemove,
  limit,
  label = 'Selected tasks',
  all = false,
}: {
  items: TrackerItem[];
  onRemove?: (id: string) => void;
  limit: number;
  label?: string;
  /** No task was selected: the tool acts on all visible tasks. */
  all?: boolean;
}) {
  const tooMany = items.length > limit;
  const [open, setOpen] = useState(!all && items.length <= 6);
  const name = all ? 'All tasks' : label;
  const shown = open || tooMany;
  return (
    <section className="grid gap-2" aria-label={name}>
      <div className="selected-tasks-summary">
        <span className="font-semibold">{name}</span>
        <Count>{items.length}</Count>
        {items.length > 0 && !tooMany && (
          <Button
            type="button"
            variant="link"
            className="ml-auto"
            aria-expanded={shown}
            onClick={() => setOpen((value) => !value)}
          >
            {shown ? 'Done' : onRemove ? 'Edit' : 'Show'}
          </Button>
        )}
      </div>
      {!items.length ? (
        <p className="form-help m-0">Select tasks on the board first.</p>
      ) : (
        shown && (
          <ul className="selected-tasks">
            {items.map((item) => (
              <li key={item.id}>
                <Tag
                  title={item.title}
                  removeLabel={`Remove ${item.title}`}
                  onRemove={onRemove && (() => onRemove(item.id))}
                >
                  {item.title}
                </Tag>
              </li>
            ))}
          </ul>
        )
      )}
      {tooMany && (
        <Alert variant="destructive" size="sm">
          <AlertDescription>
            Choose up to {plural(limit, 'task')}. Remove {plural(items.length - limit, 'task')}.
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}

/** A block error in a panel or dialog. */
export function ErrorAlert({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <Alert variant="destructive" size="sm">
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

/** A collapsible section: 32px row, 14px chevron that turns 90°, title 13/600. */
export function ToolSection({
  title,
  aside,
  defaultOpen,
  children,
}: {
  title: ReactNode;
  aside?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="tool-section">
      <CollapsibleTrigger className="tool-section-trigger group">
        <ChevronRight
          size={14}
          aria-hidden="true"
          className="shrink-0 transition-transform duration-[var(--motion-fast)] group-data-[state=open]:rotate-90"
        />
        <span className="tool-section-title">{title}</span>
        {aside && <span className="tool-section-aside">{aside}</span>}
      </CollapsibleTrigger>
      <CollapsibleContent className="tool-section-content">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** A link to a GitHub page, with the 14px external-link icon. */
export function ExternalTextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      className="text-link underline-offset-2 hover:underline inline-flex items-center gap-1"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {children}
      <ExternalLink size={14} aria-hidden="true" />
    </a>
  );
}

/** A row of actions at the end of a panel, sized to their content. */
export function ActionRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap justify-end gap-2">{children}</div>;
}

// Events to the shell and to other pages. The shell owns the routes.
export function openTask(groupId: string, itemId: string) {
  window.dispatchEvent(new CustomEvent('kalkidan-open-task', { detail: { groupId, itemId } }));
}
export function openChat(agent: Agent, id: string) {
  window.dispatchEvent(new CustomEvent('kalkidan-open-session', { detail: { agent, id } }));
}
export function newChat(detail: {
  groupId?: string;
  repoId?: string;
  agent?: Agent;
  prompt?: string;
  docIds?: string[];
  taskId?: string;
}) {
  window.dispatchEvent(new CustomEvent('kalkidan-new-session', { detail }));
}
export function openInsights(
  groupId: string,
  view?: 'board' | 'github' | 'usage' | 'knowledge',
  taskId?: string,
) {
  window.dispatchEvent(
    new CustomEvent('kalkidan-open-project-page', {
      detail: { groupId, page: 'knowledge', section: 'insights', view, taskId },
    }),
  );
}
export function openTasksPage(groupId: string) {
  window.dispatchEvent(
    new CustomEvent('kalkidan-open-project-page', { detail: { groupId, page: 'tasks' } }),
  );
}

/** The event that opens the "Check" popover of the board "⋯" menu. The detail is `{ groupId }`. */
export const checkWritesEvent = 'kalkidan-check-github-writes';
/** Opens the Tasks page and the list of GitHub changes to check. */
export function openWriteCheck(groupId: string) {
  openTasksPage(groupId);
  setTimeout(
    () => window.dispatchEvent(new CustomEvent(checkWritesEvent, { detail: { groupId } })),
    250,
  );
}

/**
 * "Status: Todo → Done" for a review row. When neither value is known, it is only
 * "Status changed".
 */
export function fieldChangeText(
  field: TrackerField | undefined,
  before: ProjectFieldValue,
  value: ProjectFieldValue,
) {
  const name = field?.name || 'Field';
  const from = describeFieldValue(field, before);
  const to = describeFieldValue(field, value);
  return from.startsWith('Unknown') && to.startsWith('Unknown')
    ? `${name} changed`
    : `${name}: ${from} → ${to}`;
}

/** Words for a field value, for the review rows. */
export function describeFieldValue(field: TrackerField | undefined, value: ProjectFieldValue) {
  if (value === null) return 'No value';
  if ('singleSelectOptionId' in value)
    return (
      field?.options?.find((option) => option.id === value.singleSelectOptionId)?.name ||
      'Unknown option'
    );
  if ('iterationId' in value)
    return (
      field?.iterations?.find((option) => option.id === value.iterationId)?.title ||
      'Unknown iteration'
    );
  if ('multiSelectOptionIds' in value)
    return (
      value.multiSelectOptionIds
        .map((id) => field?.options?.find((option) => option.id === id)?.name || 'Unknown option')
        .join(', ') || 'No value'
    );
  return String(Object.values(value)[0]);
}

/** The event that a tool sends after a GitHub write. The detail is `{ groupId }`. */
export const githubWritesEvent = 'kalkidan-github-writes';

/**
 * Tells the user that GitHub writes have no confirmed result. "Check" opens the Tasks page,
 * where the board "⋯" menu lists them. Tools call it when a write ends with an unknown result.
 */
export function notifyGitHubWrites(groupId: string, count: number) {
  window.dispatchEvent(new CustomEvent(githubWritesEvent, { detail: { groupId } }));
  if (count < 1) return;
  showToast({
    message:
      count === 1
        ? '1 change may not have reached GitHub.'
        : `${count} changes may not have reached GitHub.`,
    actions: [{ label: 'Check', onClick: () => openWriteCheck(groupId) }],
    duration: 10000,
  });
}

/**
 * A select for forms and toolbars. With no value, it shows the placeholder. An option with the
 * value '' is a real choice, for example "None".
 */
export function FormSelect({
  label,
  value,
  onChange,
  options,
  placeholder = 'Choose…',
  disabled,
  size = 'default',
  variant = 'outline',
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'default';
  variant?: 'outline' | 'filled';
  className?: string;
}) {
  const none = '__none';
  const hasEmpty = options.some((option) => option.value === '');
  return (
    <Select
      // An empty string shows the placeholder and keeps the select controlled.
      value={value ? value : hasEmpty ? none : ''}
      onValueChange={(next) => onChange(next === none ? '' : next)}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={label}
        size={size}
        variant={variant}
        className={cn(
          'min-w-0 max-w-full [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate',
          size === 'default' && 'w-full',
          className,
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-w-[calc(100vw-2rem)]">
        {options.map((option) => (
          <SelectItem
            key={option.value || none}
            value={option.value || none}
            className="whitespace-normal break-words"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
