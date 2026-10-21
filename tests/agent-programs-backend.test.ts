import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { backendLoader } from './helpers/backend-loader';
import { stripTerminalSequences } from '../electron/chat';
import { RemoteHosts } from '../electron/remote-hosts';
import {
  agentComputerAnchor,
  agentProgramAnchor,
  agentProgramStatus,
  sanitizeAgentInstallations,
} from '../src/domain/agent-programs';

const source = (name: string) => resolve('electron', name + '.ts');

test('shell output loses terminal escape sequences before the path check', () => {
  // iTerm shell integration prints OSC 1337 marks before the output of `command -v`.
  assert.equal(
    stripTerminalSequences('\u001b]1337;RemoteHost=u@host\u0007/home/u/.local/bin/claude'),
    '/home/u/.local/bin/claude',
  );
  assert.equal(
    stripTerminalSequences('\u001b]133;C\u001b\\\u001b]1337;CurrentDir=/home/u\u0007/usr/bin/x'),
    '/usr/bin/x',
  );
  assert.equal(stripTerminalSequences('\u001b[1;32m/opt/bin/codex\u001b[0m\r'), '/opt/bin/codex');
  assert.equal(stripTerminalSequences('\u009d1337;Mark\u009c/bin/a'), '/bin/a');
  assert.equal(stripTerminalSequences('\u001bP+q544e\u001b\\/bin/b'), '/bin/b');
  // A string without its end stops at the end of the line. The next line stays.
  assert.equal(stripTerminalSequences('\u001b]1337;broken\n/bin/c'), '\n/bin/c');
  assert.equal(stripTerminalSequences('plain/text'), 'plain/text');
});

/** A temporary computer: PATH folders with fake agent programs and a data folder. */
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'agent-programs-'));
  const folder = async (name: string) => {
    const path = join(root, name);
    await fs.mkdir(path, { recursive: true });
    return path;
  };
  const script = async (dir: string, name: string, body: string, mode = 0o755) => {
    const path = join(dir, name);
    await fs.writeFile(path, `#!/bin/sh\n${body}\n`);
    await fs.chmod(path, mode);
    return path;
  };
  const brew = await folder('linuxbrew/bin');
  const local = await folder('home/.local/bin');
  const linked = await folder('linked');
  const data = await folder('data');
  const old = await script(brew, 'claude', 'echo "2.1.287 (Claude Code)"');
  const current = await script(local, 'claude', 'echo "2.1.306 (Claude Code)"');
  // A second link to the same program is one program.
  await fs.symlink(current, join(linked, 'claude'));
  const state = {
    configured: undefined as string | undefined,
    shell: '',
  };
  state.shell =
    // iTerm marks before the PATH line and before the `command -v` line.
    `\u001b]1337;ShellIntegrationVersion=13\u0007__CG_PATH__${brew}:${local}:${linked}\n` +
    `\u001b]1337;RemoteHost=u@host\u0007${old}\n`;
  const load = backendLoader(
    {
      // Only files in the temporary folder exist. Real programs on this computer stay out.
      'node:fs/promises': {
        ...fs,
        access: (path: string, mode?: number) =>
          String(path).startsWith(root)
            ? fs.access(path, mode)
            : Promise.reject(Object.assign(Error('outside'), { code: 'ENOENT' })),
      },
      'node:os': { homedir: () => join(root, 'home'), tmpdir },
      [source('config/runtime')]: {
        runtimeConfig: () => ({
          agentExecutable: state.configured ? { claude: state.configured } : {},
        }),
      },
      // The shell finds only Claude Code. For Codex it prints only the PATH line.
      [source('core')]: {
        exec: async (_shell: string, args: string[]) => ({
          stdout: args[1].endsWith('claude') ? state.shell : state.shell.split('\n')[0],
        }),
      },
    },
    {
      process: {
        ...process,
        platform: 'linux',
        arch: 'x64',
        env: { SHELL: '/bin/sh', PATH: '' },
      },
    },
  );
  const chat = load(source('chat'));
  const choice = load(source('agents/executable-choice'));
  const installs = load(source('agent-installations'));
  choice.setAgentExecutableRoot(data);
  return { root, brew, local, linked, data, old, current, script, state, chat, choice, installs };
}

