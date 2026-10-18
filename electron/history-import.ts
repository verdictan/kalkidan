import { stat } from 'node:fs/promises';
import type { Project, ProjectGroup, Session } from '../src/types';
import type {
  HistoryImportPreview,
  HistoryImportRequest,
  HistoryImportResult,
} from '../src/domain/history-import';
import type { SessionLibrary } from './session-library';
const key = (session: { agent: string; id: string }) => `${session.agent}:${session.id}`;
export class HistoryImport {
  private pending = false;
  constructor(
    private deps: {
      scan: () => Promise<{ sessions: Session[]; warnings: string[] }>;
      sources: HistoryImportPreview['sources'];
      projects: () => Project[];
      groups: () => ProjectGroup[];
      library: SessionLibrary;
      add: (path: string, groupId: string) => Promise<void>;
    },
  ) {}
  async preview(): Promise<HistoryImportPreview> {
    const scan = await this.deps.scan();
    const decorated = this.deps.library.decorate(scan.sessions);
    const folders = new Map<string, boolean>();
    for (const cwd of new Set(scan.sessions.map((s) => s.cwd))) {
      folders.set(
        cwd,
        await stat(cwd)
          .then((s) => s.isDirectory())
          .catch(() => false),
      );
    }
    return {
      sources: this.deps.sources,
      warnings: scan.warnings,
      sessions: decorated.map((session) => ({
        ...session,
        available:
          !session.organization?.importHidden &&
          this.deps.projects().some((p) => !p.hostId && p.path === session.cwd),
        missingFolder: !folders.get(session.cwd),
      })),
    };
  }
  async apply(request: HistoryImportRequest): Promise<HistoryImportResult> {
    if (this.pending) throw new Error('An import is already running.');
    if (
      !request ||
      !Array.isArray(request.sessions) ||
      !request.sessions.length ||
      request.sessions.length > 10000 ||
      request.sessions.some(
        (s) => !s || !['codex', 'claude'].includes(s.agent) || typeof s.id !== 'string',
      ) ||
      (request.collection !== undefined &&
        (typeof request.collection !== 'string' || request.collection.length > 160))
    )
      throw new Error('Choose valid chats and a collection of up to 160 characters.');
    const group = this.deps.groups().find((g) => g.id === request.groupId);
    if (!group || group.hostId) throw new Error('Choose a local destination project.');
    this.pending = true;
    try {
      const preview = await this.preview();
      const wanted = new Set(request.sessions.map(key));
      if ([...wanted].some((id) => !preview.sessions.some((s) => key(s) === id)))
        throw new Error('Some chats are no longer available. Preview history again.');
      const selected = preview.sessions.filter((s) => wanted.has(key(s)));
      const result: HistoryImportResult = { imported: 0, repositories: 0, skipped: [] };
      for (const cwd of new Set(selected.map((s) => s.cwd))) {
        const matches = selected.filter((s) => s.cwd === cwd);
        if (matches.some((s) => s.missingFolder)) {
          result.skipped.push(`${cwd}: folder is missing or inaccessible`);
          continue;
        }
        const existing = this.deps.projects().some((p) => !p.hostId && p.path === cwd);
        try {
          // Only new folders restrict their initial import. Existing visible chats stay intact.
          if (!existing) {
            await this.deps.library.updateMany(
              preview.sessions
                .filter((s) => s.cwd === cwd)
                .map((s) => ({
                  agent: s.agent,
                  id: s.id,
                  changes: { importHidden: !wanted.has(key(s)) },
                })),
            );
          }
          await this.deps.add(cwd, request.groupId);
          if (!existing) result.repositories++;
          await this.deps.library.updateMany(
            matches.map((s) => ({
              agent: s.agent,
              id: s.id,
              changes: {
                importHidden: false,
                ...(request.collection?.trim() ? { collection: request.collection.trim() } : {}),
              },
            })),
          );
          result.imported += matches.length;
        } catch (e) {
          result.skipped.push(`${cwd}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      return result;
    } finally {
      this.pending = false;
    }
  }
}
