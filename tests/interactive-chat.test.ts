import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InteractiveChatRunner } from '../electron/interactive-chat';
import { acceptedManagedLaunch } from './helpers/managed-launch';
import { ProjectGroups } from '../electron/project-groups';
import type { Session } from '../src/types';

async function until(fn: () => boolean) {
  const end = Date.now() + 5000;
  while (!fn() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 15));
  assert.ok(fn(), 'Expected protocol state was not reached');
}
const fixture = `#!${process.execPath}
const { createInterface } = require('node:readline');
const codex = process.argv.includes('app-server');
let session = 'session';
const emit = row => process.stdout.write(JSON.stringify(row) + '\\n');
const done = approved => {
 if(codex) {
  emit({method:'item/completed',params:{threadId:session,item:{id:'command',type:'commandExecution',command:'git status',status:approved?'completed':'declined',aggregatedOutput:approved?'clean':'denied'}}});
  emit({method:'turn/diff/updated',params:{threadId:session,diff:'--- a/file\\n+++ b/file\\n+change'}});
  emit({method:'item/agentMessage/delta',params:{threadId:session,itemId:'message',delta:approved?'Approved result':'Denied result'}});
  emit({method:'turn/completed',params:{threadId:session,turn:{id:'turn',status:'completed'}}});
 } else {
  emit({type:'user',message:{content:[{type:'tool_result',tool_use_id:'command',content:approved?'clean':'denied',is_error:!approved}]}});
  emit({type:'assistant',message:{id:'message',content:[{type:'text',text:approved?'Approved result':'Denied result'}]}});
  emit({type:'result',is_error:false});
 }
};
createInterface({input:process.stdin}).on('line',line=>{
 const row = JSON.parse(line);
 if(codex) {
  if(row.method==='initialize') emit({id:row.id,result:{}});
  if(row.method==='thread/start'||row.method==='thread/resume'||row.method==='thread/fork') {
   session = row.method==='thread/fork' ? 'forked-session' : row.params.threadId || 'created-session';
   if(process.env.PROVIDER_LOG) require('node:fs').appendFileSync(process.env.PROVIDER_LOG, String(row.params.modelProvider)+'\\n');
   if(session==='busy') return emit({id:row.id,error:{message:'thread already has an active writer'}});
   if(row.params.model!=='fixture-model'||row.params.approvalPolicy!=='on-request'||row.params.approvalsReviewer!=='user') process.exit(5);
   emit({id:row.id,result:{thread:{id:session}}});
  }
  if(row.method==='turn/start') {
   emit({id:row.id,result:{turn:{id:'turn'}}});
   emit({method:'item/started',params:{threadId:session,item:{id:'command',type:'commandExecution',command:'git status',status:'inProgress'}}});
   emit({id:44,method:'item/commandExecution/requestApproval',params:{threadId:session,turnId:'turn',itemId:'command',command:'git status',reason:'Check work'}});
  }
  if(row.id===44&&row.result) { if(!['accept','decline'].includes(row.result.decision)) process.exit(6); done(row.result.decision==='accept'); }
 } else {
  if(row.type==='control_request'&&row.request.subtype==='initialize') emit({type:'control_response',response:{subtype:'success',request_id:row.request_id,response:{}}});
  if(row.type==='user') {
   session=process.argv.includes('--fork-session')?'forked-session':row.session_id;
   emit({type:'system',subtype:'init',session_id:session});
   emit({type:'assistant',message:{id:'tool-message',content:[{type:'tool_use',id:'command',name:'Bash',input:{command:'git status'}}]}});
   emit({type:'control_request',request_id:'permission',request:{subtype:'can_use_tool',tool_name:'Bash',input:{command:'git status'}}});
  }
  if(row.type==='control_response') {
   const result=row.response.response;
   if(result.behavior==='allow'&&result.updatedInput.command!=='git status') process.exit(7);
   done(result.behavior==='allow');
  }
 }
});
`;