test('discovery lists each program on the login-shell PATH once, with its version', async () => {
  const f = await fixture();
  try {
    const programs = await f.chat.agentPrograms('claude');
    assert.equal(programs.source, 'automatic');
    assert.equal(programs.selected.path, f.old);
    assert.deepEqual(
      programs.candidates.map((item: { path: string }) => item.path),
      [f.old, f.current],
    );
    // The PATH of the login shell applies to the agent process.
    assert.equal(programs.selected.env.PATH, `${f.brew}:${f.local}:${f.linked}`);
    const [codex, claude] = await f.installs.agentInstallations();
    assert.deepEqual(codex, { agent: 'codex', status: 'missing', source: 'automatic' });
    assert.deepEqual(claude, {
      agent: 'claude',
      status: 'installed',
      path: f.old,
      version: '2.1.287',
      source: 'automatic',
      candidates: [{ path: f.current, version: '2.1.306' }],
    });
    // Without the shell, the fixed install folders still apply.
    f.state.shell = '';
    const fallback = await f.chat.agentPrograms('claude');
    assert.equal(fallback.selected.path, join(f.root, 'home/.local/bin/claude'));
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test('a chosen program is validated, kept, used by launches, and can be reset', async () => {
  const f = await fixture();
  try {
    const file = join(f.data, 'agent-executables.json');
    await assert.rejects(f.installs.chooseAgentExecutable('other', f.current), /Unknown agent/);
    await assert.rejects(f.installs.chooseAgentExecutable('claude', 'claude'), /full path/);
    await assert.rejects(f.installs.chooseAgentExecutable('claude', 42), /full path/);
    await assert.rejects(
      f.installs.chooseAgentExecutable('claude', join(f.root, 'missing')),
      /cannot find a program/,
    );
    await assert.rejects(f.installs.chooseAgentExecutable('claude', f.brew), /cannot find/);
    const plain = await f.script(f.root, 'plain', 'echo', 0o644);
    await assert.rejects(f.installs.chooseAgentExecutable('claude', plain), /not executable/);
    const strange = await f.script(f.root, 'strange', 'echo "something else"');
    await assert.rejects(
      f.installs.chooseAgentExecutable('claude', strange),
      /did not report a Claude Code version/,
    );
    await assert.rejects(fs.readFile(file), /ENOENT/);

    const list = await f.installs.chooseAgentExecutable('claude', f.current);
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), {
      schema_version: 1,
      agents: { claude: f.current },
    });
    const claude = list.find((item: { agent: string }) => item.agent === 'claude');
    assert.equal(claude.source, 'chosen');
    assert.equal(claude.path, f.current);
    assert.equal(claude.version, '2.1.306');
    assert.deepEqual(claude.candidates, [{ path: f.old, version: '2.1.287' }]);
    // Launches and version checks use the chosen program.
    assert.equal((await f.chat.executable('claude')).path, f.current);
    assert.deepEqual(await f.choice.readChosenExecutables(), { claude: f.current });

    // `~/` is the home folder of the computer that keeps the choice.
    await f.installs.chooseAgentExecutable('claude', '~/.local/bin/claude');
    assert.equal((await f.chat.executable('claude')).path, f.current);

    // A chosen program that goes away stops launches with clear words. No silent fallback.
    const moved = await f.script(f.root, 'moved', 'echo "2.1.310 (Claude Code)"');
    await f.installs.chooseAgentExecutable('claude', moved);
    await fs.rm(moved);
    await assert.rejects(
      f.chat.executable('claude'),
      /chosen Claude Code program at .*moved is not available/,
    );
    const gone = (await f.installs.agentInstallations()).find(
      (item: { agent: string }) => item.agent === 'claude',
    );
    assert.equal(gone.status, 'missing');
    assert.equal(gone.chosenPath, moved);
    assert.equal(agentProgramStatus(gone).label, 'Chosen program not found');

    // Automatic detection returns.
    const reset = await f.installs.chooseAgentExecutable('claude', null);
    assert.equal(
      reset.find((item: { agent: string }) => item.agent === 'claude').source,
      'automatic',
    );
    assert.equal((await f.chat.executable('claude')).path, f.old);
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')).agents, {});

    // A damaged file means automatic detection.
    await fs.writeFile(file, '{broken');
    assert.deepEqual(await f.choice.readChosenExecutables(), {});
    await fs.writeFile(file, JSON.stringify({ agents: { claude: 'relative', codex: 7 } }));
    assert.deepEqual(await f.choice.readChosenExecutables(), {});
    await assert.rejects(f.choice.writeChosenExecutable('claude', 'relative'), /absolute/);

    // KALKIDAN_CLAUDE_PATH wins, and the user cannot choose a different program.
    f.state.configured = f.current;
    await assert.rejects(
      f.installs.chooseAgentExecutable('claude', f.old),
      /KALKIDAN_CLAUDE_PATH sets the Claude Code program/,
    );
    const configured = await f.chat.agentPrograms('claude');
    assert.equal(configured.source, 'environment');
    assert.equal(configured.selected.path, f.current);
    f.state.configured = join(f.root, 'nowhere');
    await assert.rejects(f.chat.executable('claude'), /KALKIDAN_CLAUDE_PATH is not available/);
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test('agent checks from an SSH host keep only valid fields', () => {
  assert.deepEqual(sanitizeAgentInstallations('bad'), []);
  assert.deepEqual(
    sanitizeAgentInstallations([
      {
        agent: 'claude',
        status: 'installed',
        path: '/home/u/claude',
        version: '2.1.306',
        source: 'chosen',
        chosenPath: '/home/u/claude',
        candidates: [
          { path: '/bin/claude', version: '2.1.287' },
          { path: 'relative' },
          { path: '/bin/\u001b[31m' },
          { path: '/opt/claude', version: '<script>' },
        ],
        secret: 'x',
      },
      { agent: 'claude', status: 'missing' },
      { agent: 'other', status: 'installed' },
      { agent: 'codex', status: 'strange', path: 7, source: 'other' },
    ]),
    [
      {
        agent: 'claude',
        status: 'installed',
        path: '/home/u/claude',
        version: '2.1.306',
        source: 'chosen',
        chosenPath: '/home/u/claude',
        candidates: [{ path: '/bin/claude', version: '2.1.287' }, { path: '/opt/claude' }],
      },
      { agent: 'codex', status: 'missing' },
    ],
  );
  assert.equal(agentComputerAnchor(), 'settings-agents');
  assert.equal(agentComputerAnchor('h1'), 'agent-computer-h1');
  assert.equal(agentProgramAnchor('claude', 'h1'), 'agent-program-h1-claude');
  assert.equal(agentProgramAnchor('codex'), 'agent-program-local-codex');
  const status = (version?: string) =>
    agentProgramStatus({ agent: 'claude', status: 'installed', path: '/c', version }).label;
  assert.equal(status('2.1.306'), 'Meets the minimum');
  assert.equal(status('2.1.287'), 'Update required: needs 2.1.300 or later');
  assert.equal(status(), 'Version not known');
  assert.equal(agentProgramStatus({ agent: 'claude', status: 'missing' }).label, 'Not found');
  assert.equal(agentProgramStatus(undefined).label, 'Not checked');
  assert.equal(agentProgramStatus({ agent: 'codex', status: 'unavailable' }).label, 'Desktop only');
});

test('the desktop keeps the last agent check of each SSH host', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'agent-check-hosts-'));
  try {
    const file = join(root, 'remote-hosts.json');
    let changes = 0;
    const hosts = new RemoteHosts(file, join(root, 'bundle.cjs'), () => changes++);
    hosts.hosts = [{ id: 'h1', name: 'devbox', target: 'u@devbox', status: 'connected' }];
    let reply: () => Promise<unknown> = async () => [
      { agent: 'claude', status: 'installed', path: '/home/u/claude', version: '2.1.306', x: 1 },
    ];
    const calls: unknown[][] = [];
    hosts.call = async (...args: any[]) => {
      calls.push(args);
      return reply();
    };
    assert.deepEqual(await hosts.agentInstallations('h1'), [
      { agent: 'claude', status: 'installed', path: '/home/u/claude', version: '2.1.306' },
    ]);
    assert.deepEqual(calls.at(-1), ['h1', 'agent-installations', []]);
    assert.ok(changes > 0);
    await hosts.chooseAgentExecutable('h1', 'claude', '/home/u/claude');
    assert.deepEqual(calls.at(-1), ['h1', 'agent-executable-choose', ['claude', '/home/u/claude']]);
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(saved[0].agentCheck.agents[0].version, '2.1.306');
    assert.equal(typeof saved[0].agentCheck.checkedAt, 'number');
    // After a restart, the host is not connected and the last result stays.
    const again = new RemoteHosts(file, join(root, 'bundle.cjs'));
    await again.load();
    assert.equal(again.list()[0].status, 'disconnected');
    assert.equal(again.list()[0].agentCheck?.agents[0].path, '/home/u/claude');
    // A helper from before this check asks for an update.
    reply = async () => {
      throw new Error('Unsupported remote operation');
    };
    await assert.rejects(hosts.agentInstallations('h1'), /too old to check agents/);
    reply = async () => {
      throw new Error('Host is offline.');
    };
    await assert.rejects(hosts.agentInstallations('h1'), /offline/);
    await assert.rejects(hosts.agentInstallations('missing'), /not found/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
