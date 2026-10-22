import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopFixture } from './helpers/desktop-fixture';

test('desktop rejects foreign IPC callers and stops safely when startup storage is invalid', async () => {
  for (const failure of ['groups', 'roots', 'library', 'projects', 'invalidProjects']) {
    const f = await desktopFixture('linux', failure);
    assert.equal(f.windows.length, 0, failure);
    assert.ok(
      f.calls.some((c) => c[0] === 'quit'),
      failure,
    );
    assert.ok(
      f.calls.some((c) => c[0] === 'errorBox'),
      failure,
    );
  }
  const f = await desktopFixture();
  assert.ok(f.handlers.size > 80);
  for (const [name, handler] of f.handlers)
    assert.throws(() => handler({ sender: {}, senderFrame: {} }, 'x'), /Untrusted caller/, name);
  const w = f.windows[0];
  assert.equal(w.options.webPreferences.nodeIntegration, false);
  assert.equal(w.options.webPreferences.sandbox, true);
  assert.equal(w.options.webPreferences.contextIsolation, true);
});

test('desktop routes project, docs, agent, terminal and remote handlers to the execution host', async () => {
  const f = await desktopFixture(),
    call = f.invoke;
  for (const operation of [
    'list',
    'metadata',
    'read',
    'create',
    'save',
    'delete',
    'trash',
    'restore',
    'search',
    'task-links',
    'set-task-links',
  ]) {
    await call('docs-' + operation, 'g', 'page', 'body');
    await call('docs-' + operation, 'remote', 'page', 'body');
  }
  await assert.rejects(call('docs-list', 'missing'), /Project not found/);
  f.state.docsError = true;
  await assert.rejects(call('docs-list', 'g'), /docs failed/);
  f.state.docsError = false;
  assert.ok(f.calls.some((c) => c[0] === 'invalidate'));
  assert.equal(await call('project-resource-revision', 'g', 'docs'), 'revision-1');
  await call('project-resource-revision', 'remote', 'memory');
  await assert.rejects(call('project-resource-revision', 'missing', 'docs'), /not found/);
  await assert.rejects(call('project-resource-revision', 'g', 'bad'), /Invalid project resource/);
  await call('memory-list', 'g');
  await call('memory-list', 'remote');
  await call('memory-entries', 'remote');
  await call('memory-forget', 'remote', 'a'.repeat(64), 'b'.repeat(64));
  await assert.rejects(call('memory-entries', 'missing'), /not found/);
  await assert.rejects(call('memory-list', 'missing'), /not found/);
  for (const [method, args] of Object.entries({
    'pty-open': ['/repo', 80, 24],
    'pty-read': ['pty', 0],
    'pty-write': ['pty', 'input'],
    'pty-resize': ['pty', 100, 30],
    'pty-close': ['pty'],
    'terminal-start': ['/repo', 'echo fixture'],
    'terminal-status': ['terminal'],
    'terminal-input': ['terminal', 'input'],
    'terminal-stop': ['terminal'],
    'repository-diff': ['/repo'],
    'browser-action': ['default', 'profile'],
    'browser-layout': ['default', null],
    'browser-navigate': ['default', 'reload'],
    'browser-state': ['default'],
    'browser-open': ['http://example.test', 'default'],
    'browser-select': ['default'],
    'browser-close': ['default'],
    'remote-hosts': [],
    'remote-add': ['name', 'host'],
    'remote-check': ['host'],
    'remote-install': ['host'],
    'remote-connect': ['host'],
    'remote-disconnect': ['host'],
    'remote-folders': ['host', '/'],
    'directory-list': ['/'],
    'github-auth-start': [true],
    'github-auth-status': [],
    'github-auth-cancel': [],
    'github-auth-open': [],
    'tracker-auth-open': ['github'],
    'tracker-field': ['g', 'item', 'field', { text: 'Value' }],
    'tracker-item-action': ['g', 'item', { kind: 'archive' }],
    'tracker-mutation-revert': ['g', 'mutation'],
    'app-menu': [],
    models: ['codex'],
    'github-link': ['g', null],
    'github-owners': [],
    'github-projects': [{ id: 'owner', login: 'example', kind: 'organization' }],
    'github-create-project': [{ id: 'owner', login: 'example', kind: 'organization' }, 'Title'],
    'github-board': ['g'],
    'github-status': ['g', 'task', 'status'],
    'github-draft': ['g', 'title', 'body'],
    'github-add-issue': ['g', 'url'],
    'group-color': ['g', 'blue'],
    'group-update': ['g', 'Name'],
    'github-repositories': [],
    'github-cli-check': [],
    'agent-installations': [],
    'agent-executable-choose': ['claude', '/bin/claude'],
    'history-preview': [],
    'history-import': [{}],
    'chat-status': ['chat'],
    'chat-stop': ['chat'],
  }))
    await call(method, ...args);
  await assert.rejects(call('chat-approve', 'unowned', 'approval', true), /another window or host/);
  await assert.rejects(call('chat-respond', 'unowned', 'question', {}), /another window or host/);
  await call('directory-list', '/', 'host');
  // A host ID sends the agent check and the chosen program to that SSH host.
  await call('agent-installations', 'host');
  await call('agent-executable-choose', 'claude', null, 'host');
  assert.ok(f.calls.some((c) => c[0] === 'remoteAgentInstallations' && c[1] === 'host'));
  assert.ok(
    f.calls.some((c) => c[0] === 'remoteAgentChoice' && c[1] === 'host' && c[2] === 'claude'),
  );
  assert.ok(f.calls.some((c) => c[0] === 'agentChoice' && c[1] === 'claude'));
  await call('github-link', 'g', 'url');
  await assert.rejects(call('pty-open', null), /Choose a repository/);
  await assert.rejects(call('pty-open', '/outside'), /Add this session folder/);
  f.state.directory = false;
  await assert.rejects(call('pty-open', '/repo'), /unavailable/);
  f.state.directory = true;
  await assert.rejects(call('remote-remove', 'host'), /Move or remove/);
  await assert.rejects(
    call('remote-remove', 'other', { deleteHostData: true }),
    /Connect the host to delete its Kalkidan data/,
  );
  await call('remote-remove', 'other');
  // The removed host forgets its identity, so a new connection gets a new one.
  assert.ok(f.calls.some((c) => c[0] === 'forgetHost' && c[1] === 'other'));
  await assert.rejects(call('remote-call', 'host', 'unknown', []), /Unsupported/);
  await assert.rejects(call('remote-call', 'host', 'chatCreate', ['/outside']), /Add this remote/);
  await call('remote-call', 'host', 'chatCreate', ['/remote', 'codex', '@docs prompt', true]);
  await call('remote-call', 'host', 'chatStart', ['codex', 's', 'prompt', true]);
  await assert.rejects(
    call('remote-call', 'host', 'chatStart', ['codex', 'missing', 'prompt']),
    /not found/,
  );
  for (const method of ['ptyOpen', 'terminalStart'])
    await call('remote-call', 'host', method, ['/remote']);
  await assert.rejects(call('github-link', 'missing', 'url'), /not found/);
  await assert.rejects(call('github-board', 'empty'), /Connect a GitHub/);
  const initial = await call('snapshot');
  assert.ok(!initial.sessions.some((s: any) => s.id === 'host::s'));
  await new Promise((resolve) => setImmediate(resolve));
  const snapshot = await call('snapshot');
  assert.ok(snapshot.sessions.some((s: any) => s.id === 'host::s'));
  const hosts = await call('remote-hosts');
  hosts[0].status = 'disconnected';
  await call('snapshot');
  hosts[0].status = 'connected';
  f.state.remoteError = 'offline';
  await call('snapshot');
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok((await call('snapshot')).warnings.includes('Host: offline'));
  f.state.remoteError = '';
  await call('session-update', 'codex', 's', {});
  await call('session-update', 'codex', 'host::s', {});
  await assert.rejects(call('session-update', 'codex', 'host::missing', {}), /not found/);
  await assert.rejects(call('session-update', 'codex', 'missing', {}), /not found/);
  for (const agent of ['codex', 'claude'])
    await call('transcript', agent, agent === 'codex' ? 's' : 'c');
  f.state.transcriptError = 'ENOENT';
  await call('transcript', 'codex', 's');
  f.state.transcriptError = 'EACCES';
  await assert.rejects(call('transcript', 'codex', 's'), /transcript/);
  f.state.transcriptError = '';
  f.state.source = false;
  await call('transcript', 'codex', 's');
  await assert.rejects(call('transcript', 'claude', 'c'), /not found/);
  f.state.source = true;
  await assert.rejects(call('transcript', 'bad', 's'), /Invalid session/);
  await call('chat-create', 'r', 'codex', '@docs task', true, { forkFrom: 's', model: 'm' });
  await call('chat-start', 'codex', 's', 'task', true);
  await assert.rejects(call('chat-create', 'r', 'bad', 'task'), /Invalid agent/);
  await assert.rejects(call('chat-create', 'rr', 'codex', 'task'), /remote session/);
  f.state.directory = false;
  await assert.rejects(call('chat-create', 'r', 'codex', 'task'), /no longer/);
  await assert.rejects(call('chat-start', 'codex', 's', 'task'), /no longer/);
  f.state.directory = true;
  await call('group-create', 'New', null);
  await call('group-create', 'Remote', null, 'host');
  await call('group-create', 'Linked', 'url');
  await assert.rejects(call('group-create', 'Name', {}), /tracker/);
  await assert.rejects(call('group-create', 'Name', null, 'bad'), /Connect/);
  await assert.rejects(call('group-create', ''), /name/);
  await assert.rejects(call('group-remove', 'g'), /repositories/);
  await call('group-remove', 'empty');
  await assert.rejects(call('repo-move', 'r', null), /Choose/);
  await assert.rejects(call('repo-move', 'r', 'remote'), /execution host/);
  await call('repo-move', 'r', 'g');
  await assert.rejects(call('add', 'missing'), /Choose/);
  await assert.rejects(call('add', 'remote'), /remote folder/);
  f.state.cancel = true;
  await call('add', 'g');
  f.state.cancel = false;
  await call('add', 'g');
  await call('add', 'g');
  await assert.rejects(call('repository-clone', 'owner/repo', 'missing'), /Choose/);
  await assert.rejects(call('repository-clone', 'owner/repo', 'remote'), /remote host/);
  await call('repository-clone', 'owner/repo', 'g');
  await call('remote-add-repository', 'remote', '/new');
  await call('remote-add-repository', 'remote', '/new', 'owner/repo');
  await assert.rejects(call('remote-add-repository', 'g', '/new'), /remote project/);
  await assert.rejects(call('discover', 'missing'), /Choose/);
  await call('discover', 'g');
  await call('discover', 'remote');
  await call('update', 'r', { name: ' Renamed ', notes: 'notes', favorite: true });
  await assert.rejects(call('update', 'r', { name: '' }), /Name/);
  await assert.rejects(call('update', 'r', { notes: 'x'.repeat(20001) }), /too long/);
  assert.equal((await call('git', 'r')).changes, 2);
  await call('git', 'rr');
  f.state.branchError = true;
  assert.equal((await call('git', 'r')).branch, 'unborn');
  f.state.branchError = false;
  f.state.gitError = 'not a git repository';
  assert.equal(await call('git', 'r'), null);
  f.state.gitError = 'failure';
  await assert.rejects(call('git', 'r'), /failure/);
  f.state.gitError = '';
  await Promise.all([call('repository-snapshot', 'r'), call('repository-snapshot', 'r')]);
  await call('repository-snapshot', 'rr');
  await call('reveal', 'r');
  await assert.rejects(call('reveal', 'rr'), /Remote files/);
  f.state.openError = 'cannot open';
  await assert.rejects(call('reveal', 'r'), /cannot open/);
  f.state.openError = '';
  await assert.rejects(call('launch', 'r', 'codex'), /inside/);
  await assert.rejects(call('launch', 'rr', 'terminal'), /remote/);
  await call('launch', 'r', 'terminal');
  await assert.rejects(call('worktree', 'r', '-bad'), /valid new branch/);
  await call('worktree', 'r', 'feature');
  await call('task-worktree', 'rr', 'feature');
  for (const method of [
    'working-status',
    'git-commit',
    'git-pull-request',
    'pull-request-status',
  ]) {
    await call(method, 'r', 'message', 'body');
    await call(method, 'rr', 'message', 'body');
  }
  f.state.remoteError = 'Unsupported remote operation';
  await assert.rejects(call('working-status', 'rr'), /Reinstall/);
  f.state.remoteError = 'offline';
  await assert.rejects(call('working-status', 'rr'), /offline/);
  f.state.remoteError = '';
  await call('worktree-remove', 'r', false);
  await call('remove', 'rr');
  await assert.rejects(call('remove', 'missing'), /not found/);
  f.windows[0].emit('closed');
  assert.ok(f.calls.some((c) => c[0] === 'dispose') === false);
  assert.ok(f.calls.some((c) => c[0] === 'chatStop'));
  f.app.emit('before-quit', {
    preventDefault() {
      throw Error('should not prevent');
    },
  });
});

