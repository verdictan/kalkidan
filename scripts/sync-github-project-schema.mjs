import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const file = new URL('../src/config/github-projects-schema.json', import.meta.url);
const query = (query) => {
  const result = JSON.parse(
    execFileSync('gh', ['api', '--hostname', 'github.com', 'graphql', '--input', '-'], {
      input: JSON.stringify({ query }),
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      timeout: 30000,
    }),
  );
  if (result.errors) throw Error('GitHub schema query failed.');
  return result.data;
};
const ref = (depth) => (depth ? `kind name ofType{${ref(depth - 1)}}` : 'kind name');
const mutations = query(
  `{__type(name:"Mutation"){fields(includeDeprecated:true){name isDeprecated deprecationReason args{name type{${ref(5)}}}}}}`,
)
  .__type.fields.filter((f) =>
    /ProjectV2|^(add|remove)BlockedBy$|^(add|remove|reprioritize)SubIssue$|^(updateIssue|updatePullRequest|closeIssue|reopenIssue|closePullRequest|reopenPullRequest|addComment|addAssigneesToAssignable|removeAssigneesFromAssignable|addLabelsToLabelable|removeLabelsFromLabelable|requestReviews|addPullRequestReview)$/.test(
      f.name,
    ),
  )
  .sort((a, b) => a.name.localeCompare(b.name));
const base = (type) => (type.ofType ? base(type.ofType) : type);
const types = {},
  pending = new Set(mutations.map((m) => base(m.args.find((a) => a.name === 'input').type).name));
for (let batch = 0; pending.size && batch < 100; batch++) {
  const names = [...pending].sort().slice(0, 2);
  for (const name of names) pending.delete(name);
  const data = query(
    `{${names.map((name, index) => `t${index}:__type(name:${JSON.stringify(name)}){name kind inputFields{name defaultValue description type{${ref(5)}}} enumValues(includeDeprecated:true){name isDeprecated}}`).join('\n')}}`,
  );
  for (const type of Object.values(data)) {
    if (!type) throw Error('Incomplete schema response');
    types[type.name] = type;
    for (const field of type.inputFields || []) {
      const child = base(field.type);
      if (['INPUT_OBJECT', 'ENUM'].includes(child.kind) && !types[child.name])
        pending.add(child.name);
    }
  }
}
if (pending.size) throw Error('Schema depth exceeds supported bound');
const schema = {
  host: 'github.com',
  mutations,
  types: Object.fromEntries(Object.entries(types).sort(([a], [b]) => a.localeCompare(b))),
};
const text =
  JSON.stringify(
    { ...schema, sha256: createHash('sha256').update(JSON.stringify(schema)).digest('hex') },
    null,
    2,
  ) + '\n';
if (process.argv.includes('--check')) {
  if (JSON.stringify(JSON.parse(readFileSync(file, 'utf8'))) !== JSON.stringify(JSON.parse(text))) {
    mkdirSync(new URL('../ci-results/', import.meta.url), { recursive: true });
    writeFileSync(new URL('../ci-results/github-projects-schema.next.json', import.meta.url), text);
    throw Error('GitHub Projects schema changed. Review the schema comparison artifact.');
  }
} else writeFileSync(file, text);
console.log(
  `GitHub Projects schema: ${mutations.length} mutations; ${Object.keys(types).length} input/enum types`,
);
