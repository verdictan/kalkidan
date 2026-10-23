import type { Session } from './conversation';

/**
 * The one list of chat actions. The chat header menu, the chat row menus, the chat context
 * menus, the application menu bar and the command palette all read this list. Each surface
 * supplies only the code that runs an action.
 */

/** The action groups, in menu order. A separator goes between two groups. */
export const chatActionGroups = [
  'open',
  'organize',
  'work',
  'share',
  'developer',
  'archive',
] as const;
export type ChatActionGroup = (typeof chatActionGroups)[number];

/**
 * Where a menu shows the actions.
 * - `list`: the menu and the context menu of a chat row (sidebar and All chats).
 * - `header`: the Chat actions menu of the open chat.
 * - `menu-bar`: the Chat menu of the application menu bar. It acts on the open chat.
 * - `palette`: the command palette. It acts on the open chat.
 */
export type ChatActionSurface = 'list' | 'header' | 'menu-bar' | 'palette';
export type ChatActionPlatform = 'mac' | 'windows' | 'linux';

/**
 * What a menu knows about a chat. An optional value that is missing is not known. A value that
 * is not known never blocks an action: the chat view checks it again when it runs the action.
 */
export interface ChatActionState {
  /** The chat is the open chat of this window. */
  open: boolean;
  /** The agent created the chat. A new chat is saved after its first message. */
  saved: boolean;
  /** The agent works or waits for an answer in this chat. */
  running: boolean;
  pinned: boolean;
  archived: boolean;
  linkedTask: boolean;
  pullRequest: boolean;
  /** The number of the pull request of the chat, for "View pull request #N". */
  pullRequestNumber?: number;
  /** The chat is on a remote computer. */
  remote: boolean;
  /** The app can show the managed agent usage history. */
  usageHistory: boolean;
  /** Kalkidan knows the code folder of the chat. */
  repository?: boolean;
  /** The code folder of the chat is in a project. */
  project?: boolean;
  /** The code folder has no changes to commit. */
  noChanges?: boolean;
  /** The code folder has no changes and no commits that a pull request can take. */
  noBranchWork?: boolean;
  /** The project has a task board. False hides Link task. */
  board?: boolean;
  /** The linked task can be marked done now. Only then the menus show Mark task done. */
  canMarkDone?: boolean;
  /** The open chat is read only: the agent reads files and does not change them. */
  readOnly?: boolean;
}

export type ChatActionId =
  | 'open'
  | 'open-beside'
  | 'open-window'
  | 'rename'
  | 'pin'
  | 'link-task'
  | 'open-linked-task'
  | 'notes'
  | 'commit'
  | 'read-only'
  | 'mark-task-done'
  | 'create-pull-request'
  // "View pull request #N". The ID stays for the surfaces that open the pull request.
  | 'open-pull-request'
  | 'duplicate'
  | 'duplicate-here'
  | 'duplicate-branch'
  | 'fork'
  | 'show-folder'
  | 'share'
  | 'export-markdown'
  | 'export-html'
  | 'save-to-docs'
  | 'copy-markdown'
  | 'usage-history'
  | 'developer'
  | 'copy-id'
  | 'copy-path'
  | 'open-vscode'
  | 'open-cursor'
  | 'open-in'
  | 'export'
  | 'archive';

export type ChatShortcutModifier = 'mod' | 'alt' | 'shift';
export interface ChatShortcutKeys {
  modifiers: ChatShortcutModifier[];
  /** One capital letter. */
  key: string;
}
/** A shortcut for macOS and for Windows and Linux. */
export interface ChatShortcut {
  mac: ChatShortcutKeys;
  other: ChatShortcutKeys;
}

/** The code that a surface gives to run actions. */
export type ChatActionTarget = Partial<Record<ChatActionId, () => void>> & {
  /** Sends a session command to the chat view. Actions without own code use it. */
  command?: (name: ChatCommand) => void;
};

/** True, or the reason why the action is not available now. */
export type ChatActionAvailability = true | string;

