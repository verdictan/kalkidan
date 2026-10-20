import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import schema from '../src/config/github-projects-outputs.json';
test('Projects output contract retains type references and deprecation metadata', () => {
  const { sha256, ...value } = schema;
  assert.equal(createHash('sha256').update(JSON.stringify(value)).digest('hex'), sha256);
  assert.equal(Object.keys(schema.types).length, 79);
  for (const definition of Object.values(schema.types)) {
    for (const field of definition.fields || []) {
      assert.equal(typeof field.isDeprecated, 'boolean');
      let reference: any = field.type;
      while (reference?.ofType) reference = reference.ofType;
      if (reference?.name?.startsWith('ProjectV2'))
        assert.ok(reference.name in schema.types, reference.name);
    }
  }
});
