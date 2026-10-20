import { listDirectory } from './storage/directory-list';
import {
  ProjectLocationCache,
  prepareProjectLocation,
  importLegacyDocs,
} from './storage/project-location';
import { memoryDirectory, readProjectMemory } from './storage/project-memory';
import { ProjectDocs } from './storage/project-docs';
import { PtyTerminal } from './pty-terminal';
// Private stdio RPC service. OpenSSH provides authentication and encryption; no listening port.
import { createInterface } from 'node:readline';
import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { exec, parseWorktrees } from './core';
import { history } from './history';
import { readTranscript } from './transcript';
import { codexTranscript } from './codex-store';
import { createAgentRuntimes } from './agents/runtime';
import { CommandTerminal, repositoryDiff } from './conversation-tools';
import { modelOptions } from './models';
import { executable } from './chat';
import { gitCommit, gitPullRequest, removeWorktree, workingStatus } from './git-working';
const locations = new ProjectLocationCache(join(homedir(), '.kalkidan', 'projects'));
const projectDocs = new Map<string, ProjectDocs>();
const pty = new PtyTerminal();
const chats = createAgentRuntimes();
const terminal = new CommandTerminal();
const codex = process.env.CODEX_HOME || join(homedir(), '.codex');
const claude = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
async function folder(value: string) {
  if (typeof value !== 'string' || !value) throw new Error('Choose a remote folder.');
  const path = await realpath(
    value === '~' ? homedir() : value.startsWith('~/') ? join(homedir(), value.slice(2)) : value,
  );
  if (!(await stat(path)).isDirectory()) throw new Error('Not a directory');
  return path;
}
const git = async (cwd: string, args: string[]) =>
  (await exec('git', ['-C', cwd, ...args], { timeout: 15000, maxBuffer: 2 * 1024 * 1024 })).stdout;
