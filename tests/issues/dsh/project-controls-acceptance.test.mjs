import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
const actual=Boolean(process.env.ALEPH_CONTROLS_ACTUAL_CONFIG);
const cfg=actual?JSON.parse(readFileSync(process.env.ALEPH_CONTROLS_ACTUAL_CONFIG,'utf8')):{};
const source=resolve(cfg.source||process.env.ALEPH_CURRENT_SOURCE||'/home/paulus-chang/项目/aleph');
const output=cfg.output||process.env.ALEPH_CONTROLS_OBSERVATIONS;
let browserCookie;
if(actual){
 const log=readFileSync(join(cfg.root,'dsh.log'),'utf8');
 const login=log.match(/dsh web: (http:\/\/\S+)/)?.[1];
 assert.ok(login,'actual DSH login URL exists');
 const response=await fetch(login,{redirect:'manual'});
 assert.equal(response.status,303,'actual browser authentication exchange succeeds');
 browserCookie=response.headers.get('set-cookie')?.split(';')[0];
 assert.ok(browserCookie,'actual browser session cookie exists');
}
const records={source,source_sha:execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),mode:actual?'actual DSH':'automatic registered tools',checks:[],events:[],boundary:'Actual current registered tools and real Git/Python mission execution. Automatic replaces storage/session/preset/subagent services; actual uses original DSH sessions, persistent storage and tools; a local model adapter is configured but actual Composer startup outcome must be read from agent records. Missing formal controls are observed separately from successful normal execution. No source edits or injected control state.'};
const save=()=>{if(output)writeFileSync(output,JSON.stringify(records,null,2));};
const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async(predicate,label)=>{const end=Date.now()+15000;while(!await predicate()){if(Date.now()>end)throw Error('fixture timeout '+label);await delay(20);}};
async function http(path,body){const r=await fetch(cfg.url+path,{method:body===undefined?'GET':'POST',headers:{Origin:cfg.url,'Content-Type':'application/json',...(browserCookie?{Cookie:browserCookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let value;try{value=JSON.parse(text);}catch{value=text;}return {status:r.status,value};}
async function bridge(body){const r=await http('/api/aleph-test/bridge',body);if(r.status!==200||!r.value.ok)throw Error(JSON.stringify(r));return r.value.result;}
test('ALEPH-09 current project mission batch formal control availability and real normal flow',async t=>{
 const point=async(name,fn)=>t.test(name,async()=>{try{await fn();records.checks.push({name,passed:true});}catch(e){records.checks.push({name,passed:false,error:e.message});throw e;}finally{save();}});
 const workspace=actual?cfg.workspace:mkdtempSync(join(tmpdir(),'aleph-controls-'));let sid,invoke,tools=new Map(),routes=new Map();
 if(actual){sid=(await bridge({action:'parent',cwd:workspace})).sessionId;invoke=(name,args)=>bridge({action:'tool',sessionId:sid,name,args});records.definitions=await bridge({action:'tool-definitions',sessionId:sid});}
 else{
  sid='controls-leader';const map=new Map();const table={get:id=>map.has(id)?structuredClone(map.get(id)):undefined,entries:()=>[...map].map(([k,v])=>[k,structuredClone(v)]),put:async(k,v)=>map.set(k,structuredClone(v))};
  const {apply}=await import(pathToFileURL(join(source,'dsh-plugin/index-v2.js')));await apply({storageDomain:{open:async()=>({table:()=>table,close:async()=>{}})},get:n=>({sessions:{get:()=>({header:{cwd:workspace}})},agentPresets:{presetForSession:()=> 'aleph'},subagents:{startActivation:async()=>({childId:'held-composer',result:new Promise(()=>{})}),sendMessage:async()=>{}}})[n],effect:()=>{},tools:{register:d=>{tools.set(d.name,d);return()=>{};}},webServer:{register:d=>routes.set(d.path,d)}});
  invoke=async(name,args)=>{if(!tools.has(name))throw Error('missing tool '+name);return tools.get(name).execute(args,{agent:{id:sid}});};records.definitions=[...tools.values()].map(({name,description,parameters})=>({name,description,parameters}));records.routes=[...routes.keys()];
 }
 const project=await invoke('aleph_init_project',{workspace});const pid=project.id;records.project=project;
 const publicState=async()=> (await invoke('aleph_status',{project_id:pid}))[0];
 const attempt=async(name,args)=>{try{return {ok:true,result:await invoke(name,{project_id:pid,...args})};}catch(e){return {ok:false,error:e.message};}};
 const controls=[['pause','aleph_pause_project','/api/aleph/project/pause'],['resume','aleph_resume_project','/api/aleph/project/resume'],['finish','aleph_finish_project','/api/aleph/project/finish'],['queued mission cancel','aleph_cancel_mission','/api/aleph/mission/cancel'],['running batch cancel','aleph_cancel_batch','/api/aleph/batch/cancel']];
 await point('project initialization creates current project identity',()=>assert.ok(pid.startsWith('p-')));
 await point('research repository is real Git',()=>assert.equal(git(project.researchRoot,'rev-parse','--is-inside-work-tree'),'true'));
 await point('mission repository is real Git',()=>assert.equal(git(project.missionRoot,'rev-parse','--is-inside-work-tree'),'true'));
 await point('template branch is present',()=>assert.ok(git(project.missionRoot,'rev-parse','template')));
 const initial=await publicState();records.initial=initial;
 await point('registered status returns the actual project',()=>assert.equal(initial.project.id,pid));
 await point('new project has no missions',()=>assert.deepEqual(initial.missions,[]));
 await point('new project has no batches',()=>assert.deepEqual(initial.batches,[]));
 await point('new project machine is idle',()=>assert.equal(initial.machines[0].status,'idle'));
 const newMission=await invoke('aleph_start_mission',{project_id:pid,name:'work'});records.missionStart=newMission;
 const worktree=newMission.worktree;const branch=newMission.branch;const dir=join(worktree,'missions/work');const gate=join(workspace,'control-gate');mkdirSync(gate);
 const task=`import json,os,time\nfrom pathlib import Path\ng=Path(${JSON.stringify(gate)})\ng.joinpath('started.json').write_text(json.dumps({'pid':os.getpid(),'cwd':os.getcwd(),'output':os.environ['ALEPH_OUTPUT_DIR']}))\nend=time.time()+15\nwhile not g.joinpath('release').exists() and time.time()<end: time.sleep(.02)\nPath(os.environ['ALEPH_OUTPUT_DIR'],'artifact.txt').write_text('preserved result')\nprint('completed')\n`;
 writeFileSync(join(dir,'task.py'),task);writeFileSync(join(dir,'run.sh'),'exec python3 "$(dirname "$0")/task.py"\n');git(worktree,'add','-A');git(worktree,'-c','user.name=Test','-c','user.email=test@localhost','commit','-m','bounded controls mission');const missionTip=git(worktree,'rev-parse','HEAD');
 await point('mission workspace uses its own branch',()=>assert.equal(git(worktree,'branch','--show-current'),branch));
 await point('mission code is a committed Git object',()=>assert.equal(git(project.missionRoot,'cat-file','-t',missionTip),'commit'));
 const proposed=await invoke('aleph_propose_mission',{project_id:pid,branch});const mission=proposed.missions.find(m=>m.branch===branch);records.proposed=proposed;
 await point('proposal persists proposed status',()=>assert.equal(mission.status,'proposed'));
 await point('proposal keeps actual caller ownership',()=>assert.equal(mission.ownerSession,sid));
 await point('proposal retains branch tip',()=>assert.equal(git(project.missionRoot,'rev-parse',branch),missionTip));
 for(const [label,name,path] of controls){
  const args={mission_id:mission.id,batch_id:'not-yet-created'};
  const definitions=records.definitions.filter(d=>d.name===name);records.events.push({name:'definition '+label,definitions});
  await point((actual?'defect: ':'')+label+' formal registered tool availability',()=>assert.equal(definitions.length,actual?0:1));
  const route=actual?await http(path,{project_id:pid,...args}):{status:routes.has(path)?200:404};records.events.push({name:'route '+label,path,result:route});
  const unimplemented=actual ? route.status===404 || (route.status===200 && typeof route.value==='string' && /<!doctype html>/i.test(route.value)) : route.status===404;
  await point((actual?'defect: ':'')+label+' formal HTTP operation availability',()=>assert.equal(unimplemented,actual));
 }
 const cancelQueued=await attempt('aleph_cancel_mission',{mission_id:mission.id});records.events.push({name:'actual queued cancellation attempt',result:cancelQueued});
 await point('queued cancellation attempt reports missing operation accurately',()=>assert.ok(!cancelQueued.ok&&cancelQueued.error.includes('missing tool')));
 await point('failed cancellation does not silently remove proposed work',async()=>assert.equal((await publicState()).missions.find(m=>m.id===mission.id).status,'proposed'));
 const approved=await invoke('aleph_approve_mission',{project_id:pid,mission_id:mission.id});records.approved=approved;
 await point('normal approval remains operational',()=>assert.equal(approved.missions.find(m=>m.id===mission.id).status,'approved'));
 await point('approval preserves original mission code',()=>assert.equal(git(project.missionRoot,'rev-parse',branch),missionTip));
 const pause=await attempt('aleph_pause_project',{});const finish=await attempt('aleph_finish_project',{});const resume=await attempt('aleph_resume_project',{});records.events.push({name:'project control attempts',pause,finish,resume});
 await point('pause attempt cannot falsely claim success',()=>assert.ok(!pause.ok&&pause.error.includes('missing tool')));
 await point('finish attempt cannot falsely claim success',()=>assert.ok(!finish.ok&&finish.error.includes('missing tool')));
 await point('resume attempt cannot falsely claim success',()=>assert.ok(!resume.ok&&resume.error.includes('missing tool')));
 const formed=await invoke('aleph_form_batch',{project_id:pid});const batch=formed.batches[0];records.formed=formed;
 await point('approved mission still forms a real batch',()=>assert.equal(batch.status,'forming'));
 await point('batch links the proposed mission',()=>assert.ok(batch.missionIds.includes(mission.id)));
 await point('batch branch contains actual mission code',()=>assert.equal(git(project.missionRoot,'merge-base','--is-ancestor',missionTip,batch.branch),''));
 await point('machine is reserved by that batch',()=>assert.equal(formed.machines[0].batchId,batch.id));
 let result,error;const pending=invoke('aleph_run_batch',{project_id:pid,batch_id:batch.id}).then(v=>{result=v;},e=>{error=e.message;});
 try{
  await wait(()=>existsSync(join(gate,'started.json')),'real task starts');const started=JSON.parse(readFileSync(join(gate,'started.json'),'utf8'));records.started=started;const running=await publicState();records.running=running;
  await point('actual Python computation is active',()=>assert.ok(existsSync('/proc/'+started.pid)));
  await point('public batch is running during actual computation',()=>assert.equal(running.batches.find(b=>b.id===batch.id).status,'running'));
  await point('active computation keeps machine busy',()=>assert.equal(running.machines[0].status,'busy'));
  const cancel=await attempt('aleph_cancel_batch',{batch_id:batch.id});records.events.push({name:'actual running cancellation attempt',result:cancel});
  await point('running cancellation attempt reports absent operation',()=>assert.ok(!cancel.ok&&cancel.error.includes('missing tool')));
  await point('missing cancellation leaves actual compute active',()=>assert.ok(existsSync('/proc/'+started.pid)));
 }finally{writeFileSync(join(gate,'release'),'release');await pending;}
 records.run={result,error};const final=await publicState();records.final=final;const completed=final.missions.find(m=>m.id===mission.id);
 await point('normal registered run completes without tool error',()=>assert.equal(error,undefined));
 await point('normal batch reaches done',()=>assert.equal(final.batches.find(b=>b.id===batch.id).status,'done'));
 await point('mission result remains queryable as done',()=>assert.equal(completed.status,'done'));
 await point('result commit is a real retained Git object',()=>assert.equal(git(project.missionRoot,'cat-file','-t',completed.result_commit),'commit'));
 await point('delivered output artifact remains in result commit',()=>assert.equal(git(project.missionRoot,'show',completed.result_commit+':results/work/artifact.txt'),'preserved result'));
 await point('machine returns to idle after normal completion',()=>assert.equal(final.machines[0].status,'idle'));
 await point('machine clears finished batch ownership',()=>assert.equal(final.machines[0].batchId,null));
 await point('research repository remains available',()=>assert.equal(git(project.researchRoot,'rev-parse','--is-inside-work-tree'),'true'));
 records.complete=true;records.defect_reproduced=actual;save();
});
