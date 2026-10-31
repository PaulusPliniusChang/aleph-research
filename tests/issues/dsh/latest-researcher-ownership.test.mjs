import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const source = resolve(process.env.ALEPH_CURRENT_SOURCE || '/home/paulus-chang/项目/aleph');
const { apply } = await import(pathToFileURL(join(source, 'dsh-plugin/index-v2.js')));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('fixture callback flush timed out');
    await pause(5);
  }
}
async function fixture(label) {
  const root = mkdtempSync(join(tmpdir(), 'aleph-researcher-ownership-' + label + '-'));
  const workspace = join(root, 'workspace'); mkdirSync(workspace);
  const records = new Map(); let writes = 0; let startupFailure = false;
  const table = {
    get: id => records.has(id) ? structuredClone(records.get(id)) : undefined,
    entries: () => [...records].map(([id, value]) => [id, structuredClone(value)]),
    put: async (id, value) => { records.set(id, structuredClone(value)); writes++; },
  };
  const calls = [];
  const subagents = {
    async startActivation(options) {
      if (startupFailure) { startupFailure = false; throw new Error('distinct startup rejection'); }
      let succeed, fail;
      const result = new Promise((resolve, reject) => { succeed = resolve; fail = reject; });
      const call = { childId: label + '-child-' + calls.length, options,
        succeed: summary => succeed({ output: [{ type: 'text', text: summary }] }),
        fail: summary => fail(new Error(summary)) };
      calls.push(call);
      return { childId: call.childId, result };
    },
  };
  const tools = new Map();
  await apply({
    storageDomain: { open: async () => ({ table: () => table, close: async () => {} }) },
    get: name => ({ subagents,
      sessions: { get: () => ({ header: { cwd: workspace } }) },
      agentPresets: { presetForSession: () => 'aleph' },
    })[name],
    effect: () => {},
    tools: { register: definition => { tools.set(definition.name, definition); return () => {}; } },
    webServer: { register: () => {} },
  });
  const caller = { id: label + '-leader' };
  const invoke = (name, args) => tools.get(name).execute(args, { agent: caller });
  const project = await invoke('aleph_init_project', { workspace });
  const get = () => table.get(project.id);
  const otherRoot = join(workspace, 'other'); mkdirSync(otherRoot);
  const other = await invoke('aleph_init_project', { workspace: otherRoot });
  const historical = { role: 'researcher', childId: 'historic-done', status: 'done', summary: 'historic summary', branch: null, updatedAt: '2000-01-01' };
  const composer = { role: 'composer', childId: 'fixture-composer', status: 'running', summary: 'composer original', branch: null, updatedAt: '2000-01-01' };
  const infra = { role: 'infra', childId: 'fixture-infra', status: 'running', summary: 'infra original', branch: null, updatedAt: '2000-01-01' };
  await table.put(project.id, { ...get(), agents: [historical, composer, infra] });
  const otherAgent = { ...historical, childId: 'other-project-running', status: 'running', summary: 'other original' };
  await table.put(other.id, { ...table.get(other.id), agents: [otherAgent] });
  const start = () => invoke('aleph_run_researcher', { project_id: project.id });
  async function settle(call, kind, summary) {
    const previousWrites = writes;
    call[kind](summary);
    await until(() => writes > previousWrites);
    return get();
  }
  return { root, get, project, other, historical, composer, infra, otherAgent, table, calls, start, settle,
    status: () => invoke('aleph_status', { project_id: project.id }),
    failStartup: () => { startupFailure = true; } };
}

