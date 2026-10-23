import { interfaceConfig } from '../config/interface';
import { DiffReview } from './diff-review';
import { createPortal } from 'react-dom';
import { Suspense, lazy, useEffect, useRef, useState, type ReactNode } from 'react';
import { LoaderCircle, PanelRight, X } from 'lucide-react';
import { Button } from './ui/button';
import { PaneMessage } from './pane-message';
import { Hint } from './hint';
import { ConfirmDialog } from './confirm-dialog';
import { hasPrimaryModifier, isMac, isTypingTarget, shortcutLabel } from '../lib/platform';
import { InteractiveTerminal } from './interactive-terminal';
import { EmbeddedBrowser } from './embedded-browser';
import type { API, RepositoryDiff } from '../types';
import type { IdentityColor } from '../domain/identity';
import { errorMessage } from '../lib/errors';
export type ConversationContext = { id: string; label: string; text: string };
/** The tabs of the one tool pane (CH-B): Changes, Code, Terminal and Browser. */
export type ToolKind = 'diff' | 'code' | 'terminal' | 'browser';
/**
 * A request from the session view to show a tool. Increase `n` to send it again. With `toggle`,
 * a request for the shown tool hides it.
 */
export type ToolRequest = { kind: ToolKind; n: number; toggle?: boolean };
type ToolTab = { id: string; kind: ToolKind; title: string; url?: string };

// CodeMirror loads only when the Code tab shows first (EDITOR's component).
const CodeEditor = lazy(() => import('./code-editor').then((m) => ({ default: m.CodeEditor })));

/** What the Code tab needs to know about the chat. */
export interface CodeTabContext {
  hostId?: string;
  repositoryId?: string;
  repository?: { name: string; color: IdentityColor };
  session: { id: string; title: string; color: IdentityColor };
  agentName: string;
  /** The files that the agent changed in this chat. */
  agentPaths?: string[];
}

/** The event that opens a file at a line in the Code tab of the visible chat. */
export const openCodeEvent = 'kalkidan-open-code';
/** Opens a file of the chat's repo at a line in the Code tab of the visible chat. */
export function openInCode(path: string, line?: number) {
  window.dispatchEvent(new CustomEvent(openCodeEvent, { detail: { path, line } }));
}

const kindLabels: Record<ToolKind, string> = {
  diff: 'Changes',
  code: 'Code',
  terminal: 'Terminal',
  browser: 'Browser',
};
const kinds: ToolKind[] = ['diff', 'code', 'terminal', 'browser'];
/** The tabs that are always one tab. Terminal and Browser can have more (⌘T). */
const singleKinds = new Set<ToolKind>(['diff', 'code']);

