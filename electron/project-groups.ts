import { isProjectColor, type ProjectColor } from '../src/domain/project-colors';
import {
  isTrackerConnection,
  trackerConnection,
  type TrackerConnection,
} from '../src/domain/tracker';
import { readFile } from 'node:fs/promises';
import { writeJSON } from './storage/atomic-json';
import { randomUUID } from 'node:crypto';
import type { ProjectGroup, GitHubProject } from '../src/types';
export class ProjectGroups {
  groups: ProjectGroup[] = [];
  private writes = Promise.resolve();
  constructor(private file: string) {}
  async load() {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8'));
      if (
        !Array.isArray(value) ||
        !value.every(
          (g) =>
            typeof g.id === 'string' &&
            typeof g.name === 'string' &&
            Array.isArray(g.repoIds) &&
            g.repoIds.every((id: unknown) => typeof id === 'string'),
        )
      )
        throw new Error('Invalid project groups');
      if (
        value.some(
          (group: ProjectGroup) =>
            trackerConnection(group) && !isTrackerConnection(trackerConnection(group)),
        )
      )
        throw new Error('Invalid tracker connection in saved projects');
      this.groups = value.map(
        ({ client: _removed, ...group }: ProjectGroup & { client?: unknown }) => ({
          ...group,
          ...(trackerConnection(group) ? { tracker: trackerConnection(group) } : {}),
        }),
      );
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  private change(edit: (groups: ProjectGroup[]) => void) {
    const task = this.writes
      .catch(() => {})
      .then(async () => {
        const next = structuredClone(this.groups);
        edit(next);
        await writeJSON(this.file, next);
        this.groups = next;
      });
    this.writes = task;
    return task;
  }
  private name(value: string) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 150)
      throw new Error('Project name must contain 1–150 characters');
    return value.trim();
  }
  async create(
    name: string,
    /** `null` creates a project without a tracker. Connect one later. */
    github: GitHubProject | TrackerConnection | null,
    hostId?: string,
    rootPath?: string,
    id = randomUUID(),
  ) {
    const connection =
      github === null
        ? null
        : github && 'provider' in github
          ? github
          : { provider: 'github', project: github as GitHubProject };
    if (connection !== null && !isTrackerConnection(connection))
      throw new Error('Choose a tracker project before creating a project.');
    const title = this.name(name);
    await this.change((groups) =>
      groups.push({
        id,
        name: title,
        repoIds: [],
        ...(rootPath ? { rootPath } : {}),
        ...(connection ? { tracker: connection } : {}),
        ...(connection?.provider === 'github'
          ? { github: connection.project as GitHubProject }
          : {}),
        ...(hostId ? { hostId } : {}),
      }),
    );
    return id;
  }
  update(id: string, name: string) {
    const title = this.name(name);
    return this.change((groups) => {
      const group = groups.find((g) => g.id === id);
      if (!group) throw new Error('Project not found');
      group.name = title;
    });
  }
  setRoot(id: string, rootPath: string) {
    return this.change((groups) => {
      const group = groups.find((g) => g.id === id);
      if (!group) throw new Error('Project not found');
      group.rootPath = rootPath;
    });
  }
  setColor(id: string, color: ProjectColor | null) {
    if (color !== null && !isProjectColor(color)) throw new Error('Invalid project color');
    return this.change((groups) => {
      const group = groups.find((g) => g.id === id);
      if (!group) throw new Error('Project not found');
      if (color === null) delete group.color;
      else group.color = color;
    });
  }
  remove(id: string) {
    return this.change((groups) => {
      const index = groups.findIndex((g) => g.id === id);
      if (index < 0) throw new Error('Project not found');
      groups.splice(index, 1);
    });
  }
  link(id: string, github: GitHubProject | undefined) {
    return this.change((groups) => {
      const group = groups.find((g) => g.id === id);
      if (!group) throw new Error('Project not found');
      if (!github)
        throw new Error(
          'Projects require a GitHub connection. Connect a different project instead.',
        );
      group.github = github;
      group.tracker = { provider: 'github', project: github };
    });
  }
  connect(id: string, tracker: TrackerConnection) {
    return this.change((groups) => {
      const group = groups.find((g) => g.id === id);
      if (!group) throw new Error('Project not found');
      if (!isTrackerConnection(tracker)) throw new Error('Invalid tracker connection');
      group.tracker = tracker;
      if (tracker.provider === 'github') group.github = tracker.project as GitHubProject;
      else delete group.github;
    });
  }
  configure(id: string, mapping: TrackerConnection['statusMapping']) {
    return this.change((groups) => {
      const group = groups.find((g) => g.id === id);
      const connection = trackerConnection(group);
      if (!group || !connection) throw new Error('Connect a tracker first');
      group.tracker = { ...connection, statusMapping: mapping };
    });
  }
  move(repoId: string, groupId: string | null) {
    return this.change((groups) => {
      const target = groups.find((g) => g.id === groupId);
      if (groupId !== null && !target) throw new Error('Project not found');
      for (const group of groups) group.repoIds = group.repoIds.filter((id) => id !== repoId);
      target?.repoIds.push(repoId);
    });
  }
}
