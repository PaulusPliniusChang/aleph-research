import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
const actual=Boolean(process.env.ALEPH_COMPOSER_CONFIG),cfg=actual?JSON.parse(readFileSync(process.env.ALEPH_COMPOSER_CONFIG,'utf8')):{};
const source=resolve(cfg.source||process.env.ALEPH_CURRENT_SOURCE),output=cfg.output||process.env.ALEPH_COMPOSER_OUTPUT;
const report={source,sha:execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),actual,checks:[],observations:[],boundary:'Automatic substitutes storage, sessions and model activations; Git, worktrees, runner and shell are real. Actual uses installed DSH original spawn, persistent state and real model tool execution with a local deterministic decision adapter. The adapter reads actual tool results and exercises direct dispatch, one explicit Infra static-inspection path, and subsequent dispatch; this verifies Host routing and queue continuation, not model judgment or research quality. No Leader dispatch calls after approvals. Automatic service routing remains direct but registered visibility predicates are independently asserted. Actual adapter falls back to direct execution only when Infra is missing, explicitly records the missing tool and fails Infra-specific assertions; it does not report this fallback as a successful Infra path.'};
const save=()=>output&&writeFileSync(output,JSON.stringify(report,null,2));
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label)=>{const end=Date.now()+30000;while(!await fn()){if(Date.now()>end){if(actual){try{report.timeoutModel=await http('/api/aleph-test/composer-observations');report.timeoutState=await invoke('aleph_status',{project_id:project.id});save();}catch{}}throw Error('fixture timeout '+label);}await sleep(25);}};
let cookie='',sid='continuation-leader',invoke,project;
const workspace=actual?cfg.workspace:mkdtempSync(join(tmpdir(),'aleph-composer-continuation-'));
const activations=[],messages=[],errors=[];
const http=async(path,body)=>{const response=await fetch(cfg.url+path,{method:body===undefined?'GET':'POST',headers:{Origin:cfg.url,'Content-Type':'application/json',Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw Error(JSON.stringify(result));return result;};
const bridge=async body=>{const result=await http('/api/aleph-test/bridge',body);if(!result.ok)throw Error(JSON.stringify(result));return result.result;};
test('B current persistent Composer continuation',async t=>{
 const point=async(name,fn)=>t.test(name,async()=>{try{await fn();report.checks.push({name,passed:true});}catch(e){report.checks.push({name,passed:false,error:e.message});throw e;}finally{save();}});
 let definitions,visibleFor;
 if(actual){
  await until(()=>/dsh web: http/.test(readFileSync(join(cfg.root,'dsh.log'),'utf8')),'actual login');const login=[...readFileSync(join(cfg.root,'dsh.log'),'utf8').matchAll(/dsh web: (http:\/\/\S+)/g)].at(-1)[1];const response=await fetch(login,{redirect:'manual'});assert.equal(response.status,303);cookie=response.headers.get('set-cookie').split(';')[0];sid=(await bridge({action:'parent',cwd:workspace})).sessionId;
  definitions=await bridge({action:'tool-definitions',sessionId:sid});visibleFor=async caller=>(await http('/api/aleph-test/composer-observations')).states.find(s=>s.sid===caller)?.visibleTools??[];invoke=(name,args,caller=sid)=>bridge({action:'tool',sessionId:caller,name,args});
 }else{
  const predicates=new Map(),tools=new Map(),values=new Map(),table={get:id=>values.has(id)?structuredClone(values.get(id)):undefined,put:async(id,v)=>values.set(id,structuredClone(v)),entries:()=>[...values].map(([id,v])=>[id,structuredClone(v)])};
  const subagents={startActivation:async spec=>{
   let release;const result=new Promise(r=>release=r),childId='composer-child-'+activations.length;const a={childId,spec,commands:[],release,result,pumping:false,dispatches:0};activations.push(a);
   if(spec.request.agentPreset==='aleph-composer')setTimeout(()=>pump(a),0);
   else if(spec.request.agentPreset==='aleph-infra'){writeFileSync(join(spec.request.cwd,'ALEPH_HANDOFF.md'),'Static inspection only; no safe optimization needed.');setTimeout(()=>release({output:[{type:'text',text:'Static inspection complete'}]}),0);}
   return{childId,result,dispose:async()=>release({output:[]})};
  },sendMessage:async(parent,childId,content)=>{messages.push({childId,content});const a=activations.find(a=>a.childId===childId);setTimeout(()=>pump(a),0);}};
  async function pump(a){if(a.pumping)return;a.pumping=true;try{
   while(true){a.commands.push('aleph_status');const state=(await invoke('aleph_status',{project_id:project.id},a.childId))[0];if(state.machines[0].status!=='idle'||!state.missions.some(m=>m.status==='approved'))break;
    a.commands.push('aleph_form_batch');const formed=await invoke('aleph_form_batch',{project_id:project.id},a.childId),batch=formed.batches.find(b=>b.status==='forming');a.dispatches++;const name=a.dispatches===2?'aleph_run_infra':'aleph_run_batch';a.commands.push(name);await invoke(name,{project_id:project.id,batch_id:batch.id},a.childId);
   }
  }catch(error){errors.push(String(error));report.automaticErrors=errors;save();}finally{a.pumping=false;}}
  const {apply}=await import(pathToFileURL(join(source,'dsh-plugin/index-v2.js')));await apply({storageDomain:{open:async()=>({table:()=>table,close:async()=>{}})},get:name=>({sessions:{get:id=>({header:{id,cwd:workspace}})},agentPresets:{presetForSession:s=>s.header.id===sid?'aleph':'aleph-composer'},subagents})[name],effect:()=>{},tools:{register:(d,options)=>{tools.set(d.name,d);predicates.set(d.name,options?.when);return()=>{};}},webServer:{register:()=>{}}});invoke=(name,args,caller=sid)=>tools.get(name).execute(args,{agent:{id:caller}});definitions=[...tools.values()];visibleFor=async caller=>[...tools.keys()].filter(name=>!predicates.get(name)||predicates.get(name)({agent:{id:caller}}));
 }
 project=await invoke('aleph_init_project',{workspace});const id=project.id,state=async()=>(await invoke('aleph_status',{project_id:id}))[0];
 await point('old campaign dispatch tool is absent',()=>assert.equal(definitions.some(d=>d.name==='aleph_run_available'),false));
 await point('current explicit Composer tool is registered',()=>assert.ok(definitions.some(d=>d.name==='aleph_run_composer')));
 await point('current mission approval is registered',()=>assert.ok(definitions.some(d=>d.name==='aleph_approve_mission')));
 await point('initial project has no Composer records',()=>assert.equal(project.agents.length,0));
 const make=async(name,held=false)=>{const m=await invoke('aleph_start_mission',{project_id:id,name});const gate=join(workspace,name+'-release'),counter=join(workspace,name+'-counter');writeFileSync(join(m.missionDir,'mission.json'),JSON.stringify({id:m.missionId,entrypoint:'run.sh',outputs:[name+'.txt']}));writeFileSync(join(m.missionDir,'run.sh'),`printf run\\n >> '${counter}'\nprintf started > "$ALEPH_OUTPUT_DIR/started.txt"\n${held?`while [ ! -f '${gate}' ]; do sleep .025; done\n`:''}printf '${name}-result' > "$ALEPH_OUTPUT_DIR/${name}.txt"\n`);git(m.worktree,'add','-A');git(m.worktree,'-c','user.name=Test','-c','user.email=test@localhost','commit','-m',name);const proposed=await invoke('aleph_propose_mission',{project_id:id,branch:m.branch});const recordId=proposed.missions.find(record=>record.branch===m.branch).id;return{...m,recordId,name,gate,counter};};
 const first=await make('first',true),second=await make('second'),third=await make('third');report.observations.push({first,second,third});
 await point('proposal alone creates no batch',async()=>assert.equal((await state()).batches.length,0));
 await point('proposal alone starts no Composer',async()=>assert.equal((await state()).agents.filter(a=>a.role==='composer').length,0));
 await point('proposal alone runs no computation',()=>assert.equal([first,second,third].some(m=>existsSync(m.counter)),false));
 await invoke('aleph_approve_mission',{project_id:id,mission_id:first.recordId});
 report.observations.push({afterApproval:await state()});save();
 await until(()=>existsSync(first.counter),'Composer starts first actual computation');const running=await state(),composer=running.agents.find(a=>a.role==='composer');report.observations.push({running});
 await point('first approval starts a Composer identity',()=>assert.ok(composer.childId));
 await point('Composer can access the Infra dispatch tool required by its prompt',async()=>assert.ok((await visibleFor(composer.childId)).includes('aleph_run_infra')));
 await point('first computation needs no Leader dispatch',()=>assert.equal(running.batches[0].status,'running'));
 await point('first batch owns busy machine',()=>assert.equal(running.machines[0].batchId,running.batches[0].id));
 await point('unapproved second mission remains proposed',()=>assert.equal(running.missions.find(m=>m.id===second.recordId).status,'proposed'));
 await point('unapproved second computation has not started',()=>assert.equal(existsSync(second.counter),false));
 await invoke('aleph_approve_mission',{project_id:id,mission_id:second.recordId});const queued=await state();report.observations.push({queued});
 await point('approval while busy keeps second mission approved',()=>assert.equal(queued.missions.find(m=>m.id===second.recordId).status,'approved'));
 await point('busy approval preserves existing machine owner',()=>assert.equal(queued.machines[0].batchId,running.batches[0].id));
 await point('busy approval does not duplicate Composer',()=>assert.equal(queued.agents.filter(a=>a.role==='composer').length,1));
 await point('busy approval does not start second calculation early',()=>assert.equal(existsSync(second.counter),false));
 writeFileSync(first.gate,'release');await until(async()=>(await state()).missions.filter(m=>m.status==='done').length===2,'first and second finish through Composer continuation');const twoDone=await state();report.observations.push({twoDone});
 await point('first mission finishes successfully',()=>assert.equal(twoDone.missions.find(m=>m.id===first.recordId).status,'done'));
 await point('second queued mission finishes without Leader dispatch',()=>assert.equal(twoDone.missions.find(m=>m.id===second.recordId).status,'done'));
 await point('distinct batches execute queued work',()=>assert.equal(twoDone.batches.length,2));
 await point('both finished batches retain done state',()=>assert.ok(twoDone.batches.every(b=>b.status==='done')));
 await point('completion releases machine capacity',()=>assert.equal(twoDone.machines[0].status,'idle'));
 await point('completion clears exact machine batch owner',()=>assert.equal(twoDone.machines[0].batchId,null));
 await point('first task computes once',()=>assert.equal(readFileSync(first.counter,'utf8').match(/run/g).length,1));
 await point('second task computes once',()=>assert.equal(readFileSync(second.counter,'utf8').match(/run/g).length,1));
 await point('first result belongs to first mission branch',()=>assert.equal(git(project.missionRoot,'show',first.branch+':results/'+first.missionId+'/first.txt'),'first-result'));
 await point('second result belongs to second mission branch',()=>assert.equal(git(project.missionRoot,'show',second.branch+':results/'+second.missionId+'/second.txt'),'second-result'));
 await point('third unapproved mission stays untouched',()=>assert.equal(existsSync(third.counter),false));
 await point('second dispatch uses an Infra activation',()=>assert.equal(twoDone.agents.filter(a=>a.role==='infra').length,1));
 await point('Infra static inspection completes successfully',()=>assert.equal(twoDone.agents.find(a=>a.role==='infra')?.status,'done'));
 await point('Infra handoff persists in optimized batch history',()=>assert.ok(git(project.missionRoot,'show',twoDone.batches[1].branch+':ALEPH_HANDOFF.md').includes('Static inspection')));
 await invoke('aleph_approve_mission',{project_id:id,mission_id:third.recordId});await until(async()=>(await state()).missions.every(m=>m.status==='done'),'later approval wakes same Composer');const final=await state();report.observations.push({final});
 await point('later approval dispatches third work without Leader command',()=>assert.equal(final.missions.find(m=>m.id===third.recordId).status,'done'));
 await point('later approval reuses same Composer identity',()=>assert.deepEqual(final.agents.filter(a=>a.role==='composer').map(a=>a.childId),[composer.childId]));
 await point('all three task branches have distinct result commits',()=>assert.equal(new Set(final.missions.map(m=>m.result_commit)).size,3));
 await point('later work is computed exactly once',()=>assert.equal(readFileSync(third.counter,'utf8').match(/run/g).length,1));
 await point('final state has no approved work left',()=>assert.equal(final.missions.filter(m=>m.status==='approved').length,0));
 let observed;
 if(actual){await until(async()=>{const r=await http('/api/aleph-test/composer-observations');return r.states.find(s=>s.sid===composer.childId)?.commands.filter(c=>c.name==='aleph_run_batch'||c.name==='aleph_run_infra').length===3;},'actual model command evidence');observed=await http('/api/aleph-test/composer-observations');const c=observed.states.find(s=>s.sid===composer.childId);
  await point('actual Composer issues direct execution tools',()=>assert.equal(c.commands.filter(c=>c.name==='aleph_run_batch').length,2));
  await point('actual Composer issues Infra execution tool',()=>assert.equal(c.commands.filter(c=>c.name==='aleph_run_infra').length,1));
  await point('actual Composer receives queue change notifications',()=>assert.ok(JSON.stringify(c.contexts).includes('MissionQueue changed')));
  await point('actual Infra calls bash',()=>assert.ok(observed.states.find(s=>s.preset==='aleph-infra')?.commands.some(c=>c.name==='bash')));
 }else{observed={activations:activations.map(a=>({childId:a.childId,preset:a.spec.request.agentPreset,commands:a.commands})),messages,errors};
  await point('activation uses one persistent Composer',()=>assert.equal(activations.filter(a=>a.spec.request.agentPreset==='aleph-composer').length,1));
  await point('completion posts exact queue event to Composer',()=>assert.ok(messages.some(m=>m.childId===composer.childId&&JSON.stringify(m.content).includes('batch finished'))));
  await point('later approval posts queue event to same Composer',()=>assert.ok(messages.filter(m=>m.childId===composer.childId&&JSON.stringify(m.content).includes('mission approved')).length>=2));
  await point('deterministic automatic model has no tool errors',()=>assert.deepEqual(errors,[]));
 }
 report.observations.push({model:observed});report.complete=true;report.effective=report.checks.length;report.failed=report.checks.filter(c=>!c.passed).length;save();
});