export interface ChatActionDefinition {
  id: ChatActionId;
  label: string | ((state: ChatActionState, platform: ChatActionPlatform) => string);
  group: ChatActionGroup;
  /** Extra words for the command palette search. */
  keywords?: string;
  shortcut?: ChatShortcut;
  /** The session command that the menu bar and the palette send. Submenus have none. */
  command?: ChatCommand;
  /** Draws a separator above this item. Only submenu items use it. */
  separator?: boolean;
  enabled?: (state: ChatActionState) => ChatActionAvailability;
  visible?: (context: ChatActionContext) => boolean;
  children?: ChatActionDefinition[];
  /** Runs the action with the code of a surface. */
  run: (target: ChatActionTarget) => void;
}
export interface ChatActionContext {
  surface: ChatActionSurface;
  state: ChatActionState;
}

// On Windows and Linux, AltGr sends Ctrl+Alt, so Ctrl+Alt shortcuts do not arrive. There the
// session shortcuts use Ctrl+Shift. Ctrl+Shift+R is not used because it reloads the page.
const sessionShortcut = (mac: string, other: string): ChatShortcut => ({
  mac: { modifiers: ['mod', 'alt'], key: mac },
  other: { modifiers: ['mod', 'shift'], key: other },
});

export const reasons = {
  firstMessage: 'Send a message first.',
  running: 'Wait for the agent to finish.',
  noFolder: 'Kalkidan does not know the code folder of this chat.',
  noProject: 'Add this code folder to a project first.',
  noChanges: 'No changes to commit.',
  noBranchWork: 'No changes or commits for a pull request.',
  noPullRequest: 'This chat has not opened a pull request.',
  remote: 'The folder is on a remote computer.',
} as const;

type Check = (state: ChatActionState) => string | false;
const checks = {
  saved: (state) => !state.saved && reasons.firstMessage,
  idle: (state) => state.running && reasons.running,
  repository: (state) => state.repository === false && reasons.noFolder,
  project: (state) => state.project === false && reasons.noProject,
  local: (state) => state.remote && reasons.remote,
} satisfies Record<string, Check>;
/** The first reason that blocks the action, or true. */
const all =
  (...list: Check[]) =>
  (state: ChatActionState): ChatActionAvailability => {
    for (const check of list) {
      const reason = check(state);
      if (reason) return reason;
    }
    return true;
  };

type Definition = Omit<ChatActionDefinition, 'run' | 'children'> & {
  run?: ChatActionDefinition['run'];
  children?: Definition[];
};
const ids = new Set<string>();
function define(definition: Definition): ChatActionDefinition {
  if (ids.has(definition.id)) throw new Error(`Chat action ${definition.id} is defined twice`);
  ids.add(definition.id);
  const own = definition.command;
  return {
    ...definition,
    children: definition.children?.map(define),
    run:
      definition.run ||
      ((target) => {
        const handler = target[definition.id];
        if (handler) handler();
        else if (own) target.command?.(own);
      }),
  };
}

