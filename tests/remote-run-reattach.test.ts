import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RemoteHosts } from '../electron/remote-hosts';

/**
 * A helper fixture that keeps its runs in a file. The file is the state of the host: it stays
 * when the SSH connection stops, as the runs of the real helper do. A test changes the file to
 * move a run on the host.
 */
const helper = `
const fs = require('fs'), crypto = require('crypto'), path = require('path');
const digest = crypto.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex');
const file = path.join(process.env.HOME, 'host-runs.json');
const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
fs.appendFileSync(path.join(process.env.HOME, 'helper-args.txt'), process.argv.slice(2).join(' ') + '\\n');
require('readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  const runs = read();
  if (fs.existsSync(path.join(process.env.HOME, 'replace'))) {
    process.stdout.write(JSON.stringify({ event: 'helper-replaced' }) + '\\n');
    process.exit(0);
  }
  const answer = (value) => process.stdout.write(JSON.stringify({ id: request.id, ...value }) + '\\n');
  const run = runs[request.args[0]];
  switch (request.method) {
    case 'hello':
      return answer({ result: { protocol: 5, bundleDigest: digest, node: 'v24', platform: 'linux' } });
    case 'chat-runs':
      return answer({ result: Object.values(runs).filter((r) => r.status === 'running')
        .map((r) => ({ id: r.id, agent: r.agent, sessionId: r.sessionId, create: false })) });
    case 'chatStatus':
      return run ? answer({ result: run }) : answer({ error: 'Response no longer available. Reopen the session.' });
    case 'chatStop':
      if (run) { run.status = 'stopped'; fs.writeFileSync(file, JSON.stringify(runs)); }
      return answer({ result: null });
    default:
      return answer({ result: null });
  }
});
`;

const run = (id: string, sessionId: string, status = 'running') => ({
  id,
  agent: 'codex',
  sessionId,
  sessionReady: true,
  status,
  messages: [],
  activity: status === 'running' ? 'Working' : 'Done',
});

test('a run on an SSH host continues without the app, and the app attaches to it again', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-reattach-'));
  const oldPath = process.env.PATH;
  const oldHome = process.env.HOME;
  const bundle = join(root, 'agent.cjs');
  const runsFile = join(root, 'host-runs.json');
  const setRuns = (runs: object[]) =>
    writeFile(runsFile, JSON.stringify(Object.fromEntries(runs.map((r: any) => [r.id, r]))));
  const ended: any[] = [];
  const connected: string[] = [];
  const hosts = new RemoteHosts(join(root, 'hosts.json'), bundle);
  hosts.onRunEnded((value) => ended.push(value));
  hosts.onConnected((id) => connected.push(id));
  const settle = async (check: () => boolean) => {
    for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  };
  let restored: RemoteHosts | undefined;
  try {
    await writeFile(bundle, helper);
    const bin = join(root, 'bin');
    await mkdir(bin);
    // A transport fixture, not a real SSH host. It executes only this test's remote commands.
    await writeFile(
      join(bin, 'ssh'),
      '#!/bin/sh\nfor arg do command="$arg"; done\nexec /bin/sh -c "$command"\n',
    );
    await chmod(join(bin, 'ssh'), 0o755);
    process.env.PATH = bin + ':' + oldPath;
    process.env.HOME = root;
    await hosts.load();
    const host = await hosts.add('Build host', 'build-host');
    await setRuns([run('r1', 's1')]);
    assert.equal((await hosts.install(host.id)).status, 'connected');
    // The app starts the helper through the relay of the host.
    assert.match(await readFile(join(root, 'helper-args.txt'), 'utf8'), /^--attach$/m);
    assert.equal((await hosts.call(host.id, 'chatStatus', ['r1'])).status, 'running');
    assert.deepEqual([...hosts.liveRuns(host.id)], [['s1', 'r1']]);

    // The connection stops. The run continues on the host and the app keeps its last state.
    hosts.disconnect(host.id);
    const detached = await hosts.call(host.id, 'chatStatus', ['r1']);
    assert.equal(detached.status, 'running');
    assert.equal(detached.hostDetached, true);
    assert.match(detached.activity, /Running on the SSH host/);
    await assert.rejects(hosts.call(host.id, 'chatStop', ['r1']), /continues on the SSH host/);
    await assert.rejects(hosts.call(host.id, 'chatApprove', ['r1', 'a', true]), /Connect the host/);
    assert.equal(hosts.busy(host.id), true);
    assert.equal(ended.length, 0);

    // The run completes on the host. The app attaches again and gets the outcome.
    await setRuns([run('r1', 's1', 'completed'), run('r2', 's2')]);
    await hosts.connect(host.id);
    await settle(() => ended.length > 0);
    assert.deepEqual(
      ended.map((value) => [value.hostId, value.state.id, value.state.status, value.sessionId]),
      [[host.id, 'r1', 'completed', 's1']],
    );
    assert.equal((await hosts.call(host.id, 'chatStatus', ['r1'])).hostDetached, undefined);
    // The helper lists a run that this app did not start. The app follows it too.
    await settle(() => hosts.liveRuns(host.id).has('s2'));
    assert.deepEqual([...hosts.liveRuns(host.id)], [['s2', 'r2']]);
    assert.equal(connected.length, 2);

    // A new app session attaches to the runs that still work on the host.
    hosts.close();
    const next = new RemoteHosts(join(root, 'hosts.json'), bundle);
    restored = next;
    restored.onRunEnded((value) => ended.push(value));
    await restored.load();
    await restored.connect(host.id);
    await settle(() => next.liveRuns(host.id).has('s2'));
    assert.equal(restored.liveRuns(host.id).get('s2'), 'r2');
    // The user stops the run from the app.
    await restored.call(host.id, 'chatStop', ['r2']);
    assert.equal((await restored.call(host.id, 'chatStatus', ['r2'])).status, 'stopped');
    assert.equal(ended.at(-1).state.status, 'stopped');

    // A run that the host does not know any more ended with an unknown outcome.
    await setRuns([run('r3', 's3')]);
    assert.equal((await restored.call(host.id, 'chatStatus', ['r3'])).status, 'running');
    restored.disconnect(host.id);
    await setRuns([]);
    await restored.connect(host.id);
    await settle(() => ended.at(-1)?.state.id === 'r3');
    assert.deepEqual(
      [ended.at(-1).state.status, ended.at(-1).state.errorCode],
      ['failed', 'transport_lost'],
    );
    // A run that the app sees as running, but the helper lost, also ends.
    await setRuns([run('r4', 's4')]);
    await restored.call(host.id, 'chatStatus', ['r4']);
    await setRuns([]);
    assert.equal((await restored.call(host.id, 'chatStatus', ['r4'])).errorCode, 'transport_lost');
    // A different error of a run goes to the caller.
    await assert.rejects(restored.call(host.id, 'chatStatus', ['other']), /no longer available/);

    // A different app takes the helper. This app does not take it back.
    await writeFile(join(root, 'replace'), '');
    await assert.rejects(restored.call(host.id, 'hello', []));
    await settle(() => next.list()[0].status === 'error');
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(restored.list()[0].status, 'error');
    assert.match(restored.list()[0].error || '', /different Kalkidan app/);
  } finally {
    hosts.close();
    restored?.close();
    process.env.PATH = oldPath;
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    await rm(root, { recursive: true, force: true });
  }
});
