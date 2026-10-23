import { createServer } from 'node:http';
import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = await mkdtemp(join(tmpdir(), 'kalkidan-desktop-'));
let app;
let previewServer;
const env = {
  ...process.env,
  KALKIDAN_TEST_DATA: join(root, 'library'),
  CODEX_HOME: join(root, 'codex'),
  CLAUDE_CONFIG_DIR: join(root, 'claude'),
  XDG_CONFIG_HOME: join(root, 'config'),
};
delete env.ELECTRON_RUN_AS_NODE;
const launch = () =>
  electron.launch({
    args: ['.', ...(process.platform === 'linux' ? ['--ozone-platform=headless'] : [])],
    env,
  });
try {
  const repo = join(root, 'project with spaces');
  execFileSync('git', ['init', '-b', 'main', repo]);
  execFileSync('git', [
    '-C',
    repo,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '--allow-empty',
    '-m',
    'Initial',
  ]);
  await mkdir(join(env.CODEX_HOME, 'sessions'), { recursive: true });
  await writeFile(
    join(env.CODEX_HOME, 'sessions', 'test.jsonl'),
    JSON.stringify({ type: 'session_meta', payload: { id: 'session-1', cwd: repo } }) + '\n',
  );
  await mkdir(env.KALKIDAN_TEST_DATA, { recursive: true });
  await writeFile(
    join(env.KALKIDAN_TEST_DATA, 'project-groups.json'),
    JSON.stringify([{ id: 'legacy', name: 'Platform', repoIds: [] }]),
  );
  app = await launch();
  let page = await app.firstWindow();
  await page.waitForFunction(() => !!window.workspace);
  await assert.rejects(
    page.evaluate(() => window.workspace.discover()),
    /Choose a project/,
  );
  await assert.rejects(
    page.evaluate(() => window.workspace.add()),
    /Choose a project/,
  );
  await assert.rejects(
    page.evaluate(() => window.workspace.cloneRepository('example/repo')),
    /Choose a project/,
  );
  // An empty tracker reference creates a project without a tracker.
  const untracked = await page.evaluate(() => window.workspace.createGroup('Unplanned', ''));
  assert.equal(typeof untracked, 'string');
  const untrackedGroup = JSON.parse(
    await readFile(join(env.KALKIDAN_TEST_DATA, 'project-groups.json'), 'utf8'),
  ).find((group) => group.id === untracked);
  assert.equal(untrackedGroup.name, 'Unplanned');
  assert.equal('tracker' in untrackedGroup, false);
  assert.equal('github' in untrackedGroup, false);
  await assert.rejects(
    page.evaluate(() => window.workspace.createGroup('Platform', 'not a project')),
    /Invalid URL/,
  );
  const groupId = 'legacy';
  await page.evaluate(() => window.workspace.updateGroup('legacy', 'Platform'));
  await page.evaluate(() => window.workspace.setGroupColor('legacy', 'blue'));
  assert.equal(
    JSON.parse(await readFile(join(env.KALKIDAN_TEST_DATA, 'project-groups.json'), 'utf8'))[0]
      .color,
    'blue',
  );
  await assert.rejects(
    page.evaluate(() => window.workspace.setGroupColor('legacy', 'invalid')),
    /Invalid project color/,
  );

  await assert.rejects(
    page.evaluate(() => window.workspace.chatApprove('missing', 'missing', true)),
    /another window or host/,
  );
  await assert.rejects(
    page.evaluate(() => window.workspace.chatRespond('missing', 'missing', {})),
    /another window or host/,
  );
  assert.equal(
    (await page.evaluate((groupId) => window.workspace.discover(groupId), groupId)).added,
    1,
  );
  const snapshot = await page.evaluate(() => window.workspace.snapshot());
  assert.equal(snapshot.projects.length, 1);
  assert.equal(snapshot.sessions.length, 1);
  await page.evaluate(() =>
    window.workspace.updateSession('codex', 'session-1', {
      title: 'Organized session',
      collection: 'Desktop checks',
      pinned: true,
      notes: 'Pick up here',
    }),
  );
  assert.deepEqual(
    (await page.evaluate(() => window.workspace.transcript('codex', 'session-1'))).messages,
    [],
  );
  await assert.rejects(page.evaluate(() => window.workspace.transcript('codex', '../unknown')));

  const id = snapshot.projects[0].id;
  await assert.rejects(
    page.evaluate((id) => window.workspace.launch(id, 'codex'), id),
    /inside Kalkidan/,
  );
  await page.evaluate(
    (id) =>
      window.workspace.update(id, {
        name: 'Saved project',
        notes: 'Persistent notes',
        favorite: true,
      }),
    id,
  );
  assert.equal((await page.evaluate((id) => window.workspace.git(id), id)).branch, 'main');
  const command = await page.evaluate(
    (cwd) => window.workspace.terminalStart(cwd, 'printf kalkidan-terminal'),
    snapshot.projects[0].path,
  );
  await expect
    .poll(() =>
      page
        .evaluate((id) => window.workspace.terminalStatus(id), command.id)
        .then((run) => run.status),
    )
    .toBe('completed');
  const commandResult = await page.evaluate(
    (id) => window.workspace.terminalStatus(id),
    command.id,
  );
  assert.equal(commandResult.output, 'kalkidan-terminal', JSON.stringify(commandResult));
  await assert.rejects(
    page.evaluate(() => window.workspace.terminalStart('/tmp', 'pwd')),
    /Add this session folder/,
  );
  const pty = await page.evaluate(
    (cwd) => window.workspace.ptyOpen(cwd, 80, 24),
    snapshot.projects[0].path,
  );
  await page.evaluate(
    (id) => window.workspace.ptyWrite(id, "printf 'native-%s' 'pty-ready'\r"),
    pty.id,
  );
  await expect
    .poll(() => page.evaluate((id) => window.workspace.ptyRead(id, 0), pty.id).then((r) => r.data))
    .toContain('native-pty-ready');
  await page.evaluate((id) => window.workspace.ptyClose(id), pty.id);
  await writeFile(join(repo, 'untracked.txt'), 'new file');
  assert.ok(
    (
      await page.evaluate((cwd) => window.workspace.repositoryDiff(cwd), snapshot.projects[0].path)
    ).untracked.includes('untracked.txt'),
  );
  await assert.rejects(
    page.evaluate(() => window.workspace.browserOpen('file:///etc/passwd')),
    /http or https/,
  );
  previewServer = createServer((req, res) => {
    if (req.url === '/download') {
      res.setHeader('Content-Disposition', 'attachment; filename=fixture.txt');
      res.end('download fixture');
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(
      '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Annotation fixture</title><button id="target">Fix this button</button><form><input name="username"><input type="password"></form>',
    );
  });
  await new Promise((resolve) => previewServer.listen(0, '127.0.0.1', resolve));
  const previewUrl = `http://127.0.0.1:${previewServer.address().port}`;
  await page.evaluate((url) => window.workspace.browserOpen(url), previewUrl);
  await page.evaluate(() =>
    window.workspace.browserLayout('default', { x: 100, y: 200, width: 600, height: 300 }),
  );
  const browserInfo = await app.evaluate(({ BrowserWindow }) => {
    const views = BrowserWindow.getAllWindows()[0].contentView.children;
    const view = views.find((v) => v.webContents?.getURL().startsWith('http://127.0.0.1:'));
    return { bounds: view.getBounds(), windows: BrowserWindow.getAllWindows().length };
  });
  assert.deepEqual(browserInfo.bounds, { x: 100, y: 200, width: 600, height: 300 });
  assert.equal(browserInfo.windows, 1);
  assert.equal(
    await app.evaluate(
      async ({ webContents }, url) =>
        webContents
          .getAllWebContents()
          .find((w) => w.getURL().startsWith(url))
          .executeJavaScript('typeof window.workspace'),
      previewUrl,
    ),
    'undefined',
  );
  const selecting = page.evaluate(() => window.workspace.browserSelect());
  await expect
    .poll(() =>
      app.evaluate(
        async ({ webContents }, url) =>
          webContents
            .getAllWebContents()
            .find((w) => w.getURL().startsWith(url))
            .executeJavaScript(
              'document.body.innerText.includes("Select an element") || document.documentElement.innerText.includes("Select an element")',
            ),
        previewUrl,
      ),
    )
    .toBe(true);
  await app.evaluate(
    async ({ webContents }, url) =>
      webContents
        .getAllWebContents()
        .find((w) => w.getURL().startsWith(url))
        .executeJavaScript('document.querySelector("#target").click()'),
    previewUrl,
  );
  const selection = await selecting;
  assert.equal(selection.selector, '#target');
  assert.equal(selection.text, 'Fix this button');
  assert.ok(selection.url.startsWith(previewUrl));
  await page.evaluate(() => window.workspace.browserAction('default', 'zoom', 1.2));
  assert.equal((await page.evaluate(() => window.workspace.browserState('default'))).zoom, 1.2);
  await page.evaluate(() => window.workspace.browserAction('default', 'zoom', 1));
  await page.evaluate(() =>
    window.workspace.browserAction('default', 'find', { text: 'Fix', next: false }),
  );
  await expect
    .poll(() =>
      page.evaluate(() => window.workspace.browserState('default')).then((s) => s.find?.matches),
    )
    .toBe(1);
  await page.evaluate(() =>
    window.workspace.browserAction('default', 'device', { width: 390, height: 844 }),
  );
  assert.equal(
    await app.evaluate(
      async ({ webContents }, url) =>
        webContents
          .getAllWebContents()
          .find((w) => w.getURL().startsWith(url))
          .executeJavaScript('innerWidth'),
      previewUrl,
    ),
    390,
  );
  await page.evaluate(() => window.workspace.browserAction('default', 'device', null));
  const capture = join(root, 'browser.png');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, capture);
  await page.evaluate(() => window.workspace.browserAction('default', 'screenshot'));
  assert.equal((await readFile(capture)).subarray(1, 4).toString(), 'PNG');
  const profile = await page.evaluate(() => window.workspace.browserAction('default', 'profile'));
  assert.ok(profile.history.some((h) => h.url.startsWith(previewUrl)));
  await page.evaluate(() =>
    window.workspace.browserAction('default', 'settings', {
      home: 'https://example.com/',
      rememberHistory: false,
    }),
  );
  assert.equal(
    (await page.evaluate(() => window.workspace.browserAction('default', 'profile'))).settings
      .rememberHistory,
    false,
  );
  await app.evaluate(
    async ({ webContents }, url) =>
      webContents
        .getAllWebContents()
        .find((w) => w.getURL().startsWith(url))
        .executeJavaScript(`window.open('${url}/next','_blank')`),
    previewUrl,
  );
  assert.deepEqual(
    (await page.evaluate(() => window.workspace.browserState('default'))).pendingURLs,
    [previewUrl + '/next'],
  );
  const cookies = join(root, 'cookies.json');
  await writeFile(
    cookies,
    JSON.stringify([{ url: previewUrl, name: 'fixture', value: 'test-value' }]),
  );
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, cookies);
  assert.equal(
    await page.evaluate(() => window.workspace.browserAction('default', 'import', 'cookies')),
    '1 cookies imported',
  );
  assert.ok(
    await app.evaluate(
      async ({ webContents }, url) =>
        (
          await webContents
            .getAllWebContents()
            .find((w) => w.getURL().startsWith(url))
            .session.cookies.get({ url })
        ).some((c) => c.name === 'fixture'),
      previewUrl,
    ),
  );
  await page.evaluate(() => window.workspace.browserAction('default', 'clear', 'cookies'));
  assert.equal(
    await app.evaluate(
      async ({ webContents }, url) =>
        (
          await webContents
            .getAllWebContents()
            .find((w) => w.getURL().startsWith(url))
            .session.cookies.get({ url })
        ).length,
      previewUrl,
    ),
    0,
  );
  const downloaded = join(root, 'download.txt');
  await app.evaluate(
    ({ webContents }, { url, path }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(url));
      wc.session.once('will-download', (_e, item) => item.setSavePath(path));
      wc.downloadURL(url + '/download');
    },
    { url: previewUrl, path: downloaded },
  );
  await expect
    .poll(() =>
      page
        .evaluate(() => window.workspace.browserAction('default', 'profile'))
        .then((p) => p.downloads[0]?.state),
    )
    .toBe('completed');
  assert.equal(await readFile(downloaded, 'utf8'), 'download fixture');
  const secure = await app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable());
  if (secure) {
    const passwords = join(root, 'passwords.csv');
    await writeFile(
      passwords,
      'url,username,password\n' + previewUrl + ',fixture-user,synthetic-password-only',
    );
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, passwords);
    assert.equal(
      await page.evaluate(() => window.workspace.browserAction('default', 'import', 'passwords')),
      '1 passwords imported',
    );
    const credential = (
      await page.evaluate(() => window.workspace.browserAction('default', 'profile'))
    ).credentials[0];
    assert.equal('secret' in credential, false);
    assert.equal('password' in credential, false);
    assert.ok(
      !(await readFile(join(env.KALKIDAN_TEST_DATA, 'browser', 'profile.json'), 'utf8')).includes(
        'synthetic-password-only',
      ),
    );
    await page.evaluate(
      (id) => window.workspace.browserAction('default', 'autofill', id),
      credential.id,
    );
    assert.deepEqual(
      await app.evaluate(
        async ({ webContents }, url) =>
          webContents
            .getAllWebContents()
            .find((w) => w.getURL().startsWith(url))
            .executeJavaScript(
              '[document.querySelector("input[name=username]").value,document.querySelector("input[type=password]").value]',
            ),
        previewUrl,
      ),
      ['fixture-user', 'synthetic-password-only'],
    );
    await page.evaluate(() => window.workspace.browserAction('default', 'clear', 'passwords'));
  }
  await page.evaluate(() => window.workspace.browserLayout('default', null));
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]
        .contentView.children.find((v) => v.webContents?.getURL().startsWith('http://127.0.0.1:'))
        .getVisible(),
    ),
    false,
  );
  await page.evaluate(() => window.workspace.browserClose());
  // Exercise the actual dock and native view geometry together, not only bridge calls.
  // The Tools button in the chat header opens the one tool pane. Its tabs are Changes, Code,
  // Terminal and Browser. "Close tools" hides the pane.
  const toolTab = (name) =>
    page
      .getByRole('tablist', { name: 'Tools', exact: true })
      .getByRole('tab', { name, exact: true });
  const openTool = async (name) => {
    if (!(await toolTab(name).isVisible()))
      await page
        .getByRole('group', { name: 'Tools', exact: true })
        .getByRole('button', { name: 'Tools', exact: true })
        .click();
    await toolTab(name).click();
  };
  // This test checks the workspace, not the first-run tools check.
  await page.evaluate(() => window.workspace.setWelcomeDone());
  await page.reload();
  // The sidebar tree shows projects, repos and chats. Expand the project, then start a chat in
  // the repo from its right-click menu.
  const project = page.locator('.project-tree .tree-row[data-kind="project"]').first();
  await project.locator('.tree-row-button').click();
  const toggle = project.locator('.tree-toggle');
  if (/^Expand /.test((await toggle.getAttribute('aria-label')) || '')) await toggle.click();
  await page
    .locator('.project-tree .tree-row[data-kind="repo"] .tree-row-button')
    .first()
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New chat here', exact: true }).click();
  await openTool('Browser');
  await page.getByLabel('Preview URL').fill(previewUrl);
  await page.getByRole('button', { name: 'Open preview', exact: true }).click();
  await expect
    .poll(() =>
      app.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].contentView.children.filter(
            (v) => v.webContents?.getURL().startsWith('http://127.0.0.1:') && v.getVisible(),
          ).length,
      ),
    )
    .toBe(1);
  await openTool('Terminal');
  await expect
    .poll(() =>
      app.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].contentView.children.filter(
            (v) => v.webContents?.getURL().startsWith('http://127.0.0.1:') && v.getVisible(),
          ).length,
      ),
    )
    .toBe(0);
  await page.locator('.xterm-helper-textarea').fill("printf 'dock-%s' works");
  await page.locator('.xterm-helper-textarea').press('Enter');
  await expect(page.getByLabel('Interactive terminal')).toContainText('dock-works');
  await page.getByRole('button', { name: 'Close tools', exact: true }).click();

  await assert.rejects(
    page.evaluate((id) => window.workspace.moveRepo(id, null), id),
    /Choose a project/,
  );
  await page.evaluate(({ id, groupId }) => window.workspace.moveRepo(id, groupId), { id, groupId });
  // The preview shows the base branch and the folder before the worktree exists.
  const preview = await page.evaluate(
    (id) => window.workspace.worktreePreview(id, 'feature/parallel'),
    id,
  );
  assert.equal(basename(preview.path), 'project with spaces-feature-parallel');
  assert.ok(preview.base);
  // A task worktree goes in the worktrees folder of its project. No save dialog opens.
  const taskRepo = await page.evaluate(
    (id) => window.workspace.taskWorktree(id, 'feature/parallel'),
    id,
  );
  assert.equal(basename(dirname(taskRepo.path)), 'worktrees');
  assert.equal(basename(taskRepo.path), basename(preview.path));
  assert.ok(
    (await page.evaluate(() => window.workspace.snapshot())).groups[0].repoIds.includes(
      taskRepo.id,
    ),
  );
  assert.equal((await page.evaluate((id) => window.workspace.git(id), id)).worktrees.length, 2);
  // Native conversation actions: clipboard, exports, and isolated windows.
  const savedSession = (await page.evaluate(() => window.workspace.snapshot())).sessions[0];
  await page.evaluate((s) => window.workspace.sessionAction(s, 'copy-id'), savedSession);
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'session-1');
  const exportPath = join(root, 'conversation.html');
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, exportPath);
  await page.evaluate(
    (s) =>
      window.workspace.sessionAction(
        { ...s, organization: { title: '<script>alert(1)</script>' } },
        'html',
      ),
    savedSession,
  );
  const html = await readFile(exportPath, 'utf8');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  const mdPath = join(root, 'conversation.md');
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, mdPath);
  await page.evaluate((s) => window.workspace.sessionAction(s, 'markdown'), savedSession);
  assert.ok((await readFile(mdPath, 'utf8')).startsWith('# Organized session'));
  const newWindow = app.waitForEvent('window');
  await page.evaluate((s) => window.workspace.sessionAction(s, 'window'), savedSession);
  const second = await newWindow;
  await second.waitForFunction(() => !!window.workspace);
  await expect(second.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(
    'Organized session',
  );
  assert.equal((await second.evaluate(() => window.workspace.snapshot())).sessions.length, 1);
  await second.close();
  assert.equal((await page.evaluate(() => window.workspace.snapshot())).sessions.length, 1);
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.waitForFunction(() => !!window.workspace);
  assert.equal(
    (await page.evaluate(() => window.workspace.browserAction('unused', 'profile'))).settings.home,
    'https://example.com/',
  );
  const restored = await page.evaluate(() => window.workspace.snapshot());
  assert.equal(restored.projects.length, 2);
  assert.equal(restored.groups[0].name, 'Platform');
  assert.equal('client' in restored.groups[0], false);
  assert.equal(restored.groups[0].repoIds.length, 2);
  await assert.rejects(
    page.evaluate((groupId) => window.workspace.removeGroup(groupId), groupId),
    /Move this project/,
  );
  assert.equal((await page.evaluate(() => window.workspace.snapshot())).projects.length, 2);
  assert.equal(restored.sessions[0].organization.title, 'Organized session');
  assert.equal(restored.sessions[0].organization.pinned, true);
  assert.equal(restored.sessions[0].organization.collection, 'Desktop checks');
  assert.ok(
    restored.projects.some(
      (p) => p.name === 'Saved project' && p.notes === 'Persistent notes' && p.favorite,
    ),
  );
  await page.evaluate((id) => window.workspace.remove(id), id);
  assert.equal((await page.evaluate(() => window.workspace.snapshot())).projects.length, 1);
  execFileSync('git', ['-C', repo, 'status', '--porcelain']);
  console.log(
    'Desktop smoke passed: discovery, history, IPC, Git, worktree creation, persistence, and non-destructive removal.',
  );
} finally {
  previewServer?.close();
  await app?.close();
  // The app can still write a file while it quits. Try the removal again for a short time.
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
