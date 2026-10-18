import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryImport } from '../electron/history-import';
import { SessionLibrary } from '../electron/session-library';
import type { Project, Session } from '../src/types';

test('history import selects chats, preserves metadata, and is repeatable without copying source files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'history-import-'));
  try {
    const source = join(root, 'history.jsonl');
    await writeFile(source, 'original transcript');
    const library = new SessionLibrary(join(root, 'organization.json'));
    await library.load();
    await library.update('codex', 'one', { pinned: true, notes: 'Keep this' });
    const projects: Project[] = [];
    const sessions: Session[] = ['one', 'two'].map((id) => ({
      id,
      agent: 'codex',
      cwd: root,
      title: id,
      updatedAt: new Date().toISOString(),
    }));
    const importer = new HistoryImport({
      scan: async () => ({ sessions, warnings: [] }),
      sources: { codex: root, claude: root },
      library,
      projects: () => projects,
      groups: () => [{ id: 'g', name: 'Project', repoIds: [] }],
      add: async (path) => {
        if (!projects.length)
          projects.push({ id: 'p', path, name: 'Repo', favorite: false, notes: '', addedAt: '' });
      },
    });
    const request = {
      groupId: 'g',
      sessions: [{ agent: 'codex' as const, id: 'one' }],
      collection: 'Imported',
    };
    assert.deepEqual(await importer.apply(request), { imported: 1, repositories: 1, skipped: [] });
    let preview = await importer.preview();
    assert.equal(preview.sessions[0].available, true);
    assert.equal(preview.sessions[1].available, false);
    assert.deepEqual(preview.sessions[0].organization, {
      pinned: true,
      notes: 'Keep this',
      importHidden: false,
      collection: 'Imported',
    });
    assert.equal(preview.sessions[1].organization?.importHidden, true);
    assert.equal((await importer.apply(request)).repositories, 0);
    await importer.apply({ groupId: 'g', sessions: [{ agent: 'codex', id: 'two' }] });
    preview = await importer.preview();
    assert.ok(preview.sessions.every((s) => s.available));
    const restored = new SessionLibrary(join(root, 'organization.json'));
    await restored.load();
    assert.equal(restored.decorate(sessions)[0].organization?.notes, 'Keep this');
    assert.equal(await readFile(source, 'utf8'), 'original transcript');
    await assert.rejects(importer.apply({ ...request, groupId: 'unknown' }), /local destination/);
    await assert.rejects(
      importer.apply({ ...request, sessions: [{ agent: 'codex', id: 'unknown' }] }),
      /no longer available/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('history import reports missing folders and write failures without claiming success', async () => {
  const root = await mkdtemp(join(tmpdir(), 'history-import-'));
  try {
    const library = new SessionLibrary(join(root, 'organization.json'));
    await library.load();
    const sessions: Session[] = [
      {
        id: 'missing',
        agent: 'claude',
        cwd: join(root, 'missing'),
        title: 'Missing',
        updatedAt: '',
      },
      { id: 'failure', agent: 'codex', cwd: root, title: 'Failure', updatedAt: '' },
    ];
    const importer = new HistoryImport({
      scan: async () => ({ sessions, warnings: ['Partial history'] }),
      sources: { codex: root, claude: root },
      library,
      projects: () => [],
      groups: () => [{ id: 'g', name: 'Project', repoIds: [] }],
      add: async () => {
        throw new Error('Disk unavailable');
      },
    });
    const preview = await importer.preview();
    assert.equal(preview.sessions[0].missingFolder, true);
    assert.deepEqual(preview.warnings, ['Partial history']);
    const result = await importer.apply({ groupId: 'g', sessions });
    assert.equal(result.imported, 0);
    assert.equal(result.repositories, 0);
    assert.equal(result.skipped.length, 2);
    assert.match(result.skipped[1], /Disk unavailable/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
