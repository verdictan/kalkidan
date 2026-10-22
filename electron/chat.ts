import { executableCandidates } from './platform';
import { runtimeConfig } from './config/runtime';
import { readChosenExecutables } from './agents/executable-choice';
import { access, readdir, readFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { stripVTControlCharacters } from 'node:util';
import { exec } from './core';
import { contentText } from './transcript';
import type { Agent, ChatRun } from '../src/types';
import { managedErrorCode, managedErrorText } from '../src/domain/verdictan';

export function chatArgs(
  agent: Agent,
  id: string,
  allowEdits: boolean,
  create = false,
  model?: string,
): string[] {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw new Error('Invalid session ID');
  if (
    model !== undefined &&
    (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(model))
  )
    throw new Error('Invalid model ID');
  if (agent === 'codex') return ['app-server'];
  return [
    '--print',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-prompt-tool',
    'stdio',
    '--permission-mode',
    allowEdits ? 'default' : 'plan',
    ...(model ? ['--model', model] : []),
    create ? '--session-id' : '--resume',
    id,
  ];
}
/** The gateway refused a Codex subscription request without the ChatGPT login headers. */
export const codexGatewayAuthMissing = 'desktop.codex_gateway_auth_missing';
export function normalizeChatFailure(run: ChatRun, stderr = '') {
  const detail = stripVTControlCharacters([run.error, stderr].filter(Boolean).join('\n')).trim();
  if (run.agent === 'codex' && /already has an active writer/i.test(detail)) {
    run.errorCode = 'session_busy';
    run.error =
      'This Codex session is already open in another client. Finish or stop its current task, then close the session in VS Code, the Codex app, or the other CLI. If the lock remains, quit the owning client. Return here and send your message again. Kalkidan cannot take over a session while another client owns it.';
  } else if (
    run.agent === 'codex' &&
    /subscription and gateway authentication are required|desktop\.subscription_credentials_required/i.test(
      detail,
    )
  ) {
    // The gateway refused a Codex request without the ChatGPT login headers. This is not a
    // missing sign-in of the user, so it must not read as one.
    run.errorCode = codexGatewayAuthMissing;
    run.error = managedErrorText(codexGatewayAuthMissing);
  } else if (run.error) run.error = stripVTControlCharacters(run.error);
  else if (detail) run.error = detail;
  // A managed agent code alone becomes plain words. The code stays for the renderer.
  const code = run.errorCode ? undefined : managedErrorCode(run.error);
  if (code) {
    run.errorCode = code as `desktop.${string}`;
    if (!run.error!.includes('[' + code + ']')) run.error = managedErrorText(code);
  }
}

export function applyChatEvent(run: ChatRun, row: any) {
  const put = (id: string, text: string, append = false) => {
    if (!text) return;
    const message = run.messages.find((m) => m.id === id);
    if (message) message.text = (append ? message.text + text : text).slice(-2_000_000);
    else if (run.messages.length < 1000)
      run.messages.push({ id, role: 'assistant', text: text.slice(-2_000_000) });
  };
  if (run.agent === 'codex') {
    if (row.type === 'thread.started' && typeof row.thread_id === 'string') {
      if (run.sessionId && row.thread_id !== run.sessionId)
        throw new Error(
          'The agent opened a different session. Stopped to protect conversation continuity.',
        );
      run.sessionId = row.thread_id;
      run.sessionReady = true;
    }
    if (row.item?.type === 'agent_message') put(row.item.id || 'assistant', row.item.text);
    if (row.item?.type === 'command_execution')
      run.activity =
        row.item.status === 'completed'
          ? 'Command completed'
          : `Running: ${String(row.item.command || '').slice(0, 200)}`;
    if (row.item?.type === 'file_change') run.activity = 'Updating project files';
    if (row.type === 'turn.failed' || row.type === 'error')
      run.error = String(
        row.error?.message || row.message || 'Codex could not complete this turn.',
      );
  } else {
    if (row.type === 'system' && row.subtype === 'init' && row.session_id) {
      if (run.sessionId && row.session_id !== run.sessionId)
        throw new Error(
          'Claude opened a different session. Stopped to protect conversation continuity.',
        );
      run.sessionId = row.session_id;
      run.sessionReady = true;
    }
    if (row.parent_tool_use_id) return;
    if (row.type === 'stream_event') {
      const event = row.event;
      if (event?.type === 'message_start')
        run.activity = `message:${event.message?.id || 'assistant'}`;
      if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        const id = run.activity.startsWith('message:') ? run.activity.slice(8) : 'stream';
        put(id, event.delta.text, true);
      }
    }
    if (row.type === 'assistant') {
      put(row.message?.id || 'assistant', contentText(row.message?.content));
      const tool = row.message?.content?.find((block: any) => block.type === 'tool_use');
      if (tool) run.activity = `Using ${tool.name}`;
    }
    if (row.type === 'result') {
      if (row.is_error)
        run.error = row.errors?.join('\n') || row.result || 'Claude could not complete this turn.';
      if (!run.messages.length && row.result && !row.is_error) put('result', row.result);
      if (row.permission_denials?.length)
        run.error =
          'Some actions were denied by the agent permission policy. Review its configuration and ask the agent to retry.';
    }
  }
}

