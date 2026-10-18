import { runtimeConfig } from './config/runtime';
import { access, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { stripVTControlCharacters } from 'node:util';
import { exec } from './core';
import { contentText } from './transcript';
import type { Agent, ChatRun } from '../src/types';

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
export function normalizeChatFailure(run: ChatRun, stderr = '') {
  const detail = stripVTControlCharacters([run.error, stderr].filter(Boolean).join('\n')).trim();
  if (run.agent === 'codex' && /already has an active writer/i.test(detail)) {
    run.errorCode = 'session_busy';
    run.error =
      'This Codex session is already open in another client. Finish or stop its current task, then close the session in VS Code, the Codex app, or the other CLI. If the lock remains, quit the owning client. Return here and send your message again. Kalkidan cannot take over a session while another client owns it.';
  } else if (run.error) run.error = stripVTControlCharacters(run.error);
  else if (detail) run.error = detail;
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

export async function executable(agent: Agent): Promise<{ path: string; env: NodeJS.ProcessEnv }> {
  const config = runtimeConfig();
  let env = { ...process.env };
  const configured = config.agentExecutable[agent];
  if (configured) {
    await access(configured, constants.X_OK);
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.CLAUDECODE;
    return { path: configured, env };
  }
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CLAUDECODE;
  const candidates = (env.PATH || '').split(':').map((path) => join(path, agent));
  try {
    const { stdout } = await exec(
      process.env.SHELL || '/bin/zsh',
      ['-ilc', `printf '__CG_PATH__%s\\n' "$PATH"; command -v ${agent}`],
      { timeout: 10000 },
    );
    const lines = stdout.trim().split('\n');
    const pathLine = lines.find((line) => line.startsWith('__CG_PATH__'));
    if (pathLine) env.PATH = pathLine.slice('__CG_PATH__'.length);
    candidates.unshift(
      ...lines.filter((line) => isAbsolute(line.trim())).map((line) => line.trim()),
    );
  } catch {
    /* Fall back to standard install locations. */
  }
  candidates.push(
    join(homedir(), '.local/bin', agent),
    '/opt/homebrew/bin/' + agent,
    '/usr/local/bin/' + agent,
  );
  if (agent === 'codex') {
    candidates.push('/Applications/Codex.app/Contents/Resources/codex');
    const extensions = join(homedir(), '.vscode/extensions');
    try {
      const installed = (await readdir(extensions))
        .filter((name) => name.startsWith('openai.chatgpt-'))
        .sort()
        .reverse();
      for (const name of installed)
        candidates.push(
          join(
            extensions,
            name,
            'bin',
            process.arch === 'arm64' ? 'macos-aarch64' : 'macos-x86_64',
            'codex',
          ),
        );
    } catch {
      /* VS Code extension is optional. */
    }
  }
  for (const path of candidates) {
    try {
      await access(path, constants.X_OK);
      return { path, env };
    } catch {}
  }
  throw new Error(
    `${agent === 'codex' ? 'Codex' : 'Claude Code'} CLI was not found. Install it and sign in, then try again.`,
  );
}
