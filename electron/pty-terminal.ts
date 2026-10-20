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
interface Shell {
  child?: ChildProcessWithoutNullStreams;
  pty?: import('node-pty').IPty;
  output: string;
  cursor: number;
  exited: boolean;
  error?: string;
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
    if (process.platform === 'win32') {
      const { spawn: spawnPty } = await this.loadPty();
      const pty = spawnPty('powershell.exe', ['-NoLogo'], {
        cwd,
        cols,
        rows,
        name: 'xterm-256color',
        env: process.env as Record<string, string>,
      });
      const shell: Shell = { pty, output: '', cursor: 0, exited: false };
      this.shells.set(id, shell);
      pty.onData((data) => {
        shell.output = (shell.output + data).slice(-1000000);
        shell.cursor += data.length;
      });
      pty.onExit(() => {
        shell.exited = true;
      });
      return { id };
    }
    const child = spawn('python3', ['-u', '-c', helper, String(cols), String(rows)], {
      cwd,
      env: { ...process.env, NO_COLOR: undefined },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const shell: Shell = { child, output: '', cursor: 0, exited: false };
    this.shells.set(id, shell);
    child.stdin.on('error', () => {});
    child.stderr.on('data', (data) => {
      shell.error = (shell.error || '') + data.toString();
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.close(id);
        reject(new Error('Terminal startup timed out.'));
      }, 10000);
      const fail = (error: Error) => {
        clearTimeout(timer);
        shell.exited = true;
        shell.error = error.message;
        reject(error);
      };
      child.on('error', () =>
        fail(new Error('Interactive terminal requires Python 3 on this machine’s PATH.')),
      );
      child.on('close', () => {
        shell.exited = true;
        clearTimeout(timer);
        reject(new Error(shell.error || 'Terminal closed before startup.'));
      });
      createInterface({ input: child.stdout }).on('line', (line) => {
        try {
          const message = JSON.parse(line);
          if (message.ready) {
            clearTimeout(timer);
            resolve();
          }
          if (typeof message.data === 'string') {
            shell.output = (shell.output + message.data).slice(-1000000);
            shell.cursor += message.data.length;
          }
        } catch {
          /* Ignore malformed transport output. */
        }
      });
    });
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
    };
  }
  write(id: string, input: string) {
    const s = this.get(id);
    if (s.exited) throw new Error('Terminal has exited.');
    if (typeof input !== 'string' || input.length > 100000)
      throw new Error('Terminal input too long');
    if (s.pty) s.pty.write(input);
    else s.child!.stdin.write(JSON.stringify({ input }) + '\n');
  }
  private dimensions(cols: number, rows: number) {
    if (![cols, rows].every((n) => Number.isInteger(n) && n >= 2 && n <= 500))
      throw new Error('Invalid terminal dimensions');
  }
  resize(id: string, cols: number, rows: number) {
    this.dimensions(cols, rows);
    const s = this.get(id);
    if (!s.exited) {
      if (s.pty) s.pty.resize(cols, rows);
      else s.child!.stdin.write(JSON.stringify({ cols, rows }) + '\n');
    }
  }
  close(id: string) {
    const s = this.shells.get(id);
    if (!s || s.exited) return;
    if (s.pty) s.pty.kill();
    else {
      s.child!.stdin.end();
      s.child!.kill('SIGTERM');
    }
    s.exited = true;
  }
  closeAll() {
    for (const id of this.shells.keys()) this.close(id);
  }
}
