import { useEffect, useRef, useState } from 'react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { API } from '../types';
import { Button } from './ui/button';
import { ConfirmDialog } from './confirm-dialog';
import { AttachHint } from './diff-review';
import { errorMessage } from '../lib/errors';

/** xterm draws on a canvas, so it needs the font family value, not the CSS variable. */
function terminalFont() {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim();
  return value || 'monospace';
}

// ANSI colors for each scheme. Each color has good contrast on the background of
// its scheme. On the light background, "white" and "bright white" are gray, so
// that the text stays readable.
const darkPalette: ITheme = {
  black: '#484f58',
  red: '#ff7b72',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#b1bac4',
  brightBlack: '#8b949e',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#f0f6fc',
};

const lightPalette: ITheme = {
  black: '#24292f',
  red: '#cf222e',
  green: '#116329',
  yellow: '#9a6700',
  blue: '#0969da',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',
  brightBlack: '#57606a',
  brightRed: '#a40e26',
  brightGreen: '#1a7f37',
  brightYellow: '#7d4e00',
  brightBlue: '#0550ae',
  brightMagenta: '#6639ba',
  brightCyan: '#136061',
  brightWhite: '#424a53',
};

/** Reads the terminal colors from the theme tokens and the current scheme. */
function terminalTheme(): ITheme {
  const dark = document.documentElement.classList.contains('dark');
  const style = getComputedStyle(document.documentElement);
  // theme.css sets each token. If a token is empty, xterm uses its own default color.
  const token = (name: string) => style.getPropertyValue(name).trim() || undefined;
  return {
    ...(dark ? darkPalette : lightPalette),
    background: token('--background'),
    foreground: token('--foreground'),
    cursor: token('--muted-foreground'),
    selectionBackground: token('--accent'),
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
    // src/main.tsx changes the `dark` class when the system scheme changes.
    const scheme = new MutationObserver(() => {
      term.options.theme = terminalTheme();
    });
    scheme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    void (async () => {
      try {
        addon.fit();
        const result = await api.ptyOpen(cwd, Math.max(2, term.cols), Math.max(2, term.rows));
        if (disposed) {
          await api.ptyClose(result.id);
          return;
        }
        shell.current = result.id;
        const poll = async () => {
          try {
            const next = await api.ptyRead(result.id, cursor);
            if (disposed) return;
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
      scheme.disconnect();
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
  return (
    <div hidden={!visible} className="terminal-pane">
      <div
        ref={element}
        className="terminal-emulator"
        role="group"
        aria-label="Interactive terminal"
        aria-description="Press F6 to move focus out of the terminal."
      />
      <div className="tool-toolbar tool-toolbar-footer">
        <span className="min-w-0 flex-1 truncate" title={exited ? undefined : cwd}>
          {exited ? 'Shell exited' : cwd}
        </span>
        <div className="flex gap-1">
          <AttachHint reason={disabledReason}>
            <Button size="sm" variant="ghost" disabled={disabled} onClick={attach}>
              Attach output
            </Button>
          </AttachHint>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => (exited ? setGeneration((n) => n + 1) : setConfirmRestart(true))}
          >
            {exited ? 'Restart terminal' : 'New shell'}
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="field-error max-h-16 shrink-0 overflow-auto px-3 py-1">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={confirmRestart}
        title="Start a new shell?"
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
