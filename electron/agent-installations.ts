import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { agentCatalog, isAgent } from '../src/config/agents';
import { nativeAgentKind, nativeAgentNames } from '../src/domain/agent-version';
import { agentPrograms, chosenProgramEnvironment, type AgentExecutable } from './chat';
import { runtimeConfig } from './config/runtime';
import { validExecutablePath, writeChosenExecutable } from './agents/executable-choice';
import { installedAgentVersion, type InstalledAgentVersion } from './agents/installed-version';
import type { AgentCandidate, AgentInstallation } from '../src/types';
import type { NativeAgentKind } from '../src/domain/agent-version';
import {
  codexLoginInvalid,
  codexLoginRequired,
  readCodexSubscriptionLogin,
} from './verdictan/subscription-auth';
import { checkNativeClaudeLogin } from './verdictan/claude-subscription-auth';
import { DesktopProtocolError } from './verdictan/protocol';

/**
 * Codes that mean "not signed in". These are the codes with which the launch check refuses a
 * managed chat, so Settings › Computers and the chat agree. Other failures leave the sign-in
 * unknown.
 */
const signedOutCodes = new Set([
  codexLoginRequired,
  codexLoginInvalid,
  'desktop.claude_subscription_login_required',
]);

/**
 * The subscription sign-in of a coding agent on this host. It never returns a token. On macOS
 * the Claude Code check reads only the Keychain item attributes, so the system does not ask.
 */
export async function subscriptionLogin(
  kind: NativeAgentKind,
  checks: { codex(): Promise<unknown>; claude(): Promise<unknown> } = {
    codex: () => readCodexSubscriptionLogin(),
    claude: () => checkNativeClaudeLogin(),
  },
): Promise<AgentInstallation['subscriptionLogin']> {
  try {
    if (kind === 'codex') await checks.codex();
    else await checks.claude();
    return 'signed-in';
  } catch (error) {
    return error instanceof DesktopProtocolError && signedOutCodes.has(error.code)
      ? 'signed-out'
      : undefined;
  }
}

/**
 * Finds each agent and reads its version. Settings › Agents compares it with the minimum and
 * shows the other programs that Kalkidan found. The SSH helper runs the same check on a host.
 */
export async function agentInstallations(
  find: typeof agentPrograms = agentPrograms,
  readVersion: InstalledAgentVersion = installedAgentVersion,
  login: (kind: NativeAgentKind) => Promise<AgentInstallation['subscriptionLogin']> = (kind) =>
    subscriptionLogin(kind),
): Promise<AgentInstallation[]> {
  return Promise.all(
    agentCatalog.map(async ({ id: agent }): Promise<AgentInstallation> => {
      let programs: Awaited<ReturnType<typeof agentPrograms>>;
      try {
        programs = await find(agent);
      } catch {
        return { agent, status: 'missing' };
      }
      const kind = nativeAgentKind(agent);
      const version = (program: AgentExecutable) =>
        kind ? readVersion(kind, program).catch(() => undefined) : Promise.resolve(undefined);
      const selected = programs.selected;
      const others = programs.candidates.filter((item) => item.path !== selected?.path);
      const [signIn, selectedVersion, ...versions] = await Promise.all([
        selected && kind ? login(kind).catch(() => undefined) : Promise.resolve(undefined),
        selected ? version(selected) : Promise.resolve(undefined),
        ...others.map(version),
      ]);
      const candidates: AgentCandidate[] = others.map((item, index) =>
        versions[index] ? { path: item.path, version: versions[index] } : { path: item.path },
      );
      return {
        agent,
        status: selected ? 'installed' : 'missing',
        ...(selected ? { path: selected.path } : {}),
        ...(selectedVersion ? { version: selectedVersion } : {}),
        source: programs.source,
        ...(programs.chosenPath ? { chosenPath: programs.chosenPath } : {}),
        ...(candidates.length ? { candidates } : {}),
        ...(signIn ? { subscriptionLogin: signIn } : {}),
      };
    }),
  );
}

/**
 * Keeps the program that the user chose for an agent on this computer, then checks again.
 * `null` returns to automatic detection. The program must be an executable file that reports a
 * version of that agent. A version below the minimum is accepted; the status shows it.
 */
export async function chooseAgentExecutable(
  agent: unknown,
  path: unknown,
  readVersion: InstalledAgentVersion = installedAgentVersion,
  check: () => Promise<AgentInstallation[]> = () => agentInstallations(),
): Promise<AgentInstallation[]> {
  if (!isAgent(agent)) throw new Error('Unknown agent.');
  const kind = nativeAgentKind(agent)!;
  const name = nativeAgentNames[kind];
  if (runtimeConfig().agentExecutable[agent])
    throw new Error(
      `KALKIDAN_${agent.toUpperCase()}_PATH sets the ${name} program on this computer. Remove it to choose a program here.`,
    );
  if (path === null) {
    await writeChosenExecutable(agent, null);
    return check();
  }
  if (typeof path !== 'string') throw new Error('Enter the full path of the program.');
  let value = path.trim();
  if (value === '~' || value.startsWith('~/')) value = join(homedir(), value.slice(1));
  if (!validExecutablePath(value)) throw new Error('Enter the full path of the program.');
  try {
    if (!(await stat(value)).isFile()) throw new Error('Not a file');
  } catch {
    throw new Error(`Kalkidan cannot find a program at ${value}.`);
  }
  try {
    await access(value, constants.X_OK);
  } catch {
    throw new Error(`The file at ${value} is not executable. Choose the ${name} program.`);
  }
  const version = await readVersion(kind, {
    path: value,
    env: await chosenProgramEnvironment(agent),
  });
  if (!version)
    throw new Error(
      `The program at ${value} did not report a ${name} version. Make sure that it is ${name} and that it can run.`,
    );
  await writeChosenExecutable(agent, value);
  return check();
}
