import assert from 'node:assert/strict';
import test from 'node:test';

test('Find counts and marks the words that start with the typed words', async () => {
  const { matchCount, matchRanges } = await import('../src/components/knowledge-panel');
  const text = 'Short-lived tokens. Keep the refresh token.';
  assert.equal(matchCount(text, 'token'), 2);
  assert.equal(matchCount(text, 'tok ref'), 3);
  // Every typed word must start a word of the text.
  assert.equal(matchCount(text, 'token cookie'), 0);
  assert.equal(matchCount(text, ''), 0);
  assert.deepEqual(matchRanges(text, 'token'), [
    [12, 18],
    [37, 42],
  ]);
});

test('Find shows the matching pages and their parent pages', async () => {
  const { visiblePages, withoutTaskLinks } = await import('../src/components/project-docs');
  const pages = [
    { id: 'a', title: 'Architecture', parentId: null },
    { id: 'b', title: 'Design system', parentId: 'a' },
    { id: 'c', title: 'Release checklist', parentId: null },
  ];
  assert.equal(visiblePages(pages, undefined), null);
  assert.deepEqual([...visiblePages(pages, { b: 1 })!].sort(), ['a', 'b']);
  assert.deepEqual([...visiblePages(pages, { gone: 2 })!], []);
  // Undo turns the task links of a page back into plain text.
  const url = 'https://github.com/example/atlas-web/issues/142';
  assert.equal(
    withoutTaskLinks(`- [ ] [Store tokens](${url})\n- [ ] Keep`, [url]),
    '- [ ] Store tokens\n- [ ] Keep',
  );
});

test('"#" opens the task menu, and the menu finds tasks by number or word', async () => {
  const { taskLinkTrigger, matchingTasks, menuPosition, caretMenuHeight } =
    await import('../src/components/wiki-editor');
  assert.deepEqual(taskLinkTrigger('See #14'), { start: 4, query: '14' });
  assert.deepEqual(taskLinkTrigger('#'), { start: 0, query: '' });
  assert.equal(taskLinkTrigger('# Heading'), null);
  assert.equal(taskLinkTrigger('a#b'), null);
  const tasks = [
    { id: '1', title: 'Store tokens', body: '', number: 142 },
    { id: '2', title: 'Write tests', body: '', number: 143 },
    { id: '3', title: 'Old', body: '', number: 99, archived: true },
  ];
  assert.deepEqual(
    matchingTasks(tasks, '143').map((task) => task.id),
    ['2'],
  );
  assert.deepEqual(
    matchingTasks(tasks, 'tok').map((task) => task.id),
    ['1'],
  );
  assert.deepEqual(
    matchingTasks(tasks, '').map((task) => task.id),
    ['1', '2'],
  );
  // The menu opens 8px under the line, or above it when there is no room under it.
  const view = { width: 1000, height: 620 };
  assert.deepEqual(menuPosition({ left: 500, top: 100, bottom: 124 }, 178, view), {
    left: 496,
    top: 132,
  });
  assert.deepEqual(menuPosition({ left: 500, top: 500, bottom: 524 }, 178, view), {
    left: 496,
    top: 314,
  });
  assert.equal(caretMenuHeight(6), 178);
});

test('Memory "/" rows filter by the typed word', async () => {
  const { memoryCommandRows } = await import('../src/components/project-memory');
  assert.deepEqual(
    memoryCommandRows('').map((row) => row.label),
    ['Topic', 'Fact', 'Checklist', 'Code', 'Link a page'],
  );
  assert.deepEqual(
    memoryCommandRows('li').map((row) => row.label),
    ['Link a page'],
  );
  // With a board, "/" also offers "Link a task".
  assert.deepEqual(
    memoryCommandRows('', true).map((row) => row.label),
    ['Topic', 'Fact', 'Checklist', 'Code', 'Link a page', 'Link a task'],
  );
  assert.deepEqual(
    memoryCommandRows('li', true).map((row) => row.label),
    ['Link a page', 'Link a task'],
  );
});

test('The Usage card counts 14 days and writes one cost', async () => {
  const { costText, recentProjectUsage } = await import('../src/components/project-usage');
  const totals = { cost: { USD: '18.4' }, costUnknown: 0, subscription: 0, requests: 3 };
  assert.equal(costText(totals), '$18.40');
  assert.equal(costText(totals, true), '≈ $18.40');
  assert.equal(costText({ ...totals, costUnknown: 1 }), '≈ $18.40');
  assert.equal(costText({ cost: {}, costUnknown: 0, subscription: 3, requests: 3 }), 'Included');
  assert.equal(costText({ cost: {}, costUnknown: 0, subscription: 0, requests: 0 }), '');
  const now = Date.parse('2026-10-23T12:00:00');
  const entry = (time: string | null) => ({ time }) as never;
  const usage = recentProjectUsage(
    {
      chats: [
        {
          agent: 'codex',
          sessionId: 's',
          billing: 'metered',
          complete: true,
          entries: [
            entry('2026-10-23T09:00:00'),
            entry('2026-10-10T09:00:00'),
            entry('2026-10-09T23:00:00'),
            entry(null),
          ],
        },
      ],
      unmanaged: 0,
      failed: 0,
      skipped: 0,
      observedAt: '2026-10-23T12:00:00Z',
    },
    now,
  );
  assert.equal(usage.chats[0].entries.length, 2);
});
