import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
const actual=Boolean(process.env.ALEPH_OWNED_EVALUATION_ACTUAL_CONFIG);
const cfg=actual?JSON.parse(readFileSync(process.env.ALEPH_OWNED_EVALUATION_ACTUAL_CONFIG,'utf8')):{};
const source=resolve(cfg.source||process.env.ALEPH_CURRENT_SOURCE||'/home/paulus-chang/项目/aleph');
const output=cfg.output||process.env.ALEPH_OWNED_EVALUATION_OUTPUT;
const r={source,sha:execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),actual,checks:[],scenarios:[],boundary:'Real Git, registered evaluation tools, Python evaluator and filesystem. Automatic creates a real owned worktree but seeds its ownership record through an explicit storage/session adapter. Actual uses a real researcher tool/session/worktree and persistent DSH storage; only researcher model responses use a deterministic local adapter. Evaluator reads actual owned files, with bounded file gates for concurrent mutation. No source edits or deadline adaptation.'};
const save=()=>output&&writeFileSync(output,JSON.stringify(r,null,2));
const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const sleep=ms=>new Promise(f=>setTimeout(f,ms));
async function until(fn,label){const end=Date.now()+10000;while(!await fn()){if(Date.now()>end)throw Error('fixture timeout '+label);await sleep(20);}}
async function http(path,body){const response=await fetch(cfg.url+path,{method:body===undefined?'GET':'POST',headers:{Origin:cfg.url,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw Error(JSON.stringify(value));return value;}
async function bridge(body){const v=await http('/api/aleph-test/bridge',body);if(!v.ok)throw Error(JSON.stringify(v));return v.result;}
test('current owned evaluation inputs correspond to reported research commits',async t=>{
 const point=async(scope,name,fn)=>t.test(scope+': '+name,async()=>{try{await fn();r.checks.push({scope,name,passed:true});}catch(e){r.checks.push({scope,name,passed:false,error:e.message});throw e;}finally{save();}});
 for(const mode of ['clean','tracked-dirty','untracked','advance-during-evaluation']){
  const root=actual?join(cfg.workspace,mode):mkdtempSync(join(tmpdir(),'aleph-owned-eval-'+mode+'-'));mkdirSync(root,{recursive:true});const workspace=join(root,'workspace');mkdirSync(workspace);const gate=join(root,'gate');mkdirSync(gate);const script=join(root,'evaluate.py');
  writeFileSync(script,`import json,os,time\nfrom pathlib import Path\ng=Path(${JSON.stringify(gate)})\ns=Path(os.environ['ALEPH_SOLUTION_DIR'])\ng.joinpath('started.json').write_text(json.dumps({'solution':str(s),'cwd':os.getcwd(),'pid':os.getpid()}))\nend=time.monotonic()+15\nwhile not g.joinpath('release').exists():\n if time.monotonic()>end: raise RuntimeError('fixture release deadline')\n time.sleep(.01)\na=s.joinpath('algorithm.txt').read_text().strip()\ne=s.joinpath('extra.txt').read_text().strip() if s.joinpath('extra.txt').exists() else None\nrecord={'algorithm':a,'extra':e,'score':int(a)+(int(e) if e else 0)}\ng.joinpath('read.json').write_text(json.dumps(record))\nprint(json.dumps(record))\n`);
  let sid,invoke,table;const tools=new Map();
  if(actual){sid=(await bridge({action:'parent',cwd:workspace})).sessionId;invoke=(name,args,caller=sid)=>bridge({action:'tool',sessionId:caller,name,args});}
  else{sid=mode+'-leader';const values=new Map();table={get:k=>values.has(k)?structuredClone(values.get(k)):undefined,entries:()=>[...values].map(([k,v])=>[k,structuredClone(v)]),put:async(k,v)=>values.set(k,structuredClone(v))};const {apply}=await import(pathToFileURL(join(source,'dsh-plugin/index-v2.js')));await apply({storageDomain:{open:async()=>({table:()=>table,close:async()=>{}})},get:n=>({sessions:{get:()=>({header:{cwd:workspace}})},agentPresets:{presetForSession:()=> 'aleph'},subagents:{}})[n],effect:()=>{},tools:{register:d=>{tools.set(d.name,d);return()=>{};}},webServer:{register:()=>{}}});invoke=(name,args,caller=sid)=>tools.get(name).execute(args,{agent:{id:caller}});}
  const p=await invoke('aleph_init_project',{workspace,eval_command:'python3 '+quote(script)});const args={project_id:p.id};writeFileSync(join(p.researchRoot,'algorithm.txt'),'3\n');git(p.researchRoot,'add','algorithm.txt');git(p.researchRoot,'-c','user.name=Test','-c','user.email=test@localhost','commit','-m','committed algorithm 3');const base=git(p.researchRoot,'rev-parse','HEAD');let caller,owned,branch;
  if(actual){const child=await invoke('aleph_run_researcher',args);caller=child.childId;owned=child.worktree;branch=child.branch;await until(async()=> (await http('/api/aleph-test/researcher-control',{parentId:sid})).states.some(s=>s.sessionId===caller&&s.waiting),'researcher genuine tool and waiting');}
  else{caller=mode+'-researcher';owned=join(root,'researcher');branch='research/'+mode;git(p.researchRoot,'worktree','add','-b',branch,owned);const current=table.get(p.id);current.agents=[{role:'researcher',childId:caller,worktree:owned,branch,status:'running'}];await table.put(p.id,current);}
  const s={mode,project:p.id,base,owned,branch};r.scenarios.push(s);save();
  try{
   if(mode==='tracked-dirty')writeFileSync(join(owned,'algorithm.txt'),'7\n');
   if(mode==='untracked')writeFileSync(join(owned,'extra.txt'),'11\n');
   const startTip=git(owned,'rev-parse','HEAD');s.beforeStatus=git(owned,'status','--porcelain');const pending=invoke('aleph_evaluate',args,caller);await until(()=>existsSync(join(gate,'started.json')),'evaluator starts');s.entry=JSON.parse(readFileSync(join(gate,'started.json'),'utf8'));
   if(mode==='advance-during-evaluation'){writeFileSync(join(owned,'algorithm.txt'),'19\n');git(owned,'add','algorithm.txt');git(owned,'-c','user.name=Test','-c','user.email=test@localhost','commit','-m','algorithm advanced while evaluation waits');s.advanced=git(owned,'rev-parse','HEAD');}
   writeFileSync(join(gate,'release'),'release\n');const result=await pending;s.result=result;s.read=JSON.parse(readFileSync(join(gate,'read.json'),'utf8'));const status=(await invoke('aleph_status',args))[0];s.final=status;
   const reportInput=git(p.researchRoot,'show',result.researchCommit+':algorithm.txt');let reportExtra=null;try{reportExtra=git(p.researchRoot,'show',result.researchCommit+':extra.txt');}catch{}s.reportInput=reportInput;s.reportExtra=reportExtra;
   await point(mode,'evaluator really reads the owned research worktree',()=>assert.equal(s.entry.solution,owned));
   await point(mode,'evaluator runs outside the solution directory',()=>assert.equal(s.entry.cwd,workspace));
   await point(mode,'owned worktree remains registered after evaluation',()=>assert.ok(git(p.researchRoot,'worktree','list','--porcelain').includes(owned)));
   await point(mode,'owned input remains available after evaluation',()=>assert.ok(existsSync(join(owned,'algorithm.txt'))));
   await point(mode,'score matches actual Python-read files',()=>assert.equal(result.score,s.read.score));
   await point(mode,'evaluation captures the starting commit',()=>assert.equal(result.evaluatedCommit,startTip));
   await point(mode,'report is an actual Git commit',()=>assert.equal(git(p.researchRoot,'cat-file','-t',result.researchCommit),'commit'));
   await point(mode,'independent evaluation reference preserves report',()=>assert.equal(git(p.researchRoot,'rev-parse',result.evaluationRef),result.researchCommit));
   await point(mode,'report parent identifies the captured commit',()=>assert.equal(git(p.researchRoot,'rev-parse',result.researchCommit+'^'),startTip));
   await point(mode,'history stores actual returned score',()=>assert.equal(status.project.evaluations.at(-1).score,result.score));
   await point(mode,'history stores same evaluated source commit',()=>assert.equal(status.project.evaluations.at(-1).evaluatedCommit,result.evaluatedCommit));
   await point(mode,'best source pointer matches returned source pointer',()=>assert.equal(status.project.best.commit,result.evaluatedCommit));
   await point(mode,actual&&['tracked-dirty','advance-during-evaluation'].includes(mode)?'defect: tracked report input differs from actual scored file':'report tracked input matches actual scored file',()=>actual&&['tracked-dirty','advance-during-evaluation'].includes(mode)?assert.notEqual(reportInput,s.read.algorithm):assert.equal(reportInput,s.read.algorithm));
   await point(mode,actual&&mode==='untracked'?'defect: scored untracked input absent from report':'report includes actual additional scored input',()=>actual&&mode==='untracked'?assert.notEqual(reportExtra,s.read.extra):assert.equal(reportExtra,s.read.extra));
   await point(mode,'report tree equals advertised evaluated tree',()=>assert.equal(git(p.researchRoot,'rev-parse',result.researchCommit+'^{tree}'),git(p.researchRoot,'rev-parse',result.evaluatedCommit+'^{tree}')));
   await point(mode,'report message contains actual evaluation score',()=>assert.match(git(p.researchRoot,'show','-s','--format=%B',result.researchCommit),new RegExp('research evaluation: '+result.score)));
   if(mode==='advance-during-evaluation'){
    await point(mode,'concurrent research commit is retained by branch CAS',()=>assert.equal(git(p.researchRoot,'rev-parse',branch),s.advanced));
    await point(mode,'report correctly says branch was not advanced',()=>assert.equal(result.researchBranchUpdated,false));
   }else await point(mode,'research branch points at returned report',()=>assert.equal(git(p.researchRoot,'rev-parse',branch),result.researchCommit));
  }finally{writeFileSync(join(gate,'release'),'cleanup\n');if(actual)await http('/api/aleph-test/researcher-control',{parentId:sid,action:'release',sessionId:caller});save();}
 }
 r.complete=true;save();
});
