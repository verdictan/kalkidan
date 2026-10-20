import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const source =
  'https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json';
const response = await fetch(source, { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error('Cannot read the GitHub OpenAPI description.');
const api = await response.json();
const paths = Object.fromEntries(
  Object.entries(api.paths).filter(([path]) => path.includes('/projectsV2')),
);
const components = {};
const pending = [];
function collect(value) {
  if (!value || typeof value !== 'object') return;
  if (value.$ref) pending.push(value.$ref);
  for (const child of Object.values(value)) collect(child);
}
collect(paths);
const seen = new Set();
while (pending.length) {
  const ref = pending.pop();
  if (seen.has(ref)) continue;
  seen.add(ref);
  const parts = ref.split('/');
  if (parts.length !== 4 || parts[0] !== '#' || parts[1] !== 'components')
    throw new Error('Unexpected OpenAPI reference.');
  const [, , kind, name] = parts;
  const value = api.components[kind]?.[name];
  if (!value) throw new Error('Unresolved OpenAPI reference.');
  (components[kind] ||= {})[name] = value;
  collect(value);
}
const value = { source, version: api.info.version, paths, components };
const text =
  JSON.stringify(
    { ...value, sha256: createHash('sha256').update(JSON.stringify(value)).digest('hex') },
    null,
    2,
  ) + '\n';
const file = new URL('../src/config/github-projects-rest.json', import.meta.url);
if (process.argv.includes('--check')) {
  if (
    JSON.stringify(JSON.parse(await readFile(file, 'utf8'))) !== JSON.stringify(JSON.parse(text))
  ) {
    await mkdir(new URL('../ci-results/', import.meta.url), { recursive: true });
    await writeFile(new URL('../ci-results/github-projects-rest.next.json', import.meta.url), text);
    throw new Error('GitHub Projects REST changed. Review the comparison artifact.');
  }
} else await writeFile(file, text);
console.log(`Pinned ${Object.keys(paths).length} Projects REST paths.`);
