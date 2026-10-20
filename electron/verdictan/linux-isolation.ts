import { createServer, connect, type Socket } from 'node:net';
import { chmod, realpath } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import type { Server } from 'node:net';
import { DesktopProtocolError } from './protocol';

// The helper owns only fixed gateway/MCP bridges. The native child cannot open Unix sockets,
// inspect another process, or use io_uring to bypass the socket filter.
export const linuxRelay = String.raw`
import ctypes, os, platform, socket, subprocess, sys, threading
ports = [int(p) for p in sys.argv[1].split(',')]
root = sys.argv[2]
listeners = []
for port in ports:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(('127.0.0.1', port)); s.listen(32); listeners.append((s, port))
def restrict():
    libc = ctypes.CDLL(None, use_errno=True)
    class F(ctypes.Structure):
        _fields_ = [('code', ctypes.c_ushort), ('jt', ctypes.c_ubyte), ('jf', ctypes.c_ubyte), ('k', ctypes.c_uint)]
    class P(ctypes.Structure):
        _fields_ = [('len', ctypes.c_ushort), ('filter', ctypes.POINTER(F))]
    arm = platform.machine() == 'aarch64'
    if not arm and platform.machine() != 'x86_64': os._exit(125)
    arch = 0xc00000b7 if arm else 0xc000003e
    # Kill a foreign syscall ABI. Block process inspection, namespace entry, and io_uring.
    rows = [(0x20,0,0,4),(0x15,1,0,arch),(0x06,0,0,0x80000000),(0x20,0,0,0),(0x45,0,1,0x40000000),(0x06,0,0,0x80000000)]
    for number in ([117,270,271,268,97] if arm else [101,310,311,308,272]) + [425,426,427,438]:
        rows += [(0x15,0,1,number),(0x06,0,0,0x50001)]
    rows += [(0x15,0,4,198 if arm else 41),(0x20,0,0,16),(0x15,2,0,2),(0x15,1,0,10),(0x06,0,0,0x50001),(0x06,0,0,0x7fff0000)]
    table = (F * len(rows))(*(F(*r) for r in rows)); program = P(len(rows),table)
    if libc.prctl(38,1,0,0,0) != 0 or libc.prctl(22,2,ctypes.byref(program),0,0) != 0: os._exit(125)
child = subprocess.Popen(sys.argv[3:], preexec_fn=restrict)
def copy(source, target):
    try:
        while True:
            data = source.recv(65536)
            if not data: break
            target.sendall(data)
    except OSError: pass
    finally:
        try: target.shutdown(socket.SHUT_WR)
        except OSError: pass
slots = threading.BoundedSemaphore(32)
def bridge(client, port):
    upstream = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        upstream.connect(os.path.join(root, str(port)+'.sock'))
        thread = threading.Thread(target=copy, args=(client,upstream), daemon=True); thread.start()
        copy(upstream,client); thread.join()
    except OSError: pass
    finally: client.close(); upstream.close(); slots.release()
def accept(server, port):
    while True:
        client, _ = server.accept()
        if slots.acquire(blocking=False): threading.Thread(target=bridge,args=(client,port),daemon=True).start()
        else: client.close()
for server, port in listeners: threading.Thread(target=accept,args=(server,port),daemon=True).start()
sys.exit(child.wait())
`;

export function linuxArguments(
  cwd: string,
  home: string,
  temporary: string,
  files: string[],
  ports: number[],
  allowEdits = true,
) {
  if (
    ![cwd, home, temporary, ...files].every((p) => isAbsolute(p) && !/[\0\r\n]/.test(p)) ||
    ['/', '/home', '/root', '/usr', '/etc', '/run', '/proc', '/sys'].includes(cwd) ||
    !ports.length ||
    ports.some((p) => !Number.isInteger(p) || p < 1 || p > 65535)
  )
    throw new DesktopProtocolError('desktop.isolation_scope_invalid');
  return [
    '--unshare-all',
    '--unshare-user',
    '--disable-userns',
    '--die-with-parent',
    '--new-session',
    '--cap-drop',
    'ALL',
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--tmpfs',
    '/tmp',
    '--tmpfs',
    '/run',
    ...['/usr', '/bin', '/sbin', '/lib', '/lib64', '/etc/ld.so.cache'].flatMap((p) => [
      '--ro-bind-try',
      p,
      p,
    ]),
    ...files.flatMap((p) => ['--ro-bind', p, p]),
    allowEdits ? '--bind' : '--ro-bind',
    cwd,
    cwd,
    '--bind',
    home,
    home,
    '--bind',
    temporary,
    temporary,
    '--chdir',
    cwd,
    '--',
    '/usr/bin/python3',
    '-c',
    linuxRelay,
    [...new Set(ports)].join(','),
    temporary,
  ];
}

/** Host side has no arbitrary target parameter. A socket maps to exactly one loopback port. */
export async function linuxBridges(temporary: string, ports: number[]) {
  const servers: Server[] = [],
    sockets = new Set<Socket>();
  const close = async () => {
    for (const socket of sockets) socket.destroy();
    await Promise.all(
      servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
  };
  try {
    for (const port of new Set(ports)) {
      const server = createServer((socket) => {
        if (sockets.size >= 64) {
          socket.destroy();
          return;
        }
        const upstream = connect({ host: '127.0.0.1', port });
        for (const item of [socket, upstream]) {
          sockets.add(item);
          item.on('close', () => sockets.delete(item));
          item.on('error', () => {
            socket.destroy();
            upstream.destroy();
          });
        }
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
      servers.push(server);
      const path = join(temporary, `${port}.sock`);
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(path, () => {
          server.off('error', reject);
          resolve();
        });
      });
      await chmod(path, 0o600);
    }
    return close;
  } catch (error) {
    await close();
    throw error;
  }
}
export async function linuxIsolation(
  cwd: string,
  home: string,
  temporary: string,
  files: string[],
  ports: number[],
  allowEdits = true,
) {
  const executable = await realpath('/usr/bin/bwrap');
  const prefix = linuxArguments(cwd, home, temporary, files, ports, allowEdits);
  const close = await linuxBridges(temporary, ports);
  return {
    executable,
    prefix,
    close,
  };
}