test('desktop window lifecycle and session export preserve security on each platform', async () => {
  for (const platform of ['darwin', 'win32']) {
    const f = await desktopFixture(platform),
      w = f.windows[0],
      call = f.invoke;
    let prevented = 0;
    const event = {
      preventDefault() {
        prevented++;
      },
    };
    w.popup({ url: 'https://example.test' });
    w.popup({ url: 'javascript:bad' });
    w.popup({ url: 'invalid' });
    w.webContents.emit('will-navigate', event, 'https://example.test');
    w.webContents.emit('did-finish-load');
    w.emit('enter-full-screen');
    w.emit('leave-full-screen');
    f.state.running = 1;
    w.emit('close', event);
    f.app.emit('before-quit', event);
    assert.equal(prevented, 3);
    f.state.running = 2;
    f.state.choice = 0;
    f.app.emit('before-quit', event);
    assert.ok(f.calls.some((c) => c[0] === 'dispose'));
    for (const action of [
      'copy-id',
      'copy-path',
      'finder',
      'vscode',
      'cursor',
      'copy-transcript',
      'markdown',
      'html',
    ])
      await call('session-action', f.sessions[0], action);
    await call(
      'session-action',
      { ...f.sessions[0], hostId: 'host', id: 'host::s' },
      'copy-transcript',
    );
    await assert.rejects(
      call('session-action', { ...f.sessions[0], hostId: 'host', id: 'host::missing' }, 'copy-id'),
      /not found/,
    );
    await assert.rejects(
      call('session-action', { ...f.sessions[0], hostId: 'host', id: 'host::s' }, 'finder'),
      /remote folders/,
    );
    await assert.rejects(call('session-action', f.sessions[0], 'unknown'), /Unknown session/);
    f.state.openError = 'failure';
    await assert.rejects(call('session-action', f.sessions[0], 'finder'), /failure/);
    f.state.openError = '';
    f.state.cancel = true;
    assert.equal(await call('session-action', f.sessions[0], 'markdown'), null);
    f.state.cancel = false;
    await call('launch', 'r', 'terminal');
    await call('session-action', f.sessions[0], 'window');
    assert.equal(f.windows.length, 2);
    w.emit('closed');
    f.windows[1].emit('closed');
    f.windows.forEach((win) => (win.closed = true));
    f.app.emit('activate');
    assert.equal(f.windows.length, 3);
    f.app.emit('window-all-closed');
    assert.ok(f.calls.some((c) => c[0] === 'writeFile' && String(c[2]).includes('&lt;test&gt;')));
  }
});

