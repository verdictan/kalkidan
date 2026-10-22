import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectDocs } from '../electron/storage/project-docs';

test('project wiki persists Markdown, hierarchy, conflicts, and recoverable deletion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-docs-'));
  try {
    const store = new ProjectDocs(root, (id) => ['atlas', 'other'].includes(id));
    const parent = await store.create('atlas', 'Guide', null);
    let child = await store.create('atlas', 'Setup', parent.id);
    child = await store.save('atlas', {
      ...child,
      markdown: '# Hello\n\n**World**',
      title: 'Install',
    });
    assert.match(await readFile(join(root, 'atlas', child.id + '.md'), 'utf8'), /# Hello/);
    const restored = new ProjectDocs(root, () => true);
    assert.equal(
      (await restored.list('atlas')).find((p) => p.id === child.id)?.parentId,
      parent.id,
    );
    assert.deepEqual(await store.list('other'), []);
    await assert.rejects(store.save('atlas', { ...parent, parentId: child.id }), /nested/);
    await assert.rejects(store.delete('atlas', parent.id, parent.revision), /child pages/);
    const path = join(root, 'atlas', child.id + '.md');
    await writeFile(path, (await readFile(path, 'utf8')) + '\nExternal edit');
    await assert.rejects(store.save('atlas', child), /changed on disk/);
    child = (await store.list('atlas')).find((p) => p.id === child.id)!;
    await store.delete('atlas', child.id, child.revision);
    assert.equal((await store.list('atlas')).length, 1);
    assert.equal((await readdir(join(root, 'atlas', '.trash'))).length, 1);
    await assert.rejects(store.list('../outside'), /Project not found/);
    await assert.rejects(store.create('missing', 'No', null), /Project not found/);
    await assert.rejects(store.create('atlas', 'Bad', '../outside'), /Invalid page ID/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('docs selection picks the parent, a previous sibling, or the first page', async () => {
  const { pageAfterDelete, initialPage } = await import('../src/components/project-docs');
  const pages = [
    { id: 'b', title: 'Beta', parentId: null },
    { id: 'a', title: 'Alpha', parentId: null },
    { id: 'c', title: 'Child', parentId: 'b' },
    { id: 'd', title: 'Delta', parentId: null },
  ];
  assert.equal(pageAfterDelete(pages, 'c'), 'b');
  assert.equal(pageAfterDelete(pages, 'd'), 'b');
  assert.equal(pageAfterDelete(pages, 'a'), 'b');
  assert.equal(pageAfterDelete([pages[1]], 'a'), '');
  assert.equal(initialPage(pages, 'c'), 'c');
  assert.equal(initialPage(pages, 'missing'), 'b');
  assert.equal(initialPage([], null), '');
});

test('deleted pages can be listed and restored, and orphans go to the top level', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-docs-trash-'));
  try {
    const store = new ProjectDocs(root, (id) => id === 'atlas');
    assert.deepEqual(await store.trash('atlas'), []);
    const parent = await store.create('atlas', 'Guide', null);
    const child = await store.create('atlas', 'Setup', parent.id);
    await store.delete('atlas', child.id, child.revision);
    const guide = (await store.list('atlas'))[0];
    await store.delete('atlas', guide.id, guide.revision);
    const trash = await store.trash('atlas');
    assert.deepEqual(trash.map((d) => d.title).sort(), ['Guide', 'Setup']);
    const setup = trash.find((d) => d.title === 'Setup')!;
    const restored = await store.restore('atlas', setup.trashId);
    assert.equal(restored.id, child.id);
    assert.equal(restored.parentId, null);
    assert.deepEqual(
      (await store.list('atlas')).map((p) => p.title),
      ['Setup'],
    );
    assert.equal((await store.trash('atlas')).length, 1);
    await assert.rejects(store.restore('atlas', '../escape-1'), /Invalid deleted page/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('page order persists in the page header and in the metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-docs-order-'));
  try {
    const store = new ProjectDocs(root, () => true);
    const first = await store.create('atlas', 'First', null);
    const second = await store.create('atlas', 'Second', null);
    assert.equal(first.order, undefined);
    const saved = await store.save('atlas', { ...second, order: 0 });
    assert.equal(saved.order, 0);
    assert.match(await readFile(join(root, 'atlas', second.id + '.md'), 'utf8'), /"order":0/);
    const fresh = new ProjectDocs(root, () => true);
    assert.equal((await fresh.get('atlas', second.id)).order, 0);
    const metadata = await fresh.metadata('atlas');
    assert.equal(metadata.find((p) => p.id === second.id)?.order, 0);
    assert.equal('order' in metadata.find((p) => p.id === first.id)!, false);
    const cleared = await fresh.save('atlas', { ...saved, order: undefined });
    assert.equal('order' in cleared, false);
    assert.doesNotMatch(await readFile(join(root, 'atlas', second.id + '.md'), 'utf8'), /order/);
    const invalid = await fresh.save('atlas', { ...cleared, order: Number.NaN });
    assert.equal('order' in invalid, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('docs sort sibling pages by order, then by title, and list the tree in order', async () => {
  const { sortedSiblings, docTreeOrder } = await import('../src/components/project-docs');
  const pages = [
    { id: 'b', title: 'Beta', parentId: null },
    { id: 'a', title: 'Alpha', parentId: null },
    { id: 'z', title: 'Zulu', parentId: null, order: 0 },
    { id: 'c', title: 'Child', parentId: 'a' },
  ];
  assert.deepEqual(
    sortedSiblings(pages, null).map((p) => p.id),
    ['z', 'a', 'b'],
  );
  assert.deepEqual(
    docTreeOrder(pages).map(({ page, depth }) => `${page.id}:${depth}`),
    ['z:0', 'a:0', 'c:1', 'b:0'],
  );
});

test('docs show linked board tasks and resolve task links', async () => {
  const { taskLabel, tasksForPage } = await import('../src/components/project-docs');
  const { taskFromHref, taskHref } = await import('../src/components/wiki-editor');
  const tasks = [
    { id: 'i1', title: 'Fix login', body: '', number: 12, url: 'https://github.com/o/r/issues/12' },
    { id: 'i2', title: 'Draft idea', body: '' },
  ];
  assert.equal(taskLabel(tasks[0]), '#12 Fix login');
  assert.equal(taskLabel(tasks[1]), 'Draft idea');
  assert.deepEqual(
    tasksForPage('p', { i1: ['p'], i2: ['q'] }, tasks).map((task) => task.id),
    ['i1'],
  );
  assert.deepEqual(tasksForPage('p', undefined, tasks), []);
  assert.equal(taskHref(tasks[1]), '#task-i2');
  assert.equal(taskFromHref(taskHref(tasks[0]), tasks)?.id, 'i1');
  assert.equal(taskFromHref('#task-i2', tasks)?.id, 'i2');
  assert.equal(taskFromHref('https://example.com', tasks), undefined);
  assert.equal(taskFromHref('#task-i1', null), undefined);
});

test('docs show ancestors only, explain a missing planner and split pages into tasks', async () => {
  const { pageAncestors, planTasksReason } = await import('../src/components/project-docs');
  const pages = [
    { id: 'a', title: 'Guide', parentId: null },
    { id: 'b', title: 'Setup', parentId: 'a' },
    { id: 'c', title: 'Mac', parentId: 'b' },
  ];
  assert.deepEqual(
    pageAncestors(pages, 'c').map((page) => page.id),
    ['a', 'b'],
  );
  assert.deepEqual(pageAncestors(pages, 'a'), []);
  assert.equal(planTasksReason(false, undefined), 'Connect a board first');
  assert.equal(planTasksReason(true, false), 'You can only read this board');
  assert.equal(planTasksReason(true, undefined), undefined);
  assert.equal(planTasksReason(true, true), undefined);
  const { splitListItems, headingTaskCount } = await import('../src/components/docs-to-issues');
  assert.deepEqual(
    splitListItems('Intro\n\n- [ ] One\n  more text\n- Two\n\n```\n- code\n```', 'P'),
    [
      { title: 'One', body: 'more text' },
      { title: 'Two', body: '' },
    ],
  );
  assert.deepEqual(splitListItems('No list', 'Page'), [{ title: 'Page', body: 'No list' }]);
  assert.equal(headingTaskCount('## A\nx\n## B'), 2);
  assert.equal(headingTaskCount('Only text'), 0);
});

test('the slash menu finds blocks by alias and typed check list markers', async () => {
  const { commandMatches, checklistMarker } = await import('../src/components/wiki-editor');
  const checklist = { label: 'Checklist', keywords: ['todo', 'task'] };
  assert.ok(commandMatches(checklist, 'todo'));
  assert.ok(commandMatches(checklist, 'TASK'));
  assert.ok(commandMatches(checklist, ''));
  assert.ok(!commandMatches(checklist, 'table'));
  assert.ok(commandMatches({ label: 'Heading 1', keywords: ['h1'] }, 'h1'));
  assert.deepEqual(checklistMarker('[ ]'), { checked: false });
  assert.deepEqual(checklistMarker('[]'), { checked: false });
  assert.deepEqual(checklistMarker('[x]'), { checked: true });
  assert.deepEqual(checklistMarker('- [X]'), { checked: true });
  assert.equal(checklistMarker('text [ ]'), null);
});

test('a page without ## headings makes one task per list item, and pages move by drag', async () => {
  const { pageTasks } = await import('../src/components/docs-to-issues');
  const { placedSiblings } = await import('../src/components/project-docs');
  assert.deepEqual(
    pageTasks('Intro\n\n- One\n- Two\n- Three', 'Plan').map((task) => task.title),
    ['One', 'Two', 'Three'],
  );
  assert.equal(pageTasks('## A\ntext\n## B\n- x', 'Plan').length, 2);
  const pages = [
    { id: 'a', title: 'A', parentId: null, order: 0 },
    { id: 'b', title: 'B', parentId: null, order: 1 },
    { id: 'c', title: 'C', parentId: 'a', order: 0 },
  ];
  assert.deepEqual(
    placedSiblings(pages, 'b', 'a', 'before')?.map((page) => page.id),
    ['b', 'a'],
  );
  assert.deepEqual(
    placedSiblings(pages, 'b', 'c', 'after')?.map((page) => [page.id, page.parentId]),
    [
      ['c', 'a'],
      ['b', 'a'],
    ],
  );
  assert.equal(placedSiblings(pages, 'a', 'c', 'before'), null);
});

test('"[[" and "@" open the page menu, and empty paragraphs are not saved', async () => {
  const { pageLinkTrigger, withoutEmptyParagraphs } = await import('../src/components/wiki-editor');
  assert.deepEqual(pageLinkTrigger('See [[log'), { start: 4, query: 'log' });
  assert.deepEqual(pageLinkTrigger('@'), { start: 0, query: '' });
  assert.deepEqual(pageLinkTrigger('Ask @dana'), { start: 4, query: 'dana' });
  assert.equal(pageLinkTrigger('mail me@example.com'), null);
  assert.equal(pageLinkTrigger('[[done]] and'), null);
  assert.equal(withoutEmptyParagraphs('Intro\n\n&nbsp;\n\n&nbsp;\n\n- one\n'), 'Intro\n\n- one\n');
  // Code blocks keep their text and their empty lines.
  assert.equal(withoutEmptyParagraphs('```\n&nbsp;\n\n\nx\n```\n'), '```\n&nbsp;\n\n\nx\n```\n');
  assert.equal(withoutEmptyParagraphs('&nbsp;\n'), '');
});

test('Make tasks uses the repository of most board tasks', async () => {
  const { mainRepository } = await import('../src/components/docs-to-issues');
  assert.equal(mainRepository(['a/web', 'a/api', undefined, 'a/api']), 'a/api');
  assert.equal(mainRepository(['a/web', 'a/api']), 'a/api');
  assert.equal(mainRepository([undefined]), '');
});
