import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import test from 'node:test';
const actual=Boolean(process.env.ALEPH_TIMEOUT_ACTUAL_CONFIG);
const repair=process.env.ALEPH_TIMEOUT_EXPECT_PROTECTION==='1';
const expectSurvivors=actual&&!repair;
const cfg=actual?JSON.parse(readFileSync(process.env.ALEPH_TIMEOUT_ACTUAL_CONFIG,'utf8')):{};
const source=resolve(cfg.source||process.env.ALEPH_CURRENT_SOURCE||'/home/paulus-chang/项目/aleph');
const output=cfg.output||process.env.ALEPH_TIMEOUT_OBSERVATIONS;
const records={source,source_sha:execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),mode:actual?'actual DSH':'automatic registered-tool adapter',node:process.version,checks:[],scenarios:[],boundary:repair?'Isolated frozen-source copy: unique runEvaluation deadline600000→1200ms; real spawn, Git, signals, /proc and cleanup; official production remains ten minutes. Actual mode uses real DSH services and a deterministic researcher model.':'Only matching bash -lc evaluator commands with existing timeout600000 and aleph-timeout-probe.py are adapted to1200ms before original real execFile. Actual Git, Python descendants, signals, /proc identity, and cleanup. Automatic mode replaces storage/session services. Actual mode uses original DSH session/tools/storage; owned researcher uses deterministic model only.'};
const save=()=>{if(output)writeFileSync(output,JSON.stringify(records,null,2));};
const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const readJson=p=>JSON.parse(readFileSync(p,'utf8'));
const events=p=>existsSync(p)?readFileSync(p,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
function proc(id){try{const raw=readFileSync('/proc/'+id+'/stat','utf8');const f=raw.slice(raw.lastIndexOf(')')+2).split(' ');return {pid:id,state:f[0],ppid:Number(f[1]),pgid:Number(f[2]),sid:Number(f[3]),start:f[19]};}catch{return null;}}
const alive=identity=>{const p=proc(identity.pid);return p && p.start===identity.start && !['Z','X'].includes(p.state);};
const wait=async(pred,label)=>{const end=Date.now()+10000;while(!await pred()){if(Date.now()>end)throw Error('fixture wait: '+label);await delay(20);}};
async function http(path,body){const r=await fetch(cfg.url+path,{method:body===undefined?'GET':'POST',headers:{Origin:cfg.url,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw Object.assign(Error(v.error?.message||v.error||JSON.stringify(v)),{response:v});return v;}
async function bridge(body){const v=await http('/api/aleph-test/bridge',body);assert.ok(v.ok);return v.result;}
async function fixture(scope,mode,owned){
 const root=actual?join(cfg.workspace,scope):mkdtempSync(join(tmpdir(),'aleph-timeout-'+scope+'-'));mkdirSync(root,{recursive:true});const workspace=join(root,'workspace');mkdirSync(workspace);const gate=join(root,'gate');mkdirSync(gate);
 const runner=fileURLToPath(new URL('./aleph-timeout-probe.py',import.meta.url));const evalCommand='python3 '+quote(runner)+' '+quote(gate)+' '+quote(mode);
 let tools,table,invoke,sid;
 if(actual){sid=(await bridge({action:'parent',cwd:workspace})).sessionId;invoke=(name,args,caller=sid)=>bridge({action:'tool',sessionId:caller,name,args});}
 else{const map=new Map();tools=new Map();table={get:id=>map.has(id)?structuredClone(map.get(id)):undefined,entries:()=>[...map].map(([k,v])=>[k,structuredClone(v)]),put:async(k,v)=>map.set(k,structuredClone(v))};const {apply}=await import(pathToFileURL(join(source,'dsh-plugin/index-v2.js')));await apply({storageDomain:{open:async()=>({table:()=>table,close:async()=>{}})},get:n=>({sessions:{get:()=>({header:{cwd:workspace}})},agentPresets:{presetForSession:()=> 'aleph'},subagents:{}})[n],effect:()=>{},tools:{register:d=>{tools.set(d.name,d);return()=>{};}},webServer:{register:()=>{}}});sid=scope+'-caller';invoke=(name,args,caller=sid)=>tools.get(name).execute(args,{agent:{id:caller}});}
 const evalRoot=join(root,'evaluation-entry');mkdirSync(evalRoot);
 const project=await invoke('aleph_init_project',{workspace,eval_command:evalCommand,...(mode==='success'?{eval_root:evalRoot}:{})});const repo=project.researchRoot;
 writeFileSync(join(repo,'algorithm.txt'),'scored input\n');git(repo,'add','algorithm.txt');git(repo,'-c','user.name=Test','-c','user.email=test@localhost','commit','-m','evaluation source');const before=git(repo,'rev-parse','HEAD');
 let caller=sid,ownWorktree=null;
 if(owned){
  if(actual){const child=await invoke('aleph_run_researcher',{project_id:project.id});caller=child.childId;ownWorktree=child.worktree;await wait(async()=> (await http('/api/aleph-test/researcher-control',{parentId:sid})).states.some(s=>s.sessionId===caller&&s.waiting),'real researcher waits');git(ownWorktree,'add','-A');git(ownWorktree,'-c','user.name=Test','-c','user.email=test@localhost','commit','-m','commit actual researcher marker before timeout acceptance');}
  else{caller=scope+'-researcher';ownWorktree=join(root,'owned-research');git(repo,'worktree','add','-b','research/owned',ownWorktree);const p=table.get(project.id);p.agents=[{role:'researcher',childId:caller,worktree:ownWorktree,branch:'research/owned',status:'running',summary:null,updatedAt:new Date().toISOString()}];await table.put(project.id,p);}
 }
 const publicState=async()=> actual?(await http('/api/aleph/projects')).projects.find(p=>p.project.id===project.id).project:table.get(project.id);
 return {root,workspace,gate,evalRoot,project,repo,before,invoke,caller,sid,ownWorktree,publicState};
}
test('PR25 fixed input still owns evaluator descendants before snapshot cleanup',async t=>{
 const point=async(scope,name,fn)=>t.test(scope+': '+name,()=>{try{fn();records.checks.push({scope,name,passed:true});}catch(e){records.checks.push({scope,name,passed:false,error:e.message});throw e;}finally{save();}});
 for(const [scope,mode,owned] of [['normal-temporary','success',false],['failure-temporary','nonzero',false],['timeout-temporary','timeout',false],['timeout-owned','timeout',true]]){
  const f=await fixture(scope,mode,owned);const scenario={scope,root:f.root,project:f.project.id,mode,owned};records.scenarios.push(scenario);save();let identities=[];
  try{
   const startedAt=Date.now();let result,error;
   const pending=f.invoke('aleph_evaluate',{project_id:f.project.id},f.caller).then(v=>{result=v;},e=>{error={message:e.message,code:e.code,killed:e.killed,signal:e.signal};});
   await wait(()=>existsSync(join(f.gate,'entry-ready.json')),'entry ready');const entry=readJson(join(f.gate,'entry-ready.json'));scenario.entry=entry;identities=[entry];
   if(mode==='timeout'){await wait(()=>existsSync(join(f.gate,'grandchild-ready.json')),'descendant ready');scenario.worker=readJson(join(f.gate,'worker-ready.json'));scenario.grandchild=readJson(join(f.gate,'grandchild-ready.json'));identities.push(scenario.worker,scenario.grandchild);scenario.beforeProcesses=identities.map(i=>proc(i.pid));}
   scenario.solution=entry.solution;scenario.initialSolutionExists=entry.solutionExists;if(owned)writeFileSync(join(f.ownWorktree,'later-pending.txt'),'researcher changes after evaluation starts\n');await pending;scenario.finishedAt=Date.now();scenario.elapsedMs=scenario.finishedAt-startedAt;scenario.result=result;scenario.error=error;scenario.afterProcesses=identities.map(i=>proc(i.pid));await delay(170);scenario.workerEvents=events(join(f.gate,'worker-events.jsonl'));scenario.grandchildEvents=events(join(f.gate,'grandchild-events.jsonl'));scenario.entryEvents=events(join(f.gate,'entry-events.jsonl'));const state=await f.publicState();scenario.public=state;
   await point(scope,'evaluation receives real workspace environment',()=>assert.equal(entry.cwd,mode==='success'?f.evalRoot:f.workspace));
   await point(scope,'solution directory is distinct from evaluator cwd',()=>assert.notEqual(entry.solution,entry.cwd));
   await point(scope,'solution directory existed when evaluation began',()=>assert.equal(scenario.initialSolutionExists,true));
   await point(scope,'project directory survives evaluation',()=>assert.equal(existsSync(f.workspace),true));
   await point(scope,'research repository remains valid',()=>assert.equal(git(f.repo,'rev-parse','--is-inside-work-tree'),'true'));
   if(mode==='success'){
    await point(scope,'actual success score is parsed',()=>assert.equal(result?.score,7));
    await point(scope,'success retains actual evaluated input commit',()=>assert.equal(result?.evaluatedCommit,f.before));
    await point(scope,'success report is a real Git commit',()=>assert.equal(git(f.repo,'cat-file','-t',result.researchCommit),'commit'));
    await point(scope,'success records independent evaluation ref',()=>assert.equal(git(f.repo,'rev-parse',result.evaluationRef),result.researchCommit));
    await point(scope,'normal temporary solution is removed',()=>assert.equal(existsSync(entry.solution),false));
    await point(scope,'normal entry has exited',()=>assert.equal(Boolean(alive(entry)),false));
    await point(scope,'history records the successful score',()=>assert.equal(state.evaluations[0]?.score,7));
   } else{
    await point(scope,'failure returns an actual command error',()=>assert.ok(error?.message));
    await point(scope,'failure never returns a success result',()=>assert.equal(result,undefined));
    await point(scope,'failed evaluation does not record history',()=>assert.equal((state.evaluations??[]).length,0));
    await point(scope,'failed evaluation does not update best',()=>assert.equal(state.best??null,null));
    await point(scope,'failed evaluation preserves source branch',()=>assert.equal(git(f.repo,'rev-parse','HEAD'),f.before));
    await point(scope,'failure stops the directly owned entry',()=>assert.equal(Boolean(alive(entry)),false));
    await point(scope,'independent stopped snapshot registration is cleaned',()=>assert.equal(git(f.repo,'worktree','list','--porcelain').includes(entry.solution),false));
    if(mode==='timeout'){
     await point(scope,'worker really was an entry descendant',()=>assert.equal(scenario.worker.ppid,entry.pid));
     await point(scope,'grandchild really was a worker descendant',()=>assert.equal(scenario.grandchild.ppid,scenario.worker.pid));
     await point(scope,'entry received actual SIGTERM',()=>assert.ok(scenario.entryEvents.some(e=>e.kind==='signal'&&e.signal===15)));
     await point(scope,'deadline is bounded by disclosed adapter',()=>assert.ok(scenario.elapsedMs>=1000&&scenario.elapsedMs<6000));
     await point(scope,'descendants remain in ordinary inherited process group',()=>assert.equal(scenario.grandchild.pgid,entry.pgid));
     await point(scope,expectSurvivors?'defect: scoring worker remains alive after timeout':'scoring worker must stop before tool failure returns',()=>assert.equal(Boolean(alive(scenario.worker)),expectSurvivors));
     await point(scope,expectSurvivors?'defect: scoring grandchild remains alive after timeout':'scoring grandchild must stop before tool failure returns',()=>assert.equal(Boolean(alive(scenario.grandchild)),expectSurvivors));
     await point(scope,expectSurvivors?'defect: actual heartbeat continues beyond timeout':'scoring heartbeat must stop before failure returns',()=>assert.equal(scenario.grandchildEvents.some(e=>e.kind==='heartbeat'&&e.at/1e6>scenario.finishedAt),expectSurvivors));
     if(!owned) await point(scope,expectSurvivors?'defect: live grandchild observes deleted solution input':'solution must not be deleted while scoring descendant still runs',()=>assert.equal(scenario.grandchildEvents.some(e=>e.kind==='heartbeat'&&!e.solutionExists&&!e.inputExists),expectSurvivors));
     else{await point(scope,'owned original source and input are preserved',()=>assert.ok(existsSync(join(f.ownWorktree,'algorithm.txt'))));await point(scope,'later uncommitted researcher file is preserved',()=>assert.equal(readFileSync(join(f.ownWorktree,'later-pending.txt'),'utf8'),'researcher changes after evaluation starts\n'));await point(scope,'owned input was evaluated in a separate snapshot',()=>assert.notEqual(entry.solution,f.ownWorktree));}
    }else await point(scope,'controlled nonzero error retains exit code',()=>assert.ok(error.message.includes('controlled evaluation failure')));
   }
  }finally{
   scenario.cleanup=[];for(const identity of identities.reverse()){if(alive(identity)){process.kill(identity.pid,'SIGKILL');scenario.cleanup.push({pid:identity.pid,start:identity.start,signal:'SIGKILL'});}}
   await delay(80);scenario.remainingActive=identities.filter(alive);save();assert.equal(scenario.remainingActive.length,0,'fixture cleans all active owned evaluator processes');
   if(actual&&owned)await http('/api/aleph-test/researcher-control',{parentId:f.sid,action:'release',sessionId:f.caller});
  }
 }
 records.complete=true;save();
});