/** The chat actions in menu order. Each group keeps this order in every surface. */
export const chatActions: readonly ChatActionDefinition[] = [
  define({
    id: 'open',
    label: 'Open',
    group: 'open',
    // An open chat cannot open again. The menu bar and the palette act on the open chat.
    visible: ({ state }) => !state.open,
  }),
  // The side chat is removed (round 11). "Fork chat…" opens a new chat. The ID and the command
  // stay for old commands, but the action shows nowhere.
  define({
    id: 'open-beside',
    label: 'Open side chat',
    group: 'open',
    command: 'session-side-chat',
    visible: () => false,
  }),
  define({
    id: 'open-window',
    label: 'Open in new window',
    group: 'open',
    keywords: 'window separate',
    command: 'session-window',
    enabled: all(checks.saved),
  }),
  define({
    id: 'rename',
    label: 'Rename…',
    group: 'organize',
    keywords: 'title name',
    shortcut: sessionShortcut('R', 'E'),
    command: 'session-rename',
  }),
  define({
    id: 'pin',
    label: (state) => (state.pinned ? 'Unpin' : 'Pin'),
    group: 'organize',
    keywords: 'pin unpin top favorite',
    shortcut: sessionShortcut('P', 'P'),
    command: 'session-pin',
  }),
  define({
    id: 'link-task',
    label: 'Link task…',
    group: 'organize',
    keywords: 'issue board connect task',
    command: 'link-task',
    // A chat links one task. With a linked task, Open linked task shows. Without a board,
    // there is no task to link.
    visible: ({ state }) => !state.linkedTask && state.board !== false,
    enabled: all(checks.idle, checks.project),
  }),
  define({
    id: 'open-linked-task',
    label: 'Open linked task',
    group: 'organize',
    keywords: 'issue board task',
    command: 'open-linked-task',
    visible: ({ state }) => state.linkedTask,
  }),
  define({
    id: 'notes',
    label: 'Notes…',
    group: 'organize',
    keywords: 'note comment remember',
    command: 'session-notes',
  }),
  // Commit opens the Changes tab of the tool pane. "Commit only" is on the arrow of its
  // Create pull request button.
  define({
    id: 'commit',
    label: 'Commit changes…',
    group: 'work',
    keywords: 'git save changes commit',
    command: 'session-commit',
    enabled: all(checks.repository, checks.idle, (state) => !!state.noChanges && reasons.noChanges),
  }),
  // Each chat can edit its own branch copy. "Read only" stops the agent from changing files.
  define({
    id: 'read-only',
    label: (state) => (state.readOnly ? 'Allow file edits' : 'Read only'),
    group: 'work',
    keywords: 'read only access permission edit files lock',
    command: 'session-read-only',
    // Only the open chat knows its access.
    visible: ({ state }) => state.open && state.readOnly !== undefined,
    enabled: all(checks.idle),
  }),
  define({
    id: 'mark-task-done',
    label: 'Mark task done',
    group: 'work',
    keywords: 'task done finish close complete board',
    command: 'session-mark-task-done',
    visible: ({ state }) => !!state.canMarkDone,
    enabled: all(checks.idle),
  }),
  define({
    id: 'create-pull-request',
    label: 'Create pull request…',
    group: 'work',
    keywords: 'github pr push publish review',
    command: 'session-create-pull-request',
    // A chat has one pull request. With a pull request, View pull request shows.
    visible: ({ state }) => !state.pullRequest,
    enabled: all(
      checks.repository,
      checks.idle,
      (state) => !!state.noBranchWork && reasons.noBranchWork,
    ),
  }),
  define({
    id: 'open-pull-request',
    label: (state) =>
      state.pullRequestNumber
        ? `View pull request #${state.pullRequestNumber}`
        : 'View pull request',
    group: 'work',
    keywords: 'github pr review open',
    command: 'open-pull-request',
    visible: ({ state }) => state.pullRequest,
  }),
  // "Fork chat…" is the one way to copy a chat. Its dialog offers this folder, a new branch, or
  // another agent or computer. The duplicate actions stay for old commands but show nowhere.
  define({
    id: 'duplicate',
    label: 'Duplicate chat',
    group: 'work',
    visible: () => false,
    enabled: all(checks.saved, checks.idle),
    children: [
      {
        id: 'duplicate-here',
        label: 'Continue here',
        group: 'work',
        keywords: 'duplicate fork copy chat',
        command: 'session-duplicate',
      },
      {
        id: 'duplicate-branch',
        label: 'Continue on a new branch…',
        group: 'work',
        keywords: 'duplicate fork worktree branch copy',
        command: 'session-duplicate-branch',
        enabled: all(checks.repository),
      },
    ],
  }),
  define({
    id: 'fork',
    label: 'Fork chat…',
    group: 'work',
    keywords: 'fork duplicate continue copy branch agent computer host',
    command: 'session-fork',
    // A read-only chat of another account can also fork. The fork is a new chat.
    enabled: all(checks.saved),
  }),
  define({
    id: 'show-folder',
    label: (_state, platform) =>
      `Show folder in ${platform === 'mac' ? 'Finder' : platform === 'windows' ? 'File Explorer' : 'file manager'}`,
    group: 'work',
    keywords: 'reveal folder finder explorer',
    command: 'session-show-folder',
    enabled: all(checks.saved, checks.local),
  }),
  define({
    id: 'share',
    label: 'Share',
    group: 'share',
    enabled: all(checks.saved, checks.idle),
    children: [
      {
        id: 'export-markdown',
        label: 'Export Markdown…',
        group: 'share',
        keywords: 'share export save file',
        command: 'session-export-markdown',
      },
      {
        id: 'export-html',
        label: 'Export HTML…',
        group: 'share',
        keywords: 'share export save file web',
        command: 'session-export-html',
      },
      {
        id: 'save-to-docs',
        label: 'Save to Docs…',
        group: 'share',
        keywords: 'share docs wiki page',
        command: 'save-to-docs',
        separator: true,
        enabled: all(checks.project),
      },
    ],
  }),
  define({
    id: 'copy-markdown',
    label: 'Copy chat as Markdown',
    group: 'share',
    keywords: 'copy transcript clipboard',
    command: 'session-copy-markdown',
    enabled: all(checks.saved, checks.idle),
  }),
  define({
    id: 'usage-history',
    label: 'Usage history…',
    group: 'share',
    keywords: 'tokens cost requests managed',
    command: 'session-usage-history',
    // The history needs managed agents. A chat on an SSH host has a history too.
    visible: ({ state }) => state.usageHistory,
    enabled: all(checks.saved),
  }),
  define({
    id: 'developer',
    label: 'Developer',
    group: 'developer',
    enabled: all(checks.saved),
    children: [
      {
        id: 'copy-id',
        label: 'Copy chat ID',
        group: 'developer',
        keywords: 'developer identifier',
        command: 'session-copy-id',
      },
      {
        id: 'copy-path',
        label: 'Copy folder path',
        group: 'developer',
        keywords: 'developer directory',
        command: 'session-copy-path',
      },
      {
        id: 'open-vscode',
        label: 'Open in VS Code',
        group: 'developer',
        keywords: 'developer editor code',
        command: 'session-open-vscode',
        separator: true,
        enabled: all(checks.local),
      },
      {
        id: 'open-cursor',
        label: 'Open in Cursor',
        group: 'developer',
        keywords: 'developer editor',
        command: 'session-open-cursor',
        enabled: all(checks.local),
      },
    ],
  }),
  define({
    id: 'archive',
    label: (state) => (state.archived ? 'Restore' : 'Archive'),
    group: 'archive',
    keywords: 'archive hide remove restore',
    shortcut: {
      mac: { modifiers: ['mod', 'shift'], key: 'A' },
      other: { modifiers: ['mod', 'shift'], key: 'A' },
    },
    command: 'session-archive',
    enabled: all(checks.idle),
  }),
];

