import { randomUUID } from 'node:crypto';
export const inject = ['sessionController', 'tools', 'webServer', 'agents', 'sessions'];
export async function apply(ctx) {
  const parents = new Map();
  ctx.webServer.register({
    kind: 'exact', path: '/api/aleph-test/bridge',
    async handler(req, res) {
      try {
        if (req.method !== 'POST') throw new Error('POST required');
        let raw = ''; for await (const part of req) raw += part;
        const body = JSON.parse(raw);
        let result;
        if (body.action === 'parent') {
          const created = await ctx.sessionController.agents.createSession({cwd:body.cwd,agentPreset:'aleph'});
          const agent = created.agent;
          if (!agent) throw new Error(`agent missing: ${String(created.agentPreset)}`);
          parents.set(agent.id, agent);
          result = {sessionId:agent.id,agentPreset:created.agentPreset};
        } else if (body.action === 'tool') {
          const agent = parents.get(body.sessionId) ?? ctx.agents.get(body.sessionId);
          const definition = ctx.tools.get(body.name, agent);
          if (!definition) throw new Error(`missing tool ${body.name}`);
          result = await definition.execute(body.args ?? {}, {agent,signal:new AbortController().signal,callId:randomUUID()});
        } else if (body.action === 'inspect') {
          const session = ctx.sessions.get(body.sessionId);
          result = {header:session?.header,events:session ? [...session.events ?? []] : null};
        } else if (body.action === 'live-agents') {
          result = {live: ctx.agents.get(body.sessionId) !== undefined};
        } else if (body.action === 'tool-definitions') {
          result = [...ctx.tools.view(parents.get(body.sessionId) ?? ctx.agents.get(body.sessionId)).visible.values()].map(d => ({name:d.name,description:d.description,parameters:d.parameters}));
        } else if (body.action === 'tools') {
          result = [...ctx.tools.view(parents.get(body.sessionId) ?? ctx.agents.get(body.sessionId)).visible.keys()];
        } else throw new Error('unknown action');
        res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify({ok:true,result}));
      } catch (error) {
        res.writeHead(500, {'content-type':'application/json'}); res.end(JSON.stringify({ok:false,error:String(error),stack:error.stack}));
      }
    }
  });
}
