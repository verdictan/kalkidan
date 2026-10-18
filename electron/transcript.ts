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
      if (payload && (role === 'user' || role === 'assistant')) {
        const body = contentText(payload.content);
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
          text: row.payload.message,
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
