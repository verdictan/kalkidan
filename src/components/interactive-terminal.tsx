import { useEffect, useRef, useState } from 'react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { API } from '../types';
import { Paperclip, RotateCcw } from 'lucide-react';
import { Button } from './ui/button';
import { PaneMessage } from './pane-message';
import { ConfirmDialog } from './confirm-dialog';
import { Hint } from './hint';
import { errorMessage } from '../lib/errors';

/** xterm draws on a canvas, so it needs the font family value, not the CSS variable. */
function terminalFont() {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim();
  return value || 'monospace';
}

// The light terminal colors. The surface, text, cursor, green and yellow come from the theme
// tokens in src/styles/theme.css. Each other ANSI color has a contrast ratio of at least 4.5:1 on
// white, so "white" and "bright white" are gray.
function terminalTheme(): ITheme {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const background = token('--background', '#ffffff');
  const primary = token('--primary', '#9a4600');
  return {
    background,
    foreground: token('--foreground', '#0a0a0a'),
    cursor: primary,
    cursorAccent: background,
    selectionBackground: primary.startsWith('#') ? primary + '33' : primary,
    black: '#24292f',
    red: '#cf222e',
    green: token('--success', '#047857'),
    yellow: token('--warning', '#b45309'),
    blue: '#0969da',
    magenta: '#8250df',
    cyan: '#1b7c83',
    white: '#6e7781',
    brightBlack: '#57606a',
    brightRed: '#a40e26',
    brightGreen: '#065f46',
    brightYellow: '#7d4e00',
    brightBlue: '#0550ae',
    brightMagenta: '#6639ba',
    brightCyan: '#136061',
    brightWhite: '#424a53',
  };
}