// Command+` cycles windows on macOS, so the terminal uses Control+` there, as VS Code does.
// The chat column keeps at least 320px and a tool pane at least 360px. A narrower area shows
// the tool pane above the chat (tools.css). The pane is 440px wide until the user resizes it.
const minSessionWidth = 320;
const minToolWidth = 360;
const shortcuts = {
  terminal: shortcutLabel([isMac ? 'ctrl' : 'mod'], '`'),
  tab: shortcutLabel(['mod'], 'T'),
  diff: shortcutLabel(['mod', 'shift'], 'G'),
};
export const noChangesToCommit = 'No changes to commit.';
/** The event that tells the shell that a tool pane opens or closes in the visible chat. */
export const toolPaneEvent = 'kalkidan-tool-pane';
function isTerminalShortcut(e: KeyboardEvent) {
  if (e.key !== '`' && e.code !== 'Backquote') return false;
  if (e.altKey || e.shiftKey) return false;
  return isMac ? e.ctrlKey && !e.metaKey : hasPrimaryModifier(e);
}
export function ConversationTools({
  children,
  api,
  cwd,
  reviewRequest = 0,
  reviewPath,
  disabled,
  disabledReason = '',
  onAttach,
  remote = false,
  visible = true,
  onToolChange,
  toolRequest,
  branch,
  runsFinished = 0,
  onChangesRead,
  changesCount = 0,
  shipFooter,
  code,
}: {
  /** The number of changed files, after "Changes" in the tab. */
  changesCount?: number;
  /** The footer of the Changes tab: the pull request title and Create pull request. */
  shipFooter?: ReactNode;
  /** The Code tab needs the chat. Without it, the Code tab does not show. */
  code?: CodeTabContext;
  children: ReactNode;
  /** Opens the Changes tool when the number changes. */
  reviewRequest?: number;
  /** The file that the Changes tool shows first for the review request. */
  reviewPath?: string;
  /** Opens a tool when `n` changes. */
  toolRequest?: ToolRequest | null;
  /** The branch of the checkout and the branch it merges to, for the Changes header. */
  branch?: { name: string; base: string };
  /** Increase this number when an agent run ends. An open Changes tab reads the diff again. */
  runsFinished?: number;
  /** Called after the Changes tab reads the diff, so the session can update the count. */
  onChangesRead?: () => void;
  /** Called when a tool shows or hides, with the kind of the shown tool. */
  onToolChange: (kind: ToolKind | null) => void;
  visible?: boolean;
  remote?: boolean;
  api: API;
  cwd: string;
  disabled: boolean;
  /** Why the attach buttons are disabled. */
  disabledReason?: string;
  onAttach: (context: ConversationContext) => void;
}) {
  const [tabs, setTabs] = useState<ToolTab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  // The width of the chat in percent after the user resized the pane. Null: a 440px pane.
  const [ratio, setRatio] = useState<number | null>(() => {
    try {
      const saved = Number(localStorage.getItem('kalkidan-tool-width'));
      return saved
        ? Math.min(
            interfaceConfig.toolPane.maxPercent,
            Math.max(interfaceConfig.toolPane.minPercent, saved),
          )
        : null;
    } catch {
      return null;
    }
  });
  const [dragging, setDragging] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const current = tabs.find((t) => t.id === active);
  const tool = expanded ? current?.kind : null;
  // The open tabs of the shown tool. Two or more show a tab strip above the tool.
  const sameKind = current ? tabs.filter((t) => t.kind === current.kind) : [];
  const [diff, setDiff] = useState<RepositoryDiff | null>(null);
  const [busy, setBusy] = useState(false);
  // `error` is for the Changes tab. `limit` is the message about too many tabs.
  const [error, setError] = useState('');
  const [limit, setLimit] = useState('');
  const [closing, setClosing] = useState<ToolTab | null>(null);
  const [focusRequests, setFocusRequests] = useState<Record<string, number>>({});
  // The file and line that the Code tab opens. `n` increases for each request.
  const [codeRequest, setCodeRequest] = useState<{ path: string; line?: number; n: number }>();
  /** The kind of the last shown tab. The title bar button opens it again. */
  const lastKind = useRef<ToolKind>('diff');
  const focusTerminal = (id: string) =>
    setFocusRequests((previous) => ({ ...previous, [id]: (previous[id] || 0) + 1 }));
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  /** Reads the Git changes: staged, unstaged and new files together. */
  function readDiff() {
    void action(async () => {
      setDiff(await api.repositoryDiff(cwd));
      onChangesRead?.();
    });
  }
  function attach(label: string, text: string) {
    onAttach({
      id: crypto.randomUUID(),
      label,
      text: text.slice(0, interfaceConfig.attachmentCharacters),
    });
  }
  function add(kind: ToolKind, url?: string) {
    if (tabs.length >= interfaceConfig.maxToolTabs) {
      // Show the dock, so that the user can see the message and the tabs to close.
      setExpanded(true);
      if (!active) setActive(tabs.at(-1)?.id || null);
      setLimit('Close a tool tab before opening another.');
      return;
    }
    const tab = {
      id: crypto.randomUUID(),
      kind,
      title: kind === 'browser' ? 'New browser tab' : kindLabels[kind],
      url,
    };
    setTabs((previous) => [...previous, tab]);
    setActive(tab.id);
    setExpanded(true);
    if (kind === 'terminal') focusTerminal(tab.id);
    if (kind === 'diff') readDiff();
  }
  function open(kind: ToolKind | null) {
    if (!kind) {
      setExpanded(false);
      return;
    }
    if (kind === 'code' && !code) return;
    lastKind.current = kind;
    // The tab of the kind that the user saw last.
    const tab =
      (current?.kind === kind ? current : undefined) ||
      [...tabs].reverse().find((t) => t.kind === kind);
    if (tab) {
      setActive(tab.id);
      setExpanded(true);
      if (kind === 'terminal') focusTerminal(tab.id);
      if (kind === 'diff') readDiff();
    } else add(kind); // add() reads the diff for a new Changes tab.
  }
  function close(id: string) {
    const remaining = tabs.filter((t) => t.id !== id);
    setTabs(remaining);
    setLimit('');
    if (active === id) {
      const next = remaining.at(-1)?.id || null;
      setActive(next);
      if (next) requestAnimationFrame(() => focusTab(remaining.find((t) => t.id === next)!));
    }
    if (!remaining.length) setExpanded(false);
  }
  /** Focuses the tab of a tool: its tab in the tool strip, else its tab in the pane header. */
  function focusTab(tab: ToolTab) {
    (
      document.getElementById('tab-' + tab.id) || document.getElementById('tool-kind-' + tab.kind)
    )?.focus();
  }
  /** Opens a file at a line in the Code tab. */
  function openCode(path: string, line?: number) {
    if (!code) return;
    setCodeRequest((previous) => ({ path, line, n: (previous?.n || 0) + 1 }));
    open('code');
  }
  /** A terminal tab has a running shell. Ask before it stops. */
  function requestClose(tab: ToolTab) {
    if (tab.kind === 'terminal') setClosing(tab);
    else close(tab.id);
  }
  /** The width of the chat in percent: the resized width, or the width next to a 440px pane. */
  function chatPercent() {
    if (ratio !== null) return ratio;
    const width = container.current?.clientWidth || 1000;
    return Math.max(0, ((width - 441) / width) * 100);
  }
  function resize(value: number) {
    const width = container.current?.clientWidth || 1000;
    const lower = Math.max(interfaceConfig.toolPane.minPercent, (minSessionWidth / width) * 100),
      upper = Math.min(
        interfaceConfig.toolPane.maxPercent,
        ((width - minToolWidth - 1) / width) * 100,
      );
    const next = Math.min(upper, Math.max(lower, value));
    setRatio(next);
    try {
      localStorage.setItem('kalkidan-tool-width', String(next));
    } catch {}
  }
  useEffect(() => onToolChange(tool || null), [tool, onToolChange]);
  // The shell can make room for the pane, for example hide the sidebar in a narrow window.
  useEffect(() => {
    if (!visible) return;
    window.dispatchEvent(new CustomEvent(toolPaneEvent, { detail: { open: expanded } }));
  }, [visible, expanded]);
  useEffect(() => {
    if (current) lastKind.current = current.kind;
  }, [current?.kind]);
  // A diff line, a chat link or EDITOR's openFileAt opens a file in the Code tab.
  useEffect(() => {
    if (!visible) return;
    const show = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string; line?: number }>).detail;
      if (detail?.path) openCode(detail.path, detail.line);
    };
    window.addEventListener(openCodeEvent, show);
    return () => window.removeEventListener(openCodeEvent, show);
  }, [visible, tabs, current, code]);
  useEffect(
    () => () => {
      window.dispatchEvent(new CustomEvent(toolPaneEvent, { detail: { open: false } }));
    },
    [],
  );
  useEffect(() => {
    if (!expanded || !container.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      // A narrow area shows the tool pane as a sheet. The ratio then does not apply.
      if (width < minSessionWidth + minToolWidth + 1) return;
      setRatio((previous) =>
        previous === null
          ? null
          : Math.min(
              Math.min(
                interfaceConfig.toolPane.maxPercent,
                ((width - minToolWidth - 1) / width) * 100,
              ),
              Math.max(
                Math.max(interfaceConfig.toolPane.minPercent, (minSessionWidth / width) * 100),
                previous,
              ),
            ),
      );
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [expanded]);
  useEffect(() => {
    if (!visible) return;
    const keys = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      if (isTerminalShortcut(e)) {
        e.preventDefault();
        open(tool === 'terminal' ? null : 'terminal');
        return;
      }
      if (!hasPrimaryModifier(e) || e.altKey) return;
      // In a terminal on Windows and Linux, Ctrl+T and Ctrl+Shift+G go to the shell.
      // In other text fields the shortcuts go to the field. The composer is an exception.
      const target = e.target as HTMLElement | null;
      const inTerminal = !!target?.closest?.('.xterm');
      const inComposer = !!target?.closest?.('[data-composer]');
      if (inTerminal ? !isMac : isTypingTarget(e.target) && !inComposer) return;
      if (e.shiftKey && e.code === 'KeyG') {
        e.preventDefault();
        open('diff');
      } else if (!e.shiftKey && e.code === 'KeyT') {
        // A second terminal. The tool strip shows the terminals.
        e.preventDefault();
        add('terminal');
      }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, [visible, tool, tabs]);
  // ⌘W or Ctrl+W: the shell sends this event. Close the open tool tab first.
  useEffect(() => {
    if (!visible) return;
    const closeTab = (event: Event) => {
      if (!expanded || !current) return;
      event.preventDefault();
      requestClose(current);
    };
    window.addEventListener('kalkidan-close-tab', closeTab);
    return () => window.removeEventListener('kalkidan-close-tab', closeTab);
  }, [visible, expanded, current, tabs]);
  useEffect(() => {
    if (reviewRequest) open('diff');
  }, [reviewRequest]);
  useEffect(() => {
    if (!toolRequest) return;
    open(toolRequest.toggle && tool === toolRequest.kind ? null : toolRequest.kind);
  }, [toolRequest?.n]);
  // The agent or the user can change files outside Kalkidan. Read them again on focus.
  useEffect(() => {
    if (!visible || tool !== 'diff') return;
    const focus = () => readDiff();
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [visible, tool, cwd]);
  // An agent run can change files. Read the diff again when the Changes tab shows.
  useEffect(() => {
    if (runsFinished && tool === 'diff') readDiff();
  }, [runsFinished]);
  // The application menu sends these commands. Only the visible session handles them.
  useEffect(() => {
    if (!visible) return;
    const command = (event: Event) => {
      const detail = (event as CustomEvent<{ command?: string; handled?: boolean }>).detail;
      const name = detail?.command;
      if (name === 'session-terminal') open('terminal');
      else if (name === 'session-changes') open('diff');
      else if (name === 'session-code' && code) open('code');
      else if (name === 'session-browser') open('browser');
      else if (name === 'session-tools') open(expanded ? null : lastKind.current);
      else return;
      // A command that no visible chat handles waits for the next chat view.
      detail.handled = true;
    };
    window.addEventListener('kalkidan-session-command', command);
    return () => window.removeEventListener('kalkidan-session-command', command);
  }, [visible, tool, tabs, expanded, code]);
  return (
    <div
      ref={container}
      className={
        'conversation-split' + (expanded ? ' tools-expanded' : '') + (dragging ? ' resizing' : '')
      }
      style={ratio === null ? undefined : ({ '--chat-width': ratio + '%' } as React.CSSProperties)}
    >
      <div className="conversation-chat-column">{children}</div>
      {expanded && (
        <div
          role="separator"
          tabIndex={0}
          aria-label="Resize session and tools"
          aria-orientation="vertical"
          aria-valuemin={interfaceConfig.toolPane.minPercent}
          aria-valuemax={interfaceConfig.toolPane.maxPercent}
          aria-valuenow={Math.round(chatPercent())}
          className="tool-divider"
          onDoubleClick={() => resize(interfaceConfig.toolPane.initialPercent)}
          onKeyDown={(e) => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
              e.preventDefault();
              resize(
                e.key === 'Home'
                  ? interfaceConfig.toolPane.minPercent
                  : e.key === 'End'
                    ? interfaceConfig.toolPane.maxPercent
                    : chatPercent() + (e.key === 'ArrowLeft' ? -2 : 2),
              );
            }
          }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragging(true);
          }}
          onPointerMove={(e) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            const r = container.current!.getBoundingClientRect();
            resize(((e.clientX - r.x) / r.width) * 100);
          }}
          onPointerUp={(e) => {
            e.currentTarget.releasePointerCapture(e.pointerId);
            setDragging(false);
          }}
          onLostPointerCapture={() => setDragging(false)}
        />
      )}
      {visible &&
        document.getElementById('conversation-titlebar-tabs') &&
        createPortal(
          <div className="tool-tabbar" data-expanded={expanded} role="group" aria-label="Tools">
            {/* One button for the one pane: Changes, Code, Terminal and Browser are its tabs. */}
            <Hint label={expanded ? 'Hide tools' : 'Show tools'}>
              <Button
                variant="ghost"
                size="icon-sm"
                id="tool-launch"
                className="tool-launch-button"
                aria-label="Tools"
                aria-pressed={expanded}
                onClick={() => open(expanded ? null : lastKind.current)}
              >
                <PanelRight aria-hidden="true" />
              </Button>
            </Hint>
          </div>,
          document.getElementById('conversation-titlebar-tabs')!,
        )}
      <div className="conversation-tool-dock is-open" hidden={!expanded}>
        {/* The pane header: Changes 3 · Code · Terminal · Browser, then Close (CH-B2). */}
        <div className="tool-pane-header">
          <div
            role="tablist"
            aria-label="Tools"
            className="tool-pane-tabs"
            onKeyDown={(e) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
              e.preventDefault();
              const shown = kinds.filter((kind) => kind !== 'code' || code);
              const index = Math.max(0, shown.indexOf(current?.kind || 'diff'));
              const next =
                shown[
                  e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? shown.length - 1
                      : (index + (e.key === 'ArrowRight' ? 1 : -1) + shown.length) % shown.length
                ];
              open(next);
              requestAnimationFrame(() => document.getElementById('tool-kind-' + next)?.focus());
            }}
          >
            {kinds
              .filter((kind) => kind !== 'code' || code)
              .map((kind) => {
                const selected = current?.kind === kind;
                return (
                  <button
                    key={kind}
                    type="button"
                    role="tab"
                    id={'tool-kind-' + kind}
                    className="tool-pane-tab"
                    aria-selected={selected}
                    aria-controls="tool-pane-body"
                    tabIndex={selected ? 0 : -1}
                    title={
                      kind === 'terminal'
                        ? `Terminal (${shortcuts.terminal})`
                        : kind === 'diff'
                          ? `Changes (${shortcuts.diff})`
                          : undefined
                    }
                    onClick={() => open(kind)}
                  >
                    {kindLabels[kind]}
                    {kind === 'diff' && changesCount > 0 && (
                      <span className="tool-pane-count">{changesCount}</span>
                    )}
                  </button>
                );
              })}
          </div>
          <Hint label="Close tools">
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto"
              aria-label="Close tools"
              onClick={() => open(null)}
            >
              <X />
            </Button>
          </Hint>
        </div>
        {limit && (
          <p role="alert" className="field-error px-3 py-1">
            {limit}
          </p>
        )}
        {sameKind.length > 1 && !singleKinds.has(sameKind[0].kind) && (
          <div
            role="tablist"
            aria-label={`${current?.kind === 'browser' ? 'Browser' : 'Terminal'} tabs`}
            className="tool-tabs"
            onKeyDown={(e) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
              e.preventDefault();
              const index = sameKind.findIndex((t) => t.id === active);
              const next =
                sameKind[
                  e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? sameKind.length - 1
                      : (index + (e.key === 'ArrowRight' ? 1 : -1) + sameKind.length) %
                        sameKind.length
                ];
              setActive(next.id);
              document.getElementById('tab-' + next.id)?.focus();
            }}
          >
            {sameKind.map((tab) => (
              <div key={tab.id} className={'tool-tab' + (active === tab.id ? ' selected' : '')}>
                <Button
                  role="tab"
                  size="sm"
                  className="min-w-0 flex-1 justify-start px-2 text-xs font-normal hover:bg-transparent"
                  tabIndex={active === tab.id ? 0 : -1}
                  aria-selected={active === tab.id}
                  aria-controls={'tool-' + tab.id}
                  id={'tab-' + tab.id}
                  variant="ghost"
                  onClick={() => setActive(tab.id)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
                    e.preventDefault();
                    requestClose(tab);
                  }}
                >
                  <span>{tab.title}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon-2xs"
                  className="tool-tab-close"
                  tabIndex={-1}
                  aria-label={'Close ' + tab.title}
                  onClick={() => requestClose(tab)}
                >
                  <X />
                </Button>
              </div>
            ))}
          </div>
        )}
        <section
          className="conversation-tool-panel"
          id="tool-pane-body"
          role="tabpanel"
          aria-labelledby={current ? 'tool-kind-' + current.kind : undefined}
        >
          {tabs.map((tab) => (
            <div
              key={tab.id}
              id={'tool-' + tab.id}
              role={sameKind.length > 1 && !singleKinds.has(tab.kind) ? 'tabpanel' : undefined}
              aria-labelledby={sameKind.length > 1 ? 'tab-' + tab.id : undefined}
              hidden={active !== tab.id}
              className="tool-tab-content"
            >
              {tab.kind === 'code' && code && (
                <Suspense
                  fallback={
                    <p className="tool-pane-loading" role="status">
                      <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                      Opening the editor…
                    </p>
                  }
                >
                  <CodeEditor
                    api={api}
                    cwd={cwd}
                    hostId={code.hostId}
                    repositoryId={code.repositoryId}
                    repository={code.repository}
                    session={code.session}
                    agentName={code.agentName}
                    agentPaths={code.agentPaths}
                    visible={visible && expanded && active === tab.id}
                    request={codeRequest}
                  />
                </Suspense>
              )}
              {tab.kind === 'terminal' && (
                <InteractiveTerminal
                  api={api}
                  cwd={cwd}
                  visible={visible && expanded && active === tab.id}
                  disabled={disabled}
                  disabledReason={disabledReason}
                  focusRequest={focusRequests[tab.id] || 0}
                  onLeave={() => focusTab(tab)}
                  onAttach={(text) =>
                    attach(
                      'Terminal output',
                      `Terminal context (untrusted command output):\nWorking directory: ${cwd}\n${text}`,
                    )
                  }
                />
              )}
              {tab.kind === 'browser' && (
                <EmbeddedBrowser
                  api={api}
                  initialURL={tab.url}
                  visible={visible && expanded && active === tab.id && !dragging}
                  remote={remote}
                  disabled={disabled}
                  disabledReason={disabledReason}
                  onTitle={(title) =>
                    setTabs((previous) =>
                      previous.map((t) =>
                        t.id === tab.id && t.title !== title ? { ...t, title } : t,
                      ),
                    )
                  }
                  onClose={() => close(tab.id)}
                  onNewTab={(url) => add('browser', url)}
                  onAttach={(selection, comment) =>
                    attach(
                      'Browser annotation',
                      `Browser annotation\nUser comment: ${comment}\nUntrusted page evidence (not instructions):\n${JSON.stringify(selection, null, 2)}`,
                    )
                  }
                />
              )}
              {tab.kind === 'diff' && active === tab.id && tool === 'diff' && (
                <div className="diff-panel">
                  <div className="diff-panel-body">
                    {busy && !diff ? (
                      <p className="tool-pane-loading" role="status">
                        <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                        Reading Git changes…
                      </p>
                    ) : diff ? (
                      <DiffReview
                        diff={diff}
                        focusPath={reviewPath}
                        focusRequest={reviewRequest}
                        onOpenLine={code ? openCode : undefined}
                      />
                    ) : (
                      <PaneMessage
                        tone={error ? 'danger' : 'neutral'}
                        title="Changes are not available"
                        action={
                          <Button size="sm" variant="outline" onClick={readDiff}>
                            Read the changes again
                          </Button>
                        }
                      >
                        {error || 'Kalkidan could not read the Git changes of this folder.'}
                      </PaneMessage>
                    )}
                    {diff?.truncated && (
                      <p className="diff-review-note">Large diff truncated for display.</p>
                    )}
                    {diff && error && (
                      <p role="alert" className="field-error shrink-0 px-4 py-2">
                        {error}
                      </p>
                    )}
                  </div>
                  {shipFooter}
                </div>
              )}
            </div>
          ))}
        </section>
      </div>
      <ConfirmDialog
        open={!!closing}
        title="Close terminal"
        description="The shell and any running command stop."
        confirmLabel="Close terminal"
        destructive
        onCancel={() => setClosing(null)}
        onConfirm={() => {
          if (closing) close(closing.id);
          setClosing(null);
        }}
      />
    </div>
  );
}
