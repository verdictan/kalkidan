import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Agent, ModelOption } from '../src/types';
export async function modelOptions(agent: Agent, codexRoot: string): Promise<ModelOption[]> {
  if (!['codex', 'claude'].includes(agent)) throw new Error('Invalid agent');
  if (agent === 'claude') return [{ id: 'sonnet', name: 'Sonnet' }, { id: 'opus', name: 'Opus' }, { id: 'haiku', name: 'Haiku' }];
  try {
    const cache = JSON.parse(await readFile(join(codexRoot, 'models_cache.json'), 'utf8'));
    return (cache.models || []).filter((model: any) => model.visibility === 'list' && typeof model.slug === 'string').map((model: any) => ({ id: model.slug, name: model.display_name || model.slug }));
  } catch { return []; }
}
