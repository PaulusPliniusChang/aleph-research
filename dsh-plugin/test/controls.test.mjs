import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile, access, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { ProjectService, snapshot, apply } from '../index-v2.js';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const exists=p=>access(p).then(()=>true,()=>false);
const wait=async fn=>{const end=Date.now()+6000;while(!await fn()){if(Date.now()>end)throw Error('fixture timeout');await delay(10);}};
const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const commit=repo=>{git(repo,'add','-A');git(repo,'-c','user.name=Test','-c','user.email=t@t','commit','-m','fixture');};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const table=()=>{const m=new Map();return{get:k=>m.has(k)?structuredClone(m.get(k)):undefined,put:async(k,v)=>{m.set(k,structuredClone(v));},entries:()=>[...m].map(([k,v])=>[k,structuredClone(v)])};};
const alive=async pid=>{try{return !['Z','X'].includes((await readFile(`/proc/${pid}/stat`,'utf8')).split(') ')[1][0]);}catch{return false;}};
async function fixture(){const root=await mkdtemp(join(tmpdir(),'aleph-controls-product-'));const records=table();const service=new ProjectService({},{table:()=>records},{});const project=await service.init({workspace:root,evalCommand:`python3 -c 'import json;print(json.dumps({"score":3}))'`});return{root,records,service,project,pid:project.id,clean:()=>rm(root,{recursive:true,force:true})};}
async function mission(f,name='work',code='printf artifact > "$ALEPH_OUTPUT_DIR/artifact.txt"\n'){
 const item=await f.service.startMission({projectId:f.pid,name});await writeFile(join(item.missionDir,'run.sh'),'#!/bin/sh\nset -e\n'+code);commit(item.worktree);
 const tip=git(item.worktree,'rev-parse','HEAD');const proposed=await f.service.propose({projectId:f.pid,branch:item.branch,agent:{id:'researcher'}});
 return{...item,tip,id:proposed.missions.find(m=>m.branch===item.branch).id};
}
async function batch(f,code,name='work'){const m=await mission(f,name,code);await f.service.approve({projectId:f.pid,missionId:m.id});const p=await f.service.formBatch({projectId:f.pid});return{...m,bid:p.batches.at(-1).id};}
const state=(f,id)=>f.service.get(f.pid).batches.find(b=>b.id===id);
const slowCode=f=>`exec python3 -c 'import os,time,pathlib;pathlib.Path("${f.root}/pid").write_text(str(os.getpid()));\nwhile not pathlib.Path("${f.root}/release").exists(): time.sleep(.02)'\n`;

