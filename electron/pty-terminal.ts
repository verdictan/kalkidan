import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';

// Python's standard-library PTY avoids a native Node ABI dependency in Electron and the SSH agent.
const helper = String.raw`
import os, sys, pty, select, json, signal, struct, fcntl, termios, codecs
pid, fd = pty.fork()
if pid == 0:
    shell = os.environ.get('SHELL', '/bin/sh')
    os.execvpe(shell, [shell, '-l'], dict(os.environ, TERM='xterm-256color', COLORTERM='truecolor'))
def emit(value):
    print(json.dumps(value), flush=True)
def size(cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
def stop(*args):
    try: os.killpg(os.tcgetpgrp(fd), signal.SIGHUP)
    except OSError: pass
    try: os.killpg(pid, signal.SIGHUP)
    except OSError: pass
    sys.exit(0)
signal.signal(signal.SIGTERM, stop)
size(int(sys.argv[1]), int(sys.argv[2]))
emit({'ready': True})
buffer = b''
pending = b''
os.set_blocking(fd, False)
decode = codecs.getincrementaldecoder('utf-8')('replace')
try:
    while True:
        readable, writable, _ = select.select([fd, sys.stdin.fileno()], [fd] if pending else [], [])
        if fd in writable:
            try: pending = pending[os.write(fd, pending[:4096]):]
            except BlockingIOError: pass
        if fd in readable:
            try: data = os.read(fd, 65536)
            except BlockingIOError: continue
            except OSError: break
            if not data: break
            emit({'data': decode.decode(data)})
        if sys.stdin.fileno() in readable:
            data = os.read(sys.stdin.fileno(), 65536)
            if not data: stop()
            buffer += data
            while b'\n' in buffer:
                line, buffer = buffer.split(b'\n', 1)
                message = json.loads(line)
                if 'input' in message:
                    pending += message['input'].encode()
                if 'cols' in message: size(message['cols'], message['rows'])
finally:
    os.close(fd)
`;
/**
 * PROPOSAL: the recent output that a shell keeps, in characters. An app that attaches to the
 * shell again gets this output first. Older output is removed.
 */
