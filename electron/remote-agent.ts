import { WorktreeCreation } from './operations/worktree';
import { AgentStarts } from './operations/agent-start';
import { PublishOperations, publishEffects } from './operations/publish';
import { RemoteAccountClient } from './verdictan/remote-broker';
import { DesktopProtocolError } from './verdictan/protocol';
import { listDirectory } from './storage/directory-list';
import { listMentionFiles, readMentionFile } from './projects/mention-files';
import { createVerdictanServices } from './verdictan/service';
import { isVerdictanRegion } from './verdictan/region';
import { desktopVersion } from './verdictan/release';
import {
  ProjectLocationCache,
  prepareProjectLocation,
  importLegacyDocs,
} from './storage/project-location';
import { memoryDirectory, readProjectMemory } from './storage/project-memory';
import { projectMemory } from './storage/managed-memory';
import { resourceRevision } from './storage/resource-revision';
import { remoteProtocolVersion } from '../src/domain/host';
import { ProjectDocs } from './storage/project-docs';
import { PtyTerminal } from './pty-terminal';
// Private stdio RPC service. OpenSSH provides authentication and encryption; no listening port.
import { createInterface } from 'node:readline';
import { readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, basename, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer, type Server, type Socket } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { exec, parseWorktrees } from './core';
import { historyWithManaged } from './history';
import { RunOutcomeLog } from './operations/run-outcomes';
import {
  connectHelper,
  helperDecision,
  helperSocketPath,
  listenHelper,
  prepareHelperDirectory,
} from './operations/helper-daemon';
import type { ChatRun } from '../src/domain/conversation';
import { BindingStore, bindingSummary } from './verdictan/bindings';
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
import { agentInstallations, chooseAgentExecutable } from './agent-installations';
import {
  gitCommit,
  gitPullRequest,
  gitSwitchNewBranch,
  pullRequestStatus,
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
// The outcome of each run stays on the host. The desktop reads it when it connects again.
const runOutcomes = new RunOutcomeLog(join(homedir(), '.kalkidan', 'operations', 'run-outcomes'));
const bindings = new BindingStore(join(homedir(), '.kalkidan'));
// True when the helper stops, for example when the host shuts down. Then the open runs stop.
let shuttingDown = false;
// The runs that the helper stopped because no app was connected for too long.
const expired = new Set<string>();
/** The state of a run that the helper stopped, as the app must see it. */
function presented(state: ChatRun): ChatRun {
  if (state?.status !== 'stopped') return state;
  // The user did not stop these runs.
  if (expired.has(state.id))
    return {
      ...state,
      status: 'failed',
      errorCode: 'unattended_limit',
      error: 'The run stopped on the SSH host because no app was connected for too long.',
    };
  if (shuttingDown) return { ...state, status: 'failed', errorCode: 'transport_lost' };
  return state;
}
const chats = createAgentRuntimes(
  async (request) => {
    if (!verdictanRuntime) throw new DesktopProtocolError('desktop.remote_runtime_missing');
    return verdictanRuntime.launch.prepare(request);
  },
  (run) => {
    void runOutcomes.finished({ ...run, state: presented(run.state) }).catch(() => {});
  },
);
const terminal = new CommandTerminal();
let verdictanRuntime: ReturnType<typeof createVerdictanServices> | undefined;
let verdictanOwner = '';
/** One app connection: the SSH standard streams, or a socket of the helper. */
interface AppConnection {
  write(text: string): void;
  closed(): boolean;
  close(): void;
}
// The connected app. The helper continues without an app, so that runs continue.
let client: AppConnection | undefined;
/** Sends a frame to the connected app. Throws when no app is connected. */
function send(frame: object) {
  if (!client || client.closed()) throw new Error('No app is connected.');
  client.write(JSON.stringify(frame) + '\n');
}
/** Sends an event to the connected app. Without an app, the event is not sent. */
function notify(frame: object) {
  try {
    send(frame);
  } catch {
    // The app reads the resource again when it connects.
  }
}
let accountProxy = new RemoteAccountClient(send);
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
    case 'dispatch-recover': {
      const path = await folder(a);
      const run = await agentStarts.inspect(b);
      let canRelease = false;
      if (run?.status !== 'running')
        await chats.withCheckoutIdle(path, async () => {
          canRelease = true;
        });
      return { run, canRelease };
    }
    case 'managed-stop':
      chats.dispose();
      await verdictanRuntime?.managed.stopAll();
      verdictanRuntime?.account.reset();
      accountProxy.close();
      accountProxy = new RemoteAccountClient(send);
      return true;
    case 'runtime-update': {
      if (
        !['status', 'check', 'install', 'cancel'].includes(a) ||
        !desktopVersion(b) ||
        (d != null && !isVerdictanRegion(d)) ||
        typeof c !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(c)
      )
        throw new Error('Invalid runtime update request.');
      // No region means that the desktop has no selected account region yet.
      const region = d ?? undefined;
      // The helper outlives a connection. A different app or region can take the runtime only
      // when no run uses it.
      if (verdictanRuntime && (verdictanOwner !== c || verdictanRuntime.region !== region)) {
        if (chats.runningCount() > 0)
          throw new Error(
            verdictanOwner !== c
              ? 'Runtime host identity changed. Wait for the runs on this host to finish.'
              : 'Wait for the runs on this host to finish before changing the Verdictan region.',
          );
        await verdictanRuntime.managed.stopAll();
        verdictanRuntime.account.dispose();
        verdictanRuntime = undefined;
      }
      if (!verdictanRuntime) {
        verdictanOwner = c;
        verdictanRuntime = createVerdictanServices({
          root: join(homedir(), '.kalkidan'),
          client: async () => {
            if (accountProxy.isClosed()) accountProxy = new RemoteAccountClient(send);
            return accountProxy;
          },
          selections: () => accountProxy.query('setup.selection'),
          identities: () => accountProxy.query('host.identity'),
          hostId: c,
          region,
          desktopVersion: b,
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
      if (c === 'entries') return projectMemory(root).list();
      if (c === 'forget') return projectMemory(root).forget(d[0], d[1]);
      if (c === 'save') {
        if (!d?.[0] || typeof d[0] !== 'object') throw new Error('Enter a memory entry to save.');
        return projectMemory(root).save(d[0]);
      }
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
            return await docs.search(a, d[0], d[1] ?? undefined);
          case 'task-links':
            return await docs.taskLinks(a);
          case 'set-task-links':
            return await docs.setTaskLinks(a, d[0], d[1]);
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
        // The same helper answers after a new connection while it keeps runs.
        pid: process.pid,
      };
    case 'agent-installations':
      return agentInstallations();
    case 'agent-executable-choose':
      // The choice stays in ~/.kalkidan on this host. Launches on this host use it.
      return chooseAgentExecutable(a, b);
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
    case 'mention-files':
      return listMentionFiles(await folder(a));
    case 'mention-file-read':
      return readMentionFile(await folder(a), b);
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
    case 'git-remote-url':
      return git(await folder(a), ['remote', 'get-url', 'origin']);
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
    case 'pull-request-status':
      return pullRequestStatus(await folder(a), b, () => executable('gh'));
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
            title: 'New chat',
            governanceScope: args[6],
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
                  notify({
                    event: 'project-resource-changed',
                    groupId: f.groupId,
                    resource: 'memory',
                  }),
              }
            : undefined,
        ),
      );
    case 'chatStart': {
      const { session } = await source(a, b);
      session.governanceScope = args[6];
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
                  notify({
                    event: 'project-resource-changed',
                    groupId: f.groupId,
                    resource: 'memory',
                  }),
              }
            : undefined,
        ),
      );
    }
    case 'conversation-binding':
      if (!['codex', 'claude_code'].includes(a) || !/^[a-zA-Z0-9_-]{1,160}$/.test(b))
        throw new Error('Invalid conversation binding request.');
      return bindingSummary(await bindings.read(a, b));
    case 'run-outcomes':
      // The host time lets the desktop correct a clock difference between the computers.
      return { now: new Date().toISOString(), outcomes: await runOutcomes.list() };
    case 'chat-runs':
      // The runs that still work. The app attaches to them when it connects again.
      return chats.running();
    case 'chatStatus':
      return presented(chats.status(a));
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
/** A time limit of the helper from the environment of the host, or the default. */
function helperLimit(name: string) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
/** Reads the requests of one app connection. The answers go back to the same connection. */
function serveConnection(input: NodeJS.ReadableStream, connection: AppConnection) {
  const reply = (frame: object) => {
    if (!connection.closed()) connection.write(JSON.stringify(frame) + '\n');
  };
  const lines = createInterface({ input });
  lines.on('line', (line) => {
    if (line.length > 16000000) return;
    let request: any;
    try {
      request = JSON.parse(line);
    } catch {
      return;
    }
    if (client !== connection) return;
    if (accountProxy.receive(request)) return;
    if (typeof request.id !== 'string' || !Array.isArray(request.args)) return;
    void dispatch(request.method, request.args)
      .then((result) => reply({ id: request.id, result }))
      .catch((error) => reply({ id: request.id, error: error.message }));
  });
  return lines;
}
const socketConnection = (socket: Socket): AppConnection => ({
  write: (text) => void socket.write(text),
  closed: () => socket.destroyed,
  close: () => socket.end(),
});
const lifecycle = { detachedAt: Date.now() };
/** The app connection closed. The runs continue. Terminals belong to the connection. */
function detach() {
  lifecycle.detachedAt = Date.now();
  accountProxy.close();
  terminal.stopAll();
  pty.closeAll();
}
let helperServer: Server | undefined;
/** Stops the helper and the runs that still work. */
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  helperServer?.close();
  client?.close();
  accountProxy.close();
  void verdictanRuntime?.managed.stopAll();
  verdictanRuntime?.account.dispose();
  chats.dispose();
  terminal.stopAll();
  pty.closeAll();
  setTimeout(() => process.exit(), 1200).unref();
}
/**
 * The helper of the host. It is one process for each user and version. It outlives the SSH
 * connection, so that a run continues when the connection stops. Each app connection replaces
 * the previous one, so that each run has one owner. The replaced app gets an event first.
 */
