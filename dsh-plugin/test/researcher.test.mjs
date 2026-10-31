import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ProjectService } from '../index-v2.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('researcher callback fixture timed out');
    await pause(5);
  }
}
async function fixture(t, label) {
  const root = await mkdtemp(join(tmpdir(), `aleph-researcher-${label}-`));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, 'workspace'); await mkdir(workspace);
  const records = new Map();
  let writes = 0;
  const table = {
    get: id => records.has(id) ? structuredClone(records.get(id)) : undefined,
    entries: () => [...records].map(([id, value]) => [id, structuredClone(value)]),
    put: async (id, value) => { records.set(id, structuredClone(value)); writes++; },
  };
  const calls = [];
  let identity;
  let startupError;
  const subagents = {
    async startActivation(options) {
      if (startupError) { const error = startupError; startupError = undefined; throw error; }
      let resolve, reject;
      const result = new Promise((yes, no) => { resolve = yes; reject = no; });
      const childId = identity === undefined ? `${label}-child-${calls.length}` : identity;
      identity = undefined;
      calls.push({ childId, options, resolve, reject, result });
      return { childId, result };
    },
  };
  const service = new ProjectService({}, { table: () => table }, {
    subagents, sessions: { get: () => ({ header: { cwd: workspace } }) },
  });
  const project = await service.init({ workspace });
  const otherWorkspace = join(workspace, 'other'); await mkdir(otherWorkspace);
  const other = await service.init({ workspace: otherWorkspace });
  const legacy = { role: 'researcher', childId: null, status: 'running', summary: null, branch: null, updatedAt: '2000-01-01' };
  const history = { ...legacy, childId: 'historic-child', status: 'done', summary: 'historic result' };
  const composer = { ...legacy, role: 'composer', childId: `${label}-child-0`, summary: 'composer original' };
  const infra = { ...composer, role: 'infra', summary: 'infra original' };
  const get = () => table.get(project.id);
  await table.put(project.id, { ...get(), agents: [legacy, history, composer, infra] });
  const otherRecord = { ...legacy, childId: `${label}-child-0`, summary: 'other project original' };
  await table.put(other.id, { ...table.get(other.id), agents: [otherRecord] });
  const start = () => service.startResearcher({ projectId: project.id, agent: { id: `${label}-leader` } });
  const own = id => get().agents.find(item => item.role === 'researcher' && item.childId === id);
  async function settle(call, kind, payload) {
    const count = writes;
    if (kind === 'done') call.resolve({ output: payload ?? [{ type: 'text', text: 'own result' }] });
    else call.reject(new Error(payload ?? 'own failure'));
    await until(() => writes > count);
    return get();
  }
  return { workspace, project, other, service, table, calls, get, own, start, settle, legacy, history, composer, infra, otherRecord,
    nextIdentity: value => { identity = value; },
    failStartup: () => { startupError = new Error('startup rejected'); },
  };
}