const toolNames: Record<string, string> = { codex: 'Codex', claude: 'Claude Code', gh: 'GitHub' };

// OSC strings (ESC ] ... BEL or ESC \), for example iTerm shell integration marks, and the
// DCS, SOS, PM and APC strings. A string without its end stops at the end of the line.
const terminalStrings = new RegExp(
  '(?:\\u001b\\]|\\u009d)[^\\u0007\\u001b\\u009c\\n]*(?:\\u0007|\\u001b\\\\|\\u009c)?|' +
    '(?:\\u001b[P^_X]|[\\u0090\\u0098\\u009e\\u009f])[^\\u001b\\u009c\\n]*(?:\\u001b\\\\|\\u009c)?',
  'g',
);
// oxlint-disable-next-line no-control-regex
const controlCharacters = new RegExp('[\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f]', 'g');

/**
 * Removes terminal escape sequences and control characters from shell output. A login shell can
 * print shell integration marks before the output of `command -v`.
 */
export function stripTerminalSequences(text: string) {
  return stripVTControlCharacters(text.replace(terminalStrings, '')).replace(controlCharacters, '');
}

/** The environment for an agent process, without the variables of this Electron process. */
function agentEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CLAUDECODE;
  return env;
}

/**
 * Asks the login shell for its PATH and for `command -v <name>`. Sets the PATH in `env` and
 * returns the paths that the shell found. Returns no paths when the shell cannot run.
 */
async function shellLookup(name: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  if (process.platform === 'win32') return [];
  try {
    const { stdout } = await exec(
      process.env.SHELL || '/bin/sh',
      ['-ilc', `printf '__CG_PATH__%s\\n' "$PATH"; command -v ${name}`],
      { timeout: 10000 },
    );
    const lines = String(stdout)
      .split('\n')
      .map((line) => stripTerminalSequences(line).trim());
    const marker = '__CG_PATH__';
    const pathLine = lines.find((line) => line.includes(marker));
    if (pathLine) env.PATH = pathLine.slice(pathLine.indexOf(marker) + marker.length);
    return lines.filter((line) => !line.includes(marker) && isAbsolute(line));
  } catch {
    return [];
  }
}

/** All the places where Kalkidan looks for a program, in order of preference. */
async function candidatePaths(name: string, env: NodeJS.ProcessEnv, found: string[]) {
  const candidates = [
    ...found,
    ...executableCandidates(name, env),
    ...executableCandidates(name, process.env),
    join(homedir(), '.local/bin', name),
    '/opt/homebrew/bin/' + name,
    '/usr/local/bin/' + name,
  ];
  if (process.platform === 'win32') {
    candidates.push(join(homedir(), '.local', 'bin', name + '.exe'));
    if (env.APPDATA) candidates.push(join(env.APPDATA, 'npm', name + '.cmd'));
  }
  if (name === 'codex' && process.platform === 'darwin') {
    candidates.push('/Applications/Codex.app/Contents/Resources/codex');
    const extensions = join(homedir(), '.vscode/extensions');
    try {
      const installed = (await readdir(extensions))
        .filter((entry) => entry.startsWith('openai.chatgpt-'))
        .sort()
        .reverse();
      for (const entry of installed)
        candidates.push(
          join(
            extensions,
            entry,
            'bin',
            process.arch === 'arm64' ? 'macos-aarch64' : 'macos-x86_64',
            'codex',
          ),
        );
    } catch {
      /* VS Code extension is optional. */
    }
  }
  return [...new Set(candidates)];
}

