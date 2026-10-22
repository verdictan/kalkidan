import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const contractFiles = [
  'src/api/contracts.ts',
  'src/domain/project-services.ts',
  'src/domain/parallel-dispatch.ts',
  'src/domain/publish.ts',
  'src/domain/verdictan.ts',
  'src/domain/data-policy.ts',
  'src/domain/updates.ts',
  'src/domain/diagnostics.ts',
  'src/domain/docs.ts',
  'src/domain/github-content.ts',
  'src/domain/github-relations.ts',
  'src/domain/github-resources.ts',
  'src/domain/github-mutations.ts',
];

const opening: Record<string, string> = { '(': ')', '[': ']', '{': '}', '<': '>' };
const closing = new Set(Object.values(opening));

/** Returns the index of the bracket that closes the bracket at `start`. */
function matching(source: string, start: number): number {
  let depth = 0;
  let quote = '';
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (char === '\\') index++;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '>' && source[index - 1] === '=') continue;
    else if (char in opening) depth++;
    else if (closing.has(char) && --depth === 0) return index;
  }
  throw new Error(`No closing bracket for index ${start}`);
}

/** Splits a list on top-level commas and drops a trailing empty entry. */
function split(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (let index = 0; index < list.length; index++) {
    const char = list[index];
    current += char;
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '>' && list[index - 1] === '=') continue;
    else if (char in opening) depth++;
    else if (closing.has(char)) depth--;
    else if (char === ',' && depth === 0) {
      parts.push(current.slice(0, -1).trim());
      current = '';
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

async function contractArity(): Promise<Map<string, number>> {
  const arity = new Map<string, number>();
  for (const file of contractFiles) {
    // Comments can hold quote characters, for example "the project's". Drop them first.
    const source = (await readFile(join(root, file), 'utf8'))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const match of source.matchAll(/^export interface \w+API\b[^{]*\{/gm)) {
      const open = match.index + match[0].length - 1;
      const body = source.slice(open + 1, matching(source, open));
      for (const member of body.matchAll(/^ {2}(\w+)\??(<[^(]*>)?\(/gm)) {
        const start = member.index + member[0].length - 1;
        const count = split(body.slice(start + 1, matching(body, start))).length;
        assert.ok(!arity.has(member[1]), `${member[1]} has two contract declarations`);
        arity.set(member[1], count);
      }
    }
  }
  return arity;
}

type Forwarding = { name: string; parameters: string[]; forwarded: string[] | 'all' };

function preloadForwarding(source: string): Forwarding[] {
  const entries = [...source.matchAll(/^ {2}(\w+): \(?\(/gm)];
  return entries.flatMap((entry, index) => {
    const end = entries[index + 1]?.index ?? source.length;
    const text = source.slice(entry.index, end);
    const invoke = text.indexOf('ipcRenderer.invoke(');
    if (invoke < 0) return [];
    const open = entry[0].length - 1;
    const parameters = split(text.slice(open + 1, matching(text, open)));
    const call = invoke + 'ipcRenderer.invoke'.length;
    const [, ...forwarded] = split(text.slice(call + 1, matching(text, call)));
    const spread = forwarded.length === 1 && forwarded[0].startsWith('...');
    return [{ name: entry[1], parameters, forwarded: spread ? 'all' : forwarded }];
  });
}

function mismatches(arity: Map<string, number>, methods: Forwarding[]): string[] {
  return methods.flatMap(({ name, parameters, forwarded }) => {
    const declared = arity.get(name);
    if (declared === undefined) return [`${name} has no contract declaration`];
    if (forwarded === 'all')
      return parameters.length === 1 && parameters[0].startsWith('...')
        ? []
        : [`${name} must take rest arguments`];
    if (parameters.length !== declared)
      return [`${name} takes ${parameters.length} of ${declared} arguments`];
    if (forwarded.join() !== parameters.join()) return [`${name} must forward its arguments`];
    return [];
  });
}

test('preload methods forward every argument that the contract declares', async () => {
  const arity = await contractArity();
  const methods = preloadForwarding(await readFile(join(root, 'electron/preload.ts'), 'utf8'));
  assert.ok(methods.length > 100, 'The parser must find the preload methods');
  assert.deepEqual(mismatches(arity, methods), []);
});

test('the check finds a preload method that drops arguments', async () => {
  const arity = await contractArity();
  const source = `const api: API = {
  createGroup: (name, url, hostId, provider, rootPath) =>
    ipcRenderer.invoke('group-create', name, url, hostId, provider, rootPath),
  updateGroup: (id, name) => ipcRenderer.invoke('group-update', id),
  docsList: (...args) => ipcRenderer.invoke('docs-list', ...args),
};`;
  assert.deepEqual(mismatches(arity, preloadForwarding(source)), [
    'createGroup takes 5 of 7 arguments',
    'updateGroup must forward its arguments',
  ]);
});
