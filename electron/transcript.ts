import { open } from 'node:fs/promises';
import type { Agent, ChatMessage, ToolActivity, Transcript } from '../src/types';
export function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (block) =>
        block &&
        ['text', 'input_text', 'output_text'].includes(block.type) &&
        typeof block.text === 'string',
    )
    .map((block) => block.text)
    .join('\n');
}
const kalkidanContext = 'Project context supplied by Kalkidan.';
/** True when a text starts with the hidden project context of Kalkidan. Never show it. */
export function hasHiddenContext(text: string) {
  return text.trimStart().startsWith(kalkidanContext);
}
const userRequest = '\n\nUser request:\n';
/**
 * Blocks that an agent adds to the stored user messages. Codex stores its environment (the
 * folder, the shell, the date, the file system permissions) and its instructions as user
 * messages. Claude Code adds system reminders. They are not the user's text, and they can hold
 * local paths.
 */
const injectedBlocks =
  /<(system-reminder|environment_context|user_instructions|permissions_instructions|collaboration_mode|skills_instructions|turn_aborted)>[\s\S]*?<\/\1>/g;
/** Codex stores the AGENTS.md instructions as a user message with this first line. */
const agentsInstructions = /^# AGENTS\.md instructions for /;
/**
 * The part of a user message that the user wrote. Kalkidan wraps project prompts in project
 * context (electron/projects/prompt.ts), and the agents add context blocks to the stored
 * message (see `injectedBlocks`). None of this is the user's text. A message with only added
 * context gives an empty text, so it does not show.
 */
