import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
const actual=Boolean(process.env.ALEPH_FIXED_SELECT_ACTUAL_CONFIG);
const cfg=actual?JSON.parse(readFileSync(process.env.ALEPH_FIXED_SELECT_ACTUAL_CONFIG,'utf8')):{};
const source=resolve(cfg.source||process.env.ALEPH_CURRENT_SOURCE),output=cfg.output||process.env.ALEPH_FIXED_SELECT_OUTPUT;
const records={source,sha:execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),actual,checks:[],scenarios:[],boundary:'Real project init/evaluate/select-best handlers, Git refs/index/files, linked worktrees, Python scoring. Automatic replaces DSH session/storage. Actual uses real DSH sessions/tools/persistent storage and authenticated HTTP. No product edits or model calls.'};
const save=()=>output&&writeFileSync(output,JSON.stringify(records,null,2));
const git=(r,...a)=>execFileSync('git',['-C',r,...a],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const commit=r=>{git(r,'add','-A');git(r,'-c','user.name=Test','-c','user.email=test@localhost','commit','-m','fixture input');return git(r,'rev-parse','HEAD');};
const snap=r=>({head:git(r,'rev-parse','HEAD'),index:git(r,'write-tree'),status:git(r,'status','--porcelain=v1','--untracked-files=all'),algorithm:readFileSync(join(r,'algorithm.txt'),'utf8'),pending:existsSync(join(r,'pending.txt'))?readFileSync(join(r,'pending.txt'),'utf8'):null});
let cookie;
if(actual){const login=readFileSync(join(cfg.root,'dsh.log'),'utf8').match(/dsh web: (http:\/\/\S+)/)?.[1];assert.ok(login);const r=await fetch(login,{redirect:'manual'});assert.equal(r.status,303);cookie=r.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);}
async function http(path,body){const r=await fetch(cfg.url+path,{method:body===undefined?'GET':'POST',headers:{Origin:cfg.url,'Content-Type':'application/json',Cookie:cookie||''},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,value:await r.json()};}
async function bridge(body){const r=await http('/api/aleph-test/bridge',body);assert.equal(r.status,200);assert.ok(r.value.ok);return r.value.result;}
test('B fixed select-best preserves checked-out worktrees and selects unoccupied refs',async t=>{
 const point=async(scope,name,fn)=>t.test(scope+': '+name,()=>{try{fn();records.checks.push({scope,name,passed:true});}catch(e){records.checks.push({scope,name,passed:false,error:e.message});throw e;}finally{save();}});
 for(const mode of ['checked-clean','checked-dirty','linked-clean','linked-dirty','unoccupied','already-best','already-best-dirty','missing-branch','no-best']){
  const root=actual?join(cfg.workspace,mode):mkdtempSync(join(tmpdir(),'aleph-select-'+mode+'-'));mkdirSync(root,{recursive:true});const workspace=join(root,'workspace');mkdirSync(workspace);
  let invoke,sid;const routes=new Map(),tools=new Map();
  if(actual){sid=(await bridge({action:'parent',cwd:workspace})).sessionId;invoke=(name,args)=>bridge({action:'tool',sessionId:sid,name,args});}
  else{sid=mode+'-leader';const data=new Map(),table={get:k=>data.has(k)?structuredClone(data.get(k)):undefined,entries:()=>[...data].map(([k,v])=>[k,structuredClone(v)]),put:async(k,v)=>data.set(k,structuredClone(v))};const {apply}=await import(pathToFileURL(join(source,'dsh-plugin/index-v2.js')));await apply({storageDomain:{open:async()=>({table:()=>table,close:async()=>{}})},get:n=>({sessions:{get:()=>({header:{cwd:workspace}})},agentPresets:{presetForSession:()=> 'aleph'},subagents:{}})[n],effect:()=>{},tools:{register:d=>{tools.set(d.name,d);return()=>{};}},webServer:{register:r=>routes.set(r.path,r)}});invoke=(name,args)=>tools.get(name).execute(args,{agent:{id:sid}});}
  const project=await invoke('aleph_init_project',{workspace,eval_command:'python3 -c \'import json,os;from pathlib import Path;print(json.dumps({"score":int(Path(os.environ["ALEPH_SOLUTION_DIR"]).joinpath("algorithm.txt").read_text())}))\''}),repo=project.researchRoot;
  writeFileSync(join(repo,'algorithm.txt'),'10\n');const bestInput=commit(repo);let evaluated;
  if(mode!=='no-best')evaluated=await invoke('aleph_evaluate',{project_id:project.id});
  writeFileSync(join(repo,'algorithm.txt'),'20\n');const later=commit(repo);let branch='main',target=repo;
  if(mode.startsWith('linked')){branch='research/linked';target=join(root,'关联 worktree\n精确路径');git(repo,'worktree','add','-b',branch,target);}
  if(mode==='unoccupied'){branch='research/idle';git(repo,'branch',branch,later);}
  if(mode==='missing-branch')branch='research/missing';
  if(mode.startsWith('already-best'))git(repo,'reset','--hard',bestInput);
  if(mode.endsWith('dirty')){writeFileSync(join(target,'algorithm.txt'),'30\n');git(target,'add','algorithm.txt');writeFileSync(join(target,'algorithm.txt'),'40\n');writeFileSync(join(target,'pending.txt'),'pending work\n');}
  const before=snap(target),mainBefore=snap(repo),stateBefore=(await invoke('aleph_status',{project_id:project.id}))[0].project;
  const args={...(mode==='linked-dirty'?{projectId:project.id}:{project_id:project.id}),...(mode==='checked-clean'?{}:{branch})};
  let response;
  if(actual)response=await http('/api/aleph/select-best',args);
  else{let status,value;await routes.get('/api/aleph/select-best').handler({method:'POST',async *[Symbol.asyncIterator](){yield JSON.stringify(args);}},{writeHead:v=>status=v,end:raw=>value=JSON.parse(raw)});response={status,value};}
  const after=snap(target),mainAfter=snap(repo),stateAfter=(await invoke('aleph_status',{project_id:project.id}))[0].project;
  const occupied=mode.startsWith('checked')||mode.startsWith('linked'),invalid=mode==='missing-branch'||mode==='no-best';
  const s={mode,project:project.id,repo,target,branch,bestInput,later,evaluated,before,after,mainBefore,mainAfter,response,stateBefore,stateAfter};records.scenarios.push(s);save();
  await point(mode,'project research repository remains valid',()=>assert.equal(git(repo,'rev-parse','--is-inside-work-tree'),'true'));
  await point(mode,'original algorithm commit remains reachable',()=>assert.equal(git(repo,'cat-file','-t',bestInput),'commit'));
  await point(mode,'later algorithm commit remains reachable',()=>assert.equal(git(repo,'cat-file','-t',later),'commit'));
  await point(mode,'selection preserves evaluation history',()=>assert.deepEqual(stateAfter.evaluations,stateBefore.evaluations));
  await point(mode,'selection preserves best score and source record',()=>assert.deepEqual(stateAfter.best,stateBefore.best));
  await point(mode,'selection preserves tracked working contents',()=>assert.equal(after.algorithm,before.algorithm));
  await point(mode,'selection preserves staged tree',()=>assert.equal(after.index,before.index));
  await point(mode,'selection preserves untracked pending contents',()=>assert.equal(after.pending,before.pending));
  if(occupied){
   await point(mode,'checked-out branch move rejects before ref mutation',()=>assert.equal(response.status,500));
   await point(mode,'checked-out source HEAD remains intact',()=>assert.equal(after.head,before.head));
   await point(mode,'checked-out status remains intact',()=>assert.equal(after.status,before.status));
   await point(mode,'rejection identifies exact occupied worktree',()=>assert.ok(response.value.error.message.includes(JSON.stringify(target))));
   await point(mode,'rejection gives save or commit and switch instructions',()=>assert.match(response.value.error.message,/save or commit.*switch each listed worktree.*retry/));
   if(mode.startsWith('linked'))await point(mode,'other checked-out main worktree stays unchanged',()=>assert.deepEqual(mainAfter,mainBefore));
  }else if(invalid){
   await point(mode,'invalid selection rejects',()=>assert.equal(response.status,500));
   await point(mode,'invalid selection returns actionable cause',()=>assert.match(response.value.error.message,mode==='no-best'?/no evaluated best/:/branch not found/));
   await point(mode,'invalid selection leaves checked-out snapshot unchanged',()=>assert.deepEqual(after,before));
   if(mode==='missing-branch')await point(mode,'invalid selection does not create missing branch',()=>assert.equal(git(repo,'for-each-ref','--format=%(refname)','refs/heads/'+branch),''));
  }else{
   await point(mode,'valid safe selection succeeds',()=>assert.equal(response.status,200));
   await point(mode,'selected ref equals best evaluated input',()=>assert.equal(git(repo,'rev-parse','refs/heads/'+branch),bestInput));
   await point(mode,'returned selected score matches actual Python score',()=>assert.equal(response.value.score,10));
   await point(mode,'returned previous ref matches preselection ref',()=>assert.equal(response.value.previous,mode.startsWith('already-best')?bestInput:later));
   await point(mode,'safe selection preserves checked-out snapshot',()=>assert.deepEqual(after,before));
  }
 }
 records.complete=true;records.failed=records.checks.filter(p=>!p.passed).length;save();
});
