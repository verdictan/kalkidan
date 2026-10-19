import { win32, posix } from 'node:path';

export function pathContains(root: string, path: string) {
  // Remote Unix paths must retain Unix semantics on Windows clients.
  const paths = /^[A-Za-z]:[\\/]|^\\\\/.test(root) ? win32 : posix;
  const child = paths.relative(root, path);
  return (
    child === '' ||
    (child !== '..' && !child.startsWith('..' + paths.sep) && !paths.isAbsolute(child))
  );
}

export function executableCandidates(name: string, env = process.env, platform = process.platform) {
  const windows = platform === 'win32';
  const paths = windows ? win32 : posix;
  const path = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] || '';
  const names = windows ? [name + '.exe', name + '.cmd', name] : [name];
  return path
    .split(windows ? ';' : ':')
    .filter(Boolean)
    .flatMap((dir) => names.map((file) => paths.join(dir, file)));
}

export function commandShell(command: string, platform = process.platform) {
  return platform === 'win32'
    ? {
        file: 'powershell.exe',
        args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
      }
    : { file: process.env.SHELL || '/bin/sh', args: ['-lc', command] };
}
