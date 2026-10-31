import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
const actual=Boolean(process.env.ALEPH_HISTORY_ACTUAL_CONFIG);
const cfg=actual?JSON.parse(readFileSync(process.env.ALEPH_HISTORY_ACTUAL_CONFIG,'utf8')):{};
const source=resolve(cfg.source||process.env.ALEPH_CURRENT_SOURCE),output=cfg.output||process.env.ALEPH_HISTORY_OUTPUT;
const records={source,sha:execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),actual,checks:[],scenarios:[],boundary:'Current evaluation histories/best-score updates and report lookup through real project handlers, Git and gated Python. Automatic substitutes session/storage. Actual uses real DSH sessions/tools/persistence/authenticated HTTP. No product source, timeout, Git or score-parser adapters.'};
const save=()=>output&&writeFileSync(output,JSON.stringify(records,null,2));
const git=(r,...a)=>execFileSync('git',['-C',r,...a],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const commit=r=>{git(r,'add','-A');git(r,'-c','user.name=Test','-c','user.email=test@localhost','commit','-m','fixture input');return git(r,'rev-parse','HEAD');};
const snap=r=>({head:git(r,'rev-parse','HEAD'),index:git(r,'write-tree'),status:git(r,'status','--porcelain=v1','--untracked-files=all'),algorithm:readFileSync(join(r,'algorithm.txt'),'utf8'),pending:existsSync(join(r,'pending.txt'))?readFileSync(join(r,'pending.txt'),'utf8'):null});
let cookie;
if(actual){const login=readFileSync(join(cfg.root,'dsh.log'),'utf8').match(/dsh web: (http:\/\/\S+)/)?.[1];assert.ok(login);const r=await fetch(login,{redirect:'manual'});assert.equal(r.status,303);cookie=r.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);}
async function http(path,body){const r=await fetch(cfg.url+path,{method:body===undefined?'GET':'POST',headers:{Origin:cfg.url,'Content-Type':'application/json',Cookie:cookie||''},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,value:await r.json()};}
async function bridge(body){const r=await http('/api/aleph-test/bridge',body);assert.equal(r.status,200);assert.ok(r.value.ok);return r.value.result;}

test('B current evaluation history report and best consistency',async t=>{
 const point=async(scope,name,fn)=>t.test(scope+': '+name,()=>{try{fn();records.checks.push({scope,name,passed:true});}catch(e){records.checks.push({scope,name,passed:false,error:e.message});throw e;}finally{save();}});
 const delay=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(fn)=>{const end=Date.now()+12000;while(!fn()){if(Date.now()>end)throw Error('evaluation fixture gate');await delay(20);}};
 for(const mode of ['higher-finishes-first','lower-finishes-first','equal-score','scoreless','nonzero','bounded-report']){
  const root=actual?join(cfg.workspace,mode):mkdtempSync(join(tmpdir(),'aleph-history-'+mode+'-'));mkdirSync(root,{recursive:true});const workspace=join(root,'workspace');mkdirSync(workspace);const gate=join(root,'gate');mkdirSync(gate);
  const script=join(root,'evaluate.py');
  writeFileSync(script,`import json,os,time,sys\nfrom pathlib import Path\ns=Path(os.environ['ALEPH_SOLUTION_DIR']);g=Path(${JSON.stringify(gate)})\nx=json.loads(s.joinpath('input.json').read_text());label=x['label']\ng.joinpath(label+'-ready').write_text(str(s))\nend=time.monotonic()+15\nwhile not g.joinpath(label+'-release').exists():\n if time.monotonic()>end: raise RuntimeError('fixture release timeout')\n time.sleep(.01)\nif x['mode']=='nonzero':\n print('controlled-error',file=sys.stderr);sys.exit(3)\nr={'rows':1000,'diagnostic':'diagnostic-'+label,'baseline_delta':x['score']-5}\nif x['mode']!='scoreless':r['score']=x['score']\nif x['mode']=='bounded-report':r['detail']='x'*9000\nprint(json.dumps(r));print('stderr-'+label,file=sys.stderr)\n`);
  let invoke,sid;const routes=new Map(),tools=new Map();
  if(actual){sid=(await bridge({action:'parent',cwd:workspace})).sessionId;invoke=(name,args)=>bridge({action:'tool',sessionId:sid,name,args});}
  else{sid=mode+'-leader';const data=new Map(),table={get:k=>data.has(k)?structuredClone(data.get(k)):undefined,entries:()=>[...data].map(([k,v])=>[k,structuredClone(v)]),put:async(k,v)=>data.set(k,structuredClone(v))};const {apply}=await import(pathToFileURL(join(source,'dsh-plugin/index-v2.js')));await apply({storageDomain:{open:async()=>({table:()=>table,close:async()=>{}})},get:n=>({sessions:{get:()=>({header:{cwd:workspace}})},agentPresets:{presetForSession:()=> 'aleph'},subagents:{}})[n],effect:()=>{},tools:{register:d=>{tools.set(d.name,d);return()=>{};}},webServer:{register:r=>routes.set(r.path,r)}});invoke=(name,args)=>tools.get(name).execute(args,{agent:{id:sid}});}
  const quote=v=>"'"+v.replaceAll("'","'\\''")+"'";const p=await invoke('aleph_init_project',{workspace,eval_command:'python3 '+quote(script)}),repo=p.researchRoot;
  const call=async(path,args)=>{if(actual)return http(path,args);let status,value;await routes.get(path).handler({method:args===undefined?'GET':'POST',async *[Symbol.asyncIterator](){yield JSON.stringify(args);}},{writeHead:v=>status=v,end:raw=>value=JSON.parse(raw)});return {status,value};};
  const inputs=[],concurrent=mode.includes('finishes')||mode==='equal-score';
  for(const [label,score] of (concurrent?[['low',10],['high',mode==='equal-score'?10:20]]:[['one',30]])){
   git(repo,'checkout','-b','research/'+label);writeFileSync(join(repo,'input.json'),JSON.stringify({label,score,mode}));const input=commit(repo);inputs.push({label,score,input,branch:'research/'+label});git(repo,'checkout','main');
  }
  const initialHead=git(repo,'rev-parse','HEAD'),s={mode,project:p.id,inputs};records.scenarios.push(s);save();
  const pending=inputs.map(x=>call('/api/aleph/evaluate',{project_id:p.id,branch:x.branch}));
  for(const x of inputs)await until(()=>existsSync(join(gate,x.label+'-ready')));
  const order=mode==='higher-finishes-first'?[1,0]:inputs.map((_,i)=>i);s.order=order;s.responses=[];
  for(const i of order){writeFileSync(join(gate,inputs[i].label+'-release'),'release');s.responses[i]=await pending[i];}
  const state=(await invoke('aleph_status',{project_id:p.id}))[0].project;s.state=state;
  await point(mode,'main research branch remains unchanged',()=>assert.equal(git(repo,'rev-parse','main'),initialHead));
  await point(mode,'main research worktree stays clean',()=>assert.equal(git(repo,'status','--porcelain'),''));
  if(mode==='nonzero'){
   await point(mode,'nonzero evaluator returns failure',()=>assert.equal(s.responses[0].status,500));
   await point(mode,'failure diagnostic retains actual stderr',()=>assert.match(s.responses[0].value.error.message,/controlled-error/));
   await point(mode,'failure creates no evaluation history',()=>assert.equal((state.evaluations??[]).length,0));
   await point(mode,'failure creates no best result',()=>assert.equal(state.best??null,null));
   await point(mode,'failure creates no report ref',()=>assert.equal(git(repo,'for-each-ref','--format=%(refname)','refs/aleph/evaluations'),''));
   await point(mode,'failure preserves source branch',()=>assert.equal(git(repo,'rev-parse',inputs[0].branch),inputs[0].input));
   await point(mode,'failed temporary evaluation worktree removed',()=>assert.equal(git(repo,'worktree','list','--porcelain').includes('.aleph/evaluations'),false));
   continue;
  }
  await point(mode,'history retains each completed evaluation',()=>assert.equal(state.evaluations.length,inputs.length));
  await point(mode,'history completion order matches real releases',()=>assert.deepEqual(state.evaluations.map(x=>x.evaluatedCommit),order.map(i=>inputs[i].input)));
  for(const [i,x] of inputs.entries()){
   const result=s.responses[i].value,record=state.evaluations.find(r=>r.evaluatedCommit===x.input),scope=mode+'/'+x.label;
   const message=git(repo,'show','-s','--format=%B',result.researchCommit);s.responses[i].report=message;
   await point(scope,'evaluation returns success',()=>assert.equal(s.responses[i].status,200));
   await point(scope,'returned score follows actual evaluator contract',()=>assert.equal(result.score,mode==='scoreless'?null:x.score));
   await point(scope,'history score matches returned score',()=>assert.equal(record.score,result.score));
   await point(scope,'history branch matches input branch',()=>assert.equal(record.branch,x.branch));
   await point(scope,'report ref resolves to matching report',()=>assert.equal(git(repo,'rev-parse',record.evaluationRef),result.researchCommit));
   await point(scope,'report parent identifies scored input',()=>assert.equal(git(repo,'rev-parse',result.researchCommit+'^'),x.input));
   await point(scope,'report source metadata identifies scored input',()=>assert.ok(message.includes('Aleph-Research-Commit: '+x.input)));
   await point(scope,'report retains additional rows information',()=>assert.ok(message.includes('"rows": 1000')));
   await point(scope,'report retains diagnostic information',()=>assert.ok(message.includes('diagnostic-'+x.label)));
   await point(scope,'report retains relative baseline measurement',()=>assert.ok(message.includes('"baseline_delta": '+(x.score-5))));
   await point(scope,'tool response returns evaluator stderr',()=>assert.equal(result.stderr,'stderr-'+x.label+'\n'));
   await point(scope,'tool response retains rows and diagnostic output',()=>{assert.ok(result.stdout.includes('"rows": 1000'));assert.ok(result.stdout.includes('diagnostic-'+x.label));});
   await point(scope,'research source remains reachable',()=>assert.equal(git(repo,'cat-file','-t',x.input),'commit'));
   await point(scope,'successful evaluation updates only its branch report',()=>assert.equal(git(repo,'rev-parse',x.branch),result.researchCommit));
   await point(scope,'history report fields match return value',()=>{assert.equal(record.researchCommit,result.researchCommit);assert.equal(record.evaluationRef,result.evaluationRef);});
   if(mode==='bounded-report'){
    await point(scope,'stdout limit is explicit at8000 characters',()=>assert.equal(result.stdout.length,8000));
    await point(scope,'commit report applies documented4000-character prefix',()=>assert.ok(message.length<4500&&message.length>4000));
   }
  }
  if(mode==='scoreless')await point(mode,'scoreless report does not become best',()=>assert.equal(state.best??null,null));
  else{
   const winner=mode==='equal-score'?inputs[order[0]]:inputs.reduce((a,b)=>a.score>b.score?a:b),best=state.best;
   await point(mode,'best score equals highest completed numeric score',()=>assert.equal(best.score,winner.score));
   await point(mode,'best commit identifies matching actually scored algorithm',()=>assert.equal(best.commit,winner.input));
   await point(mode,'best report identifies same input code',()=>assert.equal(git(repo,'rev-parse',best.researchCommit+'^'),winner.input));
   await point(mode,'best ref retains its report',()=>assert.equal(git(repo,'rev-parse',best.evaluationRef),best.researchCommit));
   await point(mode,'best record branch matches winning code',()=>assert.equal(best.branch,winner.branch));
  }
 }
 records.complete=true;records.failed=records.checks.filter(x=>!x.passed).length;save();
});
