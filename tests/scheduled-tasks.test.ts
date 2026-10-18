import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScheduledTasks } from '../electron/scheduled-tasks';
import type { Session, ChatRun } from '../src/types';
const session: Session = { id:'session', agent:'codex', cwd:'/fixture', title:'Test', updatedAt:'' };
test('schedules persist, run once, expose approvals, track completion, and mark downtime as missed',async()=>{
 const root=await mkdtemp(join(tmpdir(),'kalkidan-schedule-')); let now=100000;let starts=0;
 const run:ChatRun={id:'run',agent:'codex',sessionId:'session',status:'running',messages:[],activity:'Waiting',approvals:[{id:'approval',title:'Permission',detail:'Inspect',status:'pending'}]};
 const make=()=>new ScheduledTasks(join(root,'tasks.json'),async()=>{starts++;return {...run};},async()=>({...run}),async()=>{},()=>now);
 try{const tasks=make();await tasks.load();await assert.rejects(tasks.add(session,'',new Date(now+1000).toISOString()));const task=await tasks.add(session,'Review the code',new Date(now+1000).toISOString());now+=1000;await tasks.tick();await tasks.tick();assert.equal(starts,1);assert.equal(task.run?.approvals?.[0].status,'pending');run.status='completed';await tasks.tick();assert.equal(task.status,'completed');await tasks.add(session,'Later',new Date(now+1000).toISOString());now+=2000;const restarted=make();await restarted.load();assert.equal(restarted.tasks[1].status,'missed');await restarted.tick();assert.equal(starts,1);await restarted.run(restarted.tasks[1].id);assert.equal(starts,2);await restarted.cancel(restarted.tasks[1].id);assert.equal(restarted.tasks[1].status,'cancelled');}finally{await rm(root,{recursive:true,force:true});}
});
