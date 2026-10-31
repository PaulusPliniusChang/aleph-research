import { randomUUID } from 'node:crypto';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { apply as registerDiagnosticBridge } from './diagnostic-bridge.mjs';

export const inject = ['sessionController', 'tools', 'webServer', 'agents', 'sessions', 'llm', 'subagents'];
export async function apply(ctx) {
  const runs = new Map();
  class ResearcherAdapter extends LlmAdapter {
    async listModels(provider) { return [{ provider, id: 'deterministic', name: 'Local researcher ownership fixture' }]; }
    async *stream(options) {
      const sessionId = String(options.sessionId);
      if (!/^[a-zA-Z0-9-]+$/.test(sessionId)) throw new Error('unexpected session identifier');
      let state = runs.get(sessionId);
      if (!state) { state = { sessionId, calls: 0, waiting: false, released: false, emittedSummary: null }; runs.set(sessionId, state); }
      state.calls++;
      if (state.calls === 1) {
        const definitions = Array.isArray(options.tools) ? options.tools : Object.values(options.tools || {});
        const bash = definitions.find(tool => tool.name === 'bash');
        if (!bash) throw new Error('researcher actual bash tool missing');
        const id = randomUUID();
        const args = { description: 'Record actual researcher session working directory', command: `pwd > researcher-${sessionId}.txt` };
        const block = { type: 'tool-call', id, name: bash.name, arguments: JSON.stringify(args) };
        state.toolCall = block;
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield { type: 'tool-call-delta', index: 0, id, name: bash.name, argumentsDelta: JSON.stringify(args) };
        yield { type: 'block-end', index: 0, block };
        yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
        yield { type: 'finish', reason: { kind: 'tool-calls' } };
        return;
      }
      state.waiting = true;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('bounded researcher fixture timed out')), 60000);
        state.release = () => { clearTimeout(timer); resolve(); };
        if (state.released) state.release();
        options.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('researcher fixture aborted')); }, { once: true });
      });
      state.waiting = false;
      const text = 'Distinct researcher result for ' + sessionId;
      state.emittedSummary = text;
      const block = { type: 'text', text };
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text };
      yield { type: 'block-end', index: 0, block };
      yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  const unregister = ctx.llm.registerAdapter(['aleph-test'], new ResearcherAdapter());
  ctx.effect(() => unregister);
  await registerDiagnosticBridge(ctx);
  ctx.webServer.register({ kind: 'exact', path: '/api/aleph-test/researcher-control', async handler(req, res) {
    let raw = ''; for await (const part of req) raw += part;
    const body = raw ? JSON.parse(raw) : {};
    if (body.action === 'release') {
      const state = runs.get(body.sessionId);
      if (state) { state.released = true; state.release?.(); }
    }
    const children = body.parentId ? await ctx.subagents.listChildren(body.parentId) : [];
    const states = [...runs.values()].map(({ release, ...state }) => ({ ...state,
      live: Boolean(ctx.agents.get(state.sessionId)), agentStatus: ctx.agents.get(state.sessionId)?.status ?? null,
      header: ctx.sessions.get(state.sessionId)?.header ?? null }));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ states, children }));
  } });
}
