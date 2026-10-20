import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const query = (query) => {
  const value = JSON.parse(
    execFileSync('gh', ['api', '--hostname', 'github.com', 'graphql', '--input', '-'], {
      input: JSON.stringify({ query }),
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      timeout: 30000,
    }),
  );
  if (value.errors) throw new Error('GitHub output schema query failed.');
  return value.data;
};
const names = query('{__schema{types{name kind}}}')
  .__schema.types.filter(
    (type) =>
      type.name.startsWith('ProjectV2') &&
      ['OBJECT', 'INTERFACE', 'UNION', 'ENUM'].includes(type.kind),
  )
  .map((type) => type.name)
  .sort();
const ref = (depth) => (depth ? `kind name ofType{${ref(depth - 1)}}` : 'kind name');
const types = {};
for (let offset = 0; offset < names.length; offset += 2) {
  const batch = names.slice(offset, offset + 2);
  const data = query(
    `{${batch.map((name, i) => `t${i}:__type(name:${JSON.stringify(name)}){name kind fields(includeDeprecated:true){name isDeprecated deprecationReason args{name defaultValue type{${ref(5)}}} type{${ref(5)}}} possibleTypes{name kind} enumValues(includeDeprecated:true){name isDeprecated deprecationReason}}`).join(' ')}}`,
  );
  for (const type of Object.values(data)) {
    if (!type) throw new Error('Incomplete output schema.');
    types[type.name] = type;
  }
}
const value = { host: 'github.com', types };
const text =
  JSON.stringify(
    { ...value, sha256: createHash('sha256').update(JSON.stringify(value)).digest('hex') },
    null,
    2,
  ) + '\n';
const file = new URL('../src/config/github-projects-outputs.json', import.meta.url);
if (process.argv.includes('--check')) {
  if (JSON.stringify(JSON.parse(readFileSync(file, 'utf8'))) !== JSON.stringify(JSON.parse(text))) {
    mkdirSync(new URL('../ci-results/', import.meta.url), { recursive: true });
    writeFileSync(
      new URL('../ci-results/github-projects-outputs.next.json', import.meta.url),
      text,
    );
    throw new Error('GitHub Projects outputs changed. Review the comparison artifact.');
  }
} else writeFileSync(file, text);
console.log(`Pinned ${names.length} Projects output types.`);
