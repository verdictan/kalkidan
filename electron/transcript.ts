import { open } from 'node:fs/promises';
import type { Agent, ChatMessage, Transcript } from '../src/types';
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
export function parseTranscript(text: string, agent: Agent): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const fallback: ChatMessage[] = [];
  const seen = new Set<string>();
  for (const [index, line] of text.split('\n').entries()) {
    try {
      const row = JSON.parse(line);
      if (agent === 'claude' && row.isSidechain) continue;
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
          messages.push({ id, role, text: body });
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