test('ALEPH-14 researcher callbacks preserve activation ownership through registered tools', async t => {
  const observations = [];
  const points = async (scope, checks) => { for (const [name, check] of checks) await t.test(scope + ': ' + name, check); };
  for (const firstKind of ['succeed', 'fail']) {
    const f = await fixture(firstKind);
    const one = await f.start(); const two = await f.start();
    const before = f.get();
    const own = id => f.get().agents.find(agent => agent.childId === id);
    await points(firstKind + '/overlap', [
      ['two registered calls receive distinct child identities', () => assert.notEqual(one.childId, two.childId)],
      ['first activation is recorded running', () => assert.equal(own(one.childId).status, 'running')],
      ['second activation is recorded running', () => assert.equal(own(two.childId).status, 'running')],
      ['first activation receives original caller identity', () => assert.equal(f.calls[0].options.request.parent.id, firstKind + '-leader')],
      ['second activation uses researcher preset', () => assert.equal(f.calls[1].options.request.agentPreset, 'aleph-researcher')],
      ['activation uses its recorded independent research worktree', () => assert.equal(f.calls[0].options.request.cwd, own(one.childId).worktree)],
    ]);
    const firstSummary = 'first distinct ' + firstKind;
    const afterFirst = await f.settle(f.calls[0], firstKind, firstSummary);
    const preservedSecond = before.agents.find(agent => agent.childId === two.childId);
    await points(firstKind + '/first-result', [
      ['completed activation receives its own terminal status', () => assert.equal(own(one.childId).status, firstKind === 'succeed' ? 'done' : 'failed')],
      ['completed activation receives its own summary or error', () => assert.ok(own(one.childId).summary.includes(firstSummary))],
      ['other pending activation remains running', () => assert.equal(own(two.childId).status, 'running')],
      ['other pending activation retains original empty summary', () => assert.equal(own(two.childId).summary, null)],
      ['other pending activation retains exact original record', () => assert.deepEqual(own(two.childId), preservedSecond)],
      ['historical completion remains byte-equivalent', () => assert.deepEqual(own('historic-done'), f.historical)],
      ['running composer retains exact record', () => assert.deepEqual(own('fixture-composer'), f.composer)],
      ['running infra retains exact record', () => assert.deepEqual(own('fixture-infra'), f.infra)],
      ['other project running activation remains independent', () => assert.deepEqual(f.table.get(f.other.id).agents, [f.otherAgent])],
    ]);
    const publicStatus = await f.status();
    await points(firstKind + '/public-query', [
      ['registered status exposes completed activation correctly', () => assert.equal(publicStatus[0].agents.find(a => a.childId === one.childId).status, firstKind === 'succeed' ? 'done' : 'failed')],
      ['registered status keeps other activation running', () => assert.equal(publicStatus[0].agents.find(a => a.childId === two.childId).status, 'running')],
    ]);
    const secondKind = firstKind === 'succeed' ? 'fail' : 'succeed';
    const secondSummary = 'second distinct ' + secondKind;
    const afterSecond = await f.settle(f.calls[1], secondKind, secondSummary);
    await points(firstKind + '/second-result', [
      ['later activation records actual terminal outcome', () => assert.equal(own(two.childId).status, secondKind === 'succeed' ? 'done' : 'failed')],
      ['later activation records its distinct result', () => assert.ok(own(two.childId).summary.includes(secondSummary))],
      ['earlier terminal result remains independent', () => assert.deepEqual(own(one.childId), afterFirst.agents.find(a => a.childId === one.childId))],
      ['no unrelated agent record is added or removed', () => assert.equal(f.get().agents.length, before.agents.length)],
    ]);
    observations.push({ scope: firstKind, root: f.root, before, afterFirst, publicStatus, afterSecond });
  }
  const f = await fixture('single-controls');
  const one = await f.start();
  const first = await f.settle(f.calls[0], 'succeed', 'single success');
  const two = await f.start();
  const second = await f.settle(f.calls[1], 'fail', 'single failure');
  f.failStartup();
  await points('single/startup-controls', [
    ['single successful activation completes normally', () => assert.equal(first.agents.find(a => a.childId === one.childId).status, 'done')],
    ['single success summary is preserved', () => assert.equal(first.agents.find(a => a.childId === one.childId).summary, 'single success')],
    ['single failing activation records failure', () => assert.equal(second.agents.find(a => a.childId === two.childId).status, 'failed')],
    ['single failure has its own reason', () => assert.match(second.agents.find(a => a.childId === two.childId).summary, /single failure/)],
    ['startup failure rejects registered call', () => assert.rejects(f.start(), /distinct startup rejection/)],
    ['startup failure creates a failed record without child identity', () => assert.equal(f.get().agents.at(-1).childId, null)],
    ['startup failure is recorded with own reason', () => assert.match(f.get().agents.at(-1).summary, /distinct startup rejection/)],
    ['startup failure does not rewrite completed success', () => assert.deepEqual(f.get().agents.find(a => a.childId === one.childId), first.agents.find(a => a.childId === one.childId))],
  ]);
  observations.push({ scope: 'single and startup controls', first, second, final: f.get() });
  if (process.env.ALEPH_RESEARCHER_OBSERVATIONS) {
    const sha = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    writeFileSync(process.env.ALEPH_RESEARCHER_OBSERVATIONS, JSON.stringify({ source, source_sha: sha,
      command: [process.execPath, ...process.execArgv, '--test', 'tests/issues/dsh/researcher-ownership-acceptance.test.mjs'],
      boundary: 'Actual plugin registered tool functions, ProjectService state callbacks and real project Git initialization. Memory storage, caller/session/preset services and controlled activation promises replace DSH services. Historical and unrelated agent records are explicit fixtures. Actual DSH activation behavior is verified separately.', observations }, null, 2));
  }
});
