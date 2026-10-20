import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const temp = await mkdtemp(join(tmpdir(), 'kalkidan-rpc-root-'));
const child = spawn(process.execPath, ['dist-electron/remote-agent.cjs'], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env, CODEX_HOME: join(temp, 'codex'), CLAUDE_CONFIG_DIR: join(temp, 'claude') },
});
const pending = new Map();
createInterface({ input: child.stdout }).on('line', (line) => {
  const data = JSON.parse(line);
  const request = pending.get(data.id);
  if (request) {
    pending.delete(data.id);
    data.error ? request.reject(Error(data.error)) : request.resolve(data.result);
  }
});
let id = 0;
const rpc = (method, args) =>
  new Promise((resolve, reject) => {
    const key = String(++id);
    pending.set(key, { resolve, reject });
    child.stdin.write(JSON.stringify({ id: key, method, args }) + '\n');
  });
try {
  const root = await rpc('project-prepare', ['test', join(temp, 'project')]);
  const memoryPath = await rpc('project-memory', ['test', root, 'path']);
  assert.equal(memoryPath, join(root, 'memory'));
  await writeFile(join(memoryPath, 'conventions.md'), '# Remote memory\nUse npm.');
  const memory = await rpc('project-memory', ['test', root, 'list']);
  assert.match(memory.pages[0].content, /Remote memory/);
  await assert.rejects(rpc('project-memory', ['other', root, 'list']), /another project/);
  await assert.rejects(rpc('project-memory', ['test', root, 'save']), /Unknown memory operation/);
  const listing = await rpc('directory-list', [root]);
  assert.equal(listing.path, root);
  assert.ok(listing.entries.some((entry) => entry.name === 'docs' && entry.kind === 'directory'));
  await assert.rejects(rpc('folders', [join(root, 'missing')]), /Folder not found:.*letter case/);
  const folders = await rpc('folders', [root]);
  assert.equal(folders.path, root);
  assert.ok(folders.folders.some((entry) => entry.name === 'docs'));
  const doc = await rpc('project-docs', ['test', root, 'create', ['Remote guide', null]]);
  const saved = await rpc('project-docs', [
    'test',
    root,
    'save',
    [{ ...doc, markdown: '# Remote docs' }],
  ]);
  const hits = await rpc('project-docs', ['test', root, 'search', ['Remote docs']]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, saved.id);
  assert.match(hits[0].excerpt, /# Remote docs/);
  assert.ok(JSON.stringify(hits).length <= 4800);
  await assert.rejects(
    rpc('project-docs', ['other', root, 'search', ['Remote docs']]),
    /another project/,
  );
  assert.match(await readFile(join(root, 'docs', saved.id + '.md'), 'utf8'), /# Remote docs/);
  assert.equal((await rpc('project-docs', ['test', root, 'list', []]))[0].revision, saved.revision);
  const beforeRead = id;
  const metadata = await rpc('project-docs', ['test', root, 'metadata', []]);
  assert.equal(metadata.length, 1);
  assert.ok(!('markdown' in metadata[0]));
  const opened = await rpc('project-docs', ['test', root, 'read', [saved.id]]);
  assert.equal(opened.markdown, saved.markdown);
  assert.equal(id - beforeRead, 2);
  const repo = join(root, 'repos', 'repo');
  execFileSync('git', ['init', repo], { stdio: 'pipe' });
  execFileSync(
    'git',
    [
      '-C',
      repo,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '--allow-empty',
      '-m',
      'Initial',
    ],
    { stdio: 'pipe' },
  );
  const worktree = await rpc('worktree', [repo, 'feature/location', root]);
  assert.ok(worktree.path.startsWith(join(root, 'worktrees') + '/'));
  assert.equal((await rpc('git', [repo])).worktrees.length, 2);
  const beforeSummary = id;
  const summary = await rpc('repository-snapshot', [repo]);
  assert.equal(summary.git.worktrees.length, 2);
  assert.deepEqual(summary.sessions, []);
  assert.equal(id - beforeSummary, 1);
  await assert.rejects(rpc('project-prepare', ['other', root]), /another project/);
  console.log(
    'Remote protocol passed: one request per metadata/read operation, one combined repository request, Markdown persistence, ownership, and Git worktrees.',
  );
} finally {
  child.stdin.end();
  child.kill();
  await rm(temp, { recursive: true, force: true });
}
