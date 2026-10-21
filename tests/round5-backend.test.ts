import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectDocs } from '../electron/storage/project-docs';
import { ManagedMemory, projectMemory } from '../electron/storage/managed-memory';
import { readProjectMemory } from '../electron/storage/project-memory';
import { GitHubMutationJournal, journalDetail } from '../electron/trackers/github-journal';
import { GitHubProjects } from '../electron/github-projects';
import { canRevertMutation, mutationLabel, mutationStateLabels } from '../src/domain/project-batch';
import { closesIssue } from '../src/domain/github-content';
import {
  claudeSubscriptionRecovery,
  managedErrorCode,
  managedErrorInfo,
  managedErrorText,
  withoutManagedCode,
} from '../src/domain/verdictan';
import { DesktopProtocolError } from '../electron/verdictan/protocol';
import { normalizeChatFailure } from '../electron/chat';
import type { ChatRun } from '../src/domain/conversation';

async function temporary(t: any, prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('docs search lists passages with short heading snippets and a limit', async (t) => {
  const root = await temporary(t, 'docs-search-');
  const docs = new ProjectDocs(root, (id) => id === 'atlas');
  const page = await docs.create('atlas', 'Release guide', null);
  await docs.save('atlas', {
    ...page,
    markdown:
      '# Overview\n\nThe release train leaves on Friday.\n\n## Rollback\n\n' +
      'If the deploy fails, ' +
      'run the rollback script. '.repeat(40) +
      '\n',
  });
  const passages = await docs.search('atlas', 'rollback', 10);
  assert.ok(passages.length >= 1);
  assert.equal(passages[0].heading, 'Rollback');
  assert.ok(passages[0].excerpt.length <= 242, String(passages[0].excerpt.length));
  assert.match(passages[0].excerpt, /rollback/i);
  assert.equal((await docs.search('atlas', 'rollback', 1)).length, 1);
  await assert.rejects(docs.search('atlas', 'rollback', 0), /from 1 to 50/);
  // Without a limit, search keeps the agent context budget.
  assert.ok((await docs.search('atlas', 'rollback')).length <= 3);
  assert.deepEqual(await docs.search('atlas', 'the'), []);
});

test('task-to-doc links persist in the docs folder, skip deleted pages and reject bad input', async (t) => {
  const root = await temporary(t, 'docs-links-');
  const docs = new ProjectDocs(root, (id) => id === 'atlas');
  const a = await docs.create('atlas', 'A', null);
  const b = await docs.create('atlas', 'B', null);
  assert.deepEqual(await docs.taskLinks('atlas'), {});
  await docs.setTaskLinks('atlas', 'PVTI_1', [a.id, b.id, a.id]);
  await docs.setTaskLinks('atlas', 'PVTI_2', [b.id]);
  const file = JSON.parse(await readFile(join(root, 'atlas', '.task-links.json'), 'utf8'));
  assert.deepEqual(file, { version: 1, links: { PVTI_1: [a.id, b.id], PVTI_2: [b.id] } });
  // A second store reads the same file, as another window or host would.
  const other = new ProjectDocs(root, () => true);
  assert.deepEqual(await other.taskLinks('atlas'), { PVTI_1: [a.id, b.id], PVTI_2: [b.id] });
  await docs.delete('atlas', b.id, (await docs.get('atlas', b.id)).revision);
  assert.deepEqual(await docs.taskLinks('atlas'), { PVTI_1: [a.id] });
  await docs.setTaskLinks('atlas', 'PVTI_1', []);
  assert.deepEqual(await docs.taskLinks('atlas'), {});
  // Links are not pages. The page list and search skip the file.
  assert.equal((await docs.list('atlas')).length, 1);
  assert.throws(() => docs.setTaskLinks('atlas', '__proto__', [a.id]), /Invalid task ID/);
  assert.throws(() => docs.setTaskLinks('atlas', 'x', ['../escape']), /up to 50 pages/);
  assert.throws(
    () =>
      docs.setTaskLinks(
        'atlas',
        'x',
        Array.from({ length: 51 }, (_, index) => 'p' + index),
      ),
    /up to 50 pages/,
  );
  // Concurrent writes to different tasks do not lose each other.
  await Promise.all(
    Array.from({ length: 10 }, (_, index) => docs.setTaskLinks('atlas', 'T' + index, [a.id])),
  );
  assert.equal(Object.keys(await docs.taskLinks('atlas')).length, 10);
  assert.deepEqual(
    (await readdir(join(root, 'atlas'))).filter((name) => name.endsWith('.tmp')),
    [],
  );
});

test('memory entries show their source and forget moves an entry out of agent use', async (t) => {
  const root = await temporary(t, 'memory-forget-');
  const sources = [{ id: 'user', text: 'Use npm test.\nUse pnpm.' }];
  const writer = new ManagedMemory(
    { root, sessionId: 'session-1', turnId: 'turn-1', sources: () => sources },
    () => {},
    () => '2026-10-21T10:00:00.000Z',
  );
  const saved = await writer.upsert({
    topic: 'Tests',
    content: 'Use npm test.',
    references: [{ id: 'user', quote: 'Use npm test.' }],
  });
  assert.equal(saved.status, 'saved');
  const changes: string[] = [];
  const memory = projectMemory(root, () => changes.push('changed'));
  const [entry] = await memory.list();
  assert.equal(entry.source.sessionId, 'session-1');
  assert.equal((await memory.search('npm test')).length, 1);
  await assert.rejects(memory.forget(entry.id, 'f'.repeat(64)), /changed/);
  await assert.rejects(memory.forget('0'.repeat(64), entry.revision), /not found/);
  await assert.rejects(memory.forget('../x', entry.revision), /Invalid memory entry/);
  await memory.forget(entry.id, entry.revision);
  assert.deepEqual(changes, ['changed']);
  assert.deepEqual(await memory.list(), []);
  assert.deepEqual(await memory.search('npm test'), []);
  assert.deepEqual((await readProjectMemory(root)).pages, []);
  const archive = join(root, 'memory', '.forgotten');
  const log = JSON.parse(await readFile(join(archive, 'log.json'), 'utf8'));
  assert.equal(log.length, 1);
  assert.equal(log[0].id, entry.id);
  assert.equal(log[0].sessionId, 'session-1');
  assert.match(await readFile(join(archive, log[0].file), 'utf8'), /Use npm test\./);
  const index = JSON.parse(await readFile(join(root, 'memory', '.managed-index.json'), 'utf8'));
  assert.equal(index[entry.id], undefined);
  // A legacy file without metadata can also be forgotten.
  await writeFile(join(root, 'memory', 'notes.md'), 'Old note');
  const [legacy] = await memory.list();
  assert.equal(legacy.provenance, 'legacy');
  await memory.forget(legacy.id, legacy.revision);
  assert.deepEqual(await memory.list(), []);
});

test('the journal keeps the item, field and earlier value of a write, and links reverts', async (t) => {
  const root = await temporary(t, 'journal-detail-');
  const journal = new GitHubMutationJournal(root, 'P', () => {});
  await journalDetail.run({ before: { number: 1 } }, () =>
    journal.run(
      'updateProjectV2ItemFieldValue',
      {
        query: 'mutation',
        variables: { input: { projectId: 'P', itemId: 'I', fieldId: 'F', value: { number: 2 } } },
      },
      async () => true,
    ),
  );
  await journalDetail.run({ itemId: 'I' }, () =>
    journal.run(
      'addComment',
      { query: 'mutation', variables: { input: { subjectId: 'C', body: 'secret body' } } },
      async () => true,
    ),
  );
  await journal.run(
    'updateProjectV2ItemFieldValue',
    { variables: { input: { itemId: 'I', fieldId: 'T', value: { text: 'x'.repeat(5000) } } } },
    async () => true,
  );
  const [field, comment, large] = await journal.list();
  assert.deepEqual(field.detail, {
    itemId: 'I',
    fieldId: 'F',
    before: { number: 1 },
    value: { number: 2 },
  });
  assert.ok(canRevertMutation(field));
  assert.deepEqual(comment.detail, { itemId: 'I' });
  assert.equal(canRevertMutation(comment), false);
  // Without a known earlier value, the write is not revertible.
  assert.deepEqual(large.detail, { itemId: 'I', fieldId: 'T' });
  assert.equal(canRevertMutation(large), false);
  const text = await readFile(join(root, (await readdir(root))[0]), 'utf8');
  assert.equal(text.includes('secret body'), false);
  await journal.markReverted(field.id, 'later');
  assert.equal((await journal.find(field.id))?.revertedBy, 'later');
  assert.equal(canRevertMutation((await journal.find(field.id))!), false);
});

test('write history labels use plain words', () => {
  assert.equal(mutationLabel({ operation: 'addComment' }), 'Comment added');
  assert.equal(mutationLabel({ operation: 'updateStatus' }), 'Status changed');
  assert.equal(mutationLabel({ operation: 'someNewMutation' }), 'Some new mutation');
  assert.equal(
    mutationLabel({ operation: 'updateProjectV2ItemFieldValue', detail: { revertOf: 'x' } }),
    'Change reverted',
  );
  assert.equal(mutationStateLabels['unknown-outcome'], 'Result not confirmed');
});

test('revert writes the earlier value as a batch and refuses a second revert', async (t) => {
  const root = await temporary(t, 'journal-revert-');
  const id = randomUUID();
  await writeFile(
    join(root, `journal-${createHash('sha256').update('P').digest('hex')}.json`),
    JSON.stringify([
      {
        id,
        signature: 's',
        operation: 'updateProjectV2ItemFieldValue',
        state: 'confirmed',
        updatedAt: 1,
        detail: { itemId: 'I', fieldId: 'F', before: null, value: { number: 2 } },
      },
      {
        id: randomUUID(),
        signature: 't',
        operation: 'addComment',
        state: 'confirmed',
        updatedAt: 2,
      },
    ]),
  );
  const fields = {
    nodes: [{ id: 'F', name: 'Estimate', dataType: 'NUMBER' }],
    pageInfo: { hasNextPage: false },
  };
  let current: number | null = 2;
  const mutations: string[] = [];
  const service = new GitHubProjects(
    async (query, variables: any) => {
      if (query.startsWith('mutation')) {
        mutations.push(query);
        current = null;
        const name = /\{(\w+)\(input/.exec(query)![1];
        assert.deepEqual(variables.input, { projectId: 'P', itemId: 'I', fieldId: 'F' });
        return { [name]: { projectV2Item: { id: 'I' } } };
      }
      if (query.includes('project:node'))
        return {
          project: { id: 'P', viewerCanUpdate: true, fields },
          item: { id: 'I', project: { id: 'P' } },
        };
      return {
        node: {
          id: 'I',
          isArchived: false,
          project: { id: 'P', viewerCanUpdate: true, fields },
          fieldValues: {
            nodes: current === null ? [] : [{ number: current, field: { id: 'F', name: 'E' } }],
            pageInfo: { hasNextPage: false },
          },
        },
      };
    },
    async () => 'test',
    root,
  );
  const project = {
    id: 'P',
    title: 'P',
    owner: 'org',
    number: 1,
    url: 'https://github.com/orgs/org/projects/1',
  };
  const history = await service.mutationHistory(project);
  await assert.rejects(service.revertMutation(project, history[1].id), /Only confirmed field/);
  await assert.rejects(service.revertMutation(project, 'bad'), /Invalid operation ID/);
  const revertId = await service.revertMutation(project, id);
  assert.match(revertId, /^[a-f0-9-]{36}$/);
  assert.equal(mutations.length, 1);
  assert.match(mutations[0], /clearProjectV2ItemFieldValue/);
  const after = await service.mutationHistory(project);
  assert.equal(after.find((row) => row.id === id)?.revertedBy, revertId);
  await assert.rejects(service.revertMutation(project, id), /already reverted/);
});

test('revert reports a conflict when the field changed after the write', async (t) => {
  const root = await temporary(t, 'journal-conflict-');
  const id = randomUUID();
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, `journal-${createHash('sha256').update('P').digest('hex')}.json`),
    JSON.stringify([
      {
        id,
        signature: 's',
        operation: 'updateProjectV2ItemFieldValue',
        state: 'confirmed',
        updatedAt: 1,
        detail: { itemId: 'I', fieldId: 'F', before: { number: 1 }, value: { number: 2 } },
      },
    ]),
  );
  const fields = {
    nodes: [{ id: 'F', name: 'Estimate', dataType: 'NUMBER' }],
    pageInfo: { hasNextPage: false },
  };
  const service = new GitHubProjects(
    async (query) => {
      if (query.startsWith('mutation')) throw new Error('No write expected');
      return {
        node: {
          id: 'I',
          isArchived: false,
          project: { id: 'P', viewerCanUpdate: true, fields },
          fieldValues: {
            nodes: [{ number: 5, field: { id: 'F', name: 'E' } }],
            pageInfo: { hasNextPage: false },
          },
        },
      };
    },
    async () => 'test',
    root,
  );
  await assert.rejects(
    service.revertMutation(
      {
        id: 'P',
        title: 'P',
        owner: 'org',
        number: 1,
        url: 'https://github.com/orgs/org/projects/1',
      },
      id,
    ),
    /changed after this write/,
  );
});

test('closing keywords in a pull request body name the issue', () => {
  const issue = { owner: 'acme', repository: 'web', number: 12 };
  assert.ok(closesIssue('Closes acme/web#12', issue));
  assert.ok(closesIssue('This work.\n\nfixes #12.', issue));
  assert.ok(closesIssue('Resolves: https://github.com/acme/web/issues/12', issue));
  assert.equal(closesIssue('Closes acme/web#123', issue), false);
  assert.equal(closesIssue('Closes other/web#12', issue), false);
  assert.equal(closesIssue('Mentions #12', issue), false);
  assert.equal(closesIssue('Closes #12', { number: undefined }), false);
});

test('managed agent errors keep a stable code and show plain words', () => {
  const error = new DesktopProtocolError('desktop.runtime_missing');
  assert.equal(error.code, 'desktop.runtime_missing');
  assert.match(error.message, /^Managed agents are not set up\..*\[desktop\.runtime_missing\]$/);
  assert.equal(managedErrorCode('Error: ' + error.message), 'desktop.runtime_missing');
  assert.equal(managedErrorInfo('desktop.runtime_missing').section, 'managed-agents');
  assert.equal(managedErrorInfo('desktop.transport_lost').retry, true);
  assert.match(managedErrorText('desktop.made_up'), /Check the setup in Settings/);
  assert.equal(withoutManagedCode(error.message).includes('desktop.'), false);
  const run = { agent: 'codex', error: 'desktop.gateway_failed' } as ChatRun;
  normalizeChatFailure(run);
  assert.equal(run.errorCode, 'desktop.gateway_failed');
  assert.equal(
    run.error,
    'The connection to managed agents stopped. Try again. [desktop.gateway_failed]',
  );
  const busy = { agent: 'codex', error: 'already has an active writer' } as ChatRun;
  normalizeChatFailure(busy);
  assert.equal(busy.errorCode, 'session_busy');
});

test('setup and account pass through display names only when the service sends them', async () => {
  const { VerdictanSetupService } = await import('../electron/verdictan/setup');
  const { parseAccount } = await import('../electron/verdictan/account');
  const origin = 'https://api.verdictan.com';
  const account = {
    state: 'authenticated',
    api_url: origin,
    user_id: 'u',
    organization_id: 'o',
    expires_at: '2030-01-01T00:00:00Z',
  };
  assert.equal(parseAccount(account, origin).organizationName, undefined);
  const named = parseAccount(
    { ...account, organization_name: 'Acme', user_email: 'dev@example.com' },
    origin,
  );
  assert.equal(named.organizationName, 'Acme');
  assert.equal(named.userEmail, 'dev@example.com');
  const team = '11111111-1111-4111-8111-111111111111';
  const connection = '22222222-2222-4222-8222-222222222222';
  const setup = (extra: Record<string, unknown>, rows: Record<string, unknown> = {}) =>
    new VerdictanSetupService(
      async () =>
        ({
          request: async (operation: string) => ({
            data:
              operation === 'status'
                ? account
                : {
                    schema_version: 1,
                    org_id: 'o',
                    user_id: 'u',
                    dispatch_allowed: false,
                    status: 'ready',
                    teams: [{ team_id: team, ...rows }],
                    policies: [
                      { configuration_id: team, configuration_version_id: connection, ...rows },
                    ],
                    provider_connections: [
                      { provider_connection_id: connection, provider: 'openai', ...rows },
                    ],
                    ...extra,
                  },
          }),
        }) as any,
      { selections: async () => ({}) } as any,
      origin,
    ).status();
  const plain = await setup({});
  assert.deepEqual(plain.teams, [{ team_id: team }]);
  assert.equal(plain.allowedModels, undefined);
  assert.equal('name' in plain.policies[0], false);
  const full = await setup(
    { allowed_models: { codex: ['gpt-5', '../bad'], claude: 'x' } },
    { name: ' Platform ', version: 3 },
  );
  assert.equal(full.teams[0].name, 'Platform');
  assert.equal(full.policies[0].version, 3);
  assert.equal(full.providerConnections[0].name, 'Platform');
  assert.deepEqual(full.allowedModels, { codex: ['gpt-5'] });
  assert.deepEqual((await setup({ allowed_models: ['a-1'] })).allowedModels, ['a-1']);
});

test('Claude subscription errors use the managed error words and keep the recovery action', () => {
  const recovery = claudeSubscriptionRecovery('desktop.claude_subscription_login_required');
  assert.equal(recovery?.action, 'sign_in_native_claude_on_execution_host');
  assert.equal(recovery?.message, managedErrorText('desktop.claude_subscription_login_required'));
  assert.equal(managedErrorInfo('desktop.readiness_failed').section, 'managed-agents');
  assert.equal(managedErrorInfo('desktop.region_required').section, 'managed-agents');
  assert.doesNotMatch(managedErrorText('desktop.subscription_target_required'), /Verdictan/);
});
