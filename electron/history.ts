import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { codexIndex } from './codex-store';
import { contentText } from './transcript';
import { readdir, stat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import type { Session } from '../src/types';
async function files(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const result: string[] = [];
    for (const item of entries) {
      if (item.isDirectory() && item.name !== 'subagents')
        result.push(...(await files(join(root, item.name))));
      else if (item.isFile() && item.name.endsWith('.jsonl') && !item.name.startsWith('agent-'))
        result.push(join(root, item.name));
    }
    return result;
  } catch (error: any) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
// Agents add context as user messages. These messages are not a good title.
function injectedContext(text: string) {
  return text.startsWith('<') || text.startsWith('# AGENTS.md instructions');
}
const parsedFiles = new Map<string, { stamp: string; cwd: string; id: string; title: string }>();
export const historyMetrics = { parsedFiles: 0, cacheHits: 0 };
async function scanHistory(codexRoot: string, claudeRoot: string, sources?: Map<string, string>) {
  const sessions: Session[] = [];
  const warnings: string[] = [];
  const indexed = new Set<string>();
  const seen = new Set<string>();
  try {
    for (const entry of await codexIndex(codexRoot)) {
      indexed.add(entry.session.id);
      if (entry.archived) continue;
      entry.session.cwd = await realpath(entry.session.cwd).catch(() => entry.session.cwd);
      sessions.push(entry.session);
      seen.add(entry.session.agent + ':' + entry.session.id);
      if (entry.path) sources?.set(`codex:${entry.session.id}`, entry.path);
    }
  } catch {
    warnings.push('Cannot read the Codex session index. Showing available JSONL sessions.');
  }
  for (const [agent, root] of [
    ['codex', join(codexRoot, 'sessions')],
    ['claude', join(claudeRoot, 'projects')],
  ] as const) {
    try {
      const paths = await files(root);
      const ranked = (
        await Promise.all(
          paths.map(async (path) => {
            try {
              const info = await stat(path);
              return {
                path,
                time: info.mtimeMs,
                stamp: [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(':'),
              };
            } catch {
              warnings.push(`Could not read one ${agent} session.`);
              return null;
            }
          }),
        )
      ).filter((entry): entry is { path: string; time: number; stamp: string } => !!entry);
      const present = new Set(paths);
      for (const path of parsedFiles.keys())
        if (path.startsWith(root + '/') && !present.has(path)) parsedFiles.delete(path);
      for (const { path, time, stamp } of ranked.sort((a, b) => b.time - a.time)) {
        let stream;
        try {
          const cached = parsedFiles.get(path);
          let cwd = cached?.stamp === stamp ? cached.cwd : '',
            id = cached?.stamp === stamp ? cached.id : '',
            title = cached?.stamp === stamp ? cached.title : '';
          if (cached?.stamp === stamp) historyMetrics.cacheHits++;
          else {
            historyMetrics.parsedFiles++;
            stream = createReadStream(path, { encoding: 'utf8' });
            const lines = createInterface({ input: stream, crlfDelay: Infinity });
            for await (const line of lines) {
              try {
                const row = JSON.parse(line);
                if (agent === 'codex' && row.type === 'session_meta') {
                  cwd = row.payload?.cwd;
                  id = row.payload?.id;
                }
                if (agent === 'claude') {
                  if (row.isSidechain) continue;
                  cwd ||= row.cwd;
                  id ||= row.sessionId;
                }
                // Codex writes the prompt as a user response item and, in newer
                // versions, also as a user_message event.
                const content =
                  agent === 'claude' && row.type === 'user'
                    ? row.message?.content
                    : row.type === 'event_msg' && row.payload?.type === 'user_message'
                      ? row.payload.message
                      : agent === 'codex' &&
                          row.type === 'response_item' &&
                          row.payload?.type === 'message' &&
                          row.payload.role === 'user'
                        ? row.payload.content
                        : null;
                const text = contentText(content).trim();
                if (!title && text && !injectedContext(text))
                  title = text.replace(/\s+/g, ' ').slice(0, 120);
                if (cwd && id && title) break;
              } catch {
                /* Truncated or unsupported lines are skipped. */
              }
            }
            parsedFiles.set(path, { stamp, cwd, id, title });
          }
          if (
            typeof cwd === 'string' &&
            typeof id === 'string' &&
            cwd &&
            id &&
            !(agent === 'codex' && indexed.has(id)) &&
            !seen.has(agent + ':' + id)
          ) {
            // Project registration resolves symlinks too; match history to the same folder.
            cwd = await realpath(cwd).catch(() => cwd);
            seen.add(agent + ':' + id);
            sources?.set(`${agent}:${id}`, path);
            sessions.push({
              agent,
              cwd,
              id,
              title: title || 'Agent session',
              updatedAt: new Date(time).toISOString(),
            });
          }
        } catch {
          warnings.push(`Could not read one ${agent} session.`);
        } finally {
          stream?.destroy();
        }
      }
    } catch {
      warnings.push(`Cannot read ${agent} history. Check folder permissions.`);
    }
  }
  return { sessions: sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), warnings };
}

const scans = new Map<
  string,
  Promise<{ result: Awaited<ReturnType<typeof scanHistory>>; sources: Map<string, string> }>
>();
export async function history(
  codexRoot: string,
  claudeRoot: string,
  sources?: Map<string, string>,
) {
  const key = JSON.stringify([codexRoot, claudeRoot]);
  let task = scans.get(key);
  if (!task) {
    task = (async () => {
      const paths = new Map<string, string>();
      return { result: await scanHistory(codexRoot, claudeRoot, paths), sources: paths };
    })();
    scans.set(key, task);
    const current = task;
    const clean = () => {
      if (scans.get(key) === current) scans.delete(key);
    };
    task.then(clean, clean);
  }
  const value = await task;
  value.sources.forEach((path, id) => sources?.set(id, path));
  return structuredClone(value.result);
}

/** Managed homes are separate from personal CLI credentials, but use native history formats. */
export async function historyWithManaged(
  managedRoot: string,
  codexRoot: string,
  claudeRoot: string,
  sources?: Map<string, string>,
) {
  const legacy = await history(codexRoot, claudeRoot, sources);
  let homes;
  try {
    homes = await readdir(join(managedRoot, 'managed-agent-homes'), { withFileTypes: true });
  } catch (error: any) {
    if (error.code === 'ENOENT') return legacy;
    throw error;
  }
  const seen = new Set(legacy.sessions.map((s) => `${s.agent}:${s.id}`));
  for (const home of homes
    .filter((h) => h.isDirectory() && /^[a-f0-9]{64}$/.test(h.name))
    .slice(0, 1000)) {
    const root = join(managedRoot, 'managed-agent-homes', home.name);
    const result = await history(join(root, 'codex'), join(root, 'claude'), sources);
    for (const session of result.sessions) {
      const key = `${session.agent}:${session.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        legacy.sessions.push(session);
      }
    }
    legacy.warnings.push(...result.warnings);
  }
  legacy.sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return legacy;
}