test('persistent admission, queued cancellation, and retained research',async t=>{
 const f=await fixture(),c=f.service.controls;const point=(n,fn)=>t.test(n,fn);
 try{
  const m=await mission(f);
  await point('legacy projects are running without migration',()=>assert.equal(snapshot(f.service.get(f.pid)).project.status,'running'));
  let paused=await c.change({projectId:f.pid,operation:'pause',reason:'review'});
  await point('pause persists control and reason',()=>assert.equal(f.service.get(f.pid).control.reason,'review'));
  await point('snapshot reports actual paused state',()=>assert.equal(snapshot(f.service.get(f.pid)).project.status,'paused'));
  const rev=paused.control.revision,op=paused.control.operationId;
  await point('repeated pause retains revision and operation',async()=>{const r=await c.change({projectId:f.pid,operation:'pause'});assert.equal(r.control.revision,rev);assert.equal(r.control.operationId,op);assert.equal(r.idempotent,true);});
  await point('pause blocks mission workspace creation',async()=>assert.rejects(f.service.startMission({projectId:f.pid}),/paused/));
  await point('pause blocks proposals before Git inspection',async()=>assert.rejects(f.service.propose({projectId:f.pid,branch:'missing'}),/paused/));
  await point('pause blocks direct batch composition without new branch',async()=>{const before=git(f.project.missionRoot,'branch','--list');await assert.rejects(f.service.formBatch({projectId:f.pid}),/paused/);assert.equal(git(f.project.missionRoot,'branch','--list'),before);});
  await point('pause blocks research activation before worktree creation',async()=>assert.rejects(f.service.startResearcher({projectId:f.pid,agent:{id:'leader'}}),/paused/));
  await point('pause blocks researcher group before side effects',async()=>assert.rejects(f.service.startResearchers({projectId:f.pid,agent:{id:'leader'}}),/paused/));
  await point('pause blocks Composer startup',async()=>assert.rejects(f.service.runComposer({projectId:f.pid,agent:{id:'leader'}}),/paused/));
  let notifications=0;f.service.notifyComposer=async()=>{notifications++;return{delivered:false,reason:'no parent'};};
  await f.service.approve({projectId:f.pid,missionId:m.id});
  await point('paused approval admits queued mission',()=>assert.equal(f.service.get(f.pid).missions[0].status,'approved'));
  await point('paused approval sends no dispatch notification',()=>assert.equal(notifications,0));
  const resumed=await c.change({projectId:f.pid,operation:'resume'});
  await point('resume opens admission with incremented revision',()=>{assert.equal(resumed.control.state,'running');assert.equal(resumed.control.revision,rev+1);});
  await point('resume reports notification failure honestly',()=>assert.deepEqual(resumed.notification,{delivered:false,reason:'no parent'}));
  await point('duplicate resume sends no additional message',async()=>{await c.change({projectId:f.pid,operation:'resume'});assert.equal(notifications,1);});
  const cancelled=await c.cancelMission({projectId:f.pid,missionId:m.id,reason:'obsolete'});
  await point('queued cancellation persists cancelled status',()=>assert.equal(cancelled.mission.status,'cancelled'));
  await point('cancelled mission branch remains unchanged',()=>assert.equal(git(f.project.missionRoot,'rev-parse',m.branch),m.tip));
  await point('cancelled mission excluded from queued and counted separately',()=>{const s=snapshot(f.service.get(f.pid));assert.equal(s.counts.queued,0);assert.equal(s.counts.cancelled,1);});
  await point('repeated cancellation retains operation id',async()=>assert.equal((await c.cancelMission({projectId:f.pid,missionId:m.id})).mission.cancelOperationId,cancelled.mission.cancelOperationId));
  await point('approval cannot revive cancelled mission',async()=>{await f.service.approve({projectId:f.pid,missionId:m.id});assert.equal(f.service.get(f.pid).missions[0].status,'cancelled');});
  await point('Composer cannot select cancelled work',async()=>assert.rejects(f.service.formBatch({projectId:f.pid}),/no approved/));
  const finish=await c.change({projectId:f.pid,operation:'finish'});
  await point('empty project finishes immediately',()=>assert.equal(finish.control.state,'finished'));
  await point('finished project cannot resume',async()=>assert.rejects(c.change({projectId:f.pid,operation:'resume'}),/cannot resume/));
  await point('finished project rejects approval',async()=>assert.rejects(f.service.approve({projectId:f.pid,missionId:m.id}),/finished/));
  await point('finished project preserves evaluation access',async()=>assert.equal((await f.service.evaluate({projectId:f.pid,agent:{id:'researcher'}})).score,3));
  const restarted=new ProjectService({},{table:()=>f.records},{});await restarted.recoverAfterRestart();
  await point('finished state survives recovery',()=>assert.equal(restarted.get(f.pid).control.state,'finished'));
  await point('cancelled branch and evaluation history survive recovery',()=>{assert.equal(restarted.get(f.pid).missions[0].status,'cancelled');assert.equal(restarted.get(f.pid).evaluations.length,1);assert.equal(git(f.project.missionRoot,'rev-parse',m.branch),m.tip);});
 }finally{await f.clean();}
});

