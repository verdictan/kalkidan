import type { ComponentProps, KeyboardEvent, ReactNode, Ref } from 'react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  Folder,
  FolderPlus,
  Lock,
  PencilLine,
  Plus,
} from 'lucide-react';
import { newChatAccessKey } from '../lib/chat-preferences';
import { cn } from '../lib/utils';
import { hasPrimaryModifier, isMac, shortcutLabel } from '../lib/platform';
import { Hint } from './hint';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Textarea } from './ui/textarea';

/** The placeholder of a composer that does not know its agent or folder. */
export const composerPlaceholder = 'Ask anything';

/** The placeholder of the composer: "Ask Codex to change atlas-web". */
export function composerPlaceholderFor(agentName: string, folderName?: string) {
  return folderName ? `Ask ${agentName} to change ${folderName}` : `Ask ${agentName}`;
}

/**
 * True when the chat works in a branch copy that Kalkidan made: a folder in the project
 * "worktrees" folder, on a branch other than the default branch.
 */
export function isOwnBranchCopy(
  cwd: string | undefined,
  working?: { branch: string; defaultBranch: string } | null,
) {
  if (!cwd || !working || working.branch === working.defaultBranch) return false;
  return /[\\/]worktrees[\\/][^\\/]+[\\/]?$/.test(cwd);
}

export type ChatAccess = 'read' | 'edit';

// The access choice of the last new chat in each code folder.
const accessKey = (repositoryId: string) => `kalkidan-session-permission:${repositoryId}`;

/** The access that the user chose for new chats in this code folder, or null. */
export function readAccess(repositoryId: string | undefined): ChatAccess | null {
  if (!repositoryId) return null;
  try {
    const value = localStorage.getItem(accessKey(repositoryId));
    return value === 'edit' || value === 'read' ? value : null;
  } catch {
    return null;
  }
}

/** Keeps the access choice for the next new chat in this code folder. */
export function saveAccess(repositoryId: string | undefined, value: ChatAccess) {
  if (!repositoryId) return;
  try {
    localStorage.setItem(accessKey(repositoryId), value);
  } catch {
    /* The choice applies to this chat only. */
  }
}

/** The "New chats start as" choice of Settings › General, when the user made one. */
export function defaultAccess(): ChatAccess | null {
  try {
    const value = localStorage.getItem(newChatAccessKey);
    return value === 'edit' || value === 'read' ? value : null;
  } catch {
    return null;
  }
}

// The model that the Overview composer chose for the next new chat of an agent. The chat view
// that opens next takes it once.
const nextModels = new Map<string, string>();
export function setNextChatModel(agent: string, model: string) {
  if (model) nextModels.set(agent, model);
  else nextModels.delete(agent);
}
export function takeNextChatModel(agent: string) {
  const model = nextModels.get(agent) || '';
  nextModels.delete(agent);
  return model;
}

/**
 * The look of a composer pill: 13px text with a 14px icon, 8px side padding and 6px between
 * the icon and the label. A pill that cannot change while the agent works keeps its colour and
 * loses its arrow.
 */
export const composerChipClass =
  'gap-1.5 px-2 text-sm font-normal has-[>svg]:px-2 disabled:opacity-100';

const accessModes: Record<ChatAccess, { label: string; description: string }> = {
  read: { label: 'Read only', description: 'The agent reads files and does not change them.' },
  edit: { label: 'Can edit', description: 'The agent can change files in the folder.' },
};