async function serve(path: string) {
  process.umask(0o077);
  const server = createServer((socket) => {
    const previous = client;
    const connection = socketConnection(socket);
    client = connection;
    socket.on('error', () => {});
    if (previous) {
      try {
        previous.write(JSON.stringify({ event: 'helper-replaced' }) + '\n');
      } catch {
        // The previous connection is already closed.
      }
      previous.close();
      detach();
    }
    socket.on('close', () => {
      if (client !== connection) return;
      client = undefined;
      detach();
    });
    serveConnection(socket, connection);
    // A managed runtime of a run that ended without an app is released now.
    void verdictanRuntime?.managed.retryReleases();
  });
  helperServer = server;
  if (!(await listenHelper(server, path))) process.exit(0);
  setInterval(() => {
    const decision = helperDecision({
      attached: !!client,
      running: chats.runningCount(),
      releasing: verdictanRuntime?.managed.releasing() ?? 0,
      detachedAt: lifecycle.detachedAt,
      now: Date.now(),
      limit: helperLimit('KALKIDAN_UNATTENDED_RUN_LIMIT_MS'),
      idle: helperLimit('KALKIDAN_HELPER_IDLE_MS'),
    });
    if (decision === 'expire') {
      for (const run of chats.running()) expired.add(run.id);
      chats.stopAll();
    } else if (decision === 'exit') shutdown();
  }, 5000).unref();
}
/**
 * The SSH command runs this relay. It connects the SSH connection to the helper of this user,
 * and starts the helper first when it does not run. When the SSH connection stops, only the
 * relay stops.
 */
