import type { MenuItemConstructorOptions } from 'electron';
import type { MenuCommand } from '../src/api/contracts';

export interface AppMenuOptions {
  mac: boolean;
  /** Packaged builds do not show Reload and the developer tools. */
  packaged: boolean;
  appName: string;
  command: (name: MenuCommand) => () => void;
  openExternal: (url: string) => void;
}

/**
 * Builds the application menu. All labels use sentence case, like the rest of the UI.
 * Items with a role also get a label, because Electron gives roles Title Case labels.
 */
export function appMenuTemplate({
  mac,
  packaged,
  appName,
  command,
  openExternal,
}: AppMenuOptions): MenuItemConstructorOptions[] {
  const separator: MenuItemConstructorOptions = { type: 'separator' };
  return [
    ...(mac
      ? [
          {
            label: appName,
            submenu: [
              { role: 'about', label: `About ${appName}` },
              { label: 'Check for updates…', click: command('check-updates') },
              separator,
              { label: 'Settings…', accelerator: 'Cmd+,', click: command('settings') },
              separator,
              { role: 'services', label: 'Services' },
              separator,
              { role: 'hide', label: `Hide ${appName}` },
              { role: 'hideOthers', label: 'Hide others' },
              { role: 'unhide', label: 'Show all' },
              separator,
              { role: 'quit', label: `Quit ${appName}` },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New project', accelerator: 'CmdOrCtrl+N', click: command('new-project') },
        {
          label: 'Add code folder…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: command('add-code-folder'),
        },
        { label: 'New task', accelerator: 'CmdOrCtrl+Shift+K', click: command('new-task') },
        // The renderer handles this key at once, so typed text does not reach the focused field.
        {
          label: 'Search',
          accelerator: 'CmdOrCtrl+K',
          registerAccelerator: false,
          click: command('search'),
        },
        separator,
        ...(mac
          ? []
          : ([
              { label: 'Settings', accelerator: 'Ctrl+,', click: command('settings') },
              separator,
            ] satisfies MenuItemConstructorOptions[])),
        // The renderer closes the open tool tab or session. With no session, it closes the window.
        { label: 'Close tab', accelerator: 'CmdOrCtrl+W', click: command('close-tab') },
        { role: 'close', label: 'Close window', accelerator: 'Shift+CmdOrCtrl+W' },
        ...(mac ? [] : ([{ role: 'quit', label: 'Quit' }] satisfies MenuItemConstructorOptions[])),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo', label: 'Undo' },
        { role: 'redo', label: 'Redo' },
        separator,
        { role: 'cut', label: 'Cut' },
        { role: 'copy', label: 'Copy' },
        { role: 'paste', label: 'Paste' },
        ...(mac
          ? ([
              { role: 'pasteAndMatchStyle', label: 'Paste and match style' },
            ] satisfies MenuItemConstructorOptions[])
          : []),
        { role: 'delete', label: 'Delete' },
        { role: 'selectAll', label: 'Select all' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle sidebar', accelerator: 'CmdOrCtrl+B', click: command('toggle-sidebar') },
        separator,
        ...(packaged
          ? []
          : ([
              { role: 'reload', label: 'Reload' },
              { role: 'toggleDevTools', label: 'Toggle developer tools' },
              separator,
            ] satisfies MenuItemConstructorOptions[])),
        { role: 'resetZoom', label: 'Actual size' },
        { role: 'zoomIn', label: 'Zoom in' },
        { role: 'zoomOut', label: 'Zoom out' },
        separator,
        { role: 'togglefullscreen', label: 'Toggle full screen' },
      ],
    },
    {
      label: 'Go',
      submenu: [
        { label: 'Back', accelerator: 'CmdOrCtrl+[', click: command('back') },
        { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: command('forward') },
        separator,
        // These open a page of the current project. Without a project, the renderer does nothing.
        { label: 'Overview', accelerator: 'CmdOrCtrl+1', click: command('go-overview') },
        { label: 'Tasks', accelerator: 'CmdOrCtrl+2', click: command('go-tasks') },
        { label: 'Docs', accelerator: 'CmdOrCtrl+3', click: command('go-docs') },
        { label: 'Memory', accelerator: 'CmdOrCtrl+4', click: command('go-memory') },
        { label: 'Insights', accelerator: 'CmdOrCtrl+5', click: command('go-insights') },
        separator,
        { label: 'All chats', accelerator: 'CmdOrCtrl+Shift+L', click: command('all-sessions') },
      ],
    },
    {
      // The renderer sends these commands to the open chat.
      label: 'Chat',
      submenu: [
        { label: 'New chat', accelerator: 'CmdOrCtrl+Shift+N', click: command('session-new') },
        separator,
        // The renderer handles these keys in the session view, so the menu only shows them.
        {
          label: 'Terminal',
          accelerator: 'Ctrl+`',
          registerAccelerator: false,
          click: command('session-terminal'),
        },
        {
          label: 'Changes',
          accelerator: 'CmdOrCtrl+Shift+G',
          registerAccelerator: false,
          click: command('session-changes'),
        },
        separator,
        { label: 'Rename…', click: command('session-rename') },
        { label: 'Pin', click: command('session-pin') },
        { label: 'Open a second chat beside this one', click: command('session-side-chat') },
        { label: 'Commit…', click: command('session-commit') },
        separator,
        { label: 'Open linked task', click: command('open-linked-task') },
        { label: 'Link task…', click: command('link-task') },
        { label: 'Open pull request', click: command('open-pull-request') },
        separator,
        { label: 'Archive', click: command('session-archive') },
      ],
    },
    {
      // The window role makes macOS add the open windows to this menu.
      role: 'window',
      label: 'Window',
      submenu: [
        { role: 'minimize', label: 'Minimize' },
        { role: 'zoom', label: 'Zoom' },
        ...(mac
          ? ([
              separator,
              { role: 'front', label: 'Bring all to front' },
            ] satisfies MenuItemConstructorOptions[])
          : ([
              { role: 'close', label: 'Close', accelerator: 'Shift+CmdOrCtrl+W' },
            ] satisfies MenuItemConstructorOptions[])),
      ],
    },
    {
      role: 'help',
      label: 'Help',
      submenu: [
        { label: 'Get started', click: command('get-started') },
        { label: 'Keyboard shortcuts', accelerator: 'CmdOrCtrl+/', click: command('shortcuts') },
        ...(mac
          ? []
          : ([
              separator,
              { label: 'Check for updates…', click: command('check-updates') },
            ] satisfies MenuItemConstructorOptions[])),
        separator,
        {
          label: `${appName} user guide`,
          click: () =>
            openExternal('https://github.com/verdictan/kalkidan/blob/main/docs/user-guide.md'),
        },
        {
          label: 'Report an issue',
          click: () => openExternal('https://github.com/verdictan/kalkidan/issues'),
        },
      ],
    },
  ];
}
