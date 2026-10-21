import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeMention,
  chatMentionId,
  fileScore,
  fuzzyScore,
  insertMention,
  mentionLabel,
  mentionLimits,
  mentionPlainText,
  mentionSegments,
  mentionToken,
  parseChatMentionId,
  parseMentions,
  removeMention,
  removeMentionBefore,
} from '../src/domain/mentions';
import { flatOptions, mentionSections, type MentionSourceSet } from '../src/lib/mention-sections';

test('a mention token round-trips paths with spaces, parentheses and percent signs', () => {
  const mention = { kind: 'file' as const, id: 'src/my (old) 100%.ts', label: 'my (old) 100%.ts' };
  const token = mentionToken(mention);
  assert.equal(token, '@[my (old) 100%.ts](file:src/my%20%28old%29%20100%25.ts)');
  assert.deepEqual(parseMentions(`Look at ${token}, please.`), [mention]);
  assert.equal(mentionToken({ kind: 'doc', id: 'p1', label: 'a [b]\nc' }), '@[a b c](doc:p1)');
  assert.equal(mentionLabel('   '), 'Untitled');
  assert.equal(mentionLabel('x'.repeat(200)).length, mentionLimits.label);
});

test('parsing ignores broken tokens, removes duplicates and keeps at most ten mentions', () => {
  assert.deepEqual(parseMentions('@[a](unknown:1) @[a](doc:) @[a](doc:%E0%A4%A) [a](doc:1)'), []);
  const twice = '@[A](doc:1) and @[A again](doc:1)';
  assert.deepEqual(parseMentions(twice), [{ kind: 'doc', id: '1', label: 'A' }]);
  const many = Array.from({ length: 14 }, (_, i) => `@[T${i}](task:${i})`).join(' ');
  assert.equal(parseMentions(many).length, mentionLimits.mentions);
  assert.equal(mentionPlainText('Fix @[auth.ts](file:src/auth.ts) now'), 'Fix @auth.ts now');
  const parts = mentionSegments('a @[B](memory:m) c');
  assert.equal(parts.length, 3);
  assert.equal(parts[0], 'a ');
  assert.equal(parts[2], ' c');
});

test('the "@" word before the caret opens the picker only at a word start', () => {
  assert.deepEqual(activeMention('@', 1), { start: 0, query: '' });
  assert.deepEqual(activeMention('see @src/ap', 11), { start: 4, query: 'src/ap' });
  assert.deepEqual(activeMention('see @src/ap later', 11), { start: 4, query: 'src/ap' });
  assert.equal(activeMention('mail a@b.c', 10), null);
  assert.equal(activeMention('@done ', 6), null);
  assert.equal(activeMention('@[a](doc:1)', 11), null);
  assert.equal(activeMention('@x', 5), null);
});

test('insert, Backspace and remove keep the text around a mention', () => {
  const inserted = insertMention('see @au later', 4, 7, '@[auth.ts](file:auth.ts)');
  assert.equal(inserted.text, 'see @[auth.ts](file:auth.ts) later');
  assert.equal(inserted.caret, 28);
  const atEnd = insertMention('@au', 0, 3, '@docs');
  assert.deepEqual(atEnd, { text: '@docs ', caret: 6 });
  assert.deepEqual(removeMentionBefore(inserted.text, 28), { text: 'see  later', caret: 4 });
  assert.equal(removeMentionBefore(inserted.text, 27), null);
  assert.equal(
    removeMention('a @[X](doc:1) b @[X](doc:1) c @[Y](doc:2)', {
      kind: 'doc',
      id: '1',
      label: 'X',
    }),
    'a b c @[Y](doc:2)',
  );
});

test('fuzzy matching prefers names, word starts and letters in a row', () => {
  assert.equal(fuzzyScore('xyz', 'auth.ts'), null);
  assert.equal(fuzzyScore('', 'auth.ts'), 0);
  assert.ok(fuzzyScore('auth', 'auth.ts')! > fuzzyScore('auth', 'a_u_t_h.ts')!);
  assert.ok(fileScore('app', 'src/app.tsx')! > fileScore('app', 'apps/a/p/p.ts')!);
  assert.equal(fileScore('zzz', 'src/app.tsx'), null);
  assert.equal(chatMentionId('claude', 'host::1'), 'claude:host::1');
  assert.deepEqual(parseChatMentionId('claude:host::1'), { agent: 'claude', id: 'host::1' });
  assert.equal(parseChatMentionId('claude'), null);
  assert.equal(parseChatMentionId(':1'), null);
});

test('picker sections filter each source and show the empty states', () => {
  const sources: MentionSourceSet = {
    files: { status: 'ready', items: ['README.md', 'src/app.tsx', 'src/auth.ts'] },
    docs: { status: 'ready', items: [{ id: 'd1', title: 'Auth flow' }] },
    tasks: { status: 'none', message: 'Connect a board to mention tasks' },
    memory: { status: 'error', message: 'Memory is unavailable.' },
    chats: [{ id: 's1', agent: 'claude', title: 'Fix login' }],
  };
  const all = mentionSections('', true, sources);
  assert.deepEqual(
    all.map((section) => section.title),
    ['Search', 'Files', 'Docs', 'Tasks', 'Memory', 'Chats'],
  );
  assert.equal(all[3].message, 'Connect a board to mention tasks');
  assert.equal(all[4].message, 'Memory is unavailable.');
  const auth = mentionSections('auth', false, sources);
  assert.equal(auth[0].title, 'Files');
  assert.equal(auth[0].options[0].label, 'auth.ts');
  assert.equal(auth[0].options[0].detail, 'src');
  assert.equal(auth[0].options[0].insert, '@[auth.ts](file:src/auth.ts)');
  assert.equal(auth[1].options[0].insert, '@[Auth flow](doc:d1)');
  assert.equal(auth[4].message, 'No chats match');
  const none = mentionSections('qqq', false, sources);
  assert.equal(none[0].message, 'No files match');
  assert.equal(flatOptions(none).length, 0);
  const empty = mentionSections('', false, {
    ...sources,
    files: { status: 'loading' },
    docs: { status: 'ready', items: [] },
    tasks: {
      status: 'ready',
      items: [
        { id: 't1', title: 'Ship it', body: '', number: 4, status: 'Todo' },
        { id: 't2', title: 'Old', body: '', archived: true },
      ],
    },
    memory: { status: 'ready', items: [], note: 'x' },
    chats: [],
  });
  assert.equal(empty[0].message, 'Loading…');
  assert.equal(empty[1].message, 'No docs in this project');
  assert.deepEqual(
    empty[2].options.map((option) => [option.label, option.detail]),
    [['#4 Ship it', 'Todo']],
  );
  assert.equal(empty[3].message, 'No memory entries yet');
  assert.equal(empty[4].message, 'No other chats in this project');
  const chats = mentionSections('login', false, sources)[4];
  assert.equal(chats.options[0].insert, '@[Fix login](chat:claude:s1)');
  assert.equal(chats.options[0].detail, 'Claude Code');
});
