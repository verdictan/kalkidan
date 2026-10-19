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
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    'Architecture boundaries passed: domain, UI, and privileged desktop code are separated.',
  );
