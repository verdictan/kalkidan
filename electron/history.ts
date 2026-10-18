import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { codexIndex } from './codex-store';
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
export async function history(
  codexRoot: string,
  claudeRoot: string,
  sources?: Map<string, string>,
) {
  const sessions: Session[] = [];
  const warnings: string[] = [];
  const indexed = new Set<string>();
  try {
    for (const entry of await codexIndex(codexRoot)) {
      indexed.add(entry.session.id);
      if (entry.archived) continue;
      entry.session.cwd = await realpath(entry.session.cwd).catch(() => entry.session.cwd);
      sessions.push(entry.session);
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
              return { path, time: (await stat(path)).mtimeMs };
            } catch {
              warnings.push(`Could not read one ${agent} session.`);
              return null;
            }
          }),
        )
      ).filter((entry): entry is { path: string; time: number } => !!entry);
      for (const { path, time } of ranked.sort((a, b) => b.time - a.time)) {
        let stream;
        try {
          stream = createReadStream(path, { encoding: 'utf8' });
          const lines = createInterface({ input: stream, crlfDelay: Infinity });
          let cwd = '',
            id = '',
            title = '';
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
              const content =
                agent === 'claude' && row.type === 'user'
                  ? row.message?.content
                  : row.type === 'event_msg' && row.payload?.type === 'user_message'
                    ? row.payload.message
                    : null;
              const text =
                typeof content === 'string'
                  ? content
                  : Array.isArray(content)
                    ? content
                        .filter((block) => block.type === 'text' && typeof block.text === 'string')
                        .map((block) => block.text)
                        .join(' ')
                    : '';
              if (!title && text && !text.startsWith('<'))
                title = text.replace(/\s+/g, ' ').slice(0, 120);
              if (cwd && id && title) break;
            } catch {
              /* Truncated or unsupported lines are skipped. */
            }
          }
          if (
            typeof cwd === 'string' &&
            typeof id === 'string' &&
            cwd &&
            id &&
            !(agent === 'codex' && indexed.has(id)) &&
            !sessions.some((s) => s.id === id && s.agent === agent)
          ) {
            // Project registration resolves symlinks too; match history to the same folder.
            cwd = await realpath(cwd).catch(() => cwd);
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
