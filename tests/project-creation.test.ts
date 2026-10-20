import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ProjectCreation,
  type ProjectCreationEffects,
} from '../electron/operations/create-project';
test('project setup resumes after registration and import failures without duplicate creation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-operation-'));
  try {
    const request = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Example',
      reference: '',
      provider: 'github',
      paths: ['/a', '/b'],
    };
    let exists = false,
      creates = 0,
      attempts = 0;
    const added: string[] = [];
    const effects: ProjectCreationEffects = {
      exists: () => exists,
      resolve: async () => null,
      prepare: async () => '/project',
      create: async () => {
        creates++;
        exists = true;
        throw Error('lost response');
      },
      add: async (_id, path) => {
        if (path === '/b' && attempts++ === 0) throw Error('unavailable');
        added.push(path);
      },
    };
    const service = () => new ProjectCreation(root, effects);
    await assert.rejects(service().run(request), /lost response/);
    assert.equal((await service().status(request.id))?.phase, 'partially-completed');
    await assert.rejects(service().run(request), /unavailable/);
    assert.deepEqual(added, ['/a']);
    assert.equal(await service().run(request), request.id);
    assert.deepEqual(added, ['/a', '/b']);
    assert.equal(creates, 1);
    assert.equal(await service().run(request), request.id);
    await assert.rejects(service().run({ ...request, name: 'Changed' }), /different request/);
    exists = false;
    await assert.rejects(service().run(request), /removed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
