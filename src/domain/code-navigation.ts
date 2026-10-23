/** Go to file and go to symbol for the code editor. */

export interface FileMatch {
  path: string;
  name: string;
  folder: string;
  /** The matched characters of the name: [start, end). Null when only the folder matched. */
  range: [number, number] | null;
  score: number;
}

export function splitPath(path: string) {
  const index = path.lastIndexOf('/');
  return { name: path.slice(index + 1), folder: index < 0 ? '' : path.slice(0, index) };
}

function subsequence(text: string, query: string) {
  let at = 0;
  for (const char of text) if (char === query[at]) at += 1;
  return at === query.length;
}

/**
 * The files that match the query, best first. A match at the start of the name is best, then a
 * match in the name, then in the folder, then the letters in order. Shorter paths win a tie.
 */
export function matchFiles(files: readonly string[], value: string, limit = 50): FileMatch[] {
  const query = value.trim().toLowerCase();
  const matches: FileMatch[] = [];
  for (const path of files) {
    const { name, folder } = splitPath(path);
    const lowerName = name.toLowerCase();
    let score: number;
    let range: [number, number] | null = null;
    if (!query) score = 0;
    else {
      const index = lowerName.indexOf(query);
      if (index === 0) score = 0;
      else if (index > 0) score = 1;
      else if (path.toLowerCase().includes(query)) score = 2;
      else if (subsequence(query.includes('/') ? path.toLowerCase() : lowerName, query)) score = 3;
      else continue;
      if (index >= 0) range = [index, index + query.length];
    }
    matches.push({ path, name, folder, range, score });
  }
  matches.sort(
    (a, b) => a.score - b.score || a.path.length - b.path.length || a.path.localeCompare(b.path),
  );
  return matches.slice(0, limit);
}

export type SymbolKind = 'function' | 'class' | 'method' | 'variable' | 'type' | 'test' | 'heading';

export interface CodeSymbol {
  name: string;
  kind: SymbolKind;
  /** 1-based. */
  line: number;
}

const notMethods = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'function',
  'with',
  'else',
  'do',
  'try',
  'await',
  'typeof',
  'new',
]);

const patterns: { kind: SymbolKind; pattern: RegExp }[] = [
  // JavaScript and TypeScript.
  {
    kind: 'function',
    pattern: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  },
  {
    kind: 'class',
    pattern: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  },
  {
    kind: 'type',
    pattern: /^\s*(?:export\s+)?(?:declare\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
  },
  {
    kind: 'variable',
    pattern: /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[=:]/,
  },
  { kind: 'test', pattern: /^\s*(?:test|it|describe)(?:\.\w+)*\(\s*(['"`])(.+?)\1/ },
  {
    kind: 'method',
    pattern:
      /^\s+(?:(?:public|private|protected|static|readonly|override|async|get|set)\s+)*\*?([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*(?::\s*[^{=]+)?\{\s*$/,
  },
  // Python, Go and Rust.
  { kind: 'function', pattern: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/ },
  { kind: 'function', pattern: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/ },
  { kind: 'function', pattern: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/ },
  {
    kind: 'type',
    pattern: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|impl)\s+([A-Za-z_][\w<>]*)/,
  },
  { kind: 'type', pattern: /^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/ },
];

/** The symbols of a file from simple line patterns. Markdown files give their headings. */
export function fileSymbols(text: string, path = ''): CodeSymbol[] {
  const lines = text.split('\n');
  const symbols: CodeSymbol[] = [];
  const markdown = /\.(md|markdown|mdx)$/i.test(path);
  let fence = false;
  lines.forEach((line, index) => {
    if (markdown) {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence;
      const heading = !fence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (heading) symbols.push({ name: heading[2], kind: 'heading', line: index + 1 });
      return;
    }
    for (const { kind, pattern } of patterns) {
      const match = pattern.exec(line);
      if (!match) continue;
      const name = kind === 'test' ? match[2] : match[1];
      if (kind === 'method' && notMethods.has(name)) continue;
      symbols.push({ name, kind, line: index + 1 });
      break;
    }
  });
  return symbols;
}

/** The symbols whose name has the query, in file order. */
export function matchSymbols(symbols: readonly CodeSymbol[], value: string) {
  const query = value.trim().toLowerCase();
  if (!query) return [...symbols];
  return symbols.filter((symbol) => symbol.name.toLowerCase().includes(query));
}
