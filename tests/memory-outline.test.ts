import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bulletFacts,
  bulletHeading,
  defaultMemoryTopic,
  factEdit,
  memoryMarkdown,
  memoryOutline,
  newFactTopic,
  topicRenameSaves,
} from '../src/domain/memory-outline';

test('a typed bullet is one fact, and a pasted list is one fact for each item', () => {
  assert.deepEqual(bulletFacts('Run npm test before a pull request.'), [
    'Run npm test before a pull request.',
  ]);
  assert.deepEqual(bulletFacts('  - Use tokens  '), ['Use tokens']);
  assert.deepEqual(bulletFacts('- One\n- Two\n* Three'), ['One', 'Two', 'Three']);
  // Lines that are not all list items stay one fact.
  assert.deepEqual(bulletFacts('First line\nsecond line'), ['First line\nsecond line']);
  assert.deepEqual(bulletFacts('   '), []);
  assert.deepEqual(bulletFacts('- '), []);
});

test('"## " at the start of a bullet starts a topic', () => {
  assert.equal(bulletHeading('## '), '');
  assert.equal(bulletHeading('# Testing'), 'Testing');
  assert.equal(bulletHeading('### Design tokens '), 'Design tokens');
  assert.equal(bulletHeading('##'), null);
  assert.equal(bulletHeading('#tag in a fact'), null);
  assert.equal(bulletHeading('A fact'), null);
  assert.equal(bulletHeading('## Two\nlines'), null);
});

test('a changed bullet saves the fact, and an empty bullet removes it', () => {
  assert.deepEqual(factEdit('Use tokens.', 'Use tokens.'), { kind: 'none' });
  assert.deepEqual(factEdit('Use tokens.', ' Use tokens. '), { kind: 'none' });
  assert.deepEqual(factEdit('Use tokens.', 'Use design tokens.'), {
    kind: 'save',
    content: 'Use design tokens.',
  });
  assert.deepEqual(factEdit('Use tokens.', ''), { kind: 'remove' });
  assert.deepEqual(factEdit('Use tokens.', '- '), { kind: 'remove' });
});

test('a new fact goes to the heading above it, else the last topic, else General', () => {
  assert.equal(newFactTopic('Testing', ['Auth']), 'Testing');
  assert.equal(newFactTopic('  ', ['Auth', 'Design']), 'Design');
  assert.equal(newFactTopic(undefined, []), defaultMemoryTopic);
});

test('a renamed heading saves each fact of the topic with the new name', () => {
  const entries = [
    { id: 'a', revision: '1', topic: 'Auth', content: 'One' },
    { id: 'b', revision: '2', topic: 'auth', content: 'Two' },
    { id: 'c', revision: '3', topic: 'Design', content: 'Three' },
  ];
  assert.deepEqual(topicRenameSaves(entries, 'Auth', 'Authentication'), [
    { id: 'a', expectedRevision: '1', topic: 'Authentication', content: 'One' },
    { id: 'b', expectedRevision: '2', topic: 'Authentication', content: 'Two' },
  ]);
  assert.deepEqual(topicRenameSaves(entries, 'Auth', ' '), []);
  assert.deepEqual(topicRenameSaves(entries, 'Auth', 'Auth'), []);
});

test('memory maps to Markdown headings and bullets, and back', () => {
  const topics = [
    { topic: 'Authentication', facts: [{ content: 'Tokens last 15 minutes.' }] },
    { topic: 'Testing', facts: [{ content: 'Run npm test.\nThen npm run test:ui.' }] },
  ];
  const markdown = memoryMarkdown(topics);
  assert.equal(
    markdown,
    '## Authentication\n\n- Tokens last 15 minutes.\n\n## Testing\n\n- Run npm test.\n  Then npm run test:ui.',
  );
  assert.deepEqual(memoryOutline(markdown), [
    { topic: 'Authentication', facts: ['Tokens last 15 minutes.'] },
    { topic: 'Testing', facts: ['Run npm test.\nThen npm run test:ui.'] },
  ]);
  // A bullet before the first heading goes to the default topic.
  assert.deepEqual(memoryOutline('- Loose fact\n## Auth\n- Fact'), [
    { topic: defaultMemoryTopic, facts: ['Loose fact'] },
    { topic: 'Auth', facts: ['Fact'] },
  ]);
});

