// Copies the shared Verdictan contracts into contracts/verdictan and records their source.
// Verdictan cli/docs/contracts is the source of truth. Do not edit the copy by hand.
// Usage: node scripts/sync-verdictan-contracts.mjs <Verdictan checkout>
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const checkout = process.argv[2];
if (!checkout) {
  console.error('Usage: node scripts/sync-verdictan-contracts.mjs <Verdictan checkout>');
  process.exit(2);
}
const source = resolve(checkout, 'cli/docs/contracts');
const target = resolve('contracts/verdictan');
const windowName = 'desktop-support-window.v1.json';
const window = JSON.parse(await readFile(join(source, windowName), 'utf8'));
const names = new Set([windowName, 'desktop-support-window.v1.schema.json']);
for (const version of window.protocol.versions)
  for (const contract of version.contracts) {
    names.add(contract.schema);
    for (const fixture of contract.fixtures) names.add(fixture.file);
  }
names.add(window.runtime.capabilities_fixture);
// A release whose contracts differ from the current files keeps a snapshot directory.
for (const entry of window.runtime.versions)
  if (entry.snapshot)
    for (const name of [...names].filter((value) => !value.startsWith('desktop-support-window')))
      names.add(entry.snapshot + name);
const git = (...args) =>
  execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8' }).trim();
if (git('status', '--porcelain', '--', 'cli/docs/contracts'))
  throw new Error('Commit the Verdictan contract changes before the sync.');
await rm(target, { recursive: true, force: true });
const files = {};
for (const name of [...names].sort()) {
  const bytes = await readFile(join(source, name));
  await mkdir(dirname(join(target, name)), { recursive: true });
  await writeFile(join(target, name), bytes);
  files[name] = createHash('sha256').update(bytes).digest('hex');
}
const record = {
  repository: 'verdictan/work',
  path: 'cli/docs/contracts',
  commit: git('rev-parse', 'HEAD'),
  files,
};
await writeFile(join(target, 'source.json'), JSON.stringify(record, null, 2) + '\n');
console.log(`Copied ${names.size} files from Verdictan ${record.commit.slice(0, 12)}.`);
