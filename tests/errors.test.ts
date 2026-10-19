import test from 'node:test';
import assert from 'node:assert/strict';
import { errorMessage } from '../src/lib/errors';

test('errorMessage removes the Electron IPC prefix', () => {
  const error = new Error("Error invoking remote method 'repo:add': Error: Folder not found");
  assert.equal(errorMessage(error), 'Folder not found');
  assert.equal(
    errorMessage(new Error("Error invoking remote method 'x': TypeError: Bad value")),
    'Bad value',
  );
  assert.equal(errorMessage(new Error("Error invoking remote method 'x': plain")), 'plain');
});

test('errorMessage keeps other messages and accepts non-Error values', () => {
  assert.equal(errorMessage(new Error('Network down')), 'Network down');
  assert.equal(errorMessage('Text failure'), 'Text failure');
  assert.equal(errorMessage(42), '42');
});