test('memory lists topics and facts in the order they were added', async () => {
  const { memoryFacts, factTopics } = await import('../src/components/project-memory');
  const entry = (id: string, topic: string, createdAt: string) => ({
    version: 1 as const,
    id,
    topic,
    content: id,
    revision: 'r',
    provenance: 'user' as const,
    source: { sessionId: '', turnId: '', references: [] },
    createdAt,
    updatedAt: '2026-10-20T00:00:00Z',
    supersedes: [],
  });
  const facts = memoryFacts(undefined, [
    entry('z-new', 'Zeta', '2026-10-03T00:00:00Z'),
    entry('a-second', 'Alpha', '2026-10-04T00:00:00Z'),
    entry('z-first', 'Zeta', '2026-10-01T00:00:00Z'),
    entry('a-first', 'Alpha', '2026-10-02T00:00:00Z'),
  ]);
  assert.deepEqual(
    factTopics(facts).map((item) => [item.topic, item.facts.map((fact) => fact.id)]),
    [
      ['Zeta', ['z-first', 'z-new']],
      ['Alpha', ['a-first', 'a-second']],
    ],
  );
});

test('Knowledge opens on the first part that has content', async () => {
  const { firstKnowledgeSection } = await import('../src/components/knowledge-panel');
  assert.equal(firstKnowledgeSection(3, 0), 'memory');
  assert.equal(firstKnowledgeSection(3, 2), 'memory');
  assert.equal(firstKnowledgeSection(0, 2), 'pages');
  // A new project opens on Memory, with the caret in "Add a fact".
  assert.equal(firstKnowledgeSection(0, 0), 'memory');
});

test('"Make N tasks" counts the open checklist items, else headings or list items', async () => {
  const { plannedTaskCount, plannedTasks } = await import('../src/components/docs-to-issues');
  const page = [
    'We move sessions to tokens.',
    '',
    '## Steps',
    '',
    '- [x] Add a refresh endpoint',
    '- [ ] Store tokens',
    '- [ ] Write tests',
    '- [ ] Remove the cookie middleware',
    '',
    '## Risks',
    '',
    '- Mobile clients keep the old cookie.',
  ].join('\n');
  assert.equal(plannedTaskCount(page), 3);
  assert.deepEqual(
    plannedTasks(page, 'Plan').map((task) => task.title),
    ['Store tokens', 'Write tests', 'Remove the cookie middleware'],
  );
  assert.equal(plannedTaskCount('## One\n\ntext\n\n## Two\n\ntext'), 2);
  assert.equal(plannedTaskCount('- a\n- b'), 2);
  assert.equal(plannedTaskCount('Only text.'), 0);
  assert.equal(plannedTaskCount('- [x] Done'), 0);
});

test('the slash menu shows at most 8 rows and no Heading 1', async () => {
  const { slashRows, slashLimit } = await import('../src/components/wiki-editor');
  const commands = [
    'Heading',
    'Subheading',
    'Bullet list',
    'Numbered list',
    'Checklist',
    'Quote',
    'Code block',
    'Table',
    'Divider',
    'Link to page',
    'Link a task',
  ].map((label) => ({
    label,
    keywords: [] as string[],
    searchOnly: ['Numbered list', 'Quote', 'Divider'].includes(label),
  }));
  const rows = slashRows(commands, '');
  assert.equal(slashLimit, 8);
  assert.equal(rows.length, 8);
  assert.ok(!rows.some((row) => row.label === 'Quote'));
  assert.deepEqual(
    slashRows(commands, 'quo').map((row) => row.label),
    ['Quote'],
  );
});
