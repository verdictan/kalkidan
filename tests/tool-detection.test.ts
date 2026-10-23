import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectTool,
  detectTools,
  parseCodexLogin,
  parseGitHubAuth,
  parseToolVersion,
  ToolStatusCache,
  toolsFromInstallations,
  withGatewayAccess,
  type FoundProgram,
} from '../electron/tool-detection';
import {
  agentChoices,
  hasUsableAgent,
  parseWindowScope,
  projectWindowQuery,
  toolDetail,
  toolsNeedAttention,
  type ComputerTools,
  type ToolId,
} from '../src/domain/desktop';

const unix = process.platform !== 'win32';

/** Makes a temporary folder with fake programs. Each script prints and exits as given. */
async function fakeTools(scripts: Partial<Record<ToolId, string>>) {
  const dir = await mkdtemp(join(tmpdir(), 'kalkidan-tools-'));
  for (const [name, body] of Object.entries(scripts)) {
    const path = join(dir, name);
    await writeFile(path, `#!/bin/sh\n${body}\n`);
    await chmod(path, 0o755);
  }
  const find = async (tool: ToolId): Promise<FoundProgram | undefined> => {
    const path = join(dir, tool);
    return Object.hasOwn(scripts, tool) ? { path, env: { PATH: '/usr/bin:/bin' } } : undefined;
  };
  return { dir, find, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

const claudeScript = `[ "$1" = "--version" ] && { echo "2.0.14 (Claude Code)"; exit 0; }; exit 2`;
const codexSignedIn = `case "$1" in
  --version) echo "codex-cli 0.46.0";;
  login) echo "Logged in using ChatGPT";;
esac`;
const ghReady = `case "$1" in
  --version) echo "gh version 2.62.0 (2024-11-14)"; echo "https://github.com/cli/cli/releases/tag/v2.62.0";;
  auth) echo "github.com" >&2
        echo "  ✓ Logged in to github.com account dana-kim (keyring)" >&2
        echo "  - Token: gho_************************************" >&2
        echo "  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'" >&2;;
esac`;

test('detects installed tools with fake executables', { skip: !unix }, async () => {
  const tools = await fakeTools({ claude: claudeScript, codex: codexSignedIn, gh: ghReady });
  try {
    const result = await detectTools({
      find: tools.find,
      claudeLogin: async () => 'yes',
      gatewayReady: true,
    });
    assert.deepEqual(
      result.map((item) => [item.tool, item.state, item.version, item.signedIn, item.access]),
      [
        ['claude', 'ready', '2.0.14', 'yes', 'granted'],
        ['codex', 'ready', '0.46.0', 'yes', 'granted'],
        ['gh', 'ready', '2.62.0', 'yes', 'granted'],
      ],
    );
    const gh = result[2];
    assert.equal(gh.account, 'dana-kim');
    assert.equal(gh.usable, false);
    assert.equal(gh.installUrl, 'https://cli.github.com');
    assert.ok(result[0].usable && result[1].usable);
    // The token never leaves the check.
    assert.ok(!JSON.stringify(result).includes('gho_'));
    assert.equal(toolDetail(gh), '2.62.0 · Signed in as dana-kim · repo access');
    assert.equal(toolDetail(result[0]), '2.0.14 · Signed in');
  } finally {
    await tools.cleanup();
  }
});

test('a tool that is not found is missing with its official page', async () => {
  const result = await detectTool('codex', { find: async () => undefined });
  assert.equal(result.state, 'missing');
  assert.equal(result.installed, false);
  assert.equal(result.usable, false);
  assert.equal(result.installUrl, 'https://github.com/openai/codex');
  assert.equal(toolDetail(result), 'Not installed');
});

test('a finder that fails gives missing', async () => {
  const result = await detectTool('claude', {
    find: async () => {
      throw new Error('no shell');
    },
  });
  assert.equal(result.state, 'missing');
});

test('a program that does not report a version is an error', { skip: !unix }, async () => {
  const tools = await fakeTools({ claude: 'exit 3', gh: 'echo nothing' });
  try {
    const claude = await detectTool('claude', { find: tools.find });
    assert.equal(claude.state, 'error');
    assert.equal(claude.usable, false);
    assert.equal(claude.installed, true);
    const gh = await detectTool('gh', { find: tools.find });
    assert.equal(gh.state, 'error');
  } finally {
    await tools.cleanup();
  }
});

test('signed-out and no-access states', { skip: !unix }, async () => {
  const tools = await fakeTools({
    codex: `case "$1" in --version) echo "codex-cli 0.46.0";; login) echo "Not logged in"; exit 1;; esac`,
    gh: `case "$1" in --version) echo "gh version 2.62.0";; auth) echo "You are not logged into any GitHub hosts. To log in, run: gh auth login" >&2; exit 1;; esac`,
  });
  try {
    const codex = await detectTool('codex', { find: tools.find });
    assert.equal(codex.state, 'signed-out');
    assert.equal(codex.signedIn, 'no');
    // Chats go through the gateway, so the agent can still start a chat.
    assert.equal(codex.usable, true);
    assert.equal(codex.access, 'unknown');
    const gh = await detectTool('gh', { find: tools.find });
    assert.equal(gh.state, 'signed-out');
    assert.equal(toolDetail(gh), '2.62.0 · Not signed in');
  } finally {
    await tools.cleanup();
  }
  const scopes = await fakeTools({
    gh: `case "$1" in --version) echo "gh version 2.62.0";; auth) echo "Logged in to github.com account dana-kim"; echo "Token scopes: 'gist', 'read:org'";; esac`,
  });
  try {
    const gh = await detectTool('gh', { find: scopes.find });
    assert.equal(gh.state, 'no-access');
    assert.equal(gh.access, 'missing');
    assert.equal(toolDetail(gh), '2.62.0 · Signed in as dana-kim · No repo access');
  } finally {
    await scopes.cleanup();
  }
});

test('a Claude Code sign-in check that fails is unknown', { skip: !unix }, async () => {
  const tools = await fakeTools({ claude: claudeScript });
  try {
    const claude = await detectTool('claude', {
      find: tools.find,
      claudeLogin: async () => {
        throw new Error('keychain');
      },
    });
    assert.equal(claude.signedIn, 'unknown');
    assert.equal(claude.state, 'ready');
  } finally {
    await tools.cleanup();
  }
});

test('parses versions and sign-in output', () => {
  assert.equal(parseToolVersion('2.0.14 (Claude Code)'), '2.0.14');
  assert.equal(parseToolVersion('codex-cli 0.46.0-alpha.3'), '0.46.0-alpha.3');
  assert.equal(parseToolVersion('gh version 2.62.0 (2024-11-14)'), '2.62.0');
  assert.equal(parseToolVersion('no version'), undefined);
  assert.equal(
    parseCodexLogin({ code: 0, stdout: 'Logged in using an API key', stderr: '' }),
    'yes',
  );
  assert.equal(parseCodexLogin({ code: 1, stdout: '', stderr: 'Not logged in' }), 'no');
  assert.equal(parseCodexLogin({ code: 2, stdout: '', stderr: 'unknown command' }), 'unknown');
  assert.deepEqual(
    parseGitHubAuth({
      code: 0,
      stdout: 'Logged in to github.com as old-user (oauth_token)',
      stderr: '',
    }),
    { signedIn: 'yes', account: 'old-user', access: 'unknown' },
  );
  assert.deepEqual(parseGitHubAuth({ code: null, stdout: '', stderr: '' }), {
    signedIn: 'unknown',
    access: 'unknown',
  });
});

test('gateway access applies only to installed agents', () => {
  const tools = toolsFromInstallations([
    { agent: 'codex', status: 'installed', path: '/bin/codex', version: '0.46.0' },
    { agent: 'claude', status: 'missing' },
  ]);
  assert.deepEqual(
    tools.map((item) => [item.tool, item.state, item.usable]),
    [
      ['claude', 'missing', false],
      ['codex', 'ready', true],
      ['gh', 'error', false],
    ],
  );
  const granted = withGatewayAccess(tools, true);
  assert.deepEqual(
    granted.map((item) => item.access),
    ['unknown', 'granted', 'unknown'],
  );
});

test('agent choices, attention and usable agents', () => {
  const computer: ComputerTools = {
    computer: 'local',
    name: 'This Mac',
    connected: true,
    checkedAt: '',
    tools: toolsFromInstallations([{ agent: 'claude', status: 'installed', version: '2.0.14' }]),
  };
  assert.deepEqual(
    agentChoices(computer).map((item) => [item.agent, item.available]),
    [
      ['claude', true],
      ['codex', false],
    ],
  );
  assert.equal(agentChoices(computer)[1].installUrl, 'https://github.com/openai/codex');
  assert.equal(hasUsableAgent(computer), true);
  assert.equal(toolsNeedAttention(computer), true);
  assert.equal(hasUsableAgent(undefined), false);
  assert.equal(
    agentChoices(undefined).every((item) => !item.available),
    true,
  );
});

test('window scope comes from the address query', () => {
  assert.deepEqual(parseWindowScope(''), { kind: 'main' });
  assert.deepEqual(parseWindowScope(projectWindowQuery('atlas')), {
    kind: 'project',
    groupId: 'atlas',
  });
  assert.deepEqual(parseWindowScope('?project=a%20b&x=1'), { kind: 'project', groupId: 'a b' });
  assert.deepEqual(parseWindowScope('?project='), { kind: 'main' });
});

test('the cache shares a check and runs a fresh one on request', async () => {
  let now = 0;
  let runs = 0;
  const cache = new ToolStatusCache<number>(1000, () => now);
  const check = async () => ++runs;
  const [a, b] = await Promise.all([cache.get('local', check), cache.get('local', check)]);
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(await cache.get('local', check, true), 2);
  now = 2000;
  assert.equal(await cache.get('local', check), 3);
  await assert.rejects(cache.get('host', async () => Promise.reject(new Error('down'))));
  assert.equal(await cache.get('host', async () => 7), 7);
});
