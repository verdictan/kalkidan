import test from 'node:test';
import assert from 'node:assert/strict';
import { fileSymbols, matchFiles, matchSymbols } from '../src/domain/code-navigation';

const files = [
  'src/routes/billing.tsx',
  'tests/fixtures/expired-session.json',
  'src/auth/session-store.ts',
  'src/auth/session.ts',
];

test('go to file puts name prefixes first and skips loose matches', () => {
  assert.deepEqual(
    matchFiles(files, 'sess').map((match) => match.path),
    ['src/auth/session.ts', 'src/auth/session-store.ts', 'tests/fixtures/expired-session.json'],
  );
  assert.deepEqual(matchFiles(files, 'sess')[0].range, [0, 4]);
  assert.deepEqual(
    matchFiles(files, 'auth/').map((match) => match.path),
    ['src/auth/session.ts', 'src/auth/session-store.ts'],
  );
  assert.equal(matchFiles(files, '').length, 4);
});

test('symbols come from functions, types, tests and headings', () => {
  const source = [
    'export interface Session {',
    'export async function readSession(cookie: string) {',
    'export const sessionCookie = "x";',
    'class Store {',
    '  load(cookie: string) {',
    '  if (ready) {',
    "test.describe('sign in', () => {",
  ].join('\n');
  assert.deepEqual(
    fileSymbols(source, 'a.ts').map((s) => `${s.kind}:${s.name}:${s.line}`),
    [
      'type:Session:1',
      'function:readSession:2',
      'variable:sessionCookie:3',
      'class:Store:4',
      'method:load:5',
      'test:sign in:7',
    ],
  );
  const markdown = '# Title\n```\n# not a heading\n```\n## Part';
  assert.deepEqual(
    fileSymbols(markdown, 'README.md').map((s) => s.name),
    ['Title', 'Part'],
  );
  assert.deepEqual(
    matchSymbols(fileSymbols(source, 'a.ts'), 'sess').map((s) => s.name),
    ['Session', 'readSession', 'sessionCookie'],
  );
});