async function relay(path: string) {
  let socket = await connectHelper(path);
  if (!socket) {
    spawn(process.execPath, [process.argv[1], '--helper'], {
      detached: true,
      stdio: 'ignore',
    }).unref();
    for (let attempt = 0; attempt < 100 && !socket; attempt++) {
      await new Promise((done) => setTimeout(done, 100));
      socket = await connectHelper(path);
    }
  }
  if (!socket) {
    process.stderr.write('The Kalkidan helper did not start on this host.\n');
    process.exit(1);
  }
  const connection = socket;
  process.stdout.on('error', () => process.exit(0));
  connection.on('error', () => process.exit(1));
  connection.on('close', () => process.exit(0));
  process.stdin.on('end', () => connection.end());
  process.stdin.pipe(connection, { end: false });
  connection.pipe(process.stdout);
}
const mode = process.argv?.includes('--helper')
  ? 'helper'
  : process.argv?.includes('--attach')
    ? 'attach'
    : 'stdio';
if (mode === 'stdio') {
  // One connection on the standard streams. The runs stop with the connection. Tests and
  // local checks use this mode.
  client = { write: (text) => void process.stdout.write(text), closed: () => false, close() {} };
  serveConnection(process.stdin, client).on('close', shutdown);
} else {
  const path = helperSocketPath(homedir(), basename(dirname(process.argv[1] || '')));
  void prepareHelperDirectory(dirname(path))
    .then(() => {
      // A socket path has a short length limit. The name in the private folder is short.
      process.chdir(dirname(path));
      return mode === 'helper' ? serve(basename(path)) : relay(basename(path));
    })
    .catch((error) => {
      process.stderr.write(`The Kalkidan helper cannot start: ${error.message}\n`);
      process.exit(1);
    });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
