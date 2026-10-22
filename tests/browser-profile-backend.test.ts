import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { backendLoader } from './helpers/backend-loader';
import { resolve } from 'node:path';

test('browser profile controls history, downloads, imports and credentials through isolated OS fixtures', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  let text = '{}',
    missing = false,
    size = 1,
    canceled = false,
    encrypted = true,
    fill = true;
  const writes: any[] = [],
    cookies: any[] = [],
    revealed: string[] = [],
    actions: string[] = [];
  let sequence = 0;
  const { BrowserProfile } = backendLoader({
    electron: {
      app: { getPath: () => '/fixture' },
      dialog: { showOpenDialog: async () => ({ canceled, filePaths: ['/fixture/import'] }) },
      safeStorage: {
        isEncryptionAvailable: () => encrypted,
        getSelectedStorageBackend: () => 'keychain',
        encryptString: (s: string) => Buffer.from(s),
        decryptString: (b: Buffer) => b.toString(),
      },
      shell: { showItemInFolder: (s: string) => revealed.push(s) },
    },
    'node:crypto': { randomUUID: () => `id-${++sequence}` },
    'node:fs/promises': {
      readFile: async () => {
        if (missing) throw Object.assign(Error('missing'), { code: 'ENOENT' });
        return text;
      },
      stat: async () => ({ size }),
    },
    [resolve('electron/storage/atomic-json.ts')]: {
      writeJSON: async (_: string, data: any) => writes.push(data),
    },
  })(resolve('electron/browser-profile.ts'));
  const profile = new BrowserProfile();
  missing = true;
  await profile.load();
  missing = false;
  text = 'bad';
  await assert.rejects(profile.load(), SyntaxError);
  text = '{}';
  await profile.load();
  text = JSON.stringify({ downloads: [{ state: 'completed' }, { state: 'progressing' }] });
  await profile.load();
  assert.deepEqual(
    profile.downloads.map((d: any) => d.state),
    ['completed', 'interrupted'],
  );
  profile.visit('file:///private', 'secret');
  assert.equal(profile.history.length, 0);
  profile.visit('https://example.test', '');
  profile.visit('https://example.test', 'Title');
  assert.deepEqual(profile.history, [
    { url: 'https://example.test', title: 'Title', at: new Date(1000).toISOString() },
  ]);
  let permission: any, check: any;
  const session = Object.assign(new EventEmitter(), {
    setPermissionRequestHandler: (f: Function) => (permission = f),
    setPermissionCheckHandler: (f: Function) => (check = f),
    clearCache: async () => actions.push('cache'),
    clearStorageData: async () => actions.push('cookies'),
    cookies: { set: async (cookie: any) => cookies.push(cookie) },
  });
  const wc = {
    session,
    getURL: () => 'https://example.test/login',
    executeJavaScriptInIsolatedWorld: async () => fill,
  };
  profile.configure(session);
  profile.configure(session);
  assert.equal(session.listenerCount('will-download'), 1);
  permission(null, 'camera', (allowed: boolean) => assert.equal(allowed, false));
  assert.equal(check(), false);
  let paused = true;
  const item = Object.assign(new EventEmitter(), {
    getFilename: () => 'file.zip',
    getTotalBytes: () => 100,
    getSavePath: () => '/fixture/file.zip',
    getReceivedBytes: () => 50,
    isPaused: () => paused,
    getState: () => 'progressing',
    setSaveDialogOptions: (opts: any) => assert.equal(opts.title, 'Save download'),
    cancel: () => actions.push('cancel'),
    pause: () => actions.push('pause'),
    resume: () => actions.push('resume'),
  });
  session.emit('will-download', {}, item);
  const id = profile.downloads[0].id;
  item.emit('updated');
  assert.equal(profile.downloads[0].state, 'paused');
  paused = false;
  item.emit('updated');
  assert.equal(profile.downloads[0].state, 'progressing');
  for (const command of ['cancel', 'pause', 'resume'])
    await profile.action(wc, 'download', { id, command });
  await assert.rejects(
    profile.action(wc, 'download', { id: 'unknown', command: 'pause' }),
    /not found/,
  );
  await assert.rejects(profile.action(wc, 'download', { id, command: 'reveal' }), /unavailable/);
  item.emit('done', {}, 'completed');
  await profile.action(wc, 'download', { id, command: 'reveal' });
  assert.deepEqual(revealed, ['/fixture/file.zip']);
  await profile.action(wc, 'download', { id, command: 'pause' });
  await profile.action(wc, 'settings', { home: 'https://example.test', rememberHistory: false });
  profile.visit('https://ignore.test', 'Ignored');
  assert.equal(profile.history.length, 1);
  await assert.rejects(profile.action(wc, 'settings', { home: 'file:///bad' }), /HTTP/);
  await assert.rejects(
    profile.action(wc, 'settings', { home: 'https://user:pass@example.test' }),
    /HTTP/,
  );
  await assert.rejects(profile.action(wc, 'import', 'bad'), /import type/);
  canceled = true;
  assert.equal(await profile.action(wc, 'import', 'cookies'), null);
  canceled = false;
  size = 5000001;
  await assert.rejects(profile.action(wc, 'import', 'cookies'), /5 MB/);
  size = 1;
  text = '{}';
  await assert.rejects(profile.action(wc, 'import', 'cookies'), /JSON array/);
  text = JSON.stringify([
    {
      domain: '.example.test',
      secure: true,
      path: '/app',
      name: 'key',
      value: 'value',
      expirationDate: 12,
      httpOnly: true,
    },
    { url: 'http://example.test', name: 'other', value: 'value' },
  ]);
  assert.equal(await profile.action(wc, 'import', 'cookies'), '2 cookies imported');
  assert.equal(cookies[0].url, 'https://example.test/app');
  text = JSON.stringify([{ url: 'file:///private', name: 'key', value: 'value' }]);
  await assert.rejects(profile.action(wc, 'import', 'cookies'), /Invalid cookie/);
  text = 'url,username,password\nhttps://example.test,user,secret';
  encrypted = false;
  await assert.rejects(profile.action(wc, 'import', 'passwords'), /unavailable/);
  encrypted = true;
  assert.equal(await profile.action(wc, 'import', 'passwords'), '1 passwords imported');
  const credential = profile.summary().credentials[0];
  assert.ok(!('secret' in credential));
  await profile.action(wc, 'import', 'passwords');
  assert.equal(profile.summary().credentials.length, 1);
  await assert.rejects(profile.action(wc, 'autofill', 'missing'), /exact saved origin/);
  fill = false;
  await assert.rejects(profile.action(wc, 'autofill', credential.id), /visible login/);
  fill = true;
  assert.match(await profile.action(wc, 'autofill', credential.id), /Login filled/);
  assert.deepEqual(await profile.action(wc, 'profile', null), profile.summary());
  await profile.action(wc, 'delete-password', credential.id);
  assert.deepEqual(profile.summary().credentials, []);
  for (const type of ['history', 'passwords', 'cache', 'cookies'])
    await profile.action(wc, 'clear', type);
  assert.deepEqual(profile.history, []);
  await assert.rejects(profile.action(wc, 'clear', 'bad'), /Choose browsing/);
  await assert.rejects(profile.action(wc, 'bad', null), /Unsupported/);
  assert.ok(writes.length > 0);
});

