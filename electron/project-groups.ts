import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ProjectGroup, GitHubProject } from '../src/types';
export class ProjectGroups {
  groups: ProjectGroup[] = [];
  private writes = Promise.resolve();
  constructor(private file: string) {}
  async load() {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8'));
      if (!Array.isArray(value) || !value.every(g => typeof g.id === 'string' && typeof g.name === 'string' && Array.isArray(g.repoIds) && g.repoIds.every((id: unknown) => typeof id === 'string'))) throw new Error('Invalid project groups');
      this.groups = value.map(({ client: _removed, ...group }: ProjectGroup & { client?: unknown }) => group);
    } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  }
  private change(edit: (groups: ProjectGroup[]) => void) {
    const task = this.writes.catch(() => {}).then(async () => {
      const next = structuredClone(this.groups); edit(next);
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(this.file + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 });
      await rename(this.file + '.tmp', this.file); this.groups = next;
    }); this.writes = task; return task;
  }
  private name(value: string) { if (typeof value !== 'string' || !value.trim() || value.trim().length > 150) throw new Error('Project name must contain 1–150 characters'); return value.trim(); }
  async create(name: string, github: GitHubProject, hostId?: string) { if (!github?.id || !github?.url) throw new Error('Choose a GitHub Project before creating a project.'); const id = randomUUID(); const title = this.name(name); await this.change(groups => groups.push({ id, name: title, repoIds: [], github, ...(hostId ? { hostId } : {}) })); return id; }
  update(id: string, name: string) { const title = this.name(name); return this.change(groups => { const group = groups.find(g => g.id === id); if (!group) throw new Error('Project not found'); group.name = title; }); }
  remove(id: string) { return this.change(groups => { const index = groups.findIndex(g => g.id === id); if (index < 0) throw new Error('Project not found'); groups.splice(index, 1); }); }
  link(id: string, github: GitHubProject | undefined) { return this.change(groups => { const group = groups.find(g => g.id === id); if (!group) throw new Error('Project not found'); if (!github) throw new Error('Projects require a GitHub connection. Connect a different project instead.'); group.github = github; }); }
  move(repoId: string, groupId: string | null) { return this.change(groups => { const target = groups.find(g => g.id === groupId); if (groupId !== null && !target) throw new Error('Project not found'); for (const group of groups) group.repoIds = group.repoIds.filter(id => id !== repoId); target?.repoIds.push(repoId); }); }
}