for (const agent of ['codex', 'claude'] as const)
  test(`${agent}: requests pause for an explicit answer, retain output, reject stale approvals, and stop safely`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'kalkidan-interactive-'));
    const path = join(root, 'agent');
    await writeFile(path, fixture);
    await chmod(path, 0o755);
    const runner = new InteractiveChatRunner(
      async () => ({ path, env: process.env }),
      undefined,
      false,
      acceptedManagedLaunch,
    );
    const session: Session = { id: 'session', cwd: root, agent, title: 'Fixture', updatedAt: '' };
    try {
      for (const allow of [true, false]) {
        const state = await runner.start(
          session,
          'Check the repository',
          true,
          allow,
          'fixture-model',
        );
        await until(() => !!state.approvals?.some((a) => a.status === 'pending'));
        assert.equal(state.status, 'running');
        assert.equal(state.messages.length, 0);
        assert.equal(state.sessionReady, true);
        assert.equal(state.sessionId, agent === 'codex' && allow ? 'created-session' : session.id);
        assert.match(state.tools![0].title, /git status|Bash/);
        await assert.rejects(runner.start(session, 'duplicate', true), /already/);
        assert.throws(
          () => runner.approve('another-run', state.approvals![0].id, true),
          /no longer pending/,
        );
        runner.approve(state.id, state.approvals![0].id, allow);
        assert.throws(
          () => runner.approve(state.id, state.approvals![0].id, true),
          /no longer pending/,
        );
        await until(() => state.status !== 'running');
        assert.equal(state.status, 'completed');
        assert.equal(state.messages[0].text, allow ? 'Approved result' : 'Denied result');
        assert.equal(state.approvals![0].status, allow ? 'approved' : 'denied');
        assert.match(state.tools![0].detail!, allow ? /clean/ : /denied/);
        if (agent === 'codex') assert.match(state.diff!, /\+change/);
      }
      const stopped = await runner.start(
        session,
        'Stop before approval',
        false,
        false,
        'fixture-model',
      );
      await until(() => !!stopped.approvals?.length);
      runner.stop(stopped.id);
      assert.equal(stopped.status, 'stopped');
      assert.equal(stopped.approvals![0].status, 'expired');
      assert.throws(() => runner.approve(stopped.id, stopped.approvals![0].id, true));
      if (agent === 'codex') {
        const busy = await runner.start(
          { ...session, id: 'busy' },
          'retry me',
          false,
          false,
          'fixture-model',
        );
        await until(() => busy.status === 'failed');
        assert.equal(busy.errorCode, 'session_busy');
        assert.match(busy.error!, /another client/);
      }
    } finally {
      runner.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

test('new projects require a tracker and legacy projects discard obsolete client metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-clients-'));
  try {
    const file = join(root, 'groups.json');
    await writeFile(
      file,
      JSON.stringify([
        { id: 'legacy', name: 'Existing work', repoIds: ['repo'], client: 'Old label' },
      ]),
    );
    const groups = new ProjectGroups(file);
    await groups.load();
    await assert.rejects(groups.create('Unlinked', undefined as any), /tracker/);
    const gh = {
      id: 'github',
      title: 'Roadmap',
      url: 'https://github.com/orgs/example/projects/1',
      owner: 'example',
      number: 1,
    };
    const id = await groups.create('New work', gh);
    await groups.update('legacy', 'Existing work');
    await groups.link('legacy', gh);
    await assert.rejects(groups.link(id, undefined), /require a GitHub connection/);
    const persisted = JSON.parse(await readFile(file, 'utf8'));
    assert.equal('client' in persisted[0], false);
    assert.deepEqual(persisted[0].repoIds, ['repo']);
    assert.equal('client' in persisted[1], false);
    assert.equal(persisted[1].github.id, 'github');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const agent of ['codex', 'claude'] as const)
  test(`${agent}: fork inherits the source through the native protocol and receives a distinct ID`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'kalkidan-fork-'));
    const path = join(root, 'agent');
    await writeFile(path, fixture);
    await chmod(path, 0o755);
    const runner = new InteractiveChatRunner(
      async () => ({ path, env: process.env }),
      undefined,
      false,
      acceptedManagedLaunch,
    );
    try {
      const run = await runner.start(
        { id: 'new-session', agent, cwd: root, title: 'Fork', updatedAt: '' },
        'Try another direction',
        false,
        true,
        'fixture-model',
        'source-session',
      );
      await until(() => !!run.approvals?.length);
      assert.equal(run.sessionId, 'forked-session');
      assert.equal(run.sessionReady, true);
      runner.approve(run.id, run.approvals![0].id, false);
      await until(() => run.status === 'completed');
    } finally {
      runner.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

test('codex: thread/start names the model provider that the managed launch defines', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-provider-'));
  const path = join(root, 'agent');
  const log = join(root, 'providers.log');
  await writeFile(path, fixture);
  await chmod(path, 0o755);
  for (const modelProvider of ['verdictan_subscription', 'verdictan', undefined]) {
    const runner = new InteractiveChatRunner(
      async () => ({ path, env: { ...process.env, PROVIDER_LOG: log } }),
      undefined,
      false,
      async (request) => ({
        ...(await acceptedManagedLaunch(request)),
        ...(modelProvider ? { modelProvider } : {}),
      }),
    );
    const session: Session = {
      id: 'session',
      cwd: root,
      agent: 'codex',
      title: 'Fixture',
      updatedAt: '',
    };
    try {
      const state = await runner.start(session, 'Check', true, false, 'fixture-model');
      await until(() => !!state.approvals?.length || state.status !== 'running');
      runner.stop(state.id);
    } finally {
      runner.dispose();
    }
  }
  try {
    // Without a provider from the launch, the request names none, and the `-c` arguments apply.
    assert.deepEqual((await readFile(log, 'utf8')).trim().split('\n'), [
      'verdictan_subscription',
      'verdictan',
      'undefined',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
