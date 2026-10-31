import { randomUUID } from 'node:crypto';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { apply as registerDiagnosticBridge } from './diagnostic-bridge.mjs';

export const inject = ['sessionController', 'tools', 'webServer', 'agents', 'sessions', 'llm'];
export async function apply(ctx) {
  const state = { calls: [], waiting: false, released: false, error: null };
  let release;
  class DeterministicAdapter extends LlmAdapter {
    async listModels(provider) { return [{ provider, id: 'deterministic', name: 'Deterministic local test model' }]; }
    async *stream(options) {
      const definitions = Array.isArray(options.tools) ? options.tools : Object.values(options.tools || {});
      const call = { keys: Object.keys(options), tools: definitions.map(tool => ({ name: tool.name, parameters: tool.parameters })), model: options.model };
      state.calls.push(call);
      if (state.calls.length === 1) {
        const bash = definitions.find(tool => tool.name === 'bash');
        if (!bash) {
          state.error = 'Actual model tool definitions do not expose bash directly: ' + definitions.map(tool => tool.name).join(', ');
          throw new Error(state.error);
        }
        const id = randomUUID();
        const args = { description: 'Write deterministic optimizer handoff and pending markers', command: "printf 'real deterministic infra handoff\\n' > ALEPH_HANDOFF.md\nprintf '\\n# deterministic infra edit\\n' >> missions/infra/run.sh\nmkdir -p scratch/cache\nprintf 'real pending optimizer marker\\n' > scratch/cache/active.txt" };
        const block = { type: 'tool-call', id, name: bash.name, arguments: JSON.stringify(args) };
        call.toolCall = block;
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield { type: 'tool-call-delta', index: 0, id, name: bash.name, argumentsDelta: JSON.stringify(args) };
        yield { type: 'block-end', index: 0, block };
        yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
        yield { type: 'finish', reason: { kind: 'tool-calls' } };
        return;
      }
      state.waiting = true;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('bounded deterministic adapter release timed out')), 30000);
        release = () => { clearTimeout(timer); resolve(); };
        if (state.released) release();
        options.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('deterministic adapter aborted')); }, { once: true });
      });
      state.waiting = false;
      const block = { type: 'text', text: 'Deterministic optimization finished.' };
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: block.text };
      yield { type: 'block-end', index: 0, block };
      yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  const unregister = ctx.llm.registerAdapter(['aleph-test'], new DeterministicAdapter());
  ctx.effect(() => unregister);
  await registerDiagnosticBridge(ctx);
  ctx.webServer.register({
    kind: 'exact', path: '/api/aleph-test/infra-control',
    async handler(req, res) {
      let raw = ''; for await (const part of req) raw += part;
      const body = raw ? JSON.parse(raw) : {};
      if (body.action === 'release') { state.released = true; release?.(); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(state));
    },
  });
}