test('formed batch controls and restart launch fence',async t=>{
 const f=await fixture(),c=f.service.controls;const point=(n,fn)=>t.test(n,fn);
 try{const m=await batch(f);await c.change({projectId:f.pid,operation:'pause'});
  await point('paused formed batch cannot run',async()=>assert.rejects(f.service.runBatch({projectId:f.pid,batchId:m.bid}),/paused/));
  f.service.subagents={};
  await point('paused formed batch cannot start InfraOptimizer',async()=>assert.rejects(f.service.runInfra({projectId:f.pid,batchId:m.bid,agent:{id:'leader'}}),/paused/));
  await point('batched mission cancellation returns batch conflict',async()=>assert.rejects(c.cancelMission({projectId:f.pid,missionId:m.id}),new RegExp(m.bid)));
  const stop=await c.cancelBatch({projectId:f.pid,batchId:m.bid,reason:'withdraw'});
  await point('forming batch cancellation confirms completion',()=>assert.equal(stop.complete,true));
  await point('forming batch cancellation cancels undelivered mission',()=>assert.equal(f.service.get(f.pid).missions[0].status,'cancelled'));
  await point('forming batch cancellation releases matching machine',()=>assert.equal(f.service.get(f.pid).machines[0].batchId,null));
  await point('cancelled batch cannot be started',async()=>{await c.change({projectId:f.pid,operation:'resume'});await assert.rejects(f.service.runBatch({projectId:f.pid,batchId:m.bid}),/cancelled/);});
  await point('cancellation diagnostics are retained',async()=>assert.equal(JSON.parse(await readFile(join(stop.batch.cancellation.diagnosticPath,'cancellation.json'))).batchId,m.bid));
  await point('duplicate batch cancellation remains cancelled',async()=>assert.equal((await c.cancelBatch({projectId:f.pid,batchId:m.bid})).batch.status,'cancelled'));
  await c.change({projectId:f.pid,operation:'pause'});const restored=new ProjectService({},{table:()=>f.records},{});await restored.recoverAfterRestart();
  await point('pause survives Host recovery',()=>assert.equal(restored.get(f.pid).control.state,'paused'));
  await point('cancelled batch survives Host recovery',()=>assert.equal(restored.get(f.pid).batches[0].status,'cancelled'));
 }finally{await f.clean();}
});

test('real running batch cancellation preserves work and precise machine ownership',async t=>{
 const f=await fixture(),c=f.service.controls;const point=(n,fn)=>t.test(n,fn);
 try{const m=await batch(f,slowCode(f));const pending=f.service.runBatch({projectId:f.pid,batchId:m.bid});await wait(()=>exists(join(f.root,'pid')));const pid=Number(await readFile(join(f.root,'pid')));
  await point('active runner is a real process',async()=>assert.equal(await alive(pid),true));
  await point('running mission is reflected in snapshot',()=>assert.equal(snapshot(f.service.get(f.pid)).counts.running,1));
  await point('duplicate batch start is rejected before directory mutation',async()=>{await assert.rejects(f.service.runBatch({projectId:f.pid,batchId:m.bid}),/active execution/);assert.equal(await alive(pid),true);});
  const cancelled=await c.cancelBatch({projectId:f.pid,batchId:m.bid,reason:'stop training'});await pending;
  await point('running cancellation confirms owned computation stopped',async()=>{assert.equal(cancelled.complete,true);assert.equal(await alive(pid),false);});
  await point('cancelled running batch never becomes done',()=>assert.equal(state(f,m.bid).status,'cancelled'));
  await point('cancelled mission has no fabricated result commit',()=>assert.equal(f.service.get(f.pid).missions[0].resultCommit,null));
  await point('cancelled worktree remains available for diagnosis',async()=>assert.equal(await exists(state(f,m.bid).execution.worktree),true));
  await point('cancelled mission original branch remains intact',()=>assert.equal(git(f.project.missionRoot,'rev-parse',m.branch),m.tip));
  await point('machine releases only after cancellation confirmation',()=>{assert.equal(f.service.get(f.pid).machines[0].status,'idle');assert.equal(state(f,m.bid).execution.active,false);});
 }finally{await writeFile(join(f.root,'release'),'release').catch(()=>{});await f.clean();}
});