test('researcher callbacks preserve each child identity and terminal result', async t => {
  const points = async (scope, checks) => { for (const [name, check] of checks) await t.test(`${scope}: ${name}`, check); };
  for (const firstKind of ['done', 'failed']) {
    const f = await fixture(t, firstKind);
    const first = await f.start(); const second = await f.start();
    const before = f.get();
    const secondOriginal = f.own(second.childId);
    await points(`${firstKind} overlap`, [
      ['calls expose distinct child identities', () => assert.notEqual(first.childId, second.childId)],
      ['first child is recorded running', () => assert.equal(f.own(first.childId).status, 'running')],
      ['second child is recorded running', () => assert.equal(f.own(second.childId).status, 'running')],
      ['activation retains caller identity', () => assert.equal(f.calls[0].options.request.parent.id, `${firstKind}-leader`)],
      ['activation selects researcher preset', () => assert.equal(f.calls[0].options.request.agentPreset, 'aleph-researcher')],
      ['activation uses project research directory', () => assert.equal(f.calls[0].options.request.cwd, f.project.researchRoot)],
    ]);
    const firstPayload = firstKind === 'done' ? [{ type: 'text', text: 'first unique summary' }] : 'first unique failure';
    await f.settle(f.calls[0], firstKind, firstPayload);
    const completed = f.own(first.childId);
    await points(`${firstKind} first result`, [
      ['only completed child reaches its terminal state', () => assert.equal(completed.status, firstKind)],
      ['completed child receives its own summary', () => assert.match(completed.summary, /first unique/)],
      ['pending sibling remains running', () => assert.equal(f.own(second.childId).status, 'running')],
      ['pending sibling retains its exact record', () => assert.deepEqual(f.own(second.childId), secondOriginal)],
      ['legacy child without identity remains unchanged', () => assert.deepEqual(f.own(null), f.legacy)],
      ['historical terminal record is preserved', () => assert.deepEqual(f.own('historic-child'), f.history)],
      ['composer with same child ID is preserved', () => assert.deepEqual(f.get().agents.find(a => a.role === 'composer'), f.composer)],
      ['infra with same child ID is preserved', () => assert.deepEqual(f.get().agents.find(a => a.role === 'infra'), f.infra)],
      ['same child ID in another project is preserved', () => assert.deepEqual(f.table.get(f.other.id).agents, [f.otherRecord])],
      ['callback does not add or remove records', () => assert.equal(f.get().agents.length, before.agents.length)],
    ]);
    const secondKind = firstKind === 'done' ? 'failed' : 'done';
    const secondPayload = secondKind === 'done' ? [{ type: 'text', text: 'second unique summary' }] : 'second unique failure';
    await f.settle(f.calls[1], secondKind, secondPayload);
    await points(`${firstKind} later result`, [
      ['later child records its actual outcome', () => assert.equal(f.own(second.childId).status, secondKind)],
      ['later child records its distinct summary', () => assert.match(f.own(second.childId).summary, /second unique/)],
      ['earlier child retains its exact terminal record', () => assert.deepEqual(f.own(first.childId), completed)],
    ]);
  }

  const reverse = await fixture(t, 'reverse-order');
  const earlier = await reverse.start(); const later = await reverse.start();
  const earlierOriginal = reverse.own(earlier.childId);
  await reverse.settle(reverse.calls[1], 'done', [{ type: 'text', text: 'later finishes first' }]);
  const laterCompleted = reverse.own(later.childId);
  await points('reverse completion order', [
    ['later started child can finish first', () => assert.equal(laterCompleted.status, 'done')],
    ['earlier pending child retains exact record', () => assert.deepEqual(reverse.own(earlier.childId), earlierOriginal)],
  ]);
  await reverse.settle(reverse.calls[0], 'done', [{ type: 'text', text: 'earlier finishes last' }]);
  await points('reverse completion preservation', [
    ['earlier child receives its final summary', () => assert.equal(reverse.own(earlier.childId).summary, 'earlier finishes last')],
    ['later completed child remains unchanged', () => assert.deepEqual(reverse.own(later.childId), laterCompleted)],
  ]);

  const startup = await fixture(t, 'startup');
  const pending = await startup.start(); const pendingRecord = startup.own(pending.childId);
  startup.failStartup();
  await points('startup failure', [
    ['caller receives original startup rejection', () => assert.rejects(startup.start(), /startup rejected/)],
    ['failure appends a failed record', () => assert.equal(startup.get().agents.at(-1).status, 'failed')],
    ['failure record has no invented child identity', () => assert.equal(startup.get().agents.at(-1).childId, null)],
    ['failure record preserves reason', () => assert.match(startup.get().agents.at(-1).summary, /startup rejected/)],
    ['unrelated running child is unchanged', () => assert.deepEqual(startup.own(pending.childId), pendingRecord)],
  ]);
  await startup.settle(startup.calls[0], 'done');

  for (const invalid of [null, '', '   ']) {
    const f = await fixture(t, `invalid-${String(invalid).length}`);
    const valid = await f.start(); const validOriginal = f.own(valid.childId);
    f.nextIdentity(invalid);
    await points(`invalid identity ${JSON.stringify(invalid)}`, [
      ['invalid activation rejects startup', () => assert.rejects(f.start(), /did not return a child ID/)],
      ['invalid activation receives abort signal', () => assert.equal(f.calls[1].options.signal.aborted, true)],
      ['invalid activation is recorded as failed', () => assert.equal(f.get().agents.at(-1).status, 'failed')],
      ['invalid identity is not recorded as a running child', () => assert.equal(f.get().agents.filter(a => a.role === 'researcher' && a.status === 'running').length, 2)],
      ['existing null identity record is preserved', () => assert.deepEqual(f.own(null), f.legacy)],
      ['existing valid child is preserved', () => assert.deepEqual(f.own(valid.childId), validOriginal)],
    ]);
    f.calls[1].reject(new Error('invalid activation aborted'));
    await pause(0);
    await f.settle(f.calls[0], 'done');
  }

  const summary = await fixture(t, 'summary');
  const combined = await summary.start();
  await summary.settle(summary.calls[0], 'done', [
    { type: 'text', text: '  alpha' }, { type: 'image', text: 'not text' }, { type: 'text', text: 'beta  ' },
  ]);
  const empty = await summary.start(); await summary.settle(summary.calls[1], 'done', []);
  const long = await summary.start(); await summary.settle(summary.calls[2], 'done', [{ type: 'text', text: 'x'.repeat(8500) }]);
  await points('summary compatibility', [
    ['text output is combined and trimmed', () => assert.equal(summary.own(combined.childId).summary, 'alpha\nbeta')],
    ['empty output retains no-summary fallback', () => assert.equal(summary.own(empty.childId).summary, '(no summary)')],
    ['large summary retains existing length limit', () => assert.equal(summary.own(long.childId).summary, 'x'.repeat(8000))],
  ]);
});
