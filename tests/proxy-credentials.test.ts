import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ProxyAuthenticator,
  ProxyCredentialStore,
  ProxyPrompts,
  proxyKey,
  type ProxyPromptAnswer,
  type SecretStorage,
} from '../electron/proxy-credentials';

const password = 'correct horse battery staple';
/** A reversible cipher, as `safeStorage` with a key in the OS secret store. */
function secrets(available = true, backend = 'gnome_libsecret'): SecretStorage {
  return {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: (value) => Buffer.from([...Buffer.from(value)].map((byte) => byte ^ 0x5a)),
    decryptString: (value) => Buffer.from([...value].map((byte) => byte ^ 0x5a)).toString(),
  };
}
async function folder(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'proxy-credentials-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return join(root, 'proxy-credentials.json');
}
const challenge = { host: 'Proxy.Corp.Example', port: 3128, scheme: 'basic', realm: 'Corp' };

test('a saved proxy password is encrypted, private, never listed, and can be removed', async (t) => {
  const file = await folder(t);
  const store = new ProxyCredentialStore(file, secrets(), 'linux');
  assert.equal(proxyKey(challenge), 'proxy.corp.example:3128');
  assert.equal(await store.save('proxy.corp.example:3128', { username: 'dev', password }), true);
  const text = await readFile(file, 'utf8');
  assert.equal(text.includes(password), false, 'the file never has the password in plain text');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.deepEqual(await store.list(), [{ proxy: 'proxy.corp.example:3128', username: 'dev' }]);
  assert.deepEqual(await store.get('proxy.corp.example:3128'), { username: 'dev', password });
  assert.equal(await store.get('other:8080'), undefined);
  assert.equal(await store.remove('proxy.corp.example:3128'), true);
  assert.equal(await store.remove('proxy.corp.example:3128'), false);
  assert.deepEqual(await store.list(), []);
  // A damaged file has no usable sign-in, and the next save replaces it.
  await writeFile(file, '{not json');
  assert.deepEqual(await store.list(), []);
  await writeFile(file, JSON.stringify([{ proxy: 'x:1' }, 'text']));
  assert.deepEqual(await store.list(), []);
});

test('without an OS secret store, Kalkidan does not save a proxy password', async (t) => {
  for (const storage of [secrets(false), secrets(true, 'basic_text')]) {
    const file = await folder(t);
    const store = new ProxyCredentialStore(file, storage, 'linux');
    assert.equal(store.canSave(), false);
    assert.equal(await store.save('proxy:3128', { username: 'dev', password }), false);
    await assert.rejects(readFile(file), { code: 'ENOENT' });
  }
  // On macOS the backend name does not matter. The key is in the Keychain.
  assert.equal(
    new ProxyCredentialStore('/unused', secrets(true, 'basic_text'), 'darwin').canSave(),
    true,
  );
  const broken = new ProxyCredentialStore('/unused', {
    ...secrets(),
    isEncryptionAvailable: () => {
      throw new Error('not ready');
    },
  });
  assert.equal(broken.canSave(), false);
});

test('the sign-in uses a saved password, asks once for waiting requests, and forgets a refused one', async (t) => {
  const file = await folder(t);
  const store = new ProxyCredentialStore(file, secrets(), 'linux');
  const prompts: unknown[] = [];
  let reply: ProxyPromptAnswer = { username: 'dev', password, remember: true };
  let release!: () => void;
  let gate = Promise.resolve();
  let changes = 0;
  const auth = new ProxyAuthenticator(
    store,
    async (value, canSave) => {
      prompts.push({ ...value, canSave });
      await gate;
      return reply;
    },
    () => changes++,
  );
  gate = new Promise((resolve) => (release = resolve));
  // Three downloads wait for the same proxy. The user sees one prompt.
  const waiting = [
    auth.login(challenge, false),
    auth.login(challenge, false),
    auth.login(challenge, false),
  ];
  release();
  for (const answer of await Promise.all(waiting))
    assert.deepEqual(answer, { username: 'dev', password });
  assert.equal(prompts.length, 1);
  assert.deepEqual(prompts[0], { ...challenge, canSave: true });
  assert.equal(changes, 1, 'Computers shows the saved sign-in');
  // The next download uses the saved sign-in without a prompt.
  assert.deepEqual(await auth.login(challenge, false), { username: 'dev', password });
  assert.equal(prompts.length, 1);
  // The proxy refuses it. Kalkidan removes it and asks again.
  reply = { username: 'dev', password: 'new password', remember: false };
  assert.deepEqual(await auth.login(challenge, true), {
    username: 'dev',
    password: 'new password',
  });
  assert.equal(prompts.length, 2);
  assert.deepEqual(await store.list(), []);
  // A sign-in that the user did not save stays in memory for this app session only.
  assert.deepEqual(await auth.login(challenge, false), {
    username: 'dev',
    password: 'new password',
  });
  assert.equal(prompts.length, 2);
  auth.forget('proxy.corp.example:3128');
  reply = null;
  assert.equal(await auth.login(challenge, false), null, 'Cancel stops the sign-in');
  assert.equal(prompts.length, 3);
  // An empty answer is a cancel, and a challenge without a valid host gets no prompt.
  reply = { username: '', password: '', remember: true };
  assert.equal(await auth.login(challenge, false), null);
  assert.equal(await auth.login({ ...challenge, host: 'bad host/' }, false), null);
  assert.equal(await auth.login({ ...challenge, port: 0 }, false), null);
  assert.equal(prompts.length, 4);
});

test('the window prompt gets no secret, and an unknown or malformed answer cancels nothing else', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sent: unknown[] = [];
  let open = true;
  let next = 0;
  const prompts = new ProxyPrompts(
    (request) => {
      sent.push(request);
      return open;
    },
    1000,
    () => `prompt-${++next}`,
  );
  const first = prompts.ask({ ...challenge, realm: 'R'.repeat(300) }, true);
  assert.deepEqual(sent[0], {
    id: 'prompt-1',
    host: challenge.host,
    port: 3128,
    realm: 'R'.repeat(200),
    canSave: true,
  });
  prompts.answer('unknown', { username: 'dev', password });
  prompts.answer('prompt-1', { username: 'dev', password, remember: 'yes' });
  assert.deepEqual(await first, { username: 'dev', password, remember: false });
  // A malformed answer is a cancel.
  const second = prompts.ask(challenge, false);
  prompts.answer('prompt-2', { username: 'dev', password: 42 });
  assert.equal(await second, null);
  // Without an answer in time, the sign-in is canceled.
  const third = prompts.ask(challenge, false);
  t.mock.timers.tick(1000);
  assert.equal(await third, null);
  // Without a window, there is no prompt.
  open = false;
  assert.equal(await prompts.ask(challenge, false), null);
});