test('pause and finish drain existing compute without new dispatch',async t=>{
 const f=await fixture(),c=f.service.controls;const point=(n,fn)=>t.test(n,fn);
 try{const m=await batch(f,slowCode(f));let dispatch=0;f.service.notifyComposer=async()=>{dispatch++;return{delivered:true};};const pending=f.service.runBatch({projectId:f.pid,batchId:m.bid});await wait(()=>exists(join(f.root,'pid')));const pid=Number(await readFile(join(f.root,'pid')));
  await c.change({projectId:f.pid,operation:'pause'});
  await point('pause leaves running computation alive',async()=>assert.equal(await alive(pid),true));
  await point('pause does not convert running batch into cancelled',()=>assert.equal(state(f,m.bid).status,'running'));
  await c.change({projectId:f.pid,operation:'finish'});
  await point('finish reports draining while compute remains',()=>assert.equal(f.service.get(f.pid).control.state,'finishing'));
  await point('finish allows already running process to continue',async()=>assert.equal(await alive(pid),true));
  await writeFile(join(f.root,'release'),'release');await pending;
  await point('draining batch delivers normal results',()=>assert.equal(f.service.get(f.pid).missions[0].status,'done'));
  await point('last batch settles project to finished',()=>assert.equal(f.service.get(f.pid).control.state,'finished'));
  await point('finished batch sends no new dispatch notification',()=>assert.equal(dispatch,0));
 }finally{await writeFile(join(f.root,'release'),'release').catch(()=>{});await f.clean();}
});

for(const mode of ['paused','cancel-before-receipt','dispose-failure','finished'])test(`InfraOptimizer exact ownership: ${mode}`,async t=>{
 const f=await fixture(),c=f.service.controls;const point=(n,fn)=>t.test(n,fn);const published=deferred(),result=deferred(),started=deferred();let disposed=0;let request;
 try{const m=await batch(f);const originalTip=git(f.project.missionRoot,'rev-parse',state(f,m.bid).branch);
  f.service.subagents={async startActivation(spec){request=spec;started.resolve();if(mode==='cancel-before-receipt')await published.promise;return{childId:'infra-exact',result:result.promise,dispose:async()=>{disposed++;result.resolve({output:[]});if(mode==='dispose-failure')throw Error('disposal uncertain');}};}};
  const pending=f.service.runInfra({projectId:f.pid,batchId:m.bid,agent:{id:'leader'}});await started.promise;await writeFile(join(request.request.cwd,'optimization.txt'),'retained optimization');
  await point('duplicate Infra startup is rejected without erasing edits',async()=>{await assert.rejects(f.service.runInfra({projectId:f.pid,batchId:m.bid,agent:{id:'leader'}}),/active execution/);assert.equal(await readFile(join(request.request.cwd,'optimization.txt'),'utf8'),'retained optimization');});
  if(mode==='paused'||mode==='finished'){
   await c.change({projectId:f.pid,operation:mode==='paused'?'pause':'finish'});result.resolve({output:[]});await pending;
   await point('existing optimization can commit after dispatch closes',()=>assert.notEqual(git(f.project.missionRoot,'rev-parse',state(f,m.bid).branch),originalTip));
   await point('closed dispatch prevents Infra completion starting compute',()=>assert.equal(state(f,m.bid).status,'forming'));
   await point('Infra completion closes only its own activation record',()=>assert.equal(f.service.get(f.pid).agents.find(a=>a.childId==='infra-exact').status,'done'));
   if(mode==='finished')await point('finished project retains unstarted optimized batch',()=>assert.equal(f.service.get(f.pid).control.state,'finished'));
  }else{
   const stop=c.cancelBatch({projectId:f.pid,batchId:m.bid});await wait(()=>state(f,m.bid).status==='cancelling');published.resolve();const stopped=await stop;await pending;
   await point('cancelled activation receives exact receipt disposal',()=>assert.ok(disposed>=1));
   await point('late successful result never advances batch branch',()=>assert.equal(git(f.project.missionRoot,'rev-parse',state(f,m.bid).branch),originalTip));
   await point('cancelled optimization edits remain in original directory',async()=>assert.equal(await readFile(join(request.request.cwd,'optimization.txt'),'utf8'),'retained optimization'));
   if(mode==='dispose-failure'){
    await point('failed dispose does not report cancellation complete',()=>assert.equal(stopped.complete,false));
    await point('failed dispose retains cancelling and busy machine',()=>{assert.equal(state(f,m.bid).status,'cancelling');assert.equal(f.service.get(f.pid).machines[0].status,'busy');});
   }else await point('cancel before receipt publication completes without running batch',()=>assert.equal(state(f,m.bid).status,'cancelled'));
  }
 }finally{published.resolve();result.resolve({output:[]});await f.clean();}
});

