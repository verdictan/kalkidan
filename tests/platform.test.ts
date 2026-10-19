import test from 'node:test';
import assert from 'node:assert/strict';
import { executableCandidates, pathContains, commandShell } from '../electron/platform';

test('Windows PATH uses semicolons and resolves native and npm launchers', () => {
  assert.deepEqual(
    executableCandidates(
      'codex',
      { Path: 'C:\\Program Files\\nodejs;C:\\Users\\test\\bin' },
      'win32',
    ),
    [
      'C:\\Program Files\\nodejs\\codex.exe',
      'C:\\Program Files\\nodejs\\codex.cmd',
      'C:\\Program Files\\nodejs\\codex',
      'C:\\Users\\test\\bin\\codex.exe',
      'C:\\Users\\test\\bin\\codex.cmd',
      'C:\\Users\\test\\bin\\codex',
    ],
  );
});
test('repository boundaries support Windows and remote Unix paths', () => {
  assert.ok(pathContains('C:\\Projects\\App', 'c:/projects/app/src'));
  assert.ok(pathContains('\\\\server\\share\\repo', '\\\\server\\share\\repo\\file'));
  assert.ok(!pathContains('C:\\repo', 'C:\\repo-other'));
  assert.ok(!pathContains('C:\\repo', 'C:\\repo\\..\\secret'));
  assert.ok(!pathContains('C:\\repo', 'D:\\repo'));
  assert.ok(pathContains('/home/repo', '/home/repo/src'));
  assert.ok(!pathContains('/home/repo', '/home/repo-other'));
});
test('Windows commands are passed as a PowerShell argument', () => {
  assert.deepEqual(commandShell('Write-Output "hello"', 'win32'), {
    file: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'Write-Output "hello"'],
  });
});
