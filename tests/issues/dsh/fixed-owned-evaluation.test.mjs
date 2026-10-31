import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
const actual=Boolean(process.env.ALEPH_OWNED_EVALUATION_ACTUAL_CONFIG);
const cfg=actual?JSON.parse(readFileSync(process.env.ALEPH_OWNED_EVALUATION_ACTUAL_CONFIG,'utf8')):{};
const source=resolve(cfg.source||process.env.ALEPH_CURRENT_SOURCE),output=cfg.output||process.env.ALEPH_OWNED_EVALUATION_OUTPUT;
const report={source,sha:execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),actual,checks:[],scenarios:[],boundary:'Independent registered tools with real Git and Python. Automatic substitutes DSH storage/session and seeds owned worktree records. Actual starts a real researcher using a deterministic model, then explicitly commits its marker before admission. No product JavaScript or deadline changes. Evaluator file gate schedules source mutation after Python starts on its independent snapshot.'};
const save=()=>output&&writeFileSync(output,JSON.stringify(report,null,2));
const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const commit=(repo,message)=>{git(repo,'add','-A');git(repo,'-c','user.name=Test','-c','user.email=test@localhost','commit','-m',message);return git(repo,'rev-parse','HEAD');};
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const sleep=ms=>new Promise(f=>setTimeout(f,ms));
const until=async(fn,label)=>{const end=Date.now()+12000;while(!await fn()){if(Date.now()>end)throw Error('fixture timeout '+label);await sleep(20);}};
let cookie;
if(actual){const login=readFileSync(join(cfg.root,'dsh.log'),'utf8').match(/dsh web: (http:\/\/\S+)/)?.[1];assert.ok(login);const response=await fetch(login,{redirect:'manual'});assert.equal(response.status,303);cookie=response.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);}
async function http(path,body){const r=await fetch(cfg.url+path,{method:body===undefined?'GET':'POST',headers:{Origin:cfg.url,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw Error(JSON.stringify(v));return v;}
async function bridge(body){const v=await http('/api/aleph-test/bridge',body);if(!v.ok)throw Error(JSON.stringify(v));return v.result;}
test('B fixed committed snapshots keep evaluated input and report associated',async t=>{
 const point=async(scope,name,fn)=>t.test(scope+': '+name,async()=>{try{await fn();report.checks.push({scope,name,passed:true});}catch(e){report.checks.push({scope,name,passed:false,error:e.message});throw e;}finally{save();}});
 for(const mode of ['clean','tracked-dirty','untracked','staged','advance-during-evaluation','explicit-branch','ignored-input']){
  const root=actual?join(cfg.workspace,mode):mkdtempSync(join(tmpdir(),'aleph-fixed-owned-'+mode+'-'));mkdirSync(root,{recursive:true});const workspace=join(root,'workspace');mkdirSync(workspace);const gate=join(root,'gate');mkdirSync(gate);const script=join(root,'evaluate.py');
  writeFileSync(script,`import json,os,time\nfrom pathlib import Path\ng=Path(${JSON.stringify(gate)})\ns=Path(os.environ['ALEPH_SOLUTION_DIR'])\ng.joinpath('started.json').write_text(json.dumps({'solution':str(s),'cwd':os.getcwd(),'pid':os.getpid()}))\nend=time.monotonic()+15\nwhile not g.joinpath('release').exists():\n if time.monotonic()>end: raise RuntimeError('fixture release deadline')\n time.sleep(.01)\na=s.joinpath('algorithm.txt').read_text().strip()\ne=s.joinpath('extra.txt').read_text().strip() if s.joinpath('extra.txt').exists() else None\ns.joinpath('evaluator-generated.txt').write_text('not submitted input')\nrecord={'algorithm':a,'extra':e,'score':int(a)+(int(e) if e else 0)}\ng.joinpath('read.json').write_text(json.dumps(record))\nprint(json.dumps(record))\n`);
  let sid,invoke,table;const tools=new Map(),routes=new Map();
  if(actual){sid=(await bridge({action:'parent',cwd:workspace})).sessionId;invoke=(name,args,caller=sid)=>bridge({action:'tool',sessionId:caller,name,args});}
  else{sid=mode+'-leader';const values=new Map();table={get:k=>values.has(k)?structuredClone(values.get(k)):undefined,entries:()=>[...values].map(([k,v])=>[k,structuredClone(v)]),put:async(k,v)=>values.set(k,structuredClone(v))};const {apply}=await import(pathToFileURL(join(source,'dsh-plugin/index-v2.js')));await apply({storageDomain:{open:async()=>({table:()=>table,close:async()=>{}})},get:n=>({sessions:{get:()=>({header:{cwd:workspace}})},agentPresets:{presetForSession:()=> 'aleph'},subagents:{}})[n],effect:()=>{},tools:{register:d=>{tools.set(d.name,d);return()=>{};}},webServer:{register:r=>routes.set(r.path,r)}});invoke=(name,args,caller=sid)=>tools.get(name).execute(args,{agent:{id:caller}});}
  const p=await invoke('aleph_init_project',{workspace,eval_command:'python3 '+quote(script)}),args={project_id:p.id};writeFileSync(join(p.researchRoot,'algorithm.txt'),'3\n');commit(p.researchRoot,'committed algorithm 3');let caller,owned,branch;
  if(actual){const child=await invoke('aleph_run_researcher',args);caller=child.childId;owned=child.worktree;branch=child.branch;await until(async()=>(await http('/api/aleph-test/researcher-control',{parentId:sid})).states.some(s=>s.sessionId===caller&&s.waiting),'real researcher Bash and wait');commit(owned,'commit real researcher marker before evaluation');}
  else{caller=mode+'-researcher';owned=join(root,'researcher');branch='research/'+mode;git(p.researchRoot,'worktree','add','-b',branch,owned);const current=table.get(p.id);current.agents=[{role:'researcher',childId:caller,worktree:owned,branch,status:'running'}];await table.put(p.id,current);}
  const s={mode,project:p.id,owned,branch};report.scenarios.push(s);save();
  try{
   if(mode==='tracked-dirty'||mode==='staged'){writeFileSync(join(owned,'algorithm.txt'),'7\n');if(mode==='staged')git(owned,'add','algorithm.txt');}
   if(mode==='untracked')writeFileSync(join(owned,'extra.txt'),'11\n');
   if(['tracked-dirty','untracked','staged'].includes(mode)){
    const before={status:git(owned,'status','--porcelain=v1','--untracked-files=all'),head:git(owned,'rev-parse','HEAD'),index:git(owned,'write-tree'),content:readFileSync(join(owned,mode==='untracked'?'extra.txt':'algorithm.txt'),'utf8')};s.beforeRejection=before;
    let rejected;try{await invoke('aleph_evaluate',args,caller);}catch(e){rejected=e;}s.rejection=rejected?.message;const rejectedState=(await invoke('aleph_status',args))[0];
    await point(mode,'uncommitted input rejects before evaluating',()=>assert.ok(rejected));
    await point(mode,'diagnostic asks for commit before retry',()=>assert.match(rejected.message,/Commit the listed changes.*retry aleph_evaluate/));
    await point(mode,'diagnostic names exact input file',()=>assert.ok(rejected.message.includes(mode==='untracked'?'extra.txt':'algorithm.txt')));
    await point(mode,'rejection does not launch Python evaluator',()=>assert.equal(existsSync(join(gate,'started.json')),false));
    await point(mode,'rejection preserves source status',()=>assert.equal(git(owned,'status','--porcelain=v1','--untracked-files=all'),before.status));
    await point(mode,'rejection preserves source commit',()=>assert.equal(git(owned,'rev-parse','HEAD'),before.head));
    await point(mode,'rejection preserves source index',()=>assert.equal(git(owned,'write-tree'),before.index));
    await point(mode,'rejection preserves actual pending content',()=>assert.equal(readFileSync(join(owned,mode==='untracked'?'extra.txt':'algorithm.txt'),'utf8'),before.content));
    await point(mode,'rejection records no successful history',()=>assert.equal((rejectedState.project.evaluations??[]).length,0));
    await point(mode,'rejection creates no report ref',()=>assert.equal(git(p.researchRoot,'for-each-ref','--format=%(refname)','refs/aleph/evaluations'),''));
    commit(owned,'commit previously rejected research input');
   }
   if(mode==='explicit-branch'){writeFileSync(join(p.researchRoot,'algorithm.txt'),'99\n');s.unrelatedDirty=git(p.researchRoot,'status','--porcelain');}
   if(mode==='ignored-input'){writeFileSync(join(p.researchRoot,'.git/info/exclude'),'extra.txt\n');writeFileSync(join(owned,'extra.txt'),'11\n');}
   const startTip=git(owned,'rev-parse','HEAD');s.startTip=startTip;s.sourceStatus=git(owned,'status','--porcelain');
   const explicit=async()=>{if(actual)return http('/api/aleph/evaluate',{...args,branch});let status,value;const req={method:'POST',async *[Symbol.asyncIterator](){yield JSON.stringify({...args,branch});}};await routes.get('/api/aleph/evaluate').handler(req,{writeHead:s=>{status=s;},end:raw=>{value=JSON.parse(raw);}});if(status!==200)throw Error(JSON.stringify(value));return value;};
   const pending=mode==='explicit-branch'?explicit():invoke('aleph_evaluate',args,caller);await until(()=>existsSync(join(gate,'started.json')),'snapshot evaluator starts');s.entry=JSON.parse(readFileSync(join(gate,'started.json'),'utf8'));
   if(mode==='advance-during-evaluation'){writeFileSync(join(owned,'algorithm.txt'),'19\n');s.advanced=commit(owned,'algorithm advanced after evaluation admission');}
   writeFileSync(join(gate,'release'),'release');const result=await pending;s.result=result;s.read=JSON.parse(readFileSync(join(gate,'read.json'),'utf8'));const state=(await invoke('aleph_status',args))[0];s.final=state;
   const reportInput=git(p.researchRoot,'show',result.researchCommit+':algorithm.txt');let reportExtra=null;try{reportExtra=git(p.researchRoot,'show',result.researchCommit+':extra.txt');}catch{}s.reportInput=reportInput;s.reportExtra=reportExtra;
   await point(mode,'evaluator uses independent snapshot directory',()=>assert.notEqual(s.entry.solution,owned));
   await point(mode,'evaluator runs in configured external cwd',()=>assert.equal(s.entry.cwd,workspace));
   await point(mode,'owned source remains registered',()=>assert.ok(git(p.researchRoot,'worktree','list','--porcelain').includes(owned)));
   await point(mode,'stopped snapshot directory is removed',()=>assert.equal(existsSync(s.entry.solution),false));
   await point(mode,'stopped snapshot registration is removed',()=>assert.equal(git(p.researchRoot,'worktree','list','--porcelain').includes(s.entry.solution),false));
   const expectedScore=mode==='untracked'?14:['tracked-dirty','staged'].includes(mode)?7:3;
   await point(mode,'score reads exactly the admitted committed input',()=>assert.equal(result.score,expectedScore));
   await point(mode,'report tracked input equals actual Python input',()=>assert.equal(reportInput,s.read.algorithm));
   await point(mode,'report additional input equals actual Python input',()=>assert.equal(reportExtra,s.read.extra));
   await point(mode,'returned evaluated commit is captured source',()=>assert.equal(result.evaluatedCommit,startTip));
   await point(mode,'report parent is captured source commit',()=>assert.equal(git(p.researchRoot,'rev-parse',result.researchCommit+'^'),startTip));
   await point(mode,'report tree is admitted committed tree',()=>assert.equal(git(p.researchRoot,'rev-parse',result.researchCommit+'^{tree}'),git(p.researchRoot,'rev-parse',startTip+'^{tree}')));
   await point(mode,'report ref retains independent report',()=>assert.equal(git(p.researchRoot,'rev-parse',result.evaluationRef),result.researchCommit));
   await point(mode,'history associates score with same source',()=>{assert.equal(state.project.evaluations.at(-1).evaluatedCommit,startTip);assert.equal(state.project.evaluations.at(-1).score,expectedScore);});
   await point(mode,'best associates score with same source',()=>{assert.equal(state.project.best.commit,startTip);assert.equal(state.project.best.score,expectedScore);});
   await point(mode,'generated evaluator output never enters original source',()=>assert.equal(existsSync(join(owned,'evaluator-generated.txt')),false));
   if(mode==='advance-during-evaluation'){
    await point(mode,'later algorithm commit remains on researcher branch',()=>assert.equal(git(owned,'rev-parse',branch),s.advanced));
    await point(mode,'later algorithm working file remains untouched',()=>assert.equal(readFileSync(join(owned,'algorithm.txt'),'utf8'),'19\n'));
    await point(mode,'CAS accurately reports later branch not advanced',()=>assert.equal(result.researchBranchUpdated,false));
   }else await point(mode,'research branch advances to corresponding report',()=>assert.equal(git(owned,'rev-parse',branch),result.researchCommit));
   if(mode==='explicit-branch')await point(mode,'unrelated dirty branch remains untouched',()=>{assert.equal(git(p.researchRoot,'status','--porcelain'),s.unrelatedDirty);assert.equal(readFileSync(join(p.researchRoot,'algorithm.txt'),'utf8'),'99\n');});
   if(mode==='ignored-input')await point(mode,'ignored original input stays available outside submitted tree',()=>assert.equal(readFileSync(join(owned,'extra.txt'),'utf8'),'11\n'));
  }finally{writeFileSync(join(gate,'release'),'cleanup');if(actual)await http('/api/aleph-test/researcher-control',{parentId:sid,action:'release',sessionId:caller});save();}
 }
 report.complete=true;report.protection_validated=report.checks.every(x=>x.passed);save();
});
