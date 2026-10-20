import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { backendLoader } from './helpers/backend-loader';
test('one GitHub operation freezes its credential across permission reads and writes', async () => {
  let token = 'first-token';
  const used: string[] = [];
  const load = backendLoader({
    'node:fs/promises': { access: async () => {} },
    [resolve('electron/core.ts')]: {
      exec: (_path: string, args: string[], options: any) => {
        if (args[0] === 'auth') return Promise.resolve({ stdout: token });
        used.push(options.env.GH_TOKEN);
        token = 'second-token';
        return Object.assign(
          Promise.resolve({ stdout: JSON.stringify({ data: { result: true } }) }),
          { child: { stdin: { on: () => {}, end: () => {} } } },
        );
      },
    },
  });
  const { GitHubProjects, githubGraphQL } = load(resolve('electron/github-projects.ts'));
  const service = new GitHubProjects();
  await service.withAccount(async () => {
    await githubGraphQL('query{viewer{login}}', {});
    await githubGraphQL('mutation{example(input:{}){id}}', {});
  });
  assert.deepEqual(used, ['first-token', 'first-token']);
  await service.withAccount(() => githubGraphQL('query{viewer{login}}', {}));
  assert.deepEqual(used, ['first-token', 'first-token', 'second-token']);
});