/** The session commands, in menu order. The menu bar and the palette send them. */
export const chatCommands = [
  'session-side-chat',
  'session-window',
  'session-rename',
  'session-pin',
  'link-task',
  'open-linked-task',
  'session-notes',
  'session-commit',
  'session-read-only',
  'session-mark-task-done',
  'session-create-pull-request',
  'open-pull-request',
  'session-duplicate',
  'session-duplicate-branch',
  'session-fork',
  'session-show-folder',
  'session-export-markdown',
  'session-export-html',
  'save-to-docs',
  'session-copy-markdown',
  'session-usage-history',
  'session-copy-id',
  'session-copy-path',
  'session-open-vscode',
  'session-open-cursor',
  'session-archive',
] as const;
export type ChatCommand = (typeof chatCommands)[number];
export const isChatCommand = (value: string): value is ChatCommand =>
  (chatCommands as readonly string[]).includes(value);

/** All actions, with the submenu items after their submenu. */
export function flatChatActions(list: readonly ChatActionDefinition[] = chatActions) {
  return list.flatMap((action): ChatActionDefinition[] => [
    action,
    ...flatChatActions(action.children || []),
  ]);
}
export function chatAction(id: ChatActionId) {
  return flatChatActions().find((action) => action.id === id);
}
export function chatActionForCommand(command: string) {
  return flatChatActions().find((action) => action.command === command);
}

/** An action as one surface shows it now. */
export interface ChatMenuItem {
  id: ChatActionId;
  label: string;
  group: ChatActionGroup;
  shortcut?: ChatShortcut;
  command?: ChatCommand;
  keywords?: string;
  disabled: boolean;
  /** Why the item is disabled. */
  reason?: string;
  separator?: boolean;
  children?: ChatMenuItem[];
  definition: ChatActionDefinition;
}
export interface ChatMenuGroup {
  group: ChatActionGroup;
  items: ChatMenuItem[];
}

