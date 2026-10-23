import { createReadStream } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { basename, dirname, join } from 'node:path';
import { contentText, visibleUserText } from './transcript';
import type { SubagentSession } from '../src/domain/desktop';

/** The tools with which Claude Code starts a subagent. Newer versions call it Agent. */
const subagentTools = new Set(['Task', 'Agent']);
/** A subagent file that changed this recently, without a result, still works. */
export const subagentActiveMs = 2 * 60_000;
/** Larger session files are not read for the Task calls. Their subagents keep their prompts. */
const sessionScanLimit = 64 * 1024 * 1024;
/** At most this many subagents show for one session. */
const subagentLimit = 50;

function shortTitle(text: unknown) {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
}

/** The Task calls of a Claude Code session file and their results. */
interface TaskCall {
  id: string;
  title: string;
  type?: string;
  order: number;
  result?: 'done' | 'failed';
  agentId?: string;
  at?: string;
}

/** Reads the subagent calls of one Claude Code session file. Lines that do not parse are skipped. */
export async function claudeTaskCalls(path: string): Promise<TaskCall[]> {
  const calls = new Map<string, TaskCall>();
  const stream = createReadStream(path, { encoding: 'utf8' });
  try {
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
      if (!line.includes('tool_')) continue;
      let row: any;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (row.isSidechain) continue;
      const content = Array.isArray(row.message?.content) ? row.message.content : [];
      if (row.type === 'assistant')
        for (const block of content)
          if (block?.type === 'tool_use' && subagentTools.has(block.name) && block.id) {
            if (calls.has(block.id) || calls.size >= subagentLimit) continue;
            const type = shortTitle(block.input?.subagent_type);
            calls.set(String(block.id), {
              id: String(block.id),
              title: shortTitle(block.input?.description) || shortTitle(block.input?.prompt),
              ...(type ? { type } : {}),
              order: calls.size,
              ...(typeof row.timestamp === 'string' ? { at: row.timestamp } : {}),
            });
          }
      if (row.type === 'user')
        for (const block of content)
          if (block?.type === 'tool_result' && calls.has(block.tool_use_id)) {
            const call = calls.get(block.tool_use_id)!;
            call.result = block.is_error ? 'failed' : 'done';
            const agentId = row.toolUseResult?.agentId;
            if (typeof agentId === 'string' && agentId) call.agentId = agentId;
            if (typeof row.timestamp === 'string') call.at = row.timestamp;
          }
    }
  } catch {
    /* A file that cannot be read has no calls. */
  } finally {
    stream.destroy();
  }
  return [...calls.values()];
}

/** The first records of a subagent file: its first prompt and its first time. */
async function subagentHead(path: string) {
  const stream = createReadStream(path, { encoding: 'utf8', end: 256 * 1024 });
  let prompt = '';
  let at: string | undefined;
  let lines = 0;
  try {
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
      if (++lines > 20) break;
      try {
        const row = JSON.parse(line);
        if (!at && typeof row.timestamp === 'string') at = row.timestamp;
        if (!prompt && row.type === 'user')
          prompt = shortTitle(visibleUserText(contentText(row.message?.content)));
        if (prompt && at) break;
      } catch {
        /* A truncated line. */
      }
    }
  } catch {
    /* No head. */
  } finally {
    stream.destroy();
  }
  return { prompt, at };
}

/**
 * The subagents of a Claude Code session. Claude Code keeps each subagent in
 * `<session id>/subagents/agent-<id>.jsonl` next to the session file. The Task call in the
 * session file gives the title and the result. A subagent without a result works while its
 * file changes, and else it stopped.
 */
