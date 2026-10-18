import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Session, Transcript } from '../src/types';
import { contentText } from './transcript';

async function latestDatabase(root: string, prefix: string) {
  const names = await readdir(root).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
  const name = names.filter(name => new RegExp(`^${prefix}_\\d+\\.sqlite$`).test(name)).sort((a, b) => Number(b.match(/_(\d+)\./)![1]) - Number(a.match(/_(\d+)\./)![1]))[0];
  return name ? join(root, name) : undefined;
}
export async function codexIndex(root: string) {
  const path = await latestDatabase(root, 'state');
  if (!path) return [];
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare('SELECT id, cwd, title, updated_at, archived, rollout_path FROM threads').all().map(row => ({
      session: { id: String(row.id), cwd: String(row.cwd), title: String(row.title || 'Agent session'), agent: 'codex', updatedAt: new Date(Number(row.updated_at) * 1000).toISOString() } as Session,
      archived: !!row.archived, path: String(row.rollout_path || '')
    }));
  } finally { db.close(); }
}
export async function codexTranscript(root: string, id: string): Promise<Transcript> {
  const path = await latestDatabase(root, 'thread_history');
  if (!path) throw new Error('This Codex transcript is not available locally.');
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = db.prepare("SELECT item_json FROM thread_items WHERE thread_id = ? AND item_type IN ('userMessage', 'agentMessage') ORDER BY rollout_ordinal DESC LIMIT 501").all(id);
    const messages = rows.slice(0, 500).reverse().flatMap(row => {
      const item = JSON.parse(String(row.item_json));
      const text = item.type === 'userMessage' ? contentText(item.content) : item.text;
      return typeof text === 'string' && text ? [{ id: item.id, role: item.type === 'userMessage' ? 'user' as const : 'assistant' as const, text }] : [];
    });
    return { messages, truncated: rows.length > 500 };
  } finally { db.close(); }
}