async function source(agent: string, id: string) {
  const sources = new Map<string, string>();
  const result = await history(codex, claude, sources);
  const session = result.sessions.find((s) => s.id === id && s.agent === agent);
  if (!session) throw new Error('Remote session not found. Refresh history.');
  return { session, path: sources.get(`${agent}:${id}`) };
}
async function dispatch(method: string, args: any[]): Promise<any> {
  const [a, b, c, d, e] = args;
  switch (method) {
    case 'ptyOpen':
      return pty.open(await folder(a), b, c);
    case 'ptyRead':
      return pty.read(a, b);
    case 'ptyWrite':
      return pty.write(a, b);
    case 'ptyResize':
      return pty.resize(a, b, c);
    case 'ptyClose':
      return pty.close(a);
    case 'project-prepare':
      return prepareProjectLocation(a, b, join(homedir(), '.kalkidan', 'projects'));
    case 'project-import-docs': {
      const root = await locations.get(a, b);
      await importLegacyDocs(root, c);
      return true;
    }
    case 'project-memory': {
      const root = await locations.get(a, b);
      if (c === 'path') return memoryDirectory(root);
      if (c === 'list') return readProjectMemory(root);
      throw new Error('Unknown memory operation.');
    }
    case 'project-docs': {
      const root = await locations.get(a, b);
      let docs = projectDocs.get(root);
      if (!docs) {
        docs = new ProjectDocs(
          root,
          (id) => id === a,
          async () => join(root, 'docs'),
        );
        projectDocs.set(root, docs);
      }
      try {
        switch (c) {
          case 'search':
            return await docs.search(a, d[0]);
          case 'metadata':
            return await docs.metadata(a);
          case 'read':
            return await docs.get(a, d[0]);
          case 'list':
            return await docs.list(a);
          case 'create':
            return await docs.create(a, d[0], d[1]);
          case 'save':
            return await docs.save(a, d[0]);
          case 'delete':
            return await docs.delete(a, d[0], d[1]);
          case 'trash':
            return await docs.trash(a);
          case 'restore':
            return await docs.restore(a, d[0]);
          default:
            throw new Error('Unknown document operation');
        }
      } catch (error) {
        locations.invalidate(a, b);
        throw error;
      }
    }
    case 'hello':
      return {
        protocol: 1,
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        home: homedir(),
      };
    case 'repository-snapshot': {
      const cwd = await folder(a);
      const [info, scan] = await Promise.all([dispatch('git', [cwd]), history(codex, claude)]);
      const roots = [cwd, ...(info?.worktrees.map((tree: { path: string }) => tree.path) || [])];
      return {
        git: info,
        warnings: scan.warnings,
        sessions: scan.sessions.filter((session) =>
          roots.some((root) => session.cwd === root || session.cwd.startsWith(root + '/')),
        ),
      };
    }
    case 'snapshot':
      return history(codex, claude);
    case 'validate': {
      const path = await folder(a);
      return { path, name: basename(path) };
    }
    case 'directory-list':
      return listDirectory(a);
    case 'folders': {
      const listing = await listDirectory(a || '~');
      return {
        path: listing.path,
        parent: listing.parent,
        folders: listing.entries
          .filter((entry) => entry.kind === 'directory' && !entry.name.startsWith('.'))
          .map(({ name, path }) => ({ name, path }))
          .slice(0, 500),
      };
    }
    case 'clone': {
      if (
        typeof a !== 'string' ||
        !/^[\w.-]+\/[\w.-]+$/.test(a) ||
        typeof b !== 'string' ||
        !b.startsWith('/')
      )
        throw new Error('Choose owner/repository and an absolute destination path.');
      await exec('git', ['clone', '--', `https://github.com/${a}.git`, b], {
        timeout: 300000,
        maxBuffer: 2 * 1024 * 1024,
      });
      return { path: await folder(b), name: basename(b) };
    }
    case 'git': {
      const cwd = await folder(a);
      try {
        await git(cwd, ['rev-parse', '--show-toplevel']);
      } catch {
        return null;
      }
      const [branch, status, trees] = await Promise.all([
        git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'unborn'),
        git(cwd, ['status', '--porcelain', '-z']),
        git(cwd, ['worktree', 'list', '--porcelain']),
      ]);
      const entries = status.split('\0');
      let changes = 0;
      for (let i = 0; i < entries.length; i++)
        if (entries[i]) {
          changes++;
          if (/^[RC]|^.[RC]/.test(entries[i])) i++;
        }
      return { branch: branch.trim(), changes, worktrees: parseWorktrees(trees) };
    }
    case 'worktree': {
      const cwd = await folder(a);
      if (typeof b !== 'string' || b.startsWith('-') || b.length > 200)
        throw new Error('Invalid branch');
      await git(cwd, ['check-ref-format', '--branch', b]);
      if (typeof c !== 'string' || !c.startsWith('/')) throw new Error('Project location required');
      const path = join(
        c,
        'worktrees',
        basename(cwd) + '-' + b.replaceAll('/', '-') + '-' + randomUUID().slice(0, 8),
      );
      await git(cwd, ['worktree', 'add', '-b', b, '--', path]);
      return { path: await folder(path), name: basename(path) };
    }
    case 'worktree-remove':
      return removeWorktree(await folder(a), b === true);
    case 'working-status':
      return workingStatus(await folder(a));
    case 'git-commit':
      return gitCommit(await folder(a), b);
    case 'git-pull-request':
      return gitPullRequest(await folder(a), b, c, () => executable('gh'));
    case 'repositoryDiff':
      return repositoryDiff(await folder(a));
    case 'terminalStart':
      return terminal.start(await folder(a), b);
    case 'terminalStatus':
      return terminal.status(a);
    case 'terminalInput':
      return terminal.input(a, b);
    case 'terminalStop':
      return terminal.stop(a);
    case 'models':
      return modelOptions(a, codex);
    case 'transcript': {
      const { path } = await source(a, b);
      if (a === 'codex') {
        if (path) {
          try {
            return await readTranscript(path, a);
          } catch {}
        }
        return codexTranscript(codex, b);
      }
      return readTranscript(path!, a);
    }
    case 'chatCreate':
      if (e?.forkFrom) await source(b, e.forkFrom);
      return chats.start(
        {
          id: randomUUID(),
          cwd: await folder(a),
          agent: b,
          title: 'New session',
          updatedAt: new Date().toISOString(),
        },
        c,
        d,
        true,
        e?.model,
        e?.forkFrom,
      );
    case 'chatStart': {
      const { session } = await source(a, b);
      return chats.start(session, c, d, false, e?.model);
    }
    case 'chatStatus':
      return chats.status(a);
    case 'chatStop':
      return chats.stop(a);
    case 'chatApprove':
      return chats.approve(a, b, c);
    default:
      throw new Error('Unsupported remote operation');
  }
}
const input = createInterface({ input: process.stdin });
input.on('line', (line) => {
  if (line.length > 16000000) return;
  let request: any;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  if (typeof request.id !== 'string' || !Array.isArray(request.args)) return;
  void dispatch(request.method, request.args)
    .then((result) => process.stdout.write(JSON.stringify({ id: request.id, result }) + '\n'))
    .catch((error) =>
      process.stdout.write(JSON.stringify({ id: request.id, error: error.message }) + '\n'),
    );
});
const stop = () => {
  chats.dispose();
  terminal.stopAll();
  pty.closeAll();
  setTimeout(() => process.exit(), 1200).unref();
};
input.on('close', stop);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
