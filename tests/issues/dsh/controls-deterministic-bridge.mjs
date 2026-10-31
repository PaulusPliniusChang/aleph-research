import {randomUUID} from 'node:crypto';
import {LlmAdapter} from '@deepseek-ai/dsh-llm';
import {apply as diagnostic} from './diagnostic-bridge.mjs';
export const inject=['sessionController','tools','webServer','agents','sessions','llm','subagents','agentPresets'];
export async function apply(ctx){
 const states=new Map();
 class Adapter extends LlmAdapter{
  async listModels(provider){return[{provider,id:'deterministic',name:'Controls actual execution fixture'}];}
  async *stream(options){
   const sid=String(options.sessionId);let s=states.get(sid);if(!s){s={sid,calls:0,preset:ctx.agentPresets.presetForSession(ctx.sessions.get(sid)),waiting:false,released:false};states.set(sid,s);}s.calls++;
   let tool;
   if(s.calls===1&&s.preset==='aleph-infra')tool={name:'bash',args:{description:'Preserve actual infra edit',command:'printf retained > infra-fixture-marker.txt'}};
   else{
    s.waiting=true;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('bounded controls fixture wait')),90000);s.release=()=>{clearTimeout(timer);resolve();};if(s.released)s.release();options.signal?.addEventListener('abort',()=>{s.aborted=true;s.waiting=false;clearTimeout(timer);reject(Error('controls fixture aborted'));},{once:true});});s.waiting=false;
    if(s.command&&!s.commandSent){s.commandSent=true;tool=s.command;}
   }
   if(tool){const id=randomUUID(),block={type:'tool-call',id,name:tool.name,arguments:JSON.stringify(tool.args)};s.lastTool=tool.name;yield{type:'block-start',index:0,blockType:'tool-call'};yield{type:'tool-call-delta',index:0,id,name:tool.name,argumentsDelta:JSON.stringify(tool.args)};yield{type:'block-end',index:0,block};yield{type:'usage',usage:{inputTokens:0,outputTokens:0,totalTokens:0}};yield{type:'finish',reason:{kind:'tool-calls'}};return;}
   const text='Controls fixture completed '+sid,block={type:'text',text};yield{type:'block-start',index:0,blockType:'text'};yield{type:'text-delta',index:0,text};yield{type:'block-end',index:0,block};yield{type:'finish',reason:{kind:'stop'}};
  }
 }
 const unregister=ctx.llm.registerAdapter(['aleph-test'],new Adapter());ctx.effect(()=>unregister);await diagnostic(ctx);
 ctx.webServer.register({kind:'exact',path:'/api/aleph-test/controls-model',async handler(req,res){let raw='';for await(const p of req)raw+=p;const b=raw?JSON.parse(raw):{};const s=states.get(b.sid);if(b.action==='release'&&s){s.released=true;s.command=b.command;s.release?.();}const all=[...states.values()].map(({release,...s})=>({...s,live:Boolean(ctx.agents.get(s.sid))}));res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({states:all}));}});
}