export interface AgentExecutable {
  path: string;
  env: NodeJS.ProcessEnv;
  args?: string[];
}

/** The launch data for one program path, or undefined when the path cannot run. */
async function launchable(
  path: string,
  env: NodeJS.ProcessEnv,
): Promise<AgentExecutable | undefined> {
  try {
    await access(path, constants.X_OK);
    if (process.platform === 'win32' && path.toLowerCase().endsWith('.cmd')) {
      // Run the npm JavaScript entry point directly. Do not interpolate agent arguments into cmd.exe.
      const shim = await readFile(path, 'utf8');
      const entry = shim.match(/%dp0%[\\/]([^"\r\n]+\.(?:m?js|cjs))/i)?.[1];
      if (!entry) return undefined;
      const script = join(path, '..', entry);
      await access(script);
      return {
        path: process.execPath,
        args: [script],
        env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      };
    }
    return { path, env };
  } catch {
    return undefined;
  }
}

/** How Kalkidan selected the program of an agent. */
export type ExecutableSource = 'automatic' | 'chosen' | 'environment';
export interface AgentPrograms {
  /** The program that launches use. Missing when no program is available. */
  selected?: AgentExecutable;
  source: ExecutableSource;
  /** The chosen or configured path, also when it is not available. */
  chosenPath?: string;
  /** Each program that automatic detection found, in order of preference. One per file. */
  candidates: AgentExecutable[];
}

/** At most this many programs show for one agent. */
const candidateLimit = 8;

/**
 * Finds the programs of an agent. The order is: the path from KALKIDAN_<AGENT>_PATH, the
 * program that the user chose in Settings › Agents, then automatic detection.
 */
export async function agentPrograms(agent: Agent | 'gh'): Promise<AgentPrograms> {
  const env = agentEnvironment();
  const configured = agent === 'gh' ? undefined : runtimeConfig().agentExecutable[agent];
  if (configured) {
    const ready = await access(configured, constants.X_OK).then(
      () => true,
      () => false,
    );
    return {
      selected: ready ? { path: configured, env } : undefined,
      source: 'environment',
      chosenPath: configured,
      candidates: [],
    };
  }
  const found = await shellLookup(agent, env);
  const chosen = agent === 'gh' ? undefined : (await readChosenExecutables())[agent];
  const candidates: AgentExecutable[] = [];
  const files = new Set<string>();
  for (const path of await candidatePaths(agent, env, found)) {
    if (candidates.length >= candidateLimit) break;
    const program = await launchable(path, env);
    if (!program) continue;
    // Two links to one file are one program. Keep the first path, as the shell finds it.
    let file = path;
    try {
      file = await realpath(path);
    } catch {
      /* Keep the path as it is. */
    }
    if (files.has(file)) continue;
    files.add(file);
    candidates.push(program);
  }
  if (chosen)
    return {
      selected: await launchable(chosen, env),
      source: 'chosen',
      chosenPath: chosen,
      candidates,
    };
  return { selected: candidates[0], source: 'automatic', candidates };
}

/** The environment for a program that the user chooses, with the PATH of the login shell. */
export async function chosenProgramEnvironment(agent: Agent) {
  const env = agentEnvironment();
  await shellLookup(agent, env);
  return env;
}

/** The program that launches and version checks use for an agent or for the GitHub CLI. */
export async function executable(agent: Agent | 'gh'): Promise<AgentExecutable> {
  const programs = await agentPrograms(agent);
  if (programs.selected) return programs.selected;
  const name = toolNames[agent];
  if (programs.source === 'chosen')
    throw new Error(
      `The chosen ${name} program at ${programs.chosenPath} is not available. Choose a different program in Settings › Agents, or use automatic detection.`,
    );
  if (programs.source === 'environment')
    throw new Error(
      `The ${name} program in KALKIDAN_${agent.toUpperCase()}_PATH is not available. Correct the path, then try again.`,
    );
  throw new Error(`${name} CLI was not found. Install it and sign in, then try again.`);
}