test('password import refuses Linux without a keyring, where Electron stores plain text', async () => {
  for (const [backend, expected] of [
    ['basic_text', /Secure OS credential storage is unavailable/],
    ['gnome_libsecret', /1 passwords imported/],
    ['kwallet6', /1 passwords imported/],
  ] as const) {
    const { BrowserProfile } = backendLoader(
      {
        electron: {
          app: { getPath: () => '/fixture' },
          dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ['/import'] }) },
          safeStorage: {
            // Electron reports encryption as available with the plain text backend.
            isEncryptionAvailable: () => true,
            getSelectedStorageBackend: () => backend,
            encryptString: (s: string) => Buffer.from(s),
            decryptString: (b: Buffer) => b.toString(),
          },
          shell: { showItemInFolder: () => {} },
        },
        'node:fs/promises': {
          readFile: async () => 'url,username,password\nhttps://example.test,user,secret',
          stat: async () => ({ size: 60 }),
        },
        [resolve('electron/storage/atomic-json.ts')]: { writeJSON: async () => {} },
      },
      { process: { ...process, platform: 'linux' } },
    )(resolve('electron/browser-profile.ts'));
    const profile = new BrowserProfile();
    const wc = { getURL: () => 'https://example.test/' };
    const result = profile.action(wc, 'import', 'passwords');
    if (backend === 'basic_text') await assert.rejects(result, expected);
    else assert.match(await result, expected);
  }
});
