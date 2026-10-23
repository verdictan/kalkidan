import { test, expect, openSettings } from './helpers/app';

test('a proxy sign-in prompt sends the answer once, and a saved sign-in can be removed', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = {
      listener: undefined as undefined | ((request: unknown) => void),
      answers: [] as unknown[],
      saved: [{ proxy: 'proxy.corp.example:3128', username: 'dev' }],
      removed: [] as string[],
    };
    (window as any).proxyFixture = state;
    (window as any).workspace = {
      onVerdictanChanged: () => () => {},
      snapshot: async () => ({
        projects: [],
        groups: [{ id: 'g', name: 'Project', repoIds: [] }],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      trackerProviders: async () => [],
      remoteHosts: async () => [],
      githubCliCheck: async () => ({ status: 'missing' }),
      githubAuthStatus: async () => ({ status: 'idle' }),
      verdictanStatus: async () => ({ region: 'eu', phase: 'signed-out', executionReady: false }),
      onProxyLogin: (listener: (request: unknown) => void) => {
        state.listener = listener;
        return () => (state.listener = undefined);
      },
      proxyLoginAnswer: async (id: string, answer: unknown) => {
        state.answers.push([id, answer]);
      },
      proxySignIns: async () => state.saved,
      proxySignInRemove: async (proxy: string) => {
        state.removed.push(proxy);
        state.saved = state.saved.filter((row) => row.proxy !== proxy);
      },
    };
  });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).proxyFixture.listener);
  await page.evaluate(() =>
    (window as any).proxyFixture.listener({
      id: 'prompt-1',
      host: 'proxy.corp.example',
      port: 3128,
      realm: 'Corp',
      canSave: true,
    }),
  );
  const dialog = page.getByRole('dialog', { name: 'Sign in to the proxy server' });
  await expect(dialog).toContainText('proxy.corp.example:3128');
  const signIn = dialog.getByRole('button', { name: 'Sign in' });
  await expect(signIn).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'Proxy user name' }).fill('dev');
  const secret = dialog.getByLabel('Proxy password');
  await expect(secret).toHaveAttribute('type', 'password');
  await secret.fill('pw');
  await expect(dialog.getByRole('checkbox', { name: /Remember on this computer/ })).toBeChecked();
  await signIn.click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).proxyFixture.answers)).toEqual([
    ['prompt-1', { username: 'dev', password: 'pw', remember: true }],
  ]);
  // Without a secret store, the password is not saved, and Cancel answers null.
  await page.evaluate(() =>
    (window as any).proxyFixture.listener({
      id: 'prompt-2',
      host: 'proxy.corp.example',
      port: 3128,
      realm: '',
      canSave: false,
    }),
  );
  await expect(dialog.getByRole('checkbox', { name: /Remember on this computer/ })).toBeDisabled();
  await expect(dialog.getByLabel('Proxy password')).toHaveValue('');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(await page.evaluate(() => (window as any).proxyFixture.answers.at(-1))).toEqual([
    'prompt-2',
    null,
  ]);
  // Settings › Tools lists the saved sign-in without its password, with Remove.
  const settings = await openSettings(page, 'Tools');
  const saved = settings.getByRole('region', { name: 'Proxy sign-in' });
  await expect(saved).toContainText('proxy.corp.example:3128');
  await expect(saved).toContainText('dev · Saved in the secret store of this computer');
  await saved
    .getByRole('button', { name: 'Remove the proxy sign-in for proxy.corp.example:3128' })
    .click();
  await expect(saved).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).proxyFixture.removed)).toEqual([
    'proxy.corp.example:3128',
  ]);
});