export async function claudeSubagents(
  sessionPath: string,
  sessionId: string,
  now = Date.now(),
): Promise<SubagentSession[]> {
  const folder = join(dirname(sessionPath), sessionId, 'subagents');
  let names: string[];
  try {
    names = (await readdir(folder)).filter(
      (name) => name.startsWith('agent-') && name.endsWith('.jsonl'),
    );
  } catch {
    return [];
  }
  if (!names.length) return [];
  const size = await stat(sessionPath).then(
    (info) => info.size,
    () => Infinity,
  );
  const calls = size <= sessionScanLimit ? await claudeTaskCalls(sessionPath) : [];
  const files = (
    await Promise.all(
      names.slice(0, subagentLimit).map(async (name) => {
        const path = join(folder, name);
        try {
          const info = await stat(path);
          const head = await subagentHead(path);
          return {
            id: basename(name, '.jsonl').slice('agent-'.length),
            changed: info.mtimeMs,
            ...head,
          };
        } catch {
          return undefined;
        }
      }),
    )
  )
    .filter((file): file is NonNullable<typeof file> => !!file)
    .sort((a, b) => (a.at || '').localeCompare(b.at || '') || a.changed - b.changed);
  // A result names its agent. Files without a named call take the free calls in order.
  const byAgent = new Map(calls.filter((call) => call.agentId).map((call) => [call.agentId, call]));
  const free = calls.filter((call) => !call.agentId);
  const result: SubagentSession[] = files.map((file) => {
    const call = byAgent.get(file.id) ?? free.shift();
    const status: SubagentSession['status'] =
      call?.result ?? (now - file.changed < subagentActiveMs ? 'running' : 'stopped');
    return {
      id: file.id,
      title: call?.title || file.prompt || 'Subagent',
      status,
      ...(call?.type ? { type: call.type } : {}),
      updatedAt: new Date(file.changed).toISOString(),
    };
  });
  return result;
}

/** The parent thread of a Codex thread that another thread spawned, from its session_meta. */
export function codexParentThread(meta: any): string | undefined {
  const spawn = meta?.source?.subagent?.thread_spawn;
  const parent = spawn?.parent_thread_id ?? meta?.parent_thread_id;
  return typeof parent === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(parent) ? parent : undefined;
}

/** The subagent type of a Codex thread, for example "review", when Codex tells. */
export function codexSubagentType(meta: any): string | undefined {
  const value = meta?.agent_role ?? meta?.source?.subagent;
  return typeof value === 'string' ? shortTitle(value) || undefined : undefined;
}

/** Reads the session_meta payload of a Codex rollout file: its first line. */
export async function codexSessionMeta(path: string): Promise<any> {
  let file;
  try {
    file = await open(path, 'r');
    const buffer = Buffer.alloc(512 * 1024);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    const end = text.indexOf('\n');
    if (end < 0 && bytesRead === buffer.length) return undefined;
    const row = JSON.parse(end < 0 ? text : text.slice(0, end));
    return row?.type === 'session_meta' ? row.payload : undefined;
  } catch {
    return undefined;
  } finally {
    await file?.close().catch(() => {});
  }
}

/**
 * Updates the subagents of a live Claude Code run from one stream record. A Task call adds a
 * running subagent, and its result marks it done or failed. Records of a subagent keep it
 * running. Returns true when the list changed.
 */
export function applySubagentEvent(list: SubagentSession[], row: any): boolean {
  if (!row || typeof row !== 'object') return false;
  const now = new Date().toISOString();
  if (typeof row.parent_tool_use_id === 'string') {
    const item = list.find((entry) => entry.id === row.parent_tool_use_id);
    if (!item || item.status !== 'running') return false;
    item.updatedAt = now;
    const tool = Array.isArray(row.message?.content)
      ? row.message.content.find((block: any) => block?.type === 'tool_use')
      : undefined;
    if (row.type !== 'assistant' || typeof tool?.name !== 'string') return false;
    item.activity = `Using ${shortTitle(tool.name).slice(0, 60)}`;
    return true;
  }
  const content = Array.isArray(row.message?.content) ? row.message.content : [];
  let changed = false;
  if (row.type === 'assistant')
    for (const block of content)
      if (
        block?.type === 'tool_use' &&
        subagentTools.has(block.name) &&
        typeof block.id === 'string' &&
        !list.some((entry) => entry.id === block.id) &&
        list.length < subagentLimit
      ) {
        const type = shortTitle(block.input?.subagent_type);
        list.push({
          id: block.id,
          title: shortTitle(block.input?.description) || 'Subagent',
          status: 'running',
          ...(type ? { type } : {}),
          updatedAt: now,
        });
        changed = true;
      }
  if (row.type === 'user')
    for (const block of content)
      if (block?.type === 'tool_result') {
        const item = list.find((entry) => entry.id === block.tool_use_id);
        if (item && item.status === 'running') {
          item.status = block.is_error ? 'failed' : 'done';
          item.updatedAt = now;
          delete item.activity;
          changed = true;
        }
      }
  return changed;
}

/** At the end of a run, a subagent that still works stopped with it. */
export function finishSubagents(list: SubagentSession[] | undefined) {
  for (const item of list || []) if (item.status === 'running') item.status = 'stopped';
}
