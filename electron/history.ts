import { readdir, open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Session } from '../src/types';
async function files(root: string, depth = 0): Promise<string[]> {
  if (depth > 5) return [];
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const result: string[] = [];
    for (const item of entries) {
      if (item.isDirectory()) result.push(...await files(join(root, item.name), depth + 1));
      else if (item.name.endsWith('.jsonl')) result.push(join(root, item.name));
      if (result.length >= 5000) break;
    }
    return result.slice(0, 5000);
  } catch (error: any) { if (error.code === 'ENOENT') return []; throw error; }
}
export async function history(codexRoot: string, claudeRoot: string) {
  const sessions: Session[] = []; const warnings: string[] = [];
  for (const [agent, root] of [['codex', join(codexRoot, 'sessions')], ['claude', join(claudeRoot, 'projects')]] as const) {
    try {
      const paths = await files(root);
      const ranked = await Promise.all(paths.map(async path => ({ path, time: (await stat(path)).mtimeMs })));
      for (const { path, time } of ranked.sort((a,b) => b.time-a.time).slice(0, 300)) {
        let handle;
        try {
          handle = await open(path, 'r');
          const buffer = Buffer.alloc(128 * 1024); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
          let cwd = '', id = '', title = '';
          for (const line of buffer.subarray(0, bytesRead).toString('utf8').split('\n')) {
            try {
              const row = JSON.parse(line);
              if (agent === 'codex' && row.type === 'session_meta') { cwd = row.payload?.cwd; id = row.payload?.id; }
              if (agent === 'claude') { cwd ||= row.cwd; id ||= row.sessionId; }
              const content = agent === 'claude' && row.type === 'user' ? row.message?.content : row.type === 'event_msg' && row.payload?.type === 'user_message' ? row.payload.message : null;
              const text = typeof content === 'string' ? content : Array.isArray(content) ? content.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join(' ') : '';
              if (!title && text && !text.startsWith('<')) title = text.replace(/\s+/g, ' ').slice(0, 120);
            } catch { /* Truncated or unsupported lines are skipped. */ }
          }
          if (typeof cwd === 'string' && typeof id === 'string' && cwd && id && !sessions.some(s => s.id === id && s.agent === agent)) sessions.push({ agent, cwd, id, title: title || 'Agent session', updatedAt: new Date(time).toISOString() });
        } catch { warnings.push(`Could not read one ${agent} session.`); } finally { await handle?.close(); }
      }
      if (paths.length >= 300) warnings.push(`${agent}: showing up to 300 recent session files; discovery scans up to 5,000 files.`);
    } catch { warnings.push(`Cannot read ${agent} history. Check folder permissions.`); }
  }
  return { sessions: sessions.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)), warnings };
}