test('desktop recovers discovery errors, migrates remote docs and releases late resources', async () => {
  const f = await desktopFixture();
  f.state.moveError = true;
  await assert.rejects(
    f.invoke('repository-clone', 'owner/new', 'g'),
    /Repository cloned and added/,
  );
  f.state.moveError = false;
  await f.invoke('history-import', { path: '/imported', groupId: 'g' });
  await f.invoke('history-import', { path: '/imported', groupId: 'g' });
  f.state.configError = true;
  f.state.missingPath = '/repo';
  assert.deepEqual(await f.invoke('discover', 'g'), { added: 0 });
  assert.deepEqual(await f.invoke('discover', 'remote'), { added: 1 });
  const visit = (entries: any[]) => {
    for (const entry of entries) {
      entry.click?.();
      if (Array.isArray(entry.submenu)) visit(entry.submenu);
    }
  };
  visit(f.calls.find((c) => c[0] === 'menu')![1]);
  assert.ok(f.calls.some((c) => c[0] === 'send' && c[1] === 'menu-command'));
  const pending = f.invoke('chat-start', 'codex', 's', 'task', true);
  await Promise.resolve();
  f.state.stopError = true;
  f.windows[0].emit('closed');
  await pending;
  assert.ok(f.calls.some((c) => c[0] === 'chatStop'));
  const remote = await desktopFixture('linux', 'remoteMigration');
  await remote.invoke('docs-list', 'remote');
  assert.ok(remote.calls.some((c) => c[0] === 'remote' && c[2] === 'project-import-docs'));
  const windows = await desktopFixture('win32');
  // Kalkidan is light only: the native theme, the window and the title bar use light colors.
  assert.equal(windows.theme.themeSource, 'light');
  assert.equal(windows.windows[0].options.backgroundColor, '#ffffff');
  assert.equal(windows.windows[0].options.titleBarOverlay.color, '#fafafa');
  const dev = await desktopFixture('linux', 'dev');
  assert.ok(dev.calls.some((c) => c[0] === 'loadURL' && c[1].startsWith('http://127.0.0.1:5173')));
});

