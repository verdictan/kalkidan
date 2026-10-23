import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  agentMinimumVersions,
  agentVersionErrorCode,
  agentVersionLabel,
  agentVersionRequirement,
  checkAgentVersion,
  compareVersionCores,
  meetsAgentMinimum,
  nativeAgentKind,
  parseAgentVersion,
} from '../src/domain/agent-version';
import {
  managedErrorText,
  managedLaunchBlock,
  managedOnlyNotice,
  managedSetupTargets,
} from '../src/domain/verdictan';
import { agentErrorMessage } from '../src/lib/agent-errors';
import { toolInstallUrls } from '../src/domain/desktop';
import { installedAgentVersion } from '../electron/agents/installed-version';
import { agentInstallations } from '../electron/agent-installations';
import { DesktopProtocolError } from '../electron/verdictan/protocol';

test('the minimum versions are Codex 0.160.0 and Claude Code 2.1.300', () => {
  assert.deepEqual(agentMinimumVersions, { codex: '0.160.0', claude_code: '2.1.300' });
  assert.equal(nativeAgentKind('codex'), 'codex');
  assert.equal(nativeAgentKind('claude'), 'claude_code');
  assert.equal(nativeAgentKind('claude_code'), 'claude_code');
  assert.equal(nativeAgentKind('gemini'), undefined);
});

test('version output from real Codex and Claude Code builds is parsed', () => {
  // Output of the installed binaries, including trailing new lines.
  const claude = [
    ['2.1.296 (Claude Code)\n', '2.1.296'],
    ['2.1.304 (Claude Code)\n', '2.1.304'],
    ['2.1.306 (Claude Code)', '2.1.306'],
    ['  2.1.300\r\n', '2.1.300'],
    ['claude 2.2.0', '2.2.0'],
  ];
  for (const [output, version] of claude) {
    assert.equal(parseAgentVersion(output, 'claude_code'), version, output);
    assert.equal(parseAgentVersion(output), version, output);
  }
  const codex = [
    ['codex-cli 0.163.0-alpha.10.2\n', '0.163.0-alpha.10.2'],
    ['codex-cli 0.160.0', '0.160.0'],
    ['codex 0.164.1', '0.164.1'],
    ['v0.170.0', '0.170.0'],
    // A warning line before the version does not hide the version.
    ['WARNING: proceeding without a PATH update\ncodex-cli 0.165.0\n', '0.165.0'],
  ];
  for (const [output, version] of codex) {
    assert.equal(parseAgentVersion(output, 'codex'), version, output);
    assert.equal(parseAgentVersion(output), version, output);
  }
  // Unknown output, or output of the other agent, has no version.
  for (const [output, kind] of [
    ['', 'codex'],
    ['codex-cli', 'codex'],
    ['codex-cli latest', 'codex'],
    ['codex-cli 0.163', 'codex'],
    ['2.1.306 (Claude Code)', 'codex'],
    ['codex-cli 0.163.0', 'claude_code'],
    ['Claude Code version 2.1.306 is ready', 'claude_code'],
    ['2.1.306 (Claude Code) extra', 'claude_code'],
    ['1234567890.1.1', 'claude_code'],
  ] as const)
    assert.equal(parseAgentVersion(output, kind), undefined, output);
  assert.equal(parseAgentVersion(undefined), undefined);
  assert.equal(parseAgentVersion('2.1.306\n'.repeat(2000)), undefined);
});

test('versions compare by numeric core, and prereleases count by their core', () => {
  assert.equal(compareVersionCores('0.163.0-alpha.10.2', '0.160.0'), 1);
  assert.equal(compareVersionCores('0.160.0-alpha.1', '0.160.0'), 0);
  assert.equal(compareVersionCores('0.159.99', '0.160.0'), -1);
  assert.equal(compareVersionCores('2.1.300', '2.1.300'), 0);
  assert.equal(compareVersionCores('2.1.1000', '2.1.300'), 1);
  assert.equal(compareVersionCores('2.10.0', '2.9.999'), 1);
  assert.equal(compareVersionCores('latest', '2.1.300'), undefined);
  for (const version of ['0.160.0', '0.160.0-alpha.1', '0.163.0-alpha.10.2', '0.170.0', '1.0.0'])
    assert.equal(meetsAgentMinimum('codex', version), true, version);
  for (const version of ['0.159.9', '0.159.0-alpha.99', '0.1.0', 'latest', '', undefined])
    assert.equal(meetsAgentMinimum('codex', version), false, String(version));
  for (const version of ['2.1.300', '2.1.304', '2.1.306', '2.2.0', '3.0.0'])
    assert.equal(meetsAgentMinimum('claude_code', version), true, version);
  for (const version of ['2.1.299', '2.1.296', '2.0.999', '1.9.400'])
    assert.equal(meetsAgentMinimum('claude_code', version), false, version);
});

