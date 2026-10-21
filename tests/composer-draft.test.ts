import test from 'node:test';
import assert from 'node:assert/strict';
import { composerAfterSubmit, contextsAfterSubmit } from '../src/lib/composer-draft';

test('a submitted message leaves the composer', () => {
  assert.equal(composerAfterSubmit('Reply OK.', 'Reply OK.'), '');
  // The composer can have other white space at the ends than the sent text.
  assert.equal(composerAfterSubmit('Reply OK.\n', ' Reply OK.'), '');
});

test('text that the user changed during the send stays in the composer', () => {
  assert.equal(composerAfterSubmit('My next question', 'Reply OK.'), 'My next question');
  assert.equal(composerAfterSubmit('Reply OK. And more', 'Reply OK.'), 'Reply OK. And more');
});

test('an empty composer stays empty', () => {
  assert.equal(composerAfterSubmit('', 'Reply OK.'), '');
});

test('sent attachments leave the composer and new attachments stay', () => {
  const sent = { id: 'doc-1', text: 'Doc one' };
  const added = { id: 'doc-2', text: 'Doc two' };
  assert.deepEqual(contextsAfterSubmit([sent, added], [sent]), [added]);
  assert.deepEqual(contextsAfterSubmit([sent], [sent]), []);
  // An attachment with the same values is a different attachment that the user added again.
  assert.deepEqual(contextsAfterSubmit([{ ...sent }], [sent]), [{ ...sent }]);
});
