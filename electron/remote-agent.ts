import { WorktreeCreation } from './operations/worktree';
import { AgentStarts } from './operations/agent-start';
import { PublishOperations, publishEffects } from './operations/publish';
import { RemoteAccountClient } from './verdictan/remote-broker';
import { listDirectory } from './storage/directory-list';
import { createVerdictanServices } from './verdictan/service';
import type { RuntimePolicy } from './verdictan/install';
import { desktopVersion } from './verdictan/release';
import {
  ProjectLocationCache,
  prepareProjectLocation,
  importLegacyDocs,
} from './storage/project-location';
import { memoryDirectory, readProjectMemory } from './storage/project-memory';
import { resourceRevision } from './storage/resource-revision';
import { remoteProtocolVersion } from '../src/domain/host';
import { ProjectDocs } from './storage/project-docs';
import { PtyTerminal } from './pty-terminal';
// Private stdio RPC service. OpenSSH provides authentication and encryption; no listening port.
import { createInterface } from 'node:readline';
import { readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { exec, parseWorktrees } from './core';
import { historyWithManaged } from './history';
const runningBundleDigest = process.argv?.[1]
  ? readFile(process.argv[1])
      .then((bytes) => createHash('sha256').update(bytes).digest('hex'))
      .catch(() => undefined)
  : Promise.resolve(undefined);
const history = (codex: string, claude: string, sources?: Map<string, string>) =>
  historyWithManaged(join(homedir(), '.kalkidan'), codex, claude, sources);
import { readTranscript } from './transcript';
import { codexTranscript } from './codex-store';
import { createAgentRuntimes } from './agents/runtime';
import { CommandTerminal, repositoryDiff } from './conversation-tools';
import { modelOptions } from './models';
import { executable } from './chat';
import {
  gitCommit,
  gitPullRequest,
  gitSwitchNewBranch,
  removeWorktree,
  workingFiles,
  workingStatus,
  worktreePreview,
} from './git-working';
import { scanRepositories } from './repository-scan';
import { existsSync } from 'node:fs';
const publishOperations = new PublishOperations(
  join(homedir(), '.kalkidan', 'operations', 'publish'),
  publishEffects(() => executable('gh')),
);
const worktreeCreation = new WorktreeCreation(
  join(homedir(), '.kalkidan', 'operations', 'worktree'),
  (cwd, args) => git(cwd, args),
);
const locations = new ProjectLocationCache(join(homedir(), '.kalkidan', 'projects'));
const projectDocs = new Map<string, ProjectDocs>();
const pty = new PtyTerminal();
const chats = createAgentRuntimes(async (request) => {
  if (!verdictanRuntime)
    throw new Error('Install the managed runtime on this host before starting an agent.');
  return verdictanRuntime.launch.prepare(request);
});
const terminal = new CommandTerminal();
let verdictanRuntime: ReturnType<typeof createVerdictanServices> | undefined;
let verdictanPolicy: RuntimePolicy | null = null;
let verdictanOwner = '';
let accountProxy = new RemoteAccountClient((frame) =>
  process.stdout.write(JSON.stringify(frame) + '\n'),
);
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
const agentStarts = new AgentStarts(
  join(homedir(), '.kalkidan', 'operations', 'agent-start'),
  (id) => chats.status(id),
);
async function dispatch(method: string, args: any[]): Promise<any> {
  const [a, b, c, d, e, f] = args;
  switch (method) {
    case 'managed-stop':
      chats.dispose();
      await verdictanRuntime?.managed.stopAll();
      verdictanRuntime?.account.reset();
      accountProxy.close();
      accountProxy = new RemoteAccountClient((frame) =>
        process.stdout.write(JSON.stringify(frame) + '\n'),
      );
      return true;
    case 'runtime-update': {
      if (
        !['status', 'check', 'install', 'cancel'].includes(a) ||
        !desktopVersion(c) ||
        typeof d !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(d)
      )
        throw new Error('Invalid runtime update request.');
      if (verdictanOwner && verdictanOwner !== d) throw new Error('Runtime host identity changed.');
      verdictanPolicy = b;
      if (!verdictanRuntime) {
        verdictanOwner = d;
        verdictanRuntime = createVerdictanServices({
          root: join(homedir(), '.kalkidan'),
          client: async () => {
            if (accountProxy.isClosed())
              accountProxy = new RemoteAccountClient((frame) =>
                process.stdout.write(JSON.stringify(frame) + '\n'),
              );
            return accountProxy;
          },
          selections: () => accountProxy.query('setup.selection'),
          identities: () => accountProxy.query('host.identity'),
          hostId: d,
          desktopVersion: c,
          policy: async () => verdictanPolicy,
          busy: () => chats.runningCount() > 0,
          openBrowser: async () => {
            throw new Error('Account authorization belongs to the desktop.');
          },
        });
      }
      if (a === 'install') return verdictanRuntime.installer.start();
      if (a === 'cancel') return verdictanRuntime.installer.cancel();
      return verdictanRuntime.installer.check(a === 'check');
    }
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
        bundleDigest: await runningBundleDigest,
        protocol: remoteProtocolVersion,
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        home: homedir(),
      };
    case 'project-resource-revision':
      return resourceRevision(await folder(a), b);
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
      const path = await worktreeCreation.run(cwd, b, c, d);
      return { path: await folder(path), name: basename(path) };
    }
    case 'worktree-preview': {
      if (typeof c !== 'string' || !c.startsWith('/')) throw new Error('Project location required');
      return worktreePreview(await folder(a), b, c, existsSync);
    }
    case 'scan-repositories':
      return scanRepositories(await folder(a));
    case 'worktree-remove': {
      const cwd = await folder(a);
      return chats.withCheckoutIdle(cwd, () => removeWorktree(cwd, b === true));
    }
    case 'working-status':
      return workingStatus(await folder(a));
    case 'git-publish': {
      const cwd = await folder(a);
      return chats.withCheckoutIdle(cwd, () => publishOperations.run(cwd, b));
    }
    case 'git-publish-status':
      return publishOperations.status(await folder(a), b);
    case 'git-commit':
      return gitCommit(await folder(a), b, c);
    case 'working-files':
      return workingFiles(await folder(a));
    case 'git-switch-new-branch':
      return gitSwitchNewBranch(await folder(a), b);
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
      return agentStarts.run(e?.operationId, [a, b, c, d, e], async () =>
        chats.start(
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
          f
            ? {
                root: await folder(f.root),
                groupId: f.groupId,
                prompt: f.prompt,
                changed: () =>
                  process.stdout.write(
                    JSON.stringify({
                      event: 'project-resource-changed',
                      groupId: f.groupId,
                      resource: 'memory',
                    }) + '\n',
                  ),
              }
            : undefined,
        ),
      );
    case 'chatStart': {
      const { session } = await source(a, b);
      return agentStarts.run(e?.operationId, [a, b, c, d, e], async () =>
        chats.start(
          session,
          c,
          d,
          false,
          e?.model,
          undefined,
          f
            ? {
                root: await folder(f.root),
                groupId: f.groupId,
                prompt: f.prompt,
                changed: () =>
                  process.stdout.write(
                    JSON.stringify({
                      event: 'project-resource-changed',
                      groupId: f.groupId,
                      resource: 'memory',
                    }) + '\n',
                  ),
              }
            : undefined,
        ),
      );
    }
    case 'chatStatus':
      return chats.status(a);
    case 'chatStop':
      return chats.stop(a);
    case 'chatApprove':
      return chats.approve(a, b, c);
    case 'chatRespond':
      return chats.respond(a, b, c);
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
  if (accountProxy.receive(request)) return;
  if (typeof request.id !== 'string' || !Array.isArray(request.args)) return;
  void dispatch(request.method, request.args)
    .then((result) => process.stdout.write(JSON.stringify({ id: request.id, result }) + '\n'))
    .catch((error) =>
      process.stdout.write(JSON.stringify({ id: request.id, error: error.message }) + '\n'),
    );
});
const stop = () => {
  accountProxy.close();
  void verdictanRuntime?.managed.stopAll();
  verdictanRuntime?.account.dispose();
  chats.dispose();
  terminal.stopAll();
  pty.closeAll();
  setTimeout(() => process.exit(), 1200).unref();
};
input.on('close', stop);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
