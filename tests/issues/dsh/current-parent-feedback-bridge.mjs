import {randomUUID} from 'node:crypto';
import {LlmAdapter} from '@deepseek-ai/dsh-llm';
import {apply as diagnostic} from './diagnostic-bridge.mjs';
export const inject=['sessionController','tools','webServer','agents','sessions','llm','subagents','agentPresets'];
export async function apply(ctx){
 const states=new Map();
 class Adapter extends LlmAdapter{
  async listModels(provider){return [{provider,id:'deterministic',name:'Actual researcher evaluate and parent feedback fixture'}];}
  async *stream(options){
   const sid=String(options.sessionId);let s=states.get(sid);
   if(!s){s={sid,calls:0,preset:ctx.agentPresets.presetForSession(ctx.sessions.get(sid)),waiting:false,commands:[],summaries:[],logs:[]};states.set(sid,s);}
   s.calls++;s.logs.push(structuredClone(ctx.agents.get(sid)?.session.log??[]));s.waiting=true;
   const action=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('bounded feedback fixture wait')),60000);s.resume=action=>{clearTimeout(timer);resolve(action);};if(s.pending){const action=s.pending;delete s.pending;s.resume(action);}options.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(Error('feedback fixture aborted'));},{once:true});});
   s.waiting=false;
   if(action.tool){
    s.commands.push(action.tool);const id=randomUUID(),block={type:'tool-call',id,name:action.tool.name,arguments:JSON.stringify(action.tool.args)};
    yield {type:'block-start',index:0,blockType:'tool-call'};
    yield {type:'tool-call-delta',index:0,id,name:block.name,argumentsDelta:block.arguments};
    yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:'tool-calls'}};return;
   }
   const text=action.summary,block={type:'text',text};s.summaries.push(text);
   yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text};yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:'stop'}};
  }
 }
 const unregister=ctx.llm.registerAdapter(['aleph-test'],new Adapter());ctx.effect(()=>unregister);await diagnostic(ctx);
 ctx.webServer.register({kind:'exact',path:'/api/aleph-test/feedback-model',async handler(req,res){
  let raw='';for await(const part of req)raw+=part;const body=raw?JSON.parse(raw):{};
  const state=states.get(body.sid);if(body.action==='release'&&state){if(state.waiting)state.resume(body.payload);else state.pending=body.payload;}
  const children=body.parentId?await ctx.subagents.listChildren(body.parentId):[];
  const all=[...states.values()].map(({resume,pending,...s})=>({...s,live:Boolean(ctx.agents.get(s.sid)),status:ctx.agents.get(s.sid)?.status??null}));
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({states:all,children}));
 }});
}