test('cancellation and result publication share one short transaction',async t=>{
 const f=await fixture(),point=(n,fn)=>t.test(n,fn);const hold=deferred(),ready=deferred();
 try{const m=await batch(f);const command=f.service.controls.command.bind(f.service.controls);f.service.controls.command=async(...args)=>{const result=await command(...args);ready.resolve();await hold.promise;return result;};
  const pending=f.service.runBatch({projectId:f.pid,batchId:m.bid});await ready.promise;const stopping=f.service.controls.cancelBatch({projectId:f.pid,batchId:m.bid});await wait(()=>state(f,m.bid).status==='cancelling');hold.resolve();await pending;await stopping;
  await point('cancel intent before publishing blocks mission result reference',()=>assert.equal(f.service.get(f.pid).missions[0].resultCommit,null));
  await point('cancel intent before publishing preserves branch tip',()=>assert.equal(git(f.project.missionRoot,'rev-parse',m.branch),m.tip));
 }finally{hold.resolve();await f.clean();}
});

test('restart reconciles a command reserved before spawn without false ownership',async t=>{
 const f=await fixture(),point=(n,fn)=>t.test(n,fn);
 try{const m=await batch(f);const owner=await f.service.controls.reserve(f.pid,m.bid,'batch');const path=join(f.root,'.aleph','executions',owner.executionId,'1.json');await f.service.mutate(f.pid,p=>({...p,batches:p.batches.map(b=>b.id===m.bid?{...b,status:'cancelling',cancellation:{operationId:'restart-cancel',requestedAt:new Date().toISOString(),reason:'restart'},execution:{...b.execution,commands:[{id:owner.executionId+'-1',phase:'starting',receiptPath:path}]}}:b)}));
  const restored=new ProjectService({},{table:()=>f.records},{});await restored.recoverAfterRestart();
  await point('pre-spawn crash recovery settles persisted cancellation',()=>assert.equal(restored.get(f.pid).batches[0].status,'cancelled'));
  await point('pre-spawn crash recovery releases verified unadmitted machine',()=>assert.equal(restored.get(f.pid).machines[0].status,'idle'));
  await point('pre-spawn recovery writes durable delayed-launch fence',async()=>assert.equal(await exists(path+'.stop'),true));
 }finally{await f.clean();}
});

test('Composer cleanup never waits on the tool currently calling finish',async t=>{
 const f=await fixture(),point=(n,fn)=>t.test(n,fn),toolReturned=deferred();let started=false;
 try{f.service.controls.composers.set(f.pid,{receipt:{dispose:async()=>{started=true;await toolReturned.promise;}}});
  const completed=await Promise.race([f.service.controls.change({projectId:f.pid,operation:'finish'}),delay(1000).then(()=>{throw Error('self-wait');})]);
  await point('finish tool returns while exact Composer disposal awaits caller',()=>assert.equal(completed.control.state,'finished'));
  await point('finish reports Composer cleanup pending separately',()=>assert.equal(completed.control.composerCleanup,'pending'));
  await wait(()=>started);toolReturned.resolve();await wait(()=>f.service.get(f.pid).control.composerCleanup==='complete');
  await point('Composer cleanup completes after caller releases',()=>assert.equal(f.service.get(f.pid).control.composerCleanup,'complete'));
 }finally{toolReturned.resolve();await f.clean();}
});