export function visibleUserText(text: string) {
  let visible = text.replace(injectedBlocks, '').trim();
  if (agentsInstructions.test(visible)) return '';
  if (visible.startsWith(kalkidanContext)) {
    const at = visible.lastIndexOf(userRequest);
    if (at >= 0) visible = visible.slice(at + userRequest.length).trim();
  }
  return visible;
}
/** The most steps that one saved answer keeps. The count stays right. */
const stepLimit = 200;
/** The paths in an apply_patch input of Codex: "*** Update File: src/a.ts". */
function patchPaths(input: string) {
  return [...input.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((match) =>
    match[1].trim(),
  );
}
function parsedArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
/** A shell command as one line: "bash -lc 'npm test'" gives "npm test". */
function commandText(command: unknown) {
  const parts = Array.isArray(command) ? command.map(String) : [String(command ?? '')];
  const inner =
    parts.length >= 3 && /(^|\/)(ba|z)?sh$/.test(parts[0]) && /^-l?c$/.test(parts[1])
      ? parts.slice(2).join(' ')
      : parts.join(' ');
  return inner.replace(/\s+/g, ' ').trim();
}
/** The tool calls of one history record: a title per call and the files that it edited. */
export function recordSteps(
  row: { type?: string; payload?: Record<string, unknown>; message?: { content?: unknown } },
  agent: Agent,
  index: number,
): { steps: ToolActivity[]; edited: string[] } {
  const steps: ToolActivity[] = [];
  const edited: string[] = [];
  if (agent === 'codex') {
    const payload = row.type === 'response_item' ? row.payload : undefined;
    const kind = payload?.type;
    if (kind === 'function_call' || kind === 'custom_tool_call' || kind === 'local_shell_call') {
      const name = String(payload?.name || (kind === 'local_shell_call' ? 'shell' : 'tool'));
      const args = parsedArguments(payload?.arguments ?? payload?.action);
      const input = typeof payload?.input === 'string' ? payload.input : '';
      const paths = name === 'apply_patch' ? patchPaths(input || String(args.input || '')) : [];
      edited.push(...paths);
      const title = paths.length
        ? `Edit ${paths.join(', ')}`
        : args.command
          ? commandText(args.command)
          : name;
      steps.push({ id: `step-${index}`, title, status: 'completed' });
    }
  } else if (Array.isArray(row.message?.content)) {
    for (const [part, block] of row.message.content.entries()) {
      if (!block || block.type !== 'tool_use') continue;
      const input = parsedArguments(block.input);
      const path = typeof input.file_path === 'string' ? input.file_path : '';
      const name = String(block.name || 'Tool');
      if (path && /^(Edit|MultiEdit|Write|NotebookEdit)$/.test(name)) edited.push(path);
      const title =
        name === 'Bash' && input.command
          ? commandText(input.command)
          : path
            ? `${/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(name) ? 'Edit' : name} ${path}`
            : name;
      steps.push({ id: `step-${index}-${part}`, title, status: 'completed' });
    }
  }
  return { steps, edited };
}
export function parseTranscript(text: string, agent: Agent): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const fallback: ChatMessage[] = [];
  const seen = new Set<string>();
  // The tool calls since the last message of the user. They go on the last answer of the turn.
  let turnSteps: ToolActivity[] = [];
  let turnCount = 0;
  let turnEdited = new Set<string>();
  let turnAnswer: ChatMessage | undefined;
  const closeTurn = () => {
    if (turnAnswer && turnCount) {
      turnAnswer.steps = turnSteps;
      if (turnCount > turnSteps.length)
        turnAnswer.steps = [
          ...turnSteps,
          ...Array.from({ length: turnCount - turnSteps.length }, (_, extra) => ({
            id: `${turnAnswer!.id}-more-${extra}`,
            title: 'Step',
            status: 'completed',
          })),
        ];
      if (turnEdited.size) turnAnswer.edited = [...turnEdited];
    }
    turnSteps = [];
    turnCount = 0;
    turnEdited = new Set();
    turnAnswer = undefined;
  };
  for (const [index, line] of text.split('\n').entries()) {
    try {
      const row = JSON.parse(line);
      if (agent === 'claude' && row.isSidechain) continue;
      const found = recordSteps(row, agent, index);
      turnCount += found.steps.length;
      turnSteps.push(...found.steps.slice(0, Math.max(0, stepLimit - turnSteps.length)));
      for (const path of found.edited) turnEdited.add(path);
      const payload =
        agent === 'codex' ? (row.type === 'response_item' ? row.payload : null) : row.message;
      const role = payload?.role || (agent === 'claude' ? row.type : null);
      // Newer Claude Code versions also store request copies (for example `api-request-blob`)
      // with a message role. Only user and assistant records are chat messages.
      const chatRecord = agent !== 'claude' || row.type === 'user' || row.type === 'assistant';
      if (payload && chatRecord && (role === 'user' || role === 'assistant')) {
        const raw = contentText(payload.content);
        const body = role === 'user' ? visibleUserText(raw) : raw;
        const id = row.uuid || `message-${index}`;
        if (body && !seen.has(id)) {
          seen.add(id);
          if (role === 'user') closeTurn();
          const message: ChatMessage = { id, role, text: body };
          messages.push(message);
          if (role === 'assistant') turnAnswer = message;
        }
      }
      if (
        agent === 'codex' &&
        row.type === 'event_msg' &&
        ['user_message', 'agent_message'].includes(row.payload?.type) &&
        typeof row.payload.message === 'string'
      ) {
        fallback.push({
          id: `event-${index}`,
          role: row.payload.type === 'user_message' ? 'user' : 'assistant',
          text:
            row.payload.type === 'user_message'
              ? visibleUserText(row.payload.message)
              : row.payload.message,
        });
      }
    } catch {
      /* Partial and unknown JSONL records are ignored. */
    }
  }
  closeTurn();
  return messages.length ? messages : fallback;
}
export async function readTranscript(path: string, agent: Agent): Promise<Transcript> {
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    const limit = 4 * 1024 * 1024;
    const start = Math.max(0, size - limit);
    const buffer = Buffer.alloc(Math.min(limit, size));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
    let text = buffer.subarray(0, bytesRead).toString('utf8');
    if (start) text = text.slice(text.indexOf('\n') + 1);
    const messages = parseTranscript(text, agent);
    return { messages: messages.slice(-500), truncated: start > 0 || messages.length > 500 };
  } finally {
    await file.close();
  }
}