export const ptyScrollbackChars = 1_000_000;
interface Shell {
  cwd: string;
  child?: ChildProcessWithoutNullStreams;
  pty?: import('node-pty').IPty;
  output: string;
  cursor: number;
  exited: boolean;
  error?: string;
  phase: 'opening' | 'ready' | 'closing' | 'closed' | 'failed' | 'interrupted';
  cancelOpening?: (error: Error) => void;
}
export class PtyTerminal {
  private shells = new Map<string, Shell>();
  constructor(private loadPty = () => import('node-pty')) {}
  async open(cwd: string, cols: number, rows: number) {
    this.dimensions(cols, rows);
    if ([...this.shells.values()].filter((s) => !s.exited).length >= 8)
      throw new Error('Close an existing terminal before opening another.');
    for (const [id, shell] of this.shells) if (shell.exited) this.shells.delete(id);
    const id = randomUUID();
    // Reserve capacity before any asynchronous native-module load.
    const shell: Shell = { cwd, output: '', cursor: 0, exited: false, phase: 'opening' };
    this.shells.set(id, shell);
    if (process.platform === 'win32') {
      let cancel!: (error: Error) => void;
      const canceled = new Promise<never>((_resolve, reject) => {
        cancel = reject;
      });
      shell.cancelOpening = cancel;
      const timeout = setTimeout(() => {
        this.close(id);
      }, 10000);
      try {
        const { spawn: spawnPty } = await Promise.race([this.loadPty(), canceled]);
        if (shell.exited) throw new Error('Terminal closed before startup.');
        const pty = spawnPty('powershell.exe', ['-NoLogo'], {
          cwd,
          cols,
          rows,
          name: 'xterm-256color',
          env: process.env as Record<string, string>,
        });
        shell.pty = pty;
        shell.phase = 'ready';
        pty.onData((data) => {
          if (shell.exited) return;
          shell.output = (shell.output + data).slice(-ptyScrollbackChars);
          shell.cursor += data.length;
        });
        pty.onExit(() => {
          if (shell.exited) return;
          shell.exited = true;
          shell.phase = 'closed';
        });
        return { id };
      } catch (error) {
        shell.exited = true;
        if (shell.phase !== 'closed') shell.phase = 'failed';
        shell.error = error instanceof Error ? error.message : 'Terminal startup failed.';
        throw error;
      } finally {
        clearTimeout(timeout);
        shell.cancelOpening = undefined;
      }
    }
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn('python3', ['-u', '-c', helper, String(cols), String(rows)], {
        cwd,
        env: { ...process.env, NO_COLOR: undefined },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      shell.exited = true;
      shell.phase = 'failed';
      throw error;
    }
    shell.child = child;
    child.stdin.on('error', () => {});
    child.stderr.on('data', (data) => {
      if (!shell.exited) shell.error = ((shell.error || '') + data.toString()).slice(-8192);
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        shell.error = 'Terminal startup timed out.';
        this.close(id);
        reject(new Error('Terminal startup timed out.'));
      }, 10000);
      shell.cancelOpening = (error) => {
        clearTimeout(timer);
        reject(error);
      };
      const fail = (error: Error) => {
        clearTimeout(timer);
        shell.exited = true;
        shell.phase = 'failed';
        shell.error = error.message;
        reject(error);
      };
      child.on('error', () =>
        fail(new Error('Interactive terminal requires Python 3 on this machine’s PATH.')),
      );
      child.on('close', () => {
        shell.exited = true;
        if (shell.phase !== 'failed') shell.phase = 'closed';
        clearTimeout(timer);
        reject(new Error(shell.error || 'Terminal closed before startup.'));
      });
      createInterface({ input: child.stdout }).on('line', (line) => {
        if (shell.exited) return;
        try {
          const message = JSON.parse(line);
          if (message.ready) {
            clearTimeout(timer);
            shell.phase = 'ready';
            shell.cancelOpening = undefined;
            resolve();
          }
          if (typeof message.data === 'string') {
            shell.output = (shell.output + message.data).slice(-ptyScrollbackChars);
            shell.cursor += message.data.length;
          }
        } catch {
          /* Ignore malformed transport output. */
        }
      });
    });
    shell.cancelOpening = undefined;
    return { id };
  }
  private get(id: string) {
    const shell = this.shells.get(id);
    if (!shell) throw new Error('Terminal no longer available.');
    return shell;
  }
  read(id: string, cursor: number) {
    const s = this.get(id);
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Invalid terminal cursor');
    const start = s.cursor - s.output.length;
    return {
      id,
      data: s.output.slice(Math.max(0, cursor - start)),
      cursor: s.cursor,
      exited: s.exited,
      truncated: cursor < start,
      error: s.error,
      phase: s.phase,
    };
  }
  write(id: string, input: string) {
    const s = this.get(id);
    if (s.exited) throw new Error('Terminal has exited.');
    if (s.phase !== 'ready') throw new Error('Terminal is not ready.');
    if (typeof input !== 'string' || input.length > 100000)
      throw new Error('Terminal input too long');
    try {
      if (s.pty) s.pty.write(input);
      else s.child!.stdin.write(JSON.stringify({ input }) + '\n');
    } catch {
      this.close(id);
      s.phase = 'failed';
      s.error = 'Terminal input failed. Start a new shell.';
      throw new Error(s.error);
    }
  }
  private dimensions(cols: number, rows: number) {
    if (![cols, rows].every((n) => Number.isInteger(n) && n >= 2 && n <= 500))
      throw new Error('Invalid terminal dimensions');
  }
  resize(id: string, cols: number, rows: number) {
    this.dimensions(cols, rows);
    const s = this.get(id);
    if (!s.exited) {
      if (s.phase !== 'ready') throw new Error('Terminal is not ready.');
      if (s.pty) s.pty.resize(cols, rows);
      else s.child!.stdin.write(JSON.stringify({ cols, rows }) + '\n');
    }
  }
  close(id: string) {
    const s = this.shells.get(id);
    if (!s || s.exited) return;
    s.phase = 'closing';
    s.exited = true;
    s.cancelOpening?.(new Error(s.error || 'Terminal closed before startup.'));
    s.cancelOpening = undefined;
    try {
      if (s.pty) s.pty.kill();
      else if (s.child) {
        s.child.stdin.end();
        s.child.kill('SIGTERM');
      }
    } finally {
      s.phase = 'closed';
    }
  }
  /** The shells that still work, the oldest first. */
  list() {
    return [...this.shells]
      .filter(([, shell]) => !shell.exited && shell.phase === 'ready')
      .map(([id, shell]) => ({ id, cwd: shell.cwd }));
  }
  /** The number of shells that still work or start. */
  openCount() {
    return [...this.shells.values()].filter((shell) => !shell.exited).length;
  }
  closeAll() {
    for (const id of this.shells.keys()) this.close(id);
  }
}