test('each version check has one code, one label, and a specific message', () => {
  const supported = checkAgentVersion('claude_code', '2.1.306');
  assert.deepEqual(supported, {
    kind: 'claude_code',
    minimum: '2.1.300',
    version: '2.1.306',
    status: 'supported',
  });
  assert.equal(agentVersionErrorCode(supported), undefined);
  assert.equal(agentVersionLabel(supported), 'Meets the minimum 2.1.300');
  const outdated = checkAgentVersion('claude_code', '2.1.296');
  assert.equal(agentVersionErrorCode(outdated), 'desktop.claude_code_version_unsupported');
  assert.equal(agentVersionLabel(outdated), 'Update required');
  const unknown = checkAgentVersion('codex', undefined);
  assert.equal(unknown.version, undefined);
  assert.equal(agentVersionErrorCode(unknown), 'desktop.codex_version_unknown');
  assert.equal(
    agentVersionErrorCode(checkAgentVersion('codex', '0.1.0')),
    'desktop.codex_version_unsupported',
  );
  assert.equal(
    agentVersionRequirement('claude_code'),
    'Kalkidan needs Claude Code 2.1.300 or later. Update Claude Code, then try again.',
  );
  assert.equal(
    agentVersionRequirement('codex'),
    'Kalkidan needs Codex 0.160.0 or later. Update Codex, then try again.',
  );
});

test('a refused version uses the gateway notice format and links to the install guide', () => {
  for (const [code, text] of [
    ['desktop.claude_code_version_unsupported', /^Kalkidan needs Claude Code 2\.1\.300 or later\./],
    ['desktop.codex_version_unsupported', /^Kalkidan needs Codex 0\.160\.0 or later\./],
    [
      'desktop.claude_code_version_unknown',
      /^Kalkidan cannot read the installed Claude Code version\./,
    ],
    ['desktop.codex_version_unknown', /^Kalkidan cannot read the installed Codex version\./],
  ] as const) {
    const error = new DesktopProtocolError(code);
    assert.equal(error.message, managedErrorText(code));
    const block = managedLaunchBlock(error);
    assert.equal(block.code, code);
    assert.equal(block.step, 'agents');
    assert.ok(block.message.startsWith(managedOnlyNotice + ' '));
    assert.match(block.message.slice(managedOnlyNotice.length + 1), text);
    assert.doesNotMatch(block.message, /desktop\./);
    assert.deepEqual(managedSetupTargets[block.step], {
      section: 'tools',
      anchor: 'settings-tools',
      label: 'Open Tools settings',
    });
    // The same code in a chat error links to the install guide of that agent.
    const agent = code.includes('claude') ? 'claude' : 'codex';
    assert.deepEqual(agentErrorMessage(error).action, {
      label: 'Install guide',
      section: 'tools',
      kind: 'install',
      url: toolInstallUrls[agent],
    });
  }
  // A message with no exact version pin.
  assert.doesNotMatch(managedErrorText('desktop.agent_version_unsupported'), /2\.1\.304/);
  assert.equal(managedLaunchBlock('desktop.agent_version_unsupported').step, 'agents');
});

test('the installed version comes from `--version` of the agent executable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-version-'));
  try {
    const script = async (name: string, body: string) => {
      const path = join(root, name);
      await writeFile(path, `#!/bin/sh\n${body}\n`);
      await chmod(path, 0o755);
      return { path, env: { PATH: '/usr/bin:/bin' } };
    };
    const claude = await script('claude', 'test "$1" = --version && echo "2.1.306 (Claude Code)"');
    const codex = await script(
      'codex',
      'test "$1" = --version && echo "codex-cli 0.163.0-alpha.10.2"',
    );
    const strange = await script('strange', 'echo "something else"');
    const failing = await script('failing', 'exit 3');
    assert.equal(await installedAgentVersion('claude_code', claude), '2.1.306');
    assert.equal(await installedAgentVersion('codex', codex), '0.163.0-alpha.10.2');
    assert.equal(await installedAgentVersion('codex', claude), undefined);
    assert.equal(await installedAgentVersion('codex', strange), undefined);
    assert.equal(await installedAgentVersion('codex', failing), undefined);
    assert.equal(
      await installedAgentVersion('codex', { path: join(root, 'missing'), env: {} }),
      undefined,
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(installedAgentVersion('codex', codex, controller.signal), /abort/i);
    // Settings › Agents gets the path and the version of each installed agent.
    const list = await agentInstallations(
      async (agent) => {
        if (agent === 'codex') return { selected: codex, source: 'automatic', candidates: [codex] };
        throw new Error('missing');
      },
      undefined,
      async () => undefined,
    );
    assert.deepEqual(list, [
      {
        agent: 'codex',
        status: 'installed',
        path: codex.path,
        version: '0.163.0-alpha.10.2',
        source: 'automatic',
      },
      { agent: 'claude', status: 'missing' },
    ]);
    const unreadable = await agentInstallations(
      async () => ({ selected: strange, source: 'automatic', candidates: [strange] }),
      undefined,
      async () => undefined,
    );
    assert.deepEqual(
      unreadable.map((item) => [item.status, item.version]),
      [
        ['installed', undefined],
        ['installed', undefined],
      ],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