export function InteractiveTerminal({
  api,
  cwd,
  visible,
  disabled,
  disabledReason = '',
  focusRequest = 0,
  onAttach,
  onLeave,
}: {
  api: API;
  cwd: string;
  visible: boolean;
  disabled: boolean;
  /** Why "Attach output" is disabled. */
  disabledReason?: string;
  /** Increase this number to move focus into the terminal. Use it only when the user opens it. */
  focusRequest?: number;
  onAttach: (text: string) => void;
  /** Called when the user presses F6 to move focus out of the terminal. */
  onLeave?: () => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const shell = useRef<string | null>(null);
  const [error, setError] = useState('');
  // The connection to the SSH host of the shell stopped. The shell continues on the host.
  const [hostLost, setHostLost] = useState(false);
  const [exited, setExited] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const leave = useRef(onLeave);
  leave.current = onLeave;
  useEffect(() => {
    const term = new Terminal({
      fontSize: 12,
      lineHeight: 1.34,
      fontFamily: terminalFont(),
      // A blinking cursor is motion. Keep it still when the user asks for reduced motion.
      cursorBlink: !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
      scrollback: 3000,
      theme: terminalTheme(),
    });
    // The shell needs Tab for completion. F6 gives keyboard users a way out.
    term.attachCustomKeyEventHandler((event) => {
      if (event.key !== 'F6') return true;
      if (event.type === 'keydown') {
        event.preventDefault();
        leave.current?.();
      }
      return false;
    });
    const addon = new FitAddon();
    term.loadAddon(addon);
    term.open(element.current!);
    terminal.current = term;
    fit.current = addon;
    let disposed = false,
      timer: ReturnType<typeof setTimeout>,
      cursor = 0;
    setError('');
    setExited(false);
    setHostLost(false);
    const report = (e: unknown) => {
      if (!disposed) setError(errorMessage(e));
    };
    const input = term.onData((data) => {
      if (shell.current) void api.ptyWrite(shell.current, data).catch(report);
    });
    const resize = () => {
      if (element.current?.getBoundingClientRect().width) {
        addon.fit();
        if (shell.current) void api.ptyResize(shell.current, term.cols, term.rows).catch(report);
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element.current!);
    void (async () => {
      try {
        addon.fit();
        // A shell of this folder that continued on its SSH host. "New shell" always starts a
        // new shell.
        const attached =
          generation === 0
            ? await Promise.resolve()
                .then(() => api.ptyAttach(cwd))
                .catch(() => null)
            : null;
        const result =
          attached ?? (await api.ptyOpen(cwd, Math.max(2, term.cols), Math.max(2, term.rows)));
        if (disposed) {
          await api.ptyClose(result.id);
          return;
        }
        shell.current = result.id;
        if (attached) {
          // The recent output of the shell follows, so the user sees where the shell is.
          term.write('[This shell continued on the SSH host. Recent output follows.]\r\n');
          resize();
        }
        const poll = async () => {
          try {
            const next = await api.ptyRead(result.id, cursor);
            if (disposed) return;
            setHostLost(false);
            cursor = next.cursor;
            if (next.truncated) term.write('\r\n[Earlier output omitted]\r\n');
            term.write(next.data);
            if (next.exited) {
              setExited(true);
              if (next.error) setError(next.error);
              return;
            }
            timer = setTimeout(poll, 75);
          } catch (e) {
            if (disposed) return;
            // Without a connection, the shell continues on the host. Read again later.
            if (/offline|disconnected|timed out|connect the host/i.test(errorMessage(e))) {
              setHostLost(true);
              timer = setTimeout(poll, 1000);
              return;
            }
            report(e);
            setExited(true);
          }
        };
        await poll();
      } catch (e) {
        if (disposed) return;
        report(e);
        setExited(true);
      }
    })();
    return () => {
      disposed = true;
      clearTimeout(timer);
      observer.disconnect();
      input.dispose();
      term.dispose();
      terminal.current = null;
      fit.current = null;
      const id = shell.current;
      shell.current = null;
      if (id) void api.ptyClose(id).catch(() => {});
    };
  }, [api, cwd, generation]);
  useEffect(() => {
    if (visible) fit.current?.fit();
  }, [visible]);
  useEffect(() => {
    if (focusRequest) terminal.current?.focus();
  }, [focusRequest, generation]);
  function attach() {
    const buffer = terminal.current?.buffer.active;
    if (!buffer) return;
    const lines = [];
    for (let i = Math.max(0, buffer.length - 300); i < buffer.length; i++)
      lines.push(buffer.getLine(i)?.translateToString(true) || '');
    onAttach(lines.join('\n').trim().slice(-28000));
  }
  const restart = () => (exited ? setGeneration((n) => n + 1) : setConfirmRestart(true));
  return (
    <div hidden={!visible} className="terminal-pane">
      {/* The toolbar: the folder or "Shell exited", then 28px icons. The pane tab names it. */}
      <div className="tool-toolbar terminal-header">
        <span className="tool-toolbar-status" title={exited ? undefined : cwd}>
          {exited ? 'Shell exited' : cwd}
        </span>
        <Hint label={disabledReason || 'Attach output'} disabled={disabled}>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Attach output"
            disabled={disabled}
            onClick={attach}
          >
            <Paperclip aria-hidden="true" />
          </Button>
        </Hint>
        {/* A stopped shell has one Restart: the button in the pane message (CH-23). */}
        {!(exited && error) && (
          <Hint label={exited ? 'Restart terminal' : 'New shell'}>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={exited ? 'Restart terminal' : 'New shell'}
              onClick={restart}
            >
              <RotateCcw aria-hidden="true" />
            </Button>
          </Hint>
        )}
      </div>
      <div
        ref={element}
        className="terminal-emulator"
        role="group"
        aria-label="Interactive terminal"
        aria-description="Press F6 to move focus out of the terminal."
        hidden={exited && !!error}
      />
      {exited && error && (
        <PaneMessage
          tone="danger"
          title="Shell exited"
          action={
            <Button size="sm" variant="outline" onClick={restart}>
              Restart
            </Button>
          }
        >
          {error}
        </PaneMessage>
      )}
      {!exited && error && (
        <p role="alert" className="tool-statusbar">
          {error}
        </p>
      )}
      {hostLost && !exited && (
        <p role="status" className="tool-statusbar">
          The SSH host is not connected. The shell continues on the host.
        </p>
      )}
      <ConfirmDialog
        open={confirmRestart}
        title="New shell"
        description="The shell and any running command stop."
        confirmLabel="New shell"
        destructive
        onCancel={() => setConfirmRestart(false)}
        onConfirm={() => {
          setConfirmRestart(false);
          setGeneration((n) => n + 1);
        }}
      />
    </div>
  );
}
