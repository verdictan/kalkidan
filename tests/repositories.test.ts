import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cloneRepository, listRepositories, repositoryName } from '../electron/repositories';

test('repository discovery includes every REST page, private org repos and archived repos', async () => {
  const pages = [
    Array.from({ length: 100 }, (_, i) => ({ full_name: `me/repo-${i}`, private: false })),
    Array.from({ length: 100 }, (_, i) => ({ full_name: `org/repo-${i}`, private: true })),
    [
      { full_name: 'verdictan/work', private: true, archived: false },
      { full_name: 'org/archive', private: true, archived: true },
      { full_name: 'me/repo-0', private: false },
    ],
  ];
  const rows = await listRepositories(
    (async (_file: string, args: string[]) => {
      assert.ok(args.includes('--paginate'));
      assert.ok(args.includes('--slurp'));
      assert.match(args.at(-1)!, /affiliation=owner,collaborator,organization_member/);
      return { stdout: JSON.stringify(pages), stderr: '' };
    }) as any,
    async () => 'gh',
  );
  assert.equal(rows.length, 202);
  assert.equal(rows.find((r) => r.nameWithOwner === 'verdictan/work')?.isPrivate, true);
  assert.equal(rows.find((r) => r.nameWithOwner === 'org/archive')?.isArchived, true);
  for (const value of [
    '--help',
    'owner/..',
    'https://evil.com/repo',
    'owner/repo;rm',
    'owner/repo/extra',
  ])
    assert.throws(() => repositoryName(value));
});
test('repository discovery rejects failed pagination instead of showing a partial list', async () => {
  await assert.rejects(
    listRepositories(
      (async () => {
        throw new Error('failed on page 2');
      }) as any,
      async () => 'gh',
    ),
    /Could not load all/,
  );
});
test('clone reserves a new destination and passes repository and spaced paths as separate arguments', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-clone-'));
  try {
    const destination = join(root, "repo with ' quotes");
    const calls: any[] = [];
    await cloneRepository(
      'owner/repository',
      destination,
      (async (...args: any[]) => {
        calls.push(args);
        return { stdout: '', stderr: '' };
      }) as any,
      async () => '/opt/homebrew/bin/gh',
    );
    assert.deepEqual(calls[0][1], [
      'repo',
      'clone',
      'https://github.com/owner/repository',
      destination,
    ]);
    assert.equal(calls[0][2].env.GIT_TERMINAL_PROMPT, '0');
    await writeFile(join(destination, 'keep'), 'existing files');
    await assert.rejects(
      cloneRepository(
        'owner/repository',
        destination,
        (async () => {
          throw new Error('Must not run');
        }) as any,
        async () => 'gh',
      ),
      /already exists/,
    );
    assert.equal(await readFile(join(destination, 'keep'), 'utf8'), 'existing files');
    const partial = join(root, 'partial');
    await assert.rejects(
      cloneRepository(
        'owner/repository',
        partial,
        (async () => {
          await mkdir(join(partial, '.git'));
          throw new Error('network');
        }) as any,
        async () => 'gh',
      ),
      /downloaded files remain/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
