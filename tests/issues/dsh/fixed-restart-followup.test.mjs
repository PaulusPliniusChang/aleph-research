import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,readdirSync,readlinkSync,openSync,closeSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
const actual=Boolean(process.env.ALEPH_RECONCILE_ACTUAL_CONFIG),cfg=actual?JSON.parse(readFileSync(process.env.ALEPH_RECONCILE_ACTUAL_CONFIG,'utf8')):{};
const source=resolve(cfg.source||process.env.ALEPH_CURRENT_SOURCE),output=cfg.output||process.env.ALEPH_RECONCILE_OUTPUT;
const {ProjectService,apply}=actual?{}:await import(pathToFileURL(join(source,'dsh-plugin/index-v2.js')));
const records={sha:execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),actual,checks:[],scenarios:[],hosts:[],boundary:'Current startup reconciliation with real Git, batch runner, gated shell task and real SIGKILL of only the owning Host. Automatic uses on-disk storage adapter and real product startup apply. Actual uses real DSH storage/tools and restarts with same DSH_HOME. No product source or deadline changes. A bounded six-second post-exit observation covers at least one configured five-second process-monitor interval; it does not claim an unlimited wait.'};
const save=()=>output&&writeFileSync(output,JSON.stringify(records,null,2));
const git=(r,...a)=>execFileSync('git',['-C',r,...a],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label,ms=12000)=>{const end=Date.now()+ms;while(!await fn()){if(Date.now()>end)throw Error('fixture timeout '+label);await sleep(20);}};
const tableAt=root=>{const file=join(root,'state.json');if(!existsSync(file))writeFileSync(file,'{}');const read=()=>JSON.parse(readFileSync(file,'utf8'));return {get:k=>read()[k],entries:()=>Object.entries(read()),put:async(k,v)=>writeFileSync(file,JSON.stringify({...read(),[k]:v}))};};
const alive=pid=>{try{return !/^State:\s+Z/m.test(readFileSync('/proc/'+pid+'/status','utf8'));}catch{return false;}};
const procs=root=>readdirSync('/proc').filter(e=>/^\d+$/.test(e)).flatMap(e=>{try{const cwd=readlinkSync('/proc/'+e+'/cwd');return cwd===root||cwd.startsWith(root+'/')?[Number(e)]:[];}catch{return[];}});
if(process.argv[2]==='worker'){
 const root=process.argv[3],id=JSON.parse(readFileSync(join(root,'identity.json'),'utf8'));
 const service=new ProjectService({}, {table:()=>tableAt(root)},{});
 await service.runBatch({projectId:id.projectId,batchId:id.batchId});
}else{
 let cookie,sid,hostPid=cfg.pid,host,sequence=0,activeEffects=[];
 const http=async(path,body)=>{const r=await fetch(cfg.url+path,{method:body===undefined?'GET':'POST',headers:{Origin:cfg.url,'Content-Type':'application/json',Cookie:cookie||''},body:body===undefined?undefined:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw Error(JSON.stringify(v));return v;};
 const bridge=async b=>{const r=await http('/api/aleph-test/bridge',b);if(!r.ok)throw Error(JSON.stringify(r));return r.result;};
 async function authenticate(log){await until(()=>existsSync(log)&&/dsh web: (http:\/\/\S+)/.test(readFileSync(log,'utf8')),'actual auth log');const login=[...readFileSync(log,'utf8').matchAll(/dsh web: (http:\/\/\S+)/g)].at(-1)[1];const r=await fetch(login,{redirect:'manual'});assert.equal(r.status,303);cookie=r.headers.get('set-cookie').split(';')[0];}
 async function restart(root,crash){
  if(actual){
   if(hostPid){try{process.kill(hostPid,crash?'SIGKILL':'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}await until(()=>!alive(hostPid),'old actual Host exits');records.hosts.push({pid:hostPid,crash,alive:false,pid_exists:existsSync('/proc/'+hostPid)});}
   const logfile=join(cfg.root,'restart-'+(++sequence)+'.log'),fd=openSync(logfile,'w');host=spawn(process.execPath,[cfg.entry,'--profile','reproduction','--no-open','--host','127.0.0.1','--port',String(new URL(cfg.url).port)],{cwd:cfg.workspace,env:{...process.env,DSH_HOME:join(cfg.root,'home')},stdio:['ignore',fd,fd]});closeSync(fd);hostPid=host.pid;
   await until(async()=>{try{return (await fetch(cfg.url+'/api/aleph/health')).ok;}catch{return false;}},'restarted actual Host');await authenticate(logfile);sid=(await bridge({action:'parent',cwd:join(root,'workspace')})).sessionId;
  }else{
   for(const dispose of activeEffects.reverse())await dispose();activeEffects=[];
   await apply({storageDomain:{open:async()=>({table:()=>tableAt(root),close:async()=>{}})},get:()=>undefined,effect:fn=>{const d=fn();if(typeof d==='function')activeEffects.push(d);},tools:{register:()=>()=>{}},webServer:{register:()=>{}}});
   await sleep(30);
  }
 }
 test('B fixed restart follow-up preserves reservations and settles only startup orphan batches',async t=>{
  const point=async(scope,name,fn)=>t.test(scope+': '+name,()=>{try{fn();records.checks.push({scope,name,passed:true});}catch(e){records.checks.push({scope,name,passed:false,error:e.message});throw e;}finally{save();}});
  t.after(async()=>{for(const d of activeEffects.reverse())await d();if(actual&&hostPid){try{process.kill(hostPid,'SIGTERM');}catch{}await until(()=>!alive(hostPid),'final actual Host exits');records.hosts.push({pid:hostPid,final:true,exists:false});}save();});
  if(actual)await authenticate(join(cfg.root,'dsh.log'));
  for(const mode of ['forming','completed-before-restart','active-at-restart','already-delivered']){
   const root=actual?join(cfg.workspace,mode):mkdtempSync(join(tmpdir(),'aleph-reconcile-'+mode+'-'));mkdirSync(root,{recursive:true});const workspace=join(root,'workspace');mkdirSync(workspace);
   let service=actual?null:new ProjectService({}, {table:()=>tableAt(root)},{});
   if(actual)sid=(await bridge({action:'parent',cwd:workspace})).sessionId;
   const invoke=async(name,args)=>actual?bridge({action:'tool',sessionId:sid,name,args}):({aleph_init_project:()=>service.init({workspace}),aleph_propose_mission:()=>service.propose({projectId:args.project_id,branch:args.branch,agent:{id:'owner'}}),aleph_approve_mission:()=>service.approve({projectId:args.project_id,missionId:args.mission_id}),aleph_form_batch:()=>service.formBatch({projectId:args.project_id}),aleph_run_batch:()=>service.runBatch({projectId:args.project_id,batchId:args.batch_id})}[name])();
   let p=await invoke('aleph_init_project',{workspace});const repo=p.missionRoot,counter=join(root,'count.txt'),gate=join(root,'release');
   const createMission=async label=>{git(repo,'switch','-c','mission/'+label,'template');const dir=join(repo,'missions',label);mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'mission.json'),JSON.stringify({id:label,entrypoint:'run.sh'}));writeFileSync(join(dir,'run.sh'),`printf 'run\\n' >> '${counter}'\nprintf started > "$ALEPH_OUTPUT_DIR/started.txt"\nwhile [ ! -f '${gate}' ]; do sleep .02; done\nprintf completed > "$ALEPH_OUTPUT_DIR/completed.txt"\n`);git(repo,'add','-A');git(repo,'-c','user.name=Test','-c','user.email=test@localhost','commit','-m','bounded reconciliation task');git(repo,'switch','template');p=await invoke('aleph_propose_mission',{project_id:p.id,branch:'mission/'+label});const m=p.missions.at(-1);p=await invoke('aleph_approve_mission',{project_id:p.id,mission_id:m.id});return m;};
   const mission=await createMission('first');p=await invoke('aleph_form_batch',{project_id:p.id});const batch=p.batches[0],worktree=join(workspace,'.aleph/batches',batch.id),result=join(worktree,'results/first/result.json'),tip=git(repo,'rev-parse','mission/first');
   const scenario={mode,root,project:p.id,batch:batch.id,mission:mission.id,tip};records.scenarios.push(scenario);save();
   const read=async()=>actual?(await http('/api/aleph/projects')).projects.find(x=>x.project.id===p.id):new ProjectService({}, {table:()=>tableAt(root)},{}).get(p.id);
   const normalize=v=>actual?{...v.project,batches:v.batches,missions:v.missions.map(m=>({...m,resultCommit:m.result_commit,finishedAt:m.finished_at})),machines:v.machines}:v;
   let worker,pending;
   if(mode!=='forming'){
    if(mode==='already-delivered')writeFileSync(gate,'release');
    if(actual)pending=invoke('aleph_run_batch',{project_id:p.id,batch_id:batch.id}).catch(e=>{scenario.pendingError=String(e);});
    else{writeFileSync(join(root,'identity.json'),JSON.stringify({projectId:p.id,batchId:batch.id}));worker=spawn(process.execPath,['--experimental-loader',join(source,'dsh-plugin/test/loader.mjs'),process.argv[1],'worker',root],{env:process.env,stdio:'ignore'});}
    await until(()=>existsSync(join(worktree,'results/first/started.txt'))||mode==='already-delivered'&&existsSync(counter),'real runner starts');
    scenario.before=normalize(await read());scenario.beforeProcesses=procs(worktree);
    if(mode==='already-delivered'){
     if(actual)await pending;else await new Promise(r=>worker.once('exit',r));scenario.delivered=normalize(await read());
    }else{
     if(actual){try{process.kill(hostPid,'SIGKILL');}catch{}await until(()=>!alive(hostPid),'original actual Host killed');records.hosts.push({pid:hostPid,crash:true,alive:false,pid_exists:existsSync('/proc/'+hostPid)});hostPid=null;await pending;}
     else{worker.kill('SIGKILL');await new Promise(r=>worker.once('exit',r));}
     scenario.afterCrashProcesses=procs(worktree);
     if(mode==='completed-before-restart'){writeFileSync(gate,'release');await until(()=>existsSync(result),'actual runner completed');await until(()=>procs(worktree).length===0,'actual runner exited');}
    }
   }
   await restart(root,false);if(!actual)service=new ProjectService({}, {table:()=>tableAt(root)},{});
   const after=normalize(await read());scenario.after=after;
   await point(mode,'same project identity persists',()=>assert.equal(after.id,p.id));
   await point(mode,'same batch identity persists',()=>assert.equal(after.batches[0].id,batch.id));
   await point(mode,'same mission identity persists',()=>assert.equal(after.missions[0].id,mission.id));
   await point(mode,'pre-batch source commit remains reachable',()=>assert.equal(git(repo,'cat-file','-t',tip),'commit'));
   if(mode==='forming'){
    await point(mode,'unexecuted batch remains forming',()=>assert.equal(after.batches[0].status,'forming'));
    await point(mode,'unexecuted mission remains batched',()=>assert.equal(after.missions[0].status,'batched'));
    await point(mode,'startup launches no task',()=>assert.equal(existsSync(counter),false));
    await point(mode,'startup does not move mission source',()=>assert.equal(git(repo,'rev-parse','mission/first'),tip));
    await point(mode,'forming reservation remains busy',()=>assert.equal(after.machines[0].status,'busy'));
    await point(mode,'forming reservation retains exact batch owner',()=>assert.equal(after.machines[0].batchId,batch.id));
    await createMission('second');let admissionError;try{await invoke('aleph_form_batch',{project_id:p.id});}catch(e){admissionError=String(e);}const next=normalize(await read());scenario.second=next;scenario.admissionError=admissionError;
    await point(mode,'same reserved machine rejects another batch',()=>assert.match(admissionError,/busy/));
    await point(mode,'rejected formation adds no second batch',()=>assert.equal(next.batches.length,1));
    await point(mode,'original batch still remains runnable',()=>assert.equal(next.batches[0].status,'forming'));
    await point(mode,'original machine owner survives rejected formation',()=>assert.equal(next.machines[0].batchId,batch.id));
   }else if(mode==='active-at-restart'){
    await point(mode,'actual orphan process survives first Host crash',()=>assert.ok(scenario.afterCrashProcesses.length>0));
    await point(mode,'live restart preserves running batch',()=>assert.equal(after.batches[0].status,'running'));
    await point(mode,'live restart preserves machine occupancy',()=>assert.equal(after.machines[0].status,'busy'));
    await point(mode,'live restart preserves exact machine owner',()=>assert.equal(after.machines[0].batchId,batch.id));
    await point(mode,'live restart does not move source branch',()=>assert.equal(git(repo,'rev-parse','mission/first'),tip));
    await point(mode,'live restart does not execute twice',()=>assert.equal(readFileSync(counter,'utf8').trim().split('\n').length,1));
    await point(mode,'live restart preserves active worktree',()=>assert.ok(existsSync(worktree)));
    writeFileSync(gate,'release');await until(()=>existsSync(result),'orphan result');await until(()=>procs(worktree).length===0,'orphan process exits');scenario.confirmedExitAt=new Date().toISOString();scenario.postExitWindowStarted=Date.now();await sleep(6100);scenario.postExitObservedMs=Date.now()-scenario.postExitWindowStarted;
    const later=normalize(await read());scenario.afterExit=later;scenario.result=JSON.parse(readFileSync(result,'utf8'));
    await point(mode,'actual orphan runner produces done result',()=>assert.equal(scenario.result.status,'done'));
    await point(mode,'all actual workload processes have exited',()=>assert.deepEqual(procs(worktree),[]));
    await point(mode,'post-exit monitor marks orphan batch interrupted',()=>assert.equal(later.batches[0].status,'failed'));
    await point(mode,'post-exit monitor releases orphan machine',()=>assert.equal(later.machines[0].status,'idle'));
    await point(mode,'post-exit mission is explicitly interrupted',()=>assert.equal(later.missions[0].status,'failed'));
    await point(mode,'post-exit interruption has accurate reason',()=>assert.match(later.missions[0].error,/Host restart/));
    await point(mode,'post-exit exact machine owner is released',()=>assert.equal(later.machines[0].batchId,null));
    await point(mode,'actual post-exit observation covers monitor interval',()=>assert.ok(scenario.postExitObservedMs>=6100));
    await point(mode,'post-exit mission has no result commit',()=>assert.equal(later.missions[0].resultCommit??null,null));
    await point(mode,'post-exit branch remains input commit',()=>assert.equal(git(repo,'rev-parse','mission/first'),tip));
    await point(mode,'post-exit completed result is preserved',()=>assert.ok(existsSync(result)));
    await restart(root,false);const again=normalize(await read());scenario.secondRestart=again;
    await point(mode,'second restart keeps batch interruption stable',()=>assert.equal(again.batches[0].status,'failed'));
    await point(mode,'second restart keeps machine released',()=>assert.equal(again.machines[0].status,'idle'));
    await point(mode,'second restart does not repeat compute',()=>assert.equal(readFileSync(counter,'utf8').trim().split('\n').length,1));
   }else if(mode==='completed-before-restart'){
    scenario.result=JSON.parse(readFileSync(result,'utf8'));
    await point(mode,'runner finished successfully while Host was absent',()=>assert.equal(scenario.result.status,'done'));
    await point(mode,'startup explicitly marks batch interrupted',()=>assert.equal(after.batches[0].status,'failed'));
    await point(mode,'startup explicitly marks mission interrupted',()=>assert.equal(after.missions[0].status,'failed'));
    await point(mode,'startup records restart interruption reason',()=>assert.match(after.missions[0].error,/Host restart/));
    await point(mode,'startup releases stopped workload machine',()=>assert.equal(after.machines[0].status,'idle'));
    await point(mode,'startup releases exact reservation',()=>assert.equal(after.machines[0].batchId,null));
    await point(mode,'completed output remains preserved',()=>assert.ok(existsSync(result)));
    await point(mode,'restart does not repeat completed computation',()=>assert.equal(readFileSync(counter,'utf8').trim().split('\n').length,1));
    await point(mode,'restart does not forge successful delivery',()=>assert.equal(after.missions[0].resultCommit??null,null));
    await point(mode,'mission source branch remains intact',()=>assert.equal(git(repo,'rev-parse','mission/first'),tip));
    let error;try{await invoke('aleph_run_batch',{project_id:p.id,batch_id:batch.id});}catch(e){error=e;}
    await point(mode,'explicit retry refuses terminal interrupted batch',()=>assert.match(String(error),/not runnable/));
    await point(mode,'refused retry preserves completed output',()=>assert.ok(existsSync(result)));
   }else{
    await point(mode,'already delivered batch remains done',()=>assert.equal(after.batches[0].status,'done'));
    await point(mode,'already delivered mission remains done',()=>assert.equal(after.missions[0].status,'done'));
    await point(mode,'already delivered result commit is stable',()=>assert.equal(after.missions[0].resultCommit,scenario.delivered.missions[0].resultCommit));
    await point(mode,'delivered commit remains mission tip',()=>assert.equal(git(repo,'rev-parse','mission/first'),after.missions[0].resultCommit));
    await point(mode,'completed machine remains idle',()=>assert.equal(after.machines[0].status,'idle'));
    await point(mode,'restart repeats no normal computation',()=>assert.equal(readFileSync(counter,'utf8').trim().split('\n').length,1));
    await point(mode,'delivered result is readable from Git',()=>assert.equal(JSON.parse(git(repo,'show','mission/first:results/first/result.json')).status,'done'));
   }
   save();
  }
  records.complete=true;records.failed=records.checks.filter(x=>!x.passed).length;records.effective=records.checks.length;records.defect_reproduced=false;records.protection_validated=true;save();
 });
}
