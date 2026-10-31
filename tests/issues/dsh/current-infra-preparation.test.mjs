import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
const actual=Boolean(process.env.ALEPH_INFRA_PREPARATION_ACTUAL_CONFIG);
const cfg=actual?JSON.parse(readFileSync(process.env.ALEPH_INFRA_PREPARATION_ACTUAL_CONFIG,'utf8')):{};
const source=resolve(cfg.source||process.env.ALEPH_CURRENT_SOURCE||'/home/paulus-chang/项目/aleph');
const gate=process.env.ALEPH_INFRA_PREPARATION_GATE;
const output=cfg.output||process.env.ALEPH_INFRA_PREPARATION_OUTPUT;
const r={source,sha:execFileSync('/usr/bin/git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),actual,checks:[],events:[],boundary:'Only the first exact infra worktree-add response is delayed after real Git completes. Filesystem operations, subsequent Git commands and DSH tools/storage are real. Automatic substitutes storage/session/presets/activation services; actual starts a genuine researcher for a Git/session control, with deterministic model responses. The infra preparation failure happens before an infra model starts.'};
const save=()=>output&&writeFileSync(output,JSON.stringify(r,null,2));
const git=(repo,...args)=>execFileSync('/usr/bin/git',['-C',repo,...args],{encoding:'utf8'}).trim();
const sleep=ms=>new Promise(f=>setTimeout(f,ms));
async function until(fn,label){const end=Date.now()+12000;while(!await fn()){if(Date.now()>end)throw Error('fixture timeout '+label);await sleep(20);}}
async function http(path,body){const response=await fetch(cfg.url+path,{method:body===undefined?'GET':'POST',headers:{Origin:cfg.url,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw Error(JSON.stringify(value));return value;}
async function bridge(body){const v=await http('/api/aleph-test/bridge',body);if(!v.ok)throw Error(JSON.stringify(v));return v.result;}
const result=p=>p.then(value=>({value}),e=>({error:e.message}));
test('current upstream InfraOptimizer preparation exclusion and intact normal controls',async t=>{
 const point=async(name,fn)=>t.test(name,async()=>{try{await fn();r.checks.push({name,passed:true});}catch(e){r.checks.push({name,passed:false,error:e.message});throw e;}finally{save();}});
 const workspace=actual?cfg.workspace:mkdtempSync(join(tmpdir(),'aleph-current-infra-'));let sid,invoke,table;const tools=new Map();
 if(actual){sid=(await bridge({action:'parent',cwd:workspace})).sessionId;invoke=(name,args,caller=sid)=>bridge({action:'tool',sessionId:caller,name,args});}
 else{sid='infra-leader';const values=new Map();table={get:k=>values.has(k)?structuredClone(values.get(k)):undefined,entries:()=>[...values].map(([k,v])=>[k,structuredClone(v)]),put:async(k,v)=>values.set(k,structuredClone(v))};const {apply}=await import(pathToFileURL(join(source,'dsh-plugin/index-v2.js')));await apply({storageDomain:{open:async()=>({table:()=>table,close:async()=>{}})},get:n=>({sessions:{get:()=>({header:{cwd:workspace}})},agentPresets:{presetForSession:()=> 'aleph'},subagents:{startActivation:async o=>{if(!existsSync(o.request.cwd))throw Error('fixture activation cwd no longer exists');return {childId:'fixture-child',result:new Promise(()=>{})};},sendMessage:async()=>{}}})[n],effect:()=>{},tools:{register:d=>{tools.set(d.name,d);return()=>{};}},webServer:{register:()=>{}}});invoke=(name,args,caller=sid)=>tools.get(name).execute(args,{agent:{id:caller}});}
 const p=await invoke('aleph_init_project',{workspace});r.project=p;const args={project_id:p.id};const state=async()=> (await invoke('aleph_status',args))[0];
 await point('new research repository has real Git objects',()=>assert.equal(git(p.researchRoot,'rev-parse','--is-inside-work-tree'),'true'));
 await point('new mission repository has real Git objects',()=>assert.equal(git(p.missionRoot,'rev-parse','--is-inside-work-tree'),'true'));
 await point('new project has one idle local machine',async()=>{const s=await state();assert.equal(s.machines.length,1);assert.equal(s.machines[0].status,'idle');});
 await point('new project has no stale infra record',async()=>assert.equal((await state()).agents.filter(a=>a.role==='infra').length,0));
 const mission=await invoke('aleph_start_mission',{...args,name:'preparation'});r.mission=mission;const dir=join(mission.worktree,'missions/preparation');
 writeFileSync(join(dir,'run.sh'),'printf done > "$ALEPH_OUTPUT_DIR/completed.txt"\n');git(mission.worktree,'add','-A');git(mission.worktree,'-c','user.name=Test','-c','user.email=test@localhost','commit','-m','current preparation fixture');const tip=git(mission.worktree,'rev-parse','HEAD');
 await point('mission uses the returned owned worktree',()=>assert.equal(git(mission.worktree,'rev-parse','--show-toplevel'),mission.worktree));
 await point('mission owns the expected branch',()=>assert.equal(git(mission.worktree,'branch','--show-current'),mission.branch));
 await point('mission script is committed before proposal',()=>assert.match(git(p.missionRoot,'show',tip+':missions/preparation/run.sh'),/completed/));
 const proposed=await invoke('aleph_propose_mission',{...args,branch:mission.branch});const m=proposed.missions.find(m=>m.branch===mission.branch);
 await point('proposal records actual owner',()=>assert.equal(m.ownerSession,sid));
 await point('proposal persists proposed status',()=>assert.equal(m.status,'proposed'));
 const approved=await invoke('aleph_approve_mission',{...args,mission_id:m.id});
 await point('approval persists approved status',()=>assert.equal(approved.missions.find(i=>i.id===m.id).status,'approved'));
 await point('approval retains committed mission tip',()=>assert.equal(git(p.missionRoot,'rev-parse',mission.branch),tip));
 const formed=await invoke('aleph_form_batch',args);const b=formed.batches[0];r.batch=b;const worktree=join(workspace,'.aleph/infra',b.id);
 await point('composition creates forming batch',()=>assert.equal(b.status,'forming'));
 await point('composition associates selected mission',()=>assert.ok(b.missionIds.includes(m.id)));
 await point('composition records expected source tip',()=>assert.equal(formed.missions.find(i=>i.id===m.id).preBatchTip,tip));
 await point('composition reserves machine for the batch',async()=>assert.equal((await state()).machines[0].batchId,b.id));
 await point('batch branch contains mission script',()=>assert.match(git(p.missionRoot,'show',b.branch+':missions/preparation/run.sh'),/completed/));
 writeFileSync(join(gate,'armed.json'),JSON.stringify({repo:p.missionRoot,worktree,branch:b.branch}));
 let firstSettled=false;const first=result(invoke('aleph_run_infra',{...args,batch_id:b.id})).then(v=>{firstSettled=true;return v;});
 try{
  await until(()=>existsSync(join(gate,'worktree-add-1.json')),'first real worktree add completes');const firstGit=JSON.parse(readFileSync(join(gate,'worktree-add-1.json'),'utf8'));r.firstGit=firstGit;
  await point('first request really completed Git worktree creation',()=>assert.equal(firstGit.returncode,0));
  await point('first request has not returned during preparation',()=>assert.equal(firstSettled,false));
  await point('first worktree points at the real batch tip',()=>assert.equal(git(worktree,'rev-parse','HEAD'),git(p.missionRoot,'rev-parse',b.branch)));
  await point('preparing directory has a Git worktree identity',()=>assert.ok(readFileSync(join(worktree,'.git'),'utf8').startsWith('gitdir:')));
  await point('preparing role is not yet recorded running',async()=>assert.equal((await state()).agents.filter(a=>a.role==='infra'&&a.status==='running').length,0));
  writeFileSync(join(worktree,'preparation-marker.txt'),'first prepared directory\n');const ino=statSync(worktree).ino;r.preparedInode=ino;const batchTip=git(p.missionRoot,'rev-parse',b.branch);
  const second=await result(invoke('aleph_run_infra',{...args,batch_id:b.id}));r.second=second;
  await point(actual?'defect: second request reaches stale Git registration':'second request must reject before Git re-registration',()=>actual?assert.match(second.error||'',/already registered worktree/):assert.doesNotMatch(second.error||'',/already registered worktree|worktree add/));
  await point('second request explicitly returns an error',()=>assert.ok(second.error));
  await point('first request remains pending when second fails',()=>assert.equal(firstSettled,false));
  await point(actual?'defect: first directory was removed':'first prepared directory must survive duplicate request',()=>assert.equal(existsSync(worktree),!actual));
  await point(actual?'defect: first preparation marker was removed':'first preparation marker must survive duplicate request',()=>assert.equal(existsSync(join(worktree,'preparation-marker.txt')),!actual));
  await point('duplicate does not advance batch branch',()=>assert.equal(git(p.missionRoot,'rev-parse',b.branch),batchTip));
  await point('second Git attempt is independently recorded',()=>assert.equal(JSON.parse(readFileSync(join(gate,'worktree-add-2.json'),'utf8')).returncode,128));
  await point('Git retains stale first worktree registration after directory removal',()=>assert.ok(git(p.missionRoot,'worktree','list','--porcelain').includes(worktree)));
  await point('failed duplicate leaves batch forming',async()=>assert.equal((await state()).batches[0].status,'forming'));
  await point('failed duplicate keeps machine busy',async()=>assert.equal((await state()).machines[0].status,'busy'));
 }finally{writeFileSync(join(gate,'release-first'),'release\n');}
 const completed=await first;r.first=completed;const final=await state();r.final=final;
 await point(actual?'defect: original request fails after directory loss':'original request should remain usable after duplicate rejection',()=>actual?assert.ok(completed.error):assert.equal(completed.error,undefined));
 await point('no successful infra result was recorded',()=>assert.equal(final.agents.filter(a=>a.role==='infra'&&a.status==='done').length,0));
 await point('mission receives no false result commit',()=>assert.equal(final.missions[0].result_commit,null));
 await point('research repository remains intact',()=>assert.equal(git(p.researchRoot,'rev-parse','--is-inside-work-tree'),'true'));
 await point('original mission commit remains accessible',()=>assert.equal(git(p.missionRoot,'cat-file','-t',tip),'commit'));
 r.complete=true;save();
});
