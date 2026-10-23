import { EditorState } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import type { API } from '../../api/contracts';
import { splitPath } from '../../domain/code-navigation';
import { showToast } from '../ui/toast';
import {
  createDocument,
  languageSlot,
  lineSelection,
  reloadDocument,
  viewHandlers,
} from './extensions';
import { languageFor } from './languages';
import { changed, codeFolder, requestPath, updateTab, type CodeTab } from './store';

export interface ControllerProps {
  api: API;
  cwd: string;
  hostId?: string;
  agentPaths?: string[];
  key: string;
}

function message(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * The work of one mounted code editor: open, load, save, reload and close files, and the
 * CodeMirror view. The open files themselves are in the store, so they stay after unmount.
 */
export class CodeController {
  props: ControllerProps;
  view: EditorView | null = null;
  /** The path of the tab whose document the view shows. */
  shown: string | null = null;
  private epochs = new Map<string, number>();
  private gotoCount = 0;
  private focusPending = false;
  onCaret: (caret: { line: number; column: number }) => void = () => {};
  onClosePrompt: (path: string) => void = () => {};

  constructor(props: ControllerProps) {
    this.props = props;
  }

  get key() {
    return this.props.key;
  }

  find(path: string) {
    return codeFolder(this.key).tabs.find((tab) => tab.path === path);
  }

  private epoch(path: string) {
    return this.epochs.get(path) ?? 0;
  }

  /** Creates the view in the element. Returns the cleanup. */
  mount(parent: HTMLElement) {
    const editor = new EditorView({ parent, state: EditorState.create() });
    this.view = editor;
    viewHandlers.set(editor, (update) => this.onUpdate(update));
    return () => {
      const tab = this.shown ? this.find(this.shown) : undefined;
      if (tab) tab.state = editor.state;
      viewHandlers.delete(editor);
      editor.destroy();
      this.view = null;
      this.shown = null;
    };
  }

  private caretOf(state: EditorState) {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    return { line: line.number, column: head - line.from + 1 };
  }

  private onUpdate(update: ViewUpdate) {
    const tab = this.shown ? this.find(this.shown) : undefined;
    if (!tab) return;
    tab.state = update.state;
    if (update.docChanged) {
      const dirty =
        update.state.doc.length !== tab.savedText.length ||
        update.state.doc.toString() !== tab.savedText;
      if (dirty !== tab.dirty) updateTab(this.key, tab.path, { dirty });
    }
    if (update.docChanged || update.selectionSet) this.onCaret(this.caretOf(update.state));
  }

  /** Shows the document of the active tab, and goes to its requested line. */
  sync(focus: boolean) {
    const editor = this.view;
    const folder = codeFolder(this.key);
    const tab = folder.tabs.find((item) => item.path === folder.active);
    if (!editor || !tab?.state) {
      this.shown = null;
      return;
    }
    if (this.shown !== tab.path || editor.state !== tab.state) {
      editor.setState(tab.state);
      this.shown = tab.path;
      this.onCaret(this.caretOf(tab.state));
    }
    const goto = tab.goto;
    if (goto) {
      tab.goto = undefined;
      const selection = lineSelection(editor.state, goto.line, goto.column);
      editor.dispatch({
        selection,
        effects: EditorView.scrollIntoView(selection.main.head, { y: 'center' }),
      });
      this.focusPending = true;
    }
    // A request can come while the tab is still hidden. The focus moves when it shows.
    if (focus && this.focusPending) {
      this.focusPending = false;
      // After the pane shows. Go to file keeps the focus while it is open.
      requestAnimationFrame(() => {
        if (this.view === editor && !document.activeElement?.closest('.code-quick')) editor.focus();
      });
    }
  }

  /** Go to file opened: the focus stays in it. */
  keepFocus() {
    this.focusPending = false;
  }

  private async agentLines(path: string) {
    // The chat edits its own checkout, so the lines that differ from the last commit are the
    // agent's lines. Your lines come from your edits in this editor.
    const { api, cwd, hostId } = this.props;
    try {
      return (await api.codeFileChanges?.(cwd, path, hostId))?.lines ?? [];
    } catch {
      return [];
    }
  }

  private applyLanguage(path: string) {
    void languageFor(path).then((extension) => {
      const tab = this.find(path);
      if (!extension || !tab?.state) return;
      const effects = languageSlot.reconfigure(extension);
      if (this.shown === path && this.view) this.view.dispatch({ effects });
      else {
        tab.state = tab.state.update({ effects }).state;
        changed();
      }
    });
  }

  private async load(path: string) {
    const { api, cwd, hostId } = this.props;
    if (!api.codeFileRead) {
      updateTab(this.key, path, { loading: false, error: 'Open Kalkidan to edit files.' });
      return;
    }
    try {
      const [file, lines] = await Promise.all([
        api.codeFileRead(cwd, path, hostId),
        this.agentLines(path),
      ]);
      if (file.content === undefined) {
        updateTab(this.key, path, {
          loading: false,
          note: file.note || 'binary',
          size: file.size,
          revision: file.revision,
        });
        return;
      }
      updateTab(this.key, path, {
        loading: false,
        error: undefined,
        note: undefined,
        state: createDocument(file.content, lines),
        agentChanged: lines.length > 0,
        savedText: file.content,
        revision: file.revision,
        size: file.size,
      });
      this.applyLanguage(path);
    } catch (error) {
      updateTab(this.key, path, {
        loading: false,
        error: message(error, 'The file did not open.'),
      });
    }
  }

  /** Opens a file as the active tab, at a line when one is given. */
  open(value: string, line?: number, column?: number) {
    const path = requestPath(value);
    const folder = codeFolder(this.key);
    folder.recent = [path, ...folder.recent.filter((item) => item !== path)].slice(0, 20);
    const goto = line ? { line, column, n: ++this.gotoCount } : undefined;
    const existing = folder.tabs.find((tab) => tab.path === path);
    if (existing) {
      if (goto) existing.goto = goto;
      folder.active = path;
      if (existing.error) {
        existing.error = undefined;
        existing.loading = true;
        void this.load(path);
      }
      changed();
      return;
    }
    const tab: CodeTab = {
      path,
      loading: true,
      revision: '',
      savedText: '',
      dirty: false,
      saving: false,
      goto,
    };
    const index = folder.tabs.findIndex((item) => item.path === folder.active);
    folder.tabs.splice(index + 1, 0, tab);
    folder.active = path;
    changed();
    void this.load(path);
  }

  /** Loads the file list for go to file. A list newer than 30 s stays. */
  loadFiles() {
    const { api, cwd, hostId } = this.props;
    const folder = codeFolder(this.key);
    if (!api.codeFiles || (folder.files && Date.now() - (folder.filesAt ?? 0) < 30000)) return;
    folder.filesAt = Date.now();
    api
      .codeFiles(cwd, hostId)
      .then((result) => {
        folder.files = result.files;
        folder.filesError = undefined;
        changed();
      })
      .catch((error: unknown) => {
        folder.filesAt = 0;
        folder.filesError = message(error, 'The files did not load.');
        changed();
      });
  }

  search(query: string) {
    const { api, cwd, hostId } = this.props;
    if (!api.codeSearch) return Promise.reject(new Error('Open Kalkidan to find text.'));
    return api.codeSearch(cwd, query, hostId);
  }

  activate(path: string) {
    codeFolder(this.key).active = path;
    changed();
  }

  /** Closes a tab. A tab with unsaved text asks first, unless `force`. */
  close(path: string, force = false) {
    const folder = codeFolder(this.key);
    const index = folder.tabs.findIndex((tab) => tab.path === path);
    if (index < 0) return;
    if (folder.tabs[index].dirty && !force) {
      this.onClosePrompt(path);
      return;
    }
    folder.tabs.splice(index, 1);
    if (folder.active === path)
      folder.active = (folder.tabs[index] ?? folder.tabs[index - 1])?.path ?? null;
    this.epochs.delete(path);
    changed();
  }

  /**
   * Saves the text. Without `revision`, the save expects the revision that the tab opened. With
   * it (Keep mine), the save replaces that revision on disk.
   */
  async save(path: string, revision?: string) {
    const { api, cwd, hostId } = this.props;
    const tab = this.find(path);
    if (!tab?.state || tab.saving || !api.codeFileWrite) return;
    if (!tab.dirty && !revision) return;
    const text = tab.state.doc.toString();
    const previous = tab.savedText;
    this.epochs.set(path, this.epoch(path) + 1);
    updateTab(this.key, path, { saving: true });
    try {
      const result = await api.codeFileWrite(cwd, path, text, revision ?? tab.revision, hostId);
      const now = this.find(path);
      if (!now) return;
      if (!result.ok) {
        updateTab(this.key, path, { saving: false, conflict: { revision: result.revision } });
        return;
      }
      const current = now.state ? now.state.doc.toString() : text;
      updateTab(this.key, path, {
        saving: false,
        conflict: undefined,
        revision: result.revision,
        savedText: text,
        dirty: current !== text,
      });
      showToast({
        message: `Saved ${splitPath(path).name}`,
        duration: 5000,
        actions: [{ label: 'Undo', onClick: () => this.undoSave(path, previous, result.revision) }],
      });
    } catch (error) {
      updateTab(this.key, path, { saving: false });
      showToast({ message: message(error, 'The file was not saved.'), tone: 'error' });
    }
  }

  private undoSave(path: string, previous: string, revision: string) {
    const tab = this.find(path);
    if (!tab?.state || tab.revision !== revision) return;
    const change = { changes: { from: 0, to: tab.state.doc.length, insert: previous } };
    if (this.shown === path && this.view) this.view.dispatch(change);
    else tab.state = tab.state.update(change).state;
    updateTab(this.key, path, { dirty: true });
    void this.save(path);
  }

  /** Replaces the text with the file on disk. */
  async reload(path: string) {
    const { api, cwd, hostId } = this.props;
    if (!api.codeFileRead) return;
    const epoch = this.epoch(path);
    try {
      const [file, lines] = await Promise.all([
        api.codeFileRead(cwd, path, hostId),
        this.agentLines(path),
      ]);
      const tab = this.find(path);
      if (!tab?.state || this.epoch(path) !== epoch) return;
      if (file.content === undefined) {
        updateTab(this.key, path, {
          state: undefined,
          note: file.note || 'binary',
          conflict: undefined,
          dirty: false,
        });
        return;
      }
      const next = reloadDocument(tab.state, file.content, lines);
      if (this.shown === path && this.view) this.view.setState(next);
      updateTab(this.key, path, {
        state: next,
        agentChanged: lines.length > 0,
        savedText: file.content,
        revision: file.revision,
        size: file.size,
        dirty: false,
        conflict: undefined,
      });
    } catch (error) {
      showToast({ message: message(error, 'The file did not open.'), tone: 'error' });
    }
  }

  /**
   * Compares the file on disk with the tab. An agent edit reloads a tab without unsaved text.
   * With unsaved text, the tab shows the conflict.
   */
  async check(path: string, live: () => boolean) {
    const { api, cwd, hostId } = this.props;
    const tab = this.find(path);
    if (!api.codeFileRevision || !tab?.state || tab.saving) return;
    const epoch = this.epoch(path);
    let revision: string | null;
    try {
      revision = await api.codeFileRevision(cwd, path, hostId);
    } catch {
      return;
    }
    const now = this.find(path);
    if (!live() || !now || now.saving || this.epoch(path) !== epoch) return;
    if (revision === now.revision) {
      if (now.conflict) updateTab(this.key, path, { conflict: undefined });
      return;
    }
    if (now.conflict?.revision === revision) return;
    if (!now.dirty && revision !== null) await this.reload(path);
    else updateTab(this.key, path, { conflict: { revision } });
  }
}