function availability(action: ChatActionDefinition, state: ChatActionState) {
  return action.enabled ? action.enabled(state) : true;
}
/** True, or the reason why the action cannot run now. A submenu item also checks its submenu. */
export function chatActionAvailability(
  id: ChatActionId,
  state: ChatActionState,
): ChatActionAvailability {
  const parent = chatActions.find((action) => action.children?.some((child) => child.id === id));
  const action = chatAction(id);
  if (!action) return 'Unknown action.';
  const outer = parent ? availability(parent, state) : true;
  return outer === true ? availability(action, state) : outer;
}

function resolve(
  action: ChatActionDefinition,
  context: ChatActionContext,
  platform: ChatActionPlatform,
): ChatMenuItem | null {
  if (action.visible && !action.visible(context)) return null;
  const available = availability(action, context.state);
  const children = action.children
    ?.map((child) => resolve(child, context, platform))
    .filter((child): child is ChatMenuItem => !!child);
  if (children && !children.length) return null;
  return {
    id: action.id,
    label:
      typeof action.label === 'function' ? action.label(context.state, platform) : action.label,
    group: action.group,
    shortcut: action.shortcut,
    command: action.command,
    keywords: action.keywords,
    disabled: available !== true,
    reason: available === true ? undefined : available,
    separator: action.separator,
    children,
    definition: action,
  };
}

/**
 * The layout of the chat row menu and the Chat actions menu: two levels, few items. A click on a
 * row opens the chat, so the menu has no Open. The pull request is not in these menus: the
 * Changes tab of the chat ships it. Commit is on the arrow of Create pull request. Mark task done
 * shows only when it can run. Notes, export and usage history are in ⌘K and the menu bar.
 */
type MenuEntry =
  ChatActionId | { id: 'open-in' | 'export'; label: string; children: ChatActionId[] };
const chatMenuLayout: { group: ChatActionGroup; items: MenuEntry[] }[] = [
  { group: 'organize', items: ['rename', 'pin', 'link-task', 'open-linked-task'] },
  {
    group: 'work',
    items: [
      'read-only',
      'mark-task-done',
      'fork',
      {
        id: 'open-in',
        label: 'Open in',
        children: ['show-folder', 'open-vscode', 'open-cursor', 'open-window'],
      },
    ],
  },
  { group: 'archive', items: ['archive'] },
];
/** Items of the layout that show only in some states. */
const layoutVisible: Partial<Record<ChatActionId, (state: ChatActionState) => boolean>> = {};
/** The submenus of the layout. They have no command and run nothing themselves. */
function submenuAction(id: 'open-in' | 'export', label: string): ChatActionDefinition {
  return { id, label, group: id === 'open-in' ? 'work' : 'share', run: () => {} };
}
/** The menu item of an action, with the reason of its submenu when the submenu is blocked. */
function menuItem(
  id: ChatActionId,
  context: ChatActionContext,
  platform: ChatActionPlatform,
): ChatMenuItem | null {
  const action = chatAction(id);
  if (!action) return null;
  const item = resolve(action, context, platform);
  if (!item) return null;
  const available = chatActionAvailability(id, context.state);
  return available === true
    ? { ...item, separator: false }
    : { ...item, separator: false, disabled: true, reason: available };
}

/**
 * The actions that one surface shows for a chat, in groups and in menu order. The chat row menu
 * and the Chat actions menu show their items in two levels. The menu bar and the palette show
 * all actions.
 */
export function chatActionMenu(
  surface: ChatActionSurface,
  state: ChatActionState,
  platform: ChatActionPlatform,
): ChatMenuGroup[] {
  const context = { surface, state };
  if (surface === 'menu-bar' || surface === 'palette')
    return chatActionGroups
      .map((group) => ({
        group,
        items: chatActions
          .filter((action) => action.group === group)
          .map((action) => resolve(action, context, platform))
          .filter((item): item is ChatMenuItem => !!item),
      }))
      .filter((entry) => entry.items.length > 0);
  return chatMenuLayout
    .map(({ group, items }) => ({
      group,
      items: items
        .map((entry): ChatMenuItem | null => {
          if (typeof entry === 'string') {
            if (layoutVisible[entry] && !layoutVisible[entry]!(state)) return null;
            const item = menuItem(entry, context, platform);
            // A submenu of the definitions shows its items without separators.
            return item?.children
              ? {
                  ...item,
                  children: item.children.map((child) => ({ ...child, separator: false })),
                }
              : item;
          }
          const children = entry.children
            .map((id) => menuItem(id, context, platform))
            .filter((item): item is ChatMenuItem => !!item);
          if (!children.length) return null;
          return {
            id: entry.id,
            label: entry.label,
            group,
            disabled: children.every((child) => child.disabled),
            children,
            definition: submenuAction(entry.id, entry.label),
          };
        })
        .filter((item): item is ChatMenuItem => !!item),
    }))
    .filter((entry) => entry.items.length > 0);
}