test('registered control tools enforce Leader authority; HTTP operator routes use same controls',async t=>{
 const root=await mkdtemp(join(tmpdir(),'aleph-control-tools-')),records=table(),tools=new Map(),routes=new Map();let preset='aleph';let cwd=root;const point=(n,fn)=>t.test(n,fn);
 try{await apply({storageDomain:{open:async()=>({table:()=>records,close:async()=>{}})},get:n=>({sessions:{get:()=>({header:{cwd}})},agentPresets:{presetForSession:()=>preset}})[n],effect:()=>{},tools:{register:d=>{tools.set(d.name,d);return()=>{};}},webServer:{register:d=>routes.set(d.path,d)}});
  const invoke=(name,args)=>tools.get(name).execute(args,{agent:{id:'leader'}});const p=await invoke('aleph_init_project',{workspace:root});
  for(const name of ['pause_project','resume_project','finish_project','cancel_mission','cancel_batch'])await point(`${name} tool is registered`,()=>assert.ok(tools.has('aleph_'+name)));
  preset='aleph-researcher';await point('non-Leader execution is rejected even when directly invoked',async()=>assert.rejects(invoke('aleph_pause_project',{project_id:p.id}),/Leader/));preset='aleph';cwd=join(root,'other');
  await point('Leader from another workspace cannot control project',async()=>assert.rejects(invoke('aleph_pause_project',{project_id:p.id}),/workspace/));cwd=root;
  await invoke('aleph_pause_project',{project_id:p.id});
  await point('authorized Leader control uses persisted service state',()=>assert.equal(records.get(p.id).control.state,'paused'));
  const request=async(path,method,body)=>{const req={method,async *[Symbol.asyncIterator](){if(body)yield Buffer.from(body);}};let status,text;const res={writeHead:s=>status=s,end:value=>text=value};await routes.get(path).handler(req,res);return{status,value:JSON.parse(text)};};
  await point('operator route rejects GET state change',async()=>assert.equal((await request('/api/aleph/project/resume','GET')).status,405));
  await point('operator route rejects malformed JSON',async()=>assert.equal((await request('/api/aleph/project/resume','POST','{')).status,400));
  await point('operator resume shares persisted control implementation',async()=>{const result=await request('/api/aleph/project/resume','POST',JSON.stringify({project_id:p.id}));assert.equal(result.status,200);assert.equal(result.value.control.state,'running');});
  await point('operator route missing project reports 404',async()=>assert.equal((await request('/api/aleph/project/pause','POST',JSON.stringify({project_id:'absent'}))).status,404));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('real dependency preparation is owned and cancellable before the batch runner',async t=>{
 const f=await fixture(),point=(n,fn)=>t.test(n,fn),originalPath=process.env.PATH;
 try{
  const m=await mission(f);git(f.project.missionRoot,'switch',m.branch);
  await writeFile(join(f.project.missionRoot,'missions','work','pyproject.toml'),'[project]\nname="owned-preparation"\nversion="0.1.0"\n');commit(f.project.missionRoot);git(f.project.missionRoot,'switch','template');
  await f.service.approve({projectId:f.pid,missionId:m.id});const formed=await f.service.formBatch({projectId:f.pid});const bid=formed.batches[0].id;
  const bin=join(f.root,'bin');await mkdir(bin);const marker=join(f.root,'prepare-pid');
  await writeFile(join(bin,'uv'),`#!/bin/sh\nexec /usr/bin/python3 -c 'import os,time,pathlib;pathlib.Path("${marker}").write_text(str(os.getpid()));time.sleep(30)'\n`);await chmod(join(bin,'uv'),0o755);process.env.PATH=bin+':'+originalPath;
  const pending=f.service.runBatch({projectId:f.pid,batchId:bid});await wait(()=>exists(marker));const pid=Number(await readFile(marker));
  await point('dependency setup starts a real owned process',async()=>assert.equal(await alive(pid),true));
  await point('preparation phase retains forming status before runner',()=>assert.equal(state(f,bid).status,'forming'));
  await point('preparation identity is durable before cancellation',()=>assert.equal(state(f,bid).execution.commands[0].phase,'starting'));
  const cancelled=await f.service.controls.cancelBatch({projectId:f.pid,batchId:bid});await pending;
  await point('preparation cancellation confirms process termination',async()=>{assert.equal(cancelled.complete,true);assert.equal(await alive(pid),false);});
  await point('cancelled preparation never dispatches batch runner',()=>assert.equal(state(f,bid).execution.commands.length,1));
  await point('cancelled preparation retains dependency worktree',async()=>assert.equal(await exists(state(f,bid).execution.worktree),true));
 }finally{process.env.PATH=originalPath;await f.clean();}
});

test('delivery published before cancellation remains done while remaining work is cancelled',async t=>{
 const f=await fixture(),point=(n,fn)=>t.test(n,fn),published=deferred(),release=deferred();
 try{
  const first=await mission(f,'one'),second=await mission(f,'two');
  await f.service.approve({projectId:f.pid,missionId:first.id});await f.service.approve({projectId:f.pid,missionId:second.id});
  const formed=await f.service.formBatch({projectId:f.pid}),bid=formed.batches[0].id;
  const put=f.records.put;let held=false;f.records.put=async(key,value)=>{await put(key,value);if(!held&&value.missions.find(m=>m.id===first.id)?.status==='done'){held=true;published.resolve();await release.promise;}};
  const pending=f.service.runBatch({projectId:f.pid,batchId:bid});await published.promise;
  const stopping=f.service.controls.cancelBatch({projectId:f.pid,batchId:bid});await delay(10);
  await point('result publication and persisted done state precede cancel acquisition',()=>{assert.equal(f.service.get(f.pid).missions.find(m=>m.id===first.id).status,'done');assert.equal(state(f,bid).status,'running');});
  release.resolve();await stopping;await pending;
  const current=f.service.get(f.pid),delivered=current.missions.find(m=>m.id===first.id),cancelled=current.missions.find(m=>m.id===second.id);
  await point('already published mission remains done after whole-batch cancel',()=>assert.equal(delivered.status,'done'));
  await point('already published result reference remains readable',()=>assert.equal(git(f.project.missionRoot,'show',delivered.resultCommit+':results/one/artifact.txt'),'artifact'));
  await point('remaining unpublished mission becomes cancelled',()=>assert.equal(cancelled.status,'cancelled'));
  await point('unpublished second branch stays at original mission commit',()=>assert.equal(git(f.project.missionRoot,'rev-parse',second.branch),second.tip));
  await point('partial delivery still ends whole batch as cancelled',()=>assert.equal(state(f,bid).status,'cancelled'));
 }finally{release.resolve();await f.clean();}
});

test('Infra preparation reservation precedes a delayed real worktree-add return',async t=>{
 const f=await fixture(),point=(n,fn)=>t.test(n,fn),originalPath=process.env.PATH;let pending;const release=join(f.root,'git-release');
 try{
  const m=await batch(f);const bin=join(f.root,'bin');await mkdir(bin);const prepared=join(f.root,'git-prepared');
  const realGit=execFileSync('which',['git'],{encoding:'utf8'}).trim();
  await writeFile(join(bin,'git'),`#!/usr/bin/python3\nimport subprocess,sys,time,pathlib\na=sys.argv[1:]\nr=subprocess.run([${JSON.stringify(realGit)},*a])\nif r.returncode==0 and 'worktree' in a and 'add' in a and any('/.aleph/infra/' in x for x in a):\n pathlib.Path(${JSON.stringify(prepared)}).write_text('real add succeeded')\n end=time.time()+8\n while not pathlib.Path(${JSON.stringify(release)}).exists() and time.time()<end:time.sleep(.01)\nsys.exit(r.returncode)\n`);await chmod(join(bin,'git'),0o755);process.env.PATH=bin+':'+originalPath;
  let activations=0;f.service.subagents={startActivation:async()=>{activations++;return{childId:'after-preparation',result:Promise.resolve({output:[]}),dispose:async()=>{}};}};
  pending=f.service.runInfra({projectId:f.pid,batchId:m.bid,agent:{id:'leader'}});await wait(()=>exists(prepared));
  const worktree=join(f.root,'.aleph','infra',m.bid);await writeFile(join(worktree,'sentinel.txt'),'first preparation remains');
  await point('first actual worktree exists while add return is delayed',async()=>assert.equal(git(worktree,'rev-parse','--is-inside-work-tree'),'true'));
  await point('second same-batch Infra request is rejected in preparation gap',async()=>assert.rejects(f.service.runInfra({projectId:f.pid,batchId:m.bid,agent:{id:'other-leader'}}),/active execution/));
  await point('rejected request preserves first real worktree and contents',async()=>assert.equal(await readFile(join(worktree,'sentinel.txt'),'utf8'),'first preparation remains'));
  await point('duplicate preparation request starts no Infra model activation',()=>assert.equal(activations,0));
  await f.service.controls.change({projectId:f.pid,operation:'pause'});await writeFile(release,'go');await pending;
  await point('original preparation resumes and exact activation completes',()=>assert.equal(activations,1));
  await point('original preparation modifications survive into optimized branch',()=>assert.equal(git(f.project.missionRoot,'show',state(f,m.bid).branch+':sentinel.txt'),'first preparation remains'));
 }finally{await writeFile(release,'go').catch(()=>{});if(pending)await pending.catch(()=>{});process.env.PATH=originalPath;await f.clean();}
});
