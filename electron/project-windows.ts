/** The part of a window that the project window list uses. Electron's BrowserWindow has it. */
export interface ProjectWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  close(): void;
  once(event: 'closed', listener: () => void): unknown;
}

/**
 * One window for each project. Opening a project that has a window focuses that window. The
 * list event tells each window which projects have their own window, so the main window can
 * mark them. A project returns to the main tree when its window closes.
 */
export class ProjectWindows<W extends ProjectWindow> {
  private windows = new Map<string, W>();
  constructor(
    private options: {
      /** Makes the window of a project. It loads the app with the project scope. */
      create(groupId: string): W;
      /** Sends the group IDs that have their own window to every window. */
      changed(groupIds: string[]): void;
      /** True when the project exists. */
      exists(groupId: string): boolean;
    },
  ) {}
  list() {
    return [...this.windows.keys()];
  }
  /** The project of a window, or undefined for the main window. */
  projectOf(window: W) {
    for (const [groupId, item] of this.windows) if (item === window) return groupId;
    return undefined;
  }
  open(groupId: unknown) {
    if (typeof groupId !== 'string' || !groupId || groupId.length > 200)
      throw new Error('Project not found.');
    if (!this.options.exists(groupId)) throw new Error('Project not found.');
    const open = this.windows.get(groupId);
    if (open && !open.isDestroyed()) {
      if (open.isMinimized()) open.restore();
      open.show();
      open.focus();
      return;
    }
    const window = this.options.create(groupId);
    this.windows.set(groupId, window);
    window.once('closed', () => {
      if (this.windows.get(groupId) !== window) return;
      this.windows.delete(groupId);
      this.options.changed(this.list());
    });
    this.options.changed(this.list());
  }
  /** Closes the window of a project, for example after the project is removed. */
  close(groupId: string) {
    const window = this.windows.get(groupId);
    if (window && !window.isDestroyed()) window.close();
  }
}