/** The menu items without submenus. Each submenu item takes the reason of its submenu. */
export function leafChatActions(groups: ChatMenuGroup[]): ChatMenuItem[] {
  return groups.flatMap((entry) =>
    entry.items.flatMap((item) =>
      item.children
        ? item.children.map((child) =>
            item.disabled ? { ...child, disabled: true, reason: item.reason } : child,
          )
        : [item],
    ),
  );
}

/** The keys of a shortcut on one platform. */
export function chatShortcutKeys(shortcut: ChatShortcut, platform: ChatActionPlatform) {
  return platform === 'mac' ? shortcut.mac : shortcut.other;
}
/** The Electron accelerator of a shortcut, such as "Cmd+Alt+R" or "Ctrl+Shift+E". */
export function chatAccelerator(shortcut: ChatShortcut, platform: ChatActionPlatform) {
  const keys = chatShortcutKeys(shortcut, platform);
  const names = { mod: platform === 'mac' ? 'Cmd' : 'Ctrl', alt: 'Alt', shift: 'Shift' };
  const order: ChatShortcutModifier[] = ['mod', 'alt', 'shift'];
  return [...order.filter((m) => keys.modifiers.includes(m)).map((m) => names[m]), keys.key].join(
    '+',
  );
}
/** The action whose shortcut matches a key press, if any. */
export function chatActionForKey(
  event: Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  platform: ChatActionPlatform,
) {
  const mod = platform === 'mac' ? event.metaKey : event.ctrlKey && !event.altKey;
  if (!mod) return undefined;
  return flatChatActions().find((action) => {
    if (!action.shortcut) return false;
    const keys = chatShortcutKeys(action.shortcut, platform);
    return (
      event.code === 'Key' + keys.key &&
      event.altKey === keys.modifiers.includes('alt') &&
      event.shiftKey === keys.modifiers.includes('shift')
    );
  });
}

/** The state that the session record alone gives. Each surface adds what it knows. */
export function sessionActionState(
  session: Session,
  known: Partial<ChatActionState> = {},
): ChatActionState {
  const organization = session.organization || {};
  return {
    open: false,
    saved: !session.id.startsWith('draft-'),
    running: false,
    pinned: !!organization.pinned,
    archived: !!organization.archived,
    linkedTask: !!(organization.taskId || session.task?.id),
    pullRequest: !!organization.pullRequest?.url,
    ...(organization.pullRequest?.number
      ? { pullRequestNumber: organization.pullRequest.number }
      : {}),
    remote: !!session.hostId,
    usageHistory: false,
    ...known,
  };
}

const stateKeys: (keyof ChatActionState)[] = [
  'open',
  'saved',
  'running',
  'pinned',
  'archived',
  'linkedTask',
  'pullRequest',
  'remote',
  'usageHistory',
];
const optionalKeys: (keyof ChatActionState)[] = [
  'repository',
  'project',
  'noChanges',
  'noBranchWork',
  'board',
  'canMarkDone',
  'readOnly',
];
/** Reads a state from an untrusted value, such as an IPC message. Returns null when invalid. */
export function parseChatActionState(value: unknown): ChatActionState | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (stateKeys.some((key) => typeof record[key] !== 'boolean')) return null;
  const state = Object.fromEntries(stateKeys.map((key) => [key, record[key]])) as Record<
    string,
    boolean
  >;
  for (const key of optionalKeys) if (typeof record[key] === 'boolean') state[key] = record[key];
  const number = record.pullRequestNumber;
  const parsed = state as unknown as ChatActionState;
  if (typeof number === 'number' && Number.isSafeInteger(number) && number > 0)
    parsed.pullRequestNumber = number;
  return parsed;
}
