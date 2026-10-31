import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
const actual=Boolean(process.env.ALEPH_FIXED_CONTROLS_CONFIG),cfg=actual?JSON.parse(readFileSync(process.env.ALEPH_FIXED_CONTROLS_CONFIG,'utf8')):{};
const source=resolve(cfg.source||process.env.ALEPH_CURRENT_SOURCE),output=cfg.output||process.env.ALEPH_FIXED_CONTROLS_OUTPUT,gate=process.env.ALEPH_INFRA_PREPARATION_GATE;
const root=actual?cfg.workspace:mkdtempSync(join(tmpdir(),'aleph-b-controls-fixed-'));
const report={source,sha:execFileSync('/usr/bin/git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),actual,checks:[],scenarios:[],boundary:'Registered product tools, real Git, mission worktrees and Python processes. Automatic substitutes DSH storage/sessions/activation receipts; actual uses installed DSH and deterministic model responses. Exact first Infra worktree-add response is delayed after real Git completes. No product source changes or deadline adaptation.'};
const save=()=>output&&writeFileSync(output,JSON.stringify(report,null,2));
const git=(repo,...args)=>execFileSync('/usr/bin/git',['-C',repo,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async(fn,label)=>{const end=Date.now()+20000;while(!await fn()){if(Date.now()>end)throw Error('fixture timeout '+label);await delay(20);}};
const alive=pid=>{try{return !['Z','X','x'].includes(readFileSync('/proc/'+pid+'/stat','utf8').split(') ')[1][0]);}catch{return false;}};
let cookie;async function http(path,body){const r=await fetch(cfg.url+path,{method:body===undefined?'GET':'POST',headers:{Origin:cfg.url,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});let value;const raw=await r.text();try{value=JSON.parse(raw);}catch{value=raw;}return{status:r.status,value};}
async function bridge(body){const r=await http('/api/aleph-test/bridge',body);if(r.status!==200||!r.value.ok)throw Error(JSON.stringify(r));return r.value.result;}
const outcome=p=>p.then(value=>({value}),e=>({error:e.message}));
if(actual){const login=readFileSync(join(cfg.root,'dsh.log'),'utf8').match(/dsh web: (http:\/\/\S+)/)?.[1];assert.ok(login);const r=await fetch(login,{redirect:'manual'});assert.equal(r.status,303);cookie=r.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);}
let autoOrdinal=0;
async function fixture(name){
 const workspace=join(root,name);mkdirSync(workspace,{recursive:true});let sid,invoke,tools=new Map(),routes=new Map();const activations=[];
 if(actual){sid=(await bridge({action:'parent',cwd:workspace})).sessionId;invoke=(name,args,caller=sid)=>bridge({action:'tool',sessionId:caller,name,args});}
 else{sid='leader-'+name;const values=new Map(),table={get:k=>values.has(k)?structuredClone(values.get(k)):undefined,put:async(k,v)=>values.set(k,structuredClone(v)),entries:()=>[...values].map(([k,v])=>[k,structuredClone(v)])};const subagents={async startActivation(spec){let resolve;const result=new Promise(r=>resolve=r);const childId='actual-substitute-'+(++autoOrdinal);const a={childId,role:spec.request.agentPreset,disposed:0,result,resolve,spec,dispose:async()=>{a.disposed++;resolve({output:[]});}};activations.push(a);if(a.role==='aleph-infra')writeFileSync(join(spec.request.cwd,'infra-fixture-marker.txt'),'retained');return a;},sendMessage:async()=>{}};
 const {apply}=await import(pathToFileURL(join(source,'dsh-plugin/index-v2.js')));await apply({storageDomain:{open:async()=>({table:()=>table,close:async()=>{}})},get:n=>({sessions:{get:id=>({header:{id,cwd:workspace}})},agentPresets:{presetForSession:session=>session.header.id===sid?'aleph':'aleph-composer'},subagents})[n],effect:()=>{},tools:{register:d=>{tools.set(d.name,d);return()=>{};}},webServer:{register:d=>routes.set(d.path,d)}});invoke=(name,args,caller=sid)=>{const t=tools.get(name);if(!t)throw Error('missing tool '+name);return t.execute(args,{agent:{id:caller}});};}
 const p=await invoke('aleph_init_project',{workspace}),args={project_id:p.id};const state=async()=>(await invoke('aleph_status',args))[0];const call=(name,args2={})=>invoke(name,{...args,...args2});const f={workspace,sid,invoke,tools,routes,activations,p,args,state,call};report.scenarios.push({name,project:p});return f;
}
async function mission(f,name,slow=false){const m=await f.call('aleph_start_mission',{name});const dir=join(m.worktree,'missions',name);const g=join(f.workspace,'gates',name);mkdirSync(g,{recursive:true});
 const py=slow?`import os,time,json,subprocess\nfrom pathlib import Path\ng=Path(${JSON.stringify(g)})\nc=subprocess.Popen(['python3','-c',"import time;time.sleep(25)"])\ng.joinpath('started.json').write_text(json.dumps({'pid':os.getpid(),'child':c.pid}))\nend=time.time()+25\nwhile not g.joinpath('release').exists() and time.time()<end:time.sleep(.02)\nPath(os.environ['ALEPH_OUTPUT_DIR'],'artifact.txt').write_text('delivered ${name}')\n`:`import os\nfrom pathlib import Path\nPath(os.environ['ALEPH_OUTPUT_DIR'],'artifact.txt').write_text('delivered ${name}')\n`;
 writeFileSync(join(dir,'task.py'),py);writeFileSync(join(dir,'run.sh'),'exec python3 "$(dirname "$0")/task.py"\n');git(m.worktree,'add','-A');git(m.worktree,'-c','user.name=Test','-c','user.email=test@localhost','commit','-m','B controls acceptance '+name);const tip=git(m.worktree,'rev-parse','HEAD');const proposed=await f.call('aleph_propose_mission',{branch:m.branch});return{...m,id:proposed.missions.find(x=>x.branch===m.branch).id,g,tip};}
async function approveForm(f,m){await f.call('aleph_approve_mission',{mission_id:m.id});const s=await f.call('aleph_form_batch');return s.batches.at(-1);}
async function finish(f){await f.call('aleph_finish_project');await wait(async()=>{const s=await f.state();return s.project.status==='finished'&&(!s.project.control.composerCleanup||s.project.control.composerCleanup==='complete');},'project finish and Composer receipt disposal');}
test('B independent fixed project controls and precise execution ownership',async t=>{
 const point=async(name,fn)=>t.test(name,async()=>{try{await fn();report.checks.push({name,passed:true});}catch(e){report.checks.push({name,passed:false,error:e.message});throw e;}finally{save();}});
 const f=await fixture('queued');const m=await mission(f,'withdraw');
 await point('initial registered project is running',async()=>assert.equal((await f.state()).project.status,'running'));
 await point('research repository is real Git',()=>assert.equal(git(f.p.researchRoot,'rev-parse','--is-inside-work-tree'),'true'));
 await point('mission proposal retains its committed branch',()=>assert.equal(git(f.p.missionRoot,'rev-parse',m.branch),m.tip));
 const paused=await f.call('aleph_pause_project',{reason:'inspect'});
 await point('pause persists through registered status',async()=>assert.equal((await f.state()).project.status,'paused'));
 await point('pause records operator reason',()=>assert.equal(paused.control.reason,'inspect'));
 const again=await f.call('aleph_pause_project');await point('pause is idempotent without revision churn',()=>assert.equal(again.control.revision,paused.control.revision));
 await point('paused project rejects new mission creation',async()=>assert.ok((await outcome(f.call('aleph_start_mission',{name:'blocked'}))).error?.includes('paused')));
 await point('paused project rejects forming new batches',async()=>assert.ok((await outcome(f.call('aleph_form_batch'))).error?.includes('paused')));
 const approved=await f.call('aleph_approve_mission',{mission_id:m.id});
 await point('paused approval queues approved work',()=>assert.equal(approved.missions.find(x=>x.id===m.id).status,'approved'));
 await point('paused approval does not start Composer',async()=>assert.equal((await f.state()).agents.filter(x=>x.role==='composer').length,0));
 const cancelled=await f.call('aleph_cancel_mission',{mission_id:m.id,reason:'obsolete'});
 await point('queued cancellation reports cleanup complete',()=>assert.equal(cancelled.complete,true));
 await point('queued cancellation persists terminal state',async()=>assert.equal((await f.state()).missions[0].status,'cancelled'));
 await point('queued cancellation preserves original branch',()=>assert.equal(git(f.p.missionRoot,'rev-parse',m.branch),m.tip));
 await point('queued cancellation preserves mission code',()=>assert.match(git(f.p.missionRoot,'show',m.tip+':missions/withdraw/task.py'),/delivered withdraw/));
 const twice=await f.call('aleph_cancel_mission',{mission_id:m.id});await point('queued cancellation retains operation identity',()=>assert.equal(twice.mission.cancelOperationId,cancelled.mission.cancelOperationId));
 await f.call('aleph_approve_mission',{mission_id:m.id});await point('approval cannot revive cancelled mission',async()=>assert.equal((await f.state()).missions[0].status,'cancelled'));
 const resumed=await f.call('aleph_resume_project');await point('resume reopens dispatch',()=>assert.equal(resumed.control.state,'running'));
 await point('resume advances control revision once',()=>assert.equal(resumed.control.revision,paused.control.revision+1));
 await point('cancelled work cannot form batch',async()=>assert.ok((await outcome(f.call('aleph_form_batch'))).error?.includes('no approved')));
 await finish(f);await point('finished project stays closed',async()=>assert.equal((await f.state()).project.status,'finished'));
 await point('finished project cannot resume',async()=>assert.ok((await outcome(f.call('aleph_resume_project'))).error?.includes('cannot resume')));
 await point('finished retains cancelled count separately',async()=>assert.equal((await f.state()).counts.cancelled,1));
 if(actual){for(const path of ['/api/aleph/project/pause','/api/aleph/project/resume','/api/aleph/project/finish','/api/aleph/mission/cancel','/api/aleph/batch/cancel']){const r=await http(path,{project_id:f.p.id,mission_id:'missing',batch_id:'missing'});await point('authenticated route exists '+path,()=>assert.ok([200,202,404,409].includes(r.status)&&typeof r.value==='object'&&r.value!==null));}}
 else{for(const name of ['aleph_pause_project','aleph_resume_project','aleph_finish_project','aleph_cancel_mission','aleph_cancel_batch'])await point('registered authority control '+name,()=>assert.ok(f.tools.has(name)));}
 const c=await fixture('cancel-compute'),cm=await mission(c,'cancelled',true),cb=await approveForm(c,cm);const run=outcome(c.call('aleph_run_batch',{batch_id:cb.id}));let started;
 try{await wait(()=>existsSync(join(cm.g,'started.json')),'cancel compute starts');started=JSON.parse(readFileSync(join(cm.g,'started.json')));report.scenarios.at(-1).started=started;const before=await c.state();
 await point('running computation has live entry process',()=>assert.equal(alive(started.pid),true));await point('running computation has live ordinary descendant',()=>assert.equal(alive(started.child),true));
 await point('public running batch status is accurate',()=>assert.equal(before.batches[0].status,'running'));await point('running batch owns busy machine',()=>assert.equal(before.machines[0].batchId,cb.id));
 const dup=await outcome(c.call('aleph_run_batch',{batch_id:cb.id}));await point('duplicate run rejects active execution',()=>assert.match(dup.error||'',/active execution|running/));await point('duplicate run preserves computation',()=>assert.equal(alive(started.pid),true));
 const individual=await outcome(c.call('aleph_cancel_mission',{mission_id:cm.id}));await point('individual cancellation identifies whole batch conflict',()=>assert.ok(individual.error?.includes(cb.id)));
 const stopped=await c.call('aleph_cancel_batch',{batch_id:cb.id,reason:'stop actual compute'});report.scenarios.at(-1).cancellation=stopped;const rr=await run;report.scenarios.at(-1).run=rr;const after=await c.state();
 await point('whole batch cancellation confirms cleanup',()=>assert.equal(stopped.complete,true));await point('entry process stopped before confirmed cancellation',()=>assert.equal(alive(started.pid),false));await point('ordinary descendant stopped before confirmed cancellation',()=>assert.equal(alive(started.child),false));
 await point('whole batch persists cancelled state',()=>assert.equal(after.batches[0].status,'cancelled'));await point('undelivered mission becomes cancelled',()=>assert.equal(after.missions[0].status,'cancelled'));await point('cancelled work gets no false result commit',()=>assert.equal(after.missions[0].result_commit,null));
 await point('machine releases after confirmed stop',()=>assert.equal(after.machines[0].status,'idle'));await point('machine clears cancelled batch ownership',()=>assert.equal(after.machines[0].batchId,null));await point('execution becomes inactive',()=>assert.equal(after.batches[0].execution.active,false));
 await point('cancelled execution worktree is retained',()=>assert.ok(existsSync(after.batches[0].execution.worktree)));await point('cancellation diagnostics are retained',()=>assert.ok(existsSync(join(stopped.batch.cancellation.diagnosticPath,'cancellation.json'))));await point('cancelled mission source branch is preserved',()=>assert.equal(git(c.p.missionRoot,'rev-parse',cm.branch),cm.tip));
 await point('cancelled batch cannot retry into execution',async()=>assert.ok((await outcome(c.call('aleph_run_batch',{batch_id:cb.id}))).error));
 }finally{writeFileSync(join(cm.g,'release'),'release');await run;await finish(c);}
 const d=await fixture('drain-composer'),dm=await mission(d,'drain',true),db=await approveForm(d,dm);let drain;
 if(actual){const s=await d.state();const composer=s.agents.find(a=>a.role==='composer'&&a.status==='running');assert.ok(composer?.childId,'real Composer starts with configured provider');await wait(async()=>{const r=await http('/api/aleph-test/controls-model',{});return r.value.states.some(x=>x.sid===composer.childId&&x.waiting);},'real Composer model waits');report.scenarios.at(-1).composerId=composer.childId;await http('/api/aleph-test/controls-model',{action:'release',sid:composer.childId,command:{name:'aleph_run_batch',args:{project_id:d.p.id,batch_id:db.id}}});drain=Promise.resolve({modelTool:true});}
 else drain=outcome(d.call('aleph_run_batch',{batch_id:db.id}));
 try{await wait(()=>existsSync(join(dm.g,'started.json')),'draining computation starts');const ds=JSON.parse(readFileSync(join(dm.g,'started.json')));report.scenarios.at(-1).started=ds;
 await d.call('aleph_pause_project');await point('pause leaves existing batch process active',()=>assert.equal(alive(ds.pid),true));await point('pause leaves running batch status',async()=>assert.equal((await d.state()).batches[0].status,'running'));
 const closed=await d.call('aleph_finish_project');await point('finish reports draining active work',()=>assert.equal(closed.control.state,'finishing'));await point('finish does not kill admitted computation',()=>assert.equal(alive(ds.pid),true));
 await point('finish rejects additional batch dispatch',async()=>assert.ok((await outcome(d.call('aleph_form_batch'))).error?.includes('finishing')));
 writeFileSync(join(dm.g,'release'),'release');await drain;await wait(async()=>{const s=await d.state();return s.project.status==='finished'&&s.batches[0].execution.active===false;},'last execution drains and finishes');const final=await d.state();report.scenarios.at(-1).final=final;
 await point('drained mission delivers successful result',()=>assert.equal(final.missions[0].status,'done'));await point('drained batch reaches done',()=>assert.equal(final.batches[0].status,'done'));await point('drained execution releases machine',()=>assert.equal(final.machines[0].status,'idle'));await point('draining finishes project',()=>assert.equal(final.project.status,'finished'));
 await point('delivered artifact retained in real Git result',()=>assert.equal(git(d.p.missionRoot,'show',final.missions[0].result_commit+':results/drain/artifact.txt'),'delivered drain'));
 await wait(async()=>{const s=await d.state();return !s.project.control.composerCleanup||s.project.control.composerCleanup==='complete';},'Composer disposal settles after its own tool returns');const settled=await d.state();
 await point('Composer cleanup reports completion after Host tool returns',()=>assert.equal(settled.project.control.composerCleanup,'complete'));
 if(actual){const s=await http('/api/aleph-test/controls-model',{});const model=s.value.states.find(x=>x.sid===report.scenarios.at(-1).composerId);report.scenarios.at(-1).model=model;await point('real Composer actually called the batch tool',()=>assert.equal(model.lastTool,'aleph_run_batch'));await point('real Composer is disposed after final batch tool settles',()=>assert.equal(model.live,false));}
 else await point('exact Composer receipt was disposed',()=>assert.equal(d.activations.find(a=>a.role==='aleph-composer').disposed,1));
 }finally{writeFileSync(join(dm.g,'release'),'release');await drain;}
 const i=await fixture('infra-preparation'),im=await mission(i,'infra'),ib=await approveForm(i,im),worktree=join(i.workspace,'.aleph/infra',ib.id);writeFileSync(join(gate,'armed.json'),JSON.stringify({repo:i.p.missionRoot,worktree,branch:ib.branch}));let infraSettled=false;const infrared=outcome(i.call('aleph_run_infra',{batch_id:ib.id})).then(v=>{infraSettled=true;return v;});
 try{await wait(()=>existsSync(join(gate,'worktree-add-1.json')),'first real infra Git add');writeFileSync(join(worktree,'preparation-marker.txt'),'preserved');const ino=statSync(worktree).ino;const prepared=await i.state();
 await point('infra owns execution before activation record',()=>assert.equal(prepared.batches[0].execution.active,true));await point('infra preparation has not launched model',()=>assert.equal(prepared.agents.filter(a=>a.role==='infra').length,0));
 const duplicate=await outcome(i.call('aleph_run_infra',{batch_id:ib.id}));report.scenarios.at(-1).duplicate=duplicate;
 await point('duplicate Infra request rejects during Git response window',()=>assert.match(duplicate.error||'',/active execution/));await point('duplicate never invokes another worktree add',()=>assert.equal(existsSync(join(gate,'worktree-add-2.json')),false));await point('duplicate keeps first request pending',()=>assert.equal(infraSettled,false));await point('duplicate preserves prepared directory inode',()=>assert.equal(statSync(worktree).ino,ino));await point('duplicate preserves prepared marker',()=>assert.equal(readFileSync(join(worktree,'preparation-marker.txt'),'utf8'),'preserved'));
 }finally{writeFileSync(join(gate,'release-first'),'release');}
 try{await wait(()=>existsSync(join(worktree,'infra-fixture-marker.txt')),'real Infra bash edit');await point('actual Infra edit exists before cancellation',()=>assert.equal(readFileSync(join(worktree,'infra-fixture-marker.txt'),'utf8'),'retained'));
 const pre=await i.state();const child=pre.agents.find(a=>a.role==='infra');await point('Infra activation record has exact child identity',()=>assert.ok(child?.childId));
 const stop=await i.call('aleph_cancel_batch',{batch_id:ib.id});report.scenarios.at(-1).cancel=stop;await infrared;const post=await i.state();report.scenarios.at(-1).final=post;
 await point('Infra cancellation confirms exact activation cleanup',()=>assert.equal(stop.complete,true));await point('Infra cancellation retains edited worktree',()=>assert.ok(existsSync(worktree)));await point('Infra cancellation retains model edit',()=>assert.equal(readFileSync(join(worktree,'infra-fixture-marker.txt'),'utf8'),'retained'));await point('Infra cancellation releases machine after cleanup',()=>assert.equal(post.machines[0].status,'idle'));await point('Infra cancellation persists cancelled batch',()=>assert.equal(post.batches[0].status,'cancelled'));await point('Infra cancellation creates no false mission result',()=>assert.equal(post.missions[0].result_commit,null));
 if(actual){const models=(await http('/api/aleph-test/controls-model',{})).value.states;const model=models.find(x=>x.sid===child.childId);report.scenarios.at(-1).model=model;await point('real Infra model session received disposal',()=>assert.equal(model.live,false));await point('real Infra model executed Bash before disposal',()=>assert.equal(model.lastTool,'bash'));}else await point('exact Infra receipt was disposed',()=>assert.ok(i.activations.find(a=>a.childId===child.childId).disposed>0));
 }finally{writeFileSync(join(gate,'release-first'),'release');await infrared;await finish(i);}
 report.complete=true;report.protection_validated=report.checks.every(x=>x.passed);save();
});
