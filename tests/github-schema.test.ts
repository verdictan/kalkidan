import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import schema from '../src/config/github-projects-schema.json';
import { validateProjectMutation, projectSchemaIdentity } from '../electron/trackers/github-schema';

test('the pinned Projects schema is complete, internally consistent and has a matching digest', () => {
  const { sha256, ...data } = schema;
  assert.equal(createHash('sha256').update(JSON.stringify(data)).digest('hex'), sha256);
  assert.equal(projectSchemaIdentity.operations.length, 50);
  assert.equal(new Set(projectSchemaIdentity.operations).size, 50);
  const check = (type: any) => {
    if (type.ofType) return check(type.ofType);
    if (['INPUT_OBJECT', 'ENUM'].includes(type.kind))
      assert.ok(Object.hasOwn(schema.types, type.name), type.name);
  };
  for (const mutation of schema.mutations) for (const arg of mutation.args) check(arg.type);
  for (const type of Object.values(schema.types))
    for (const field of type.inputFields || []) check(field.type);
});
test('mutation validation rejects unknown fields, wrong types and invalid nested definitions', () => {
  validateProjectMutation('updateProjectV2', {
    projectId: 'PVT_1',
    title: 'Project',
    closed: false,
  });
  validateProjectMutation('createProjectV2View', {
    projectId: 'PVT_1',
    name: 'Roadmap',
    layout: 'ROADMAP_LAYOUT',
  });
  for (const input of [
    { title: 'Missing ID' },
    { projectId: 'PVT_1', closed: 'false' },
    { projectId: 'PVT_1', invented: true },
    { projectId: 'PVT_1', closed: undefined, title: '\0' },
  ])
    assert.throws(() => validateProjectMutation('updateProjectV2', input), /schema/);
  assert.throws(() => validateProjectMutation('arbitraryMutation', {}), /schema/);
  assert.throws(
    () =>
      validateProjectMutation('createProjectV2Field', {
        projectId: 'PVT_1',
        name: 'Status',
        dataType: 'SINGLE_SELECT',
        singleSelectOptions: [{ name: 'Ready', color: 'INVENTED', description: '' }],
      }),
    /schema/,
  );
});
test('field inputs reject non-finite numbers, oversized lists and invalid calendar dates', () => {
  const input = { projectId: 'PVT_1', itemId: 'PVTI_1', fieldId: 'PVTF_1' };
  for (const value of [
    { number: Infinity },
    { date: '2026-02-30' },
    { multiSelectOptionIds: Array(1001).fill('option') },
  ])
    assert.throws(
      () => validateProjectMutation('updateProjectV2ItemFieldValue', { ...input, value }),
      /schema/,
    );
  validateProjectMutation('updateProjectV2ItemFieldValue', {
    ...input,
    value: { date: '2026-10-20' },
  });
});
