import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePasswordCSV } from '../electron/browser-import';
test('password CSV handles quoted commas, escaped quotes, CRLF and multiline fields', () => {
  assert.deepEqual(
    parsePasswordCSV(
      'name,url,username,password\r\nExample,https://example.com/login,"me,too","secret""line\nnext"\r\n',
    ),
    [{ origin: 'https://example.com', username: 'me,too', password: 'secret"line\nnext' }],
  );
  assert.throws(() => parsePasswordCSV('url,username,password\nfile:///tmp,x,y'), /Invalid/);
  assert.throws(() => parsePasswordCSV('url,name\nhttps://example.com,x'), /columns/);
  assert.throws(() => parsePasswordCSV('url,username,password\n"unfinished'), /Unterminated/);
});