test('sign-out asks first when agents run or SSH hosts are connected', async () => {
  const f = await desktopFixture();
  f.state.running = 2;
  f.state.choice = 1;
  await f.invoke('verdictan-logout');
  const box = f.calls.find((c) => c[0] === 'messageBox')?.[1];
  assert.equal(box.buttons[0], 'Sign out');
  assert.match(box.detail, /^Sign out stops 2 running agents and disconnects 1 SSH host\./);
  assert.ok(!f.calls.some((c) => c[0] === 'verdictanLogout'), 'Cancel keeps the account');
  f.state.choice = 0;
  await f.invoke('verdictan-logout');
  assert.ok(f.calls.some((c) => c[0] === 'verdictanLogout'));
});

test('the sign-in handlers reach the account owner and the region console', async () => {
  const f = await desktopFixture();
  await f.invoke('verdictan-reopen-browser');
  assert.ok(f.calls.some((c) => c[0] === 'verdictanReopenBrowser'));
  await f.invoke('verdictan-apply-recommended');
  assert.ok(f.calls.some((c) => c[0] === 'verdictanApplyRecommended'));
  // The stub has no region. The console opens only for a selected region.
  await assert.rejects(f.invoke('verdictan-open-console'), /region_required/);
  assert.ok(!f.calls.some((c) => c[0] === 'external'));
  assert.deepEqual(await f.invoke('first-run-state'), { welcomeDone: false, everSignedIn: false });
  assert.deepEqual(await f.invoke('set-welcome-done'), { welcomeDone: true, everSignedIn: false });
  assert.deepEqual(
    await f.invoke('set-notification-preferences', { finished: false, needsInput: true }),
    {
      finished: false,
      needsInput: true,
    },
  );
  assert.deepEqual(await f.invoke('notification-preferences'), {
    finished: false,
    needsInput: true,
  });
  await assert.rejects(f.invoke('set-notification-preferences', null), /Invalid/);
});

test('desktop reports its own version and the helper state without an update service', async () => {
  const f = await desktopFixture();
  assert.deepEqual(await f.invoke('app-version'), {
    version: '0.1.0',
    build: 'f'.repeat(64),
    packaged: false,
  });
  assert.deepEqual(await f.invoke('helper-updates'), [
    {
      hostId: 'host',
      name: 'Host',
      connected: true,
      installed: undefined,
      running: undefined,
      approved: 'f'.repeat(64),
      discovery: 'unknown',
    },
  ]);
  // Kalkidan does not update itself. It removes the update files of older versions.
  const removed = f.calls.filter((c) => c[0] === 'rm').map((c) => c[1]);
  assert.ok(removed.some((path) => path.endsWith('/updates/desktop')));
  assert.ok(removed.some((path) => path.endsWith('/updates/desktop-discovery.json')));
  for (const name of ['component-updates', 'desktop-update-download', 'desktop-update-restart'])
    assert.equal(f.handlers.has(name), false, name);
});
