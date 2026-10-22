import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
const root = process.cwd();
const failures = [];
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await visit(file);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const name = relative(root, file);
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      const target = specifier.startsWith('.')
        ? relative(root, resolve(dirname(file), specifier))
        : specifier;
      if (target === 'electron' || target.startsWith('electron/') || target.startsWith('node:'))
        failures.push(`${name}: renderer/domain imports privileged module ${specifier}`);
      if (
        name.startsWith('src/domain/') &&
        !target.startsWith('src/domain/') &&
        !target.startsWith('src/config/')
      )
        failures.push(`${name}: domain depends on application module ${specifier}`);
      if (name.startsWith('src/components/') && target.startsWith('src/app'))
        failures.push(`${name}: component depends on application composition`);
    }
  }
}
await visit(resolve(root, 'src'));

// Every class in the app style sheets must be used in the renderer, the desktop code or
// index.html. A class that only a library adds to the DOM goes in this list.
const libraryClasses = new Set([
  // The Tiptap placeholder extension and the table extension add these classes.
  'is-editor-empty',
  'selectedCell',
]);
async function sourceFiles(directory, pattern, out = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) await sourceFiles(file, pattern, out);
    else if (pattern.test(file)) out.push(file);
  }
  return out;
}
const styleSheets = await sourceFiles(resolve(root, 'src'), /\.css$/);
const codeFiles = [
  ...(await sourceFiles(resolve(root, 'src'), /\.(ts|tsx)$/)),
  ...(await sourceFiles(resolve(root, 'electron'), /\.(ts|tsx|mjs|js|html)$/)),
  resolve(root, 'index.html'),
];
const code = (await Promise.all(codeFiles.map((file) => readFile(file, 'utf8')))).join('\n');
const used = new Set(code.match(/[A-Za-z_][\w-]*/g));
const reported = new Set();
for (const file of styleSheets) {
  const source = (await readFile(file, 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/url\([^)]*\)/g, '')
    .replace(/'[^']*'|"[^"]*"/g, '""');
  for (const rule of source.matchAll(/([^{};]+)\{/g)) {
    const selector = rule[1].trim();
    if (selector.startsWith('@')) continue;
    for (const match of selector.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) {
      const name = match[1];
      if (used.has(name) || libraryClasses.has(name) || reported.has(name)) continue;
      reported.add(name);
      failures.push(`${relative(root, file)}: .${name} is not used. Remove the rule.`);
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    'Architecture boundaries passed: domain, UI, and privileged desktop code are separated, and' +
      ' every style sheet class is used.',
  );
