import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { API } from '../../api/contracts';
import { identityVar, type IdentityColor } from '../../domain/identity';
import { fileSymbols, splitPath } from '../../domain/code-navigation';
import { StatusGlyph } from '../ui/status-glyph';
import { Button } from '../ui/button';
import { ConfirmDialog } from '../confirm-dialog';
import { CodeController } from './controller';
import { QuickOpen, type QuickOpenPick } from './quick-open';
import {
  codeFolder,
  codeVersion,
  folderKey,
  onOpenFileRequest,
  subscribeCode,
  takeOpenFileRequest,
} from './store';
import './code-editor.css';

export interface CodeEditorProps {
  api: API;
  /** The repository root of the chat checkout. */
  cwd: string;
  /** The SSH host of the checkout. Undefined: this computer. */
  hostId?: string;
  repositoryId?: string;
  /** The repo mark and name in the tabs and the file header. */
  repository?: { name: string; color: IdentityColor };
  /** The session that edits the files. Agent lines use its color. */
  session?: { id: string; title: string; color: IdentityColor };
  /** The agent name in the legend, for example "Codex". */
  agentName?: string;
  /** The files that the agent changed in this chat: first in go to file and the empty tab. */
  agentPaths?: string[];
  /** True while the Code tab shows. */
  visible?: boolean;
  /** Opens a file at a line. Increment `n` for each new request. */
  request?: { path: string; line?: number; n: number };
  onOpenSession?: () => void;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl+';

/**
 * The code editor of the Code tab: open files as tabs, quick edits, save with ⌘S, go to file
 * with ⌘P ("@" symbols, "#" text). A 2px bar at the gutter edge shows who changed each line:
 * the session color for agent lines, black for your lines.
 */
export function CodeEditor({
  api,
  cwd,
  hostId,
  repository,
  session,
  agentName = 'Agent',
  agentPaths,
  visible = true,
  request,
  onOpenSession,
}: CodeEditorProps) {
  const key = folderKey(cwd, hostId);
  useSyncExternalStore(subscribeCode, codeVersion);
  const folder = codeFolder(key);
  const active = folder.tabs.find((tab) => tab.path === folder.active) ?? null;
  const host = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<CodeController | null>(null);
  if (!controllerRef.current)
    controllerRef.current = new CodeController({ api, cwd, hostId, agentPaths, key });
  const controller = controllerRef.current;
  controller.props = { api, cwd, hostId, agentPaths, key };
  const [caret, setCaret] = useState({ line: 1, column: 1 });
  const [quick, setQuick] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  controller.onCaret = setCaret;
  controller.onClosePrompt = setClosing;
  const agentColor = session?.color || 'slate';

  // One editor view for the folder. Each tab keeps its own document state.
  useEffect(() => {
    if (!host.current) return;
    return controller.mount(host.current);
  }, [controller, key]);

  // Show the document of the active tab, and go to its requested line.
  useEffect(() => {
    controller.sync(visible);
  });

  // Requests from the diff, chat links and other views.
  const requestN = request?.n;
  const requestPathValue = request?.path;
  const requestLine = request?.line;
  useEffect(() => {
    if (requestPathValue) controller.open(requestPathValue, requestLine);
  }, [controller, requestN, requestPathValue, requestLine]);
  useEffect(() => {
    const waiting = takeOpenFileRequest(cwd);
    if (waiting) controller.open(waiting.path, waiting.line);
    return onOpenFileRequest((next) => {
      if (next.cwd && next.cwd !== cwd) return;
      takeOpenFileRequest(cwd);
      controller.open(next.path, next.line);
    });
  }, [controller, cwd]);

  // The file list for ⌘P. It loads when quick open opens, and again after 30 s.
  const quickOpen = quick !== null;
  useEffect(() => {
    if (!quickOpen) return;
    controller.keepFocus();
    controller.loadFiles();
  }, [controller, quickOpen]);

  // While the tab shows, check the active file on disk every 2 s and when the window gets focus.
  const activePath = active?.path;
  const activeReady = Boolean(active?.state);
  useEffect(() => {
    if (!visible || !activePath || !activeReady) return;
    let live = true;
    let running = false;
    const check = () => {
      if (running || document.visibilityState === 'hidden') return;
      running = true;
      void controller
        .check(activePath, () => live)
        .finally(() => {
          running = false;
        });
    };
    check();
    const timer = setInterval(check, 2000);
    window.addEventListener('focus', check);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, [controller, visible, activePath, activeReady]);

  // ⌘P, and ⌘⇧F for text, while the Code tab shows. ⌘S saves while the focus is in the editor.
  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      const primary = isMac ? event.metaKey : event.ctrlKey;
      if (!primary || event.altKey) return;
      const letter = event.key.toLowerCase();
      if (letter === 'p' && !event.shiftKey) {
        event.preventDefault();
        setQuick('');
      } else if (letter === 'f' && event.shiftKey) {
        event.preventDefault();
        setQuick('#');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible]);

  // Symbols of the open file for "@". The quick open reads them only while it shows.
  const symbols =
    quickOpen && active?.state ? fileSymbols(active.state.doc.toString(), active.path) : [];
  const suggested = [
    ...new Set([...folder.tabs.map((tab) => tab.path), ...(agentPaths || []), ...folder.recent]),
  ];
  const search = (query: string) => controller.search(query);
  const focusEditor = () => requestAnimationFrame(() => controller.view?.focus());
  const pick = (choice: QuickOpenPick) => {
    setQuick(null);
    controller.open(choice.path, choice.line, choice.column);
    focusEditor();
  };
  const openPath = (path: string) => controller.open(path);
  const closeTab = (path: string, force = false) => controller.close(path, force);
  const save = (path: string, revision?: string) => controller.save(path, revision);
  const reload = (path: string) => controller.reload(path);
  const find = (path: string) => controller.find(path);

  const conflict = active?.conflict;
  const editorReady = Boolean(active?.state);
  const closingTab = closing ? find(closing) : undefined;

  return (
    <div
      className="code-editor"
      style={{ '--agent-color': identityVar(agentColor) } as CSSProperties}
      onKeyDownCapture={(event) => {
        const primary = isMac ? event.metaKey : event.ctrlKey;
        if (primary && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 's') {
          event.preventDefault();
          if (active) void save(active.path);
        }
      }}
    >
      {folder.tabs.length ? (
        <div className="code-tabs" role="tablist" aria-label="Open files">
          {folder.tabs.map((tab) => {
            const { name } = splitPath(tab.path);
            const selected = tab.path === folder.active;
            return (
              <div
                key={tab.path}
                className={cn('code-tab', selected && 'is-active')}
                data-dirty={tab.dirty ? '' : undefined}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  title={tab.path}
                  className="code-tab-name"
                  onClick={() => controller.activate(tab.path)}
                  onAuxClick={(event) => {
                    if (event.button === 1) closeTab(tab.path);
                  }}
                >
                  <span>{name}</span>
                  {tab.conflict ? (
                    <StatusGlyph status="needs-you" label="Changed on disk" />
                  ) : tab.dirty ? (
                    <span
                      className={cn('code-dirty', tab.saving && 'is-saving')}
                      role="img"
                      aria-label={tab.saving ? 'Saving' : 'Not saved'}
                    />
                  ) : null}
                </button>
                <button
                  type="button"
                  className="code-tab-close"
                  aria-label={`Close ${name}`}
                  onClick={() => closeTab(tab.path)}
                >
                  <X aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="code-paper">
        {conflict && active ? (
          <div className="code-conflict" role="alert">
            <StatusGlyph status="needs-you" label="Changed on disk" />
            <span className="code-conflict-text">
              {conflict.revision === null
                ? 'This file was deleted.'
                : `${agentName} changed this file.`}
            </span>
            {conflict.revision === null ? (
              <Button size="sm" variant="secondary" onClick={() => closeTab(active.path, true)}>
                Close
              </Button>
            ) : (
              <>
                <Button size="sm" variant="secondary" onClick={() => void reload(active.path)}>
                  Reload
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void save(active.path, conflict.revision ?? undefined)}
                >
                  Keep mine
                </Button>
              </>
            )}
          </div>
        ) : null}
        <div className="code-body">
          <div ref={host} className="code-view" hidden={!editorReady} />
          {!active ? (
            <div className="code-empty">
              <p>Open a file</p>
              <Button size="sm" variant="secondary" onClick={() => setQuick('')}>
                Go to file <kbd>{mod}P</kbd>
              </Button>
              {agentPaths?.length ? (
                <div className="code-changed" role="list" aria-label="Changed in this chat">
                  {agentPaths.slice(0, 8).map((path) => {
                    const { name, folder: dir } = splitPath(path);
                    return (
                      <button
                        key={path}
                        type="button"
                        role="listitem"
                        className="code-changed-file"
                        onClick={() => openPath(path)}
                      >
                        <span>{name}</span>
                        <span className="code-changed-folder">{dir}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : active.loading ? (
            <div className="code-empty" role="status">
              <p>Opening {splitPath(active.path).name}…</p>
            </div>
          ) : active.error ? (
            <div className="code-empty" role="alert">
              <p>{active.error}</p>
              <Button size="sm" variant="secondary" onClick={() => openPath(active.path)}>
                Try again
              </Button>
            </div>
          ) : active.note ? (
            <div className="code-empty">
              <p>
                {active.note === 'too-large'
                  ? 'This file is larger than 2 MB. Open it in your own editor.'
                  : 'This is a binary file. Kalkidan shows only text files.'}
              </p>
            </div>
          ) : null}
        </div>
      </div>
      {active ? (
        <div className="code-status">
          <span className="code-legend">
            <i data-owner="agent" aria-hidden />
            {agentName}
          </span>
          <span className="code-legend">
            <i data-owner="you" aria-hidden />
            You
          </span>
          <span className="code-status-space" />
          {editorReady ? (
            <span aria-live="off">
              Ln {caret.line}, Col {caret.column}
            </span>
          ) : null}
          <button
            type="button"
            className="code-save"
            disabled={!active.dirty || active.saving}
            onClick={() => void save(active.path)}
          >
            {active.saving ? 'Saving…' : `${mod}S Save`}
          </button>
        </div>
      ) : null}
      {quick !== null ? (
        <QuickOpen
          initial={quick}
          files={folder.files ?? null}
          filesError={folder.filesError}
          suggested={suggested}
          activePath={active?.state ? active.path : null}
          symbols={symbols}
          search={search}
          onPick={pick}
          onClose={() => {
            setQuick(null);
            if (editorReady) focusEditor();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(closingTab)}
        title="Close without saving?"
        description={`${closing ? splitPath(closing).name : 'The file'} has changes that are not saved.`}
        confirmLabel="Close without saving"
        destructive
        onConfirm={() => {
          if (closing) closeTab(closing, true);
          setClosing(null);
        }}
        onCancel={() => setClosing(null)}
      />
    </div>
  );
}
