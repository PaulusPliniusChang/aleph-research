import {randomUUID} from 'node:crypto';
import {LlmAdapter} from '@deepseek-ai/dsh-llm';
import {apply as diagnostic} from './diagnostic-bridge.mjs';
export const inject=['sessionController','tools','webServer','agents','sessions','llm','subagents','agentPresets'];
export async function apply(ctx){
 const states=new Map();
 const parse=messages=>{const last=[...messages].reverse().find(m=>m.role==='tool');if(!last)return null;const text=(last.content??[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');try{return JSON.parse(text);}catch{return {unparsed:text};}};
 class Adapter extends LlmAdapter{
  async listModels(provider){return[{provider,id:'deterministic',name:'Composer continuation behavior fixture'}];}
  async *stream(options){
   const sid=String(options.sessionId);let state=states.get(sid);
   if(!state){state={sid,preset:ctx.agentPresets.presetForSession(ctx.sessions.get(sid)),calls:0,commands:[],contexts:[],dispatches:0,last:null};states.set(sid,state);}
   state.calls++;state.contexts.push(options.messages);state.visibleTools=(Array.isArray(options.tools)?options.tools:Object.values(options.tools||{})).map(t=>t.name);let command;
   if(state.preset==='aleph-infra'){
    if(state.calls===1)command={name:'bash',args:{description:'Record an actual Infra handoff without changing execution logic',command:"printf 'Static inspection only; no safe optimization needed.\n' > ALEPH_HANDOFF.md"}};
   }else if(state.preset==='aleph-composer'){
    const all=JSON.stringify(options.messages),project=all.match(/Project: (p-[a-zA-Z0-9-]+)/)?.[1];
    if(!project)throw Error('actual Composer project absent');state.project=project;
    const value=parse(options.messages);state.lastValue=value;
    if(state.last==='aleph_status'){
     const snap=Array.isArray(value)?value[0]:value;
     if(!snap?.machines||!snap?.missions)throw Error('unexpected actual status tool result '+JSON.stringify(value));
     if(snap.machines[0].status==='idle'&&snap.missions.some(m=>m.status==='approved'))command={name:'aleph_form_batch',args:{project_id:project}};
    }else if(state.last==='aleph_form_batch'){
     const batch=value.batches.find(b=>b.status==='forming');if(!batch)throw Error('actual formed batch missing');
     state.dispatches++;let name=state.dispatches===2?'aleph_run_infra':'aleph_run_batch';if(name==='aleph_run_infra'&&!state.visibleTools.includes(name)){state.missingRequiredInfra=true;name='aleph_run_batch';}command={name,args:{project_id:project,batch_id:batch.id}};
    }else command={name:'aleph_status',args:{project_id:project}};
   }else throw Error('unexpected actual fixture preset '+state.preset);
   if(command){
    state.last=command.name;state.commands.push(command);const id=randomUUID(),block={type:'tool-call',id,name:command.name,arguments:JSON.stringify(command.args)};
    yield{type:'block-start',index:0,blockType:'tool-call'};yield{type:'tool-call-delta',index:0,id,name:command.name,argumentsDelta:JSON.stringify(command.args)};yield{type:'block-end',index:0,block};yield{type:'finish',reason:{kind:'tool-calls'}};return;
   }
   state.last=null;const text='Queue observed with no immediately dispatchable work.',block={type:'text',text};yield{type:'block-start',index:0,blockType:'text'};yield{type:'text-delta',index:0,text};yield{type:'block-end',index:0,block};yield{type:'finish',reason:{kind:'stop'}};
  }
 }
 const unregister=ctx.llm.registerAdapter(['aleph-test'],new Adapter());ctx.effect(()=>unregister);await diagnostic(ctx);
 ctx.webServer.register({kind:'exact',path:'/api/aleph-test/composer-observations',async handler(req,res){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({states:[...states.values()].map(s=>({...s,live:Boolean(ctx.agents.get(s.sid))}))}));}});
}
