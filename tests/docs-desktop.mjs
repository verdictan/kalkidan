import { _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = await mkdtemp(join(tmpdir(), 'kalkidan-docs-ipc-'));
const env = { ...process.env, KALKIDAN_TEST_DATA: join(root, 'library'), CODEX_HOME: join(root, 'codex'), CLAUDE_CONFIG_DIR: join(root, 'claude') };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  await mkdir(env.KALKIDAN_TEST_DATA, { recursive: true });
  await writeFile(join(env.KALKIDAN_TEST_DATA, 'project-groups.json'), JSON.stringify([{ id: 'wiki', name: 'Wiki', repoIds: [] }]));
  await mkdir(join(env.KALKIDAN_TEST_DATA, 'docs', 'wiki'), { recursive: true });
  const legacy = '<!-- kalkidan {"title":"Legacy","parentId":null} -->\nOriginal Markdown';
  await writeFile(join(env.KALKIDAN_TEST_DATA, 'docs', 'wiki', 'legacy.md'), legacy);
  app = await electron.launch({ args: ['--require', resolve('tests/helpers/electron-ci.cjs'), '.'], env });
  console.log('Electron startup:', await app.evaluate(({ app, BrowserWindow }) => ({
    ready: app.isReady(), windows: BrowserWindow.getAllWindows().length,
    dockIcon: app.dock?.setIcon.toString(),
  })));
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.workspace);
  const listing = await page.evaluate(path => window.workspace.directoryList(path), root);
  assert.equal(listing.path, await realpath(root));
  assert.ok(listing.entries.some(entry => entry.name === 'library' && entry.kind === 'directory'));
  const snapshot = await page.evaluate(() => window.workspace.snapshot());
  const projectRoot = snapshot.groups.find(group => group.id === 'wiki').rootPath;
  assert.equal(projectRoot, await realpath(join(env.KALKIDAN_TEST_DATA, 'projects', 'wiki')));
  assert.equal(await readFile(join(projectRoot, 'docs', 'legacy.md'), 'utf8'), legacy);
  assert.equal(await readFile(join(env.KALKIDAN_TEST_DATA, 'docs', 'wiki', 'legacy.md'), 'utf8'), legacy);
  const saved = await page.evaluate(async () => {
    const doc = await window.workspace.docsCreate('wiki', 'Handbook', null);
    return window.workspace.docsSave('wiki', { ...doc, markdown: '# Desktop wiki\n\nSaved through IPC.' });
  });
  const file = join(env.KALKIDAN_TEST_DATA, 'projects', 'wiki', 'docs', saved.id + '.md');
  assert.match(await readFile(file, 'utf8'), /# Desktop wiki/);
  await app.close();
  app = await electron.launch({ args: ['--require', resolve('tests/helpers/electron-ci.cjs'), '.'], env });
  const reopened = await app.firstWindow();
  await reopened.waitForFunction(() => !!window.workspace);
  const docs = await reopened.evaluate(() => window.workspace.docsList('wiki'));
  assert.equal(docs.find(doc => doc.id === saved.id).markdown, saved.markdown);
  await assert.rejects(reopened.evaluate(() => window.workspace.docsList('../outside')), /Project not found/);
  console.log('Desktop docs IPC, Markdown persistence and relaunch passed.');
} finally {
  if (app) await app.close();
  await rm(root, { recursive: true, force: true });
}