/** The access pill: a menu with "Read only" and "Can edit". */
export function AccessPill({
  value,
  onChange,
  disabled,
}: {
  value: ChatAccess;
  onChange: (value: ChatAccess) => void;
  disabled?: boolean;
}) {
  const mode = accessModes[value];
  return (
    <DropdownMenu>
      <Hint label="Change what the agent can do" disabled={disabled}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="chip"
            className={cn('composer-access', composerChipClass)}
            aria-label={`Access: ${mode.label}`}
            disabled={disabled}
          >
            {value === 'read' ? <Lock aria-hidden="true" /> : <PencilLine aria-hidden="true" />}
            {mode.label}
            {!disabled && <ChevronDown aria-hidden="true" />}
          </Button>
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent align="start" width="wide">
        {(Object.keys(accessModes) as ChatAccess[]).map((key) => (
          <DropdownMenuItem
            key={key}
            // Two lines: the label and its description.
            className="h-auto items-start py-1.5 [&>svg]:mt-0.5"
            onSelect={() => onChange(key)}
          >
            {key === 'read' ? <Lock /> : <PencilLine />}
            <span className="composer-access-text">
              <span>{accessModes[key].label}</span>
              <span className="composer-access-description">{accessModes[key].description}</span>
            </span>
            {key === value && <Check aria-label="Selected" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The code folder pill: "api · main". The menu lists the code folders of the project. Without
 * folders it is one "Add code folder…" pill.
 */
export function FolderPill({
  label,
  folders,
  current,
  onPick,
  onAdd,
  disabled,
}: {
  /** The folder name, with the branch when it is known. */
  label?: string;
  folders: { id: string; name: string }[];
  current?: string;
  onPick: (id: string) => void;
  /** Adds a code folder. The menu then ends with "Add code folder…". */
  onAdd?: () => void;
  disabled?: boolean;
}) {
  if (!folders.length && onAdd)
    return (
      <Button
        variant="chip"
        className={cn('composer-folder', composerChipClass)}
        onClick={onAdd}
        disabled={disabled}
      >
        <FolderPlus aria-hidden="true" />
        Add code folder…
      </Button>
    );
  return (
    <DropdownMenu>
      <Hint label="Code folder" disabled={disabled}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="chip"
            className={cn('composer-folder', composerChipClass)}
            aria-label={`Code folder: ${label}`}
            disabled={disabled}
          >
            <Folder aria-hidden="true" />
            <span className="truncate">{label}</span>
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent align="start">
        {folders.map((folder) => (
          <DropdownMenuItem key={folder.id} onSelect={() => onPick(folder.id)}>
            <Folder />
            <span className="min-w-0 flex-1">{folder.name}</span>
            {folder.id === current && <Check aria-label="Selected" />}
          </DropdownMenuItem>
        ))}
        {onAdd && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onAdd}>
              <FolderPlus />
              Add code folder…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One item of the "+" menu of the composer. */
export interface ComposerAddItem {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  /** A key hint on the right, for example "@". */
  shortcut?: string;
}

/** The round "+" pill at the left of the composer bar. Its menu adds context to the message. */
export function ComposerAddMenu({
  items,
  disabled,
  reason,
  onOpenChange,
  children,
}: {
  items: ComposerAddItem[];
  disabled?: boolean;
  /** Why the pill is disabled. The tooltip shows it. */
  reason?: string;
  onOpenChange?: (open: boolean) => void;
  /** More menu content before the items, for example a submenu. */
  children?: ReactNode;
}) {
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <Hint label={reason || 'Add context'} disabled={disabled}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="chip"
            className={cn('composer-add', composerChipClass, 'px-0 has-[>svg]:px-0')}
            aria-label="Add context"
            disabled={disabled}
          >
            <Plus className="size-4" />
          </Button>
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent align="start" width="wide">
        {children}
        {items.map((item) => (
          <DropdownMenuItem key={item.label} onSelect={item.onSelect}>
            {item.icon}
            {item.label}
            {item.shortcut && <DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The round Send button at the bottom right of the composer. */
export function ComposerSend({
  label = 'Send',
  shortcut,
  keyShortcuts,
  disabled,
  onClick,
  children,
}: {
  label?: string;
  shortcut?: string;
  keyShortcuts?: string;
  disabled?: boolean;
  onClick: () => void;
  /** The icon. Default: an arrow up. */
  children?: ReactNode;
}) {
  return (
    <Hint label={label} shortcut={shortcut} className="composer-send-slot">
      <Button
        className="composer-send rounded-full bg-foreground text-background hover:bg-foreground/90 disabled:bg-[var(--surface-selected)] disabled:text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5"
        aria-label={label}
        aria-keyshortcuts={keyShortcuts}
        size="icon-sm"
        disabled={disabled}
        onClick={onClick}
      >
        {children || <ArrowUp />}
      </Button>
    </Hint>
  );
}

const sendShortcut = shortcutLabel(['mod'], 'Enter');

/**
 * The one composer: a 14/22 text box with radius 16 and 12/16/8 padding, then a bar with the
 * pills on the left and the round Send at the bottom right. Send keeps its place while the
 * text changes. The chat and the project Overview use it.
 */
export function Composer({
  value,
  onValueChange,
  onSend,
  canSend,
  inputRef,
  placeholder = composerPlaceholder,
  inputLabel = 'Message agent',
  enterToSend = true,
  onKeyDown,
  inputProps,
  header,
  controls,
  action,
  sendLabel = 'Send',
  label,
  className,
}: {
  value: string;
  onValueChange: (value: string, caret: number) => void;
  onSend: () => void;
  /** False disables Send and the send key. */
  canSend: boolean;
  inputRef?: Ref<HTMLTextAreaElement>;
  placeholder?: string;
  /** The accessible name of the text box. */
  inputLabel?: string;
  /** Enter sends. Else ⌘Enter (Ctrl+Enter) sends and Enter adds a line. */
  enterToSend?: boolean;
  /** Runs first. Call preventDefault to stop the send key, for example in a picker. */
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  /** More attributes of the text box, for example aria-* or readOnly. */
  inputProps?: Omit<
    ComponentProps<'textarea'>,
    'value' | 'onChange' | 'onKeyDown' | 'placeholder' | 'ref' | 'className'
  >;
  /** Content above the text box: attachments, notices, the mention picker. */
  header?: ReactNode;
  /** The pills at the left of the bar. */
  controls?: ReactNode;
  /** Replaces Send, for example Stop or "Sign in to send". */
  action?: ReactNode;
  sendLabel?: string;
  /** The accessible name of the composer group. */
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn('conversation-composer @container/composer', className)}
      role={label ? 'group' : undefined}
      aria-label={label}
    >
      {header}
      <Textarea
        ref={inputRef}
        data-composer=""
        // The text box has no frame of its own: the composer is the frame. 14/22 text.
        className="max-h-[clamp(80px,20vh,180px)] min-h-[22px] resize-none rounded-none border-0 bg-transparent px-0 py-0 text-[14px] leading-[22px] shadow-none focus-visible:shadow-none"
        aria-label={inputLabel}
        aria-keyshortcuts={enterToSend ? 'Enter' : isMac ? 'Meta+Enter' : 'Control+Enter'}
        placeholder={placeholder}
        value={value}
        rows={1}
        {...inputProps}
        onChange={(event) =>
          onValueChange(
            event.target.value,
            event.target.selectionStart ?? event.target.value.length,
          )
        }
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          const sendKey = enterToSend ? !event.shiftKey : hasPrimaryModifier(event.nativeEvent);
          if (event.key === 'Enter' && sendKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (canSend) onSend();
          }
        }}
      />
      <div className="composer-actions">
        <div className="composer-settings">{controls}</div>
        {action || (
          <ComposerSend
            label={sendLabel}
            shortcut={enterToSend ? 'Enter' : sendShortcut}
            keyShortcuts={enterToSend ? 'Enter' : isMac ? 'Meta+Enter' : 'Control+Enter'}
            disabled={!canSend}
            onClick={onSend}
          />
        )}
      </div>
    </div>
  );
}
