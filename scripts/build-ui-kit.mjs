// Build the UI kit in src/components/ui as a small package in dist-ui/.
// The design sync reads this package: an ES module, its .d.ts files and a package.json.
import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'dist-ui');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  entryPoints: [resolve(root, 'src/components/ui/index.ts')],
  outfile: resolve(out, 'index.js'),
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  // npm packages stay as imports. The consumer bundles them once, with one copy of React.
  packages: 'external',
  alias: { '@': resolve(root, 'src') },
  logLevel: 'warning',
});

execFileSync(
  process.execPath,
  [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', resolve(root, 'tsconfig.ui.json')],
  { stdio: 'inherit' },
);

await writeFile(
  resolve(out, 'package.json'),
  `${JSON.stringify(
    {
      name: '@kalkidan/ui',
      private: true,
      type: 'module',
      module: 'index.js',
      types: 'types/components/ui/index.d.ts',
    },
    null,
    2,
  )}\n`,
);
console.log('UI kit built in dist-ui/.');
