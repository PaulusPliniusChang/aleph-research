import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ProjectService } from '../index-v2.js';

// The real service, storage write queue and Git worktrees are exercised here.
// Only the activation backend is controlled. Native DSH notification delivery,
// wake-up and parent availability require the separate real-runtime acceptance.
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
const record = (role, childId, status = 'running', summary = null) => ({
  role, childId, status, summary, updatedAt: '2000-01-01T00:00:00.000Z',
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'aleph-parent-delivery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, 'research space 中文');
  await mkdir(workspace);
  const records = new Map();
  const table = { get: key => records.get(key), put: async (key, value) => records.set(key, value), entries: () => records.entries() };
  const calls = [];
  const manualMessages = [];
  const subagents = {
    async startActivation(spec) {
      let resolve, reject;
      const result = new Promise((yes, no) => { resolve = yes; reject = no; });
      const childId = `child-${calls.length + 1}`;
      calls.push({ spec, childId, resolve, reject });
      return { childId, result };
    },
    async sendMessage(...args) { manualMessages.push(args); },
  };
  const service = new ProjectService({}, { table: () => table }, { subagents });
  const project = await service.init({ workspace, brief: 'Compare the candidate methods.' });
  const parent = { id: 'leader', inject() { throw new Error('Aleph must use native delivery'); } };
  const start = () => service.startResearcher({ projectId: project.id, agent: parent });
  const agents = () => service.get(project.id).agents ?? [];
  const drain = async () => {
    // Promise callbacks schedule a write behind the current write chain.
    await new Promise(resolve => setImmediate(resolve));
    await service.writeChain;
  };
  return { root, workspace, service, project, parent, calls, manualMessages, start, agents, drain };
}

test('researcher activation selects native parent delivery with its own research workspace', async t => {
  const f = await fixture(t);
  const started = await f.start();
  const { spec } = f.calls[0];
  const prompt = spec.request.prompt.map(block => block.text).join('\n');
  await t.test('the native completion destination is parent', () => assert.equal(spec.delivery, 'parent'));
  await t.test('the exact calling parent object is delegated', () => assert.equal(spec.request.parent, f.parent));
  await t.test('the researcher provider and preset are preserved', () => {
    assert.equal(spec.provider, 'spawn');
    assert.equal(spec.request.agentPreset, 'aleph-researcher');
  });
  await t.test('the activation cwd is the actual checked-out researcher branch', () => {
    assert.equal(spec.request.cwd, started.worktree);
    assert.equal(git(started.worktree, 'branch', '--show-current'), started.branch);
  });
  await t.test('the researcher worktree shares the project research history', () => {
    assert.equal(git(started.worktree, 'rev-parse', 'HEAD'), git(f.project.researchRoot, 'rev-parse', 'HEAD'));
    assert.match(started.worktree, /research space 中文/);
  });
  await t.test('the accepted receipt and running record have the exact child identity', () => {
    assert.equal(started.childId, f.calls[0].childId);
    assert.equal(started.projectId, f.project.id);
    assert.deepEqual(f.agents().map(({ childId, status, summary, branch, worktree }) => ({ childId, status, summary, branch, worktree })),
      [{ childId: started.childId, status: 'running', summary: null, branch: started.branch, worktree: started.worktree }]);
  });
  await t.test('the parent used by later child nudges is the original object', () => {
    assert.equal(f.service.parentAgents.get(started.childId), f.parent);
    assert.equal(spec.signal.aborted, false);
  });
  await t.test('the final message requests the real evaluation return fields without fabricating a result', () => {
    assert.match(prompt, /quote the actual final aleph_evaluate return fields: status, score, researchCommit, evaluatedCommit and evaluationRef/);
    assert.match(prompt, /If evaluation did not complete, report its actual status or error instead of inventing a score or report reference/);
  });
  await t.test('the new guidance preserves final evaluation and queue ownership instructions', () => {
    assert.match(prompt, /When all your missions are done, call aleph_evaluate once more/);
    assert.match(prompt, /Do not modify project queue, batch or machine state/);
    assert.ok(prompt.includes(started.worktree) && prompt.includes(started.branch) && prompt.includes(f.project.missionRoot));
  });
});

test('successful completion keeps summary and ownership while native notification remains external', async t => {
  const f = await fixture(t);
  const first = await f.start();
  const second = await f.start();
  const sameIdComposer = record('composer', first.childId);
  const historical = record('researcher', first.childId, 'failed', 'historical failure');
  await f.service.mutate(f.project.id, p => ({ ...p, agents: [...p.agents, sameIdComposer, historical] }));
  const originalMissions = structuredClone(f.service.get(f.project.id).missions);
  const originalBatches = structuredClone(f.service.get(f.project.id).batches);
  const originalMachines = structuredClone(f.service.get(f.project.id).machines);
  f.calls[0].resolve({ stopReason: 'completed', output: [
    { type: 'text', text: '  score=37' }, { type: 'image', data: 'not-summary' },
    { type: 'text', text: 'researchCommit=report-a evaluatedCommit=source-a evaluationRef=refs/aleph/evaluations/a  ' },
  ] });
  await f.drain();
  const completed = f.agents().find(a => a.childId === first.childId && a.role === 'researcher' && a.status === 'done');
  await t.test('the completed researcher stores the model text and report references', () => {
    assert.ok(completed);
    assert.equal(completed.summary, 'score=37\nresearchCommit=report-a evaluatedCommit=source-a evaluationRef=refs/aleph/evaluations/a');
  });
  await t.test('a sibling researcher remains running with no borrowed summary', () => {
    const sibling = f.agents().find(a => a.childId === second.childId);
    assert.equal(sibling.status, 'running');
    assert.equal(sibling.summary, null);
  });
  await t.test('the same child identifier in another role is not settled', () => {
    assert.deepEqual(f.agents().find(a => a.role === 'composer'), sameIdComposer);
  });
  await t.test('an already terminal researcher record is not rewritten', () => {
    assert.deepEqual(f.agents().find(a => a.status === 'failed'), historical);
  });
  await t.test('native delivery leaves separate research branches and worktrees intact', async () => {
    assert.notEqual(first.branch, second.branch);
    assert.notEqual(first.worktree, second.worktree);
    assert.equal(git(first.worktree, 'branch', '--show-current'), first.branch);
    assert.equal(git(second.worktree, 'branch', '--show-current'), second.branch);
    assert.ok((await readFile(join(first.worktree, '.git'), 'utf8')).startsWith('gitdir:'));
  });
  await t.test('completion does not alter missions, batches or machine reservations', () => {
    const current = f.service.get(f.project.id);
    assert.deepEqual(current.missions, originalMissions);
    assert.deepEqual(current.batches, originalBatches);
    assert.deepEqual(current.machines, originalMachines);
  });
  await t.test('Aleph does not add a manual completion notice alongside native delivery', () => {
    assert.deepEqual(f.manualMessages, []);
    assert.equal(f.calls.length, 2);
  });
  f.calls[1].resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'second result' }] });
  await f.drain();
  await t.test('later sibling completion stores its own result without replacing the first result', () => {
    assert.equal(f.agents().find(a => a.childId === second.childId).summary, 'second result');
    assert.equal(f.agents().find(a => a.childId === first.childId && a.status === 'done').summary, completed.summary);
  });
});

test('failed activation settles only its own running record', async t => {
  const f = await fixture(t);
  const first = await f.start();
  const second = await f.start();
  const extra = [record('infra', first.childId), record('researcher', first.childId, 'done', 'older result')];
  await f.service.mutate(f.project.id, p => ({ ...p, agents: [...p.agents, ...extra] }));
  f.calls[0].reject(new Error('backend execution failed'));
  await f.drain();
  await t.test('a rejected activation preserves its actual error in the failed record', () => {
    const failed = f.agents().find(a => a.role === 'researcher' && a.status === 'failed');
    assert.equal(failed.childId, first.childId);
    assert.equal(failed.summary, 'Error: backend execution failed');
  });
  await t.test('failure leaves other running researchers addressable', () => {
    assert.equal(f.agents().find(a => a.childId === second.childId).status, 'running');
    assert.equal(f.service.parentAgents.get(second.childId), f.parent);
  });
  await t.test('failure cannot rewrite other roles or prior terminal records', () => {
    for (const expected of extra) assert.deepEqual(f.agents().find(a => a.role === expected.role && a.status === expected.status), expected);
  });
  await t.test('failure uses the same parent delivery policy without a manual error notice', () => {
    assert.equal(f.calls[0].spec.delivery, 'parent');
    assert.deepEqual(f.manualMessages, []);
  });
});

test('closing text edge cases retain the existing stored-summary contract', async t => {
  const cases = [
    ['no output', {}, '(no summary)'],
    ['only nontext blocks', { output: [{ type: 'image', data: 'x' }] }, '(no summary)'],
    ['whitespace-only text', { output: [{ type: 'text', text: ' \n\t ' }] }, '(no summary)'],
    ['several text blocks', { output: [{ type: 'text', text: ' first ' }, null, { type: 'text', text: 'second ' }] }, 'first \nsecond'],
    ['long closing text', { output: [{ type: 'text', text: 'x'.repeat(8100) }] }, 'x'.repeat(8000)],
  ];
  for (const [label, result, expected] of cases) {
    await t.test(label, async st => {
      const f = await fixture(st);
      const started = await f.start();
      f.calls[0].resolve(result);
      await f.drain();
      const current = f.agents().find(a => a.childId === started.childId);
      assert.equal(current.status, 'done');
      assert.equal(current.summary, expected);
      assert.equal(f.calls[0].spec.delivery, 'parent');
    });
  }
});

test('admission errors and missing activation identities remain explicit', async t => {
  await t.test('a missing caller is rejected before any backend admission', async st => {
    const f = await fixture(st);
    await assert.rejects(f.service.startResearcher({ projectId: f.project.id }), /calling Agent/);
    assert.equal(f.calls.length, 0);
    assert.deepEqual(f.agents(), []);
  });
  await t.test('an unavailable subagent service fails without creating a running record', async st => {
    const f = await fixture(st);
    f.service.subagents = null;
    await assert.rejects(f.start(), /subagent service is unavailable/);
    assert.deepEqual(f.agents(), []);
  });
  await t.test('a missing project fails without backend admission', async st => {
    const f = await fixture(st);
    await assert.rejects(f.service.startResearcher({ projectId: 'missing', agent: f.parent }), /project not found/);
    assert.equal(f.calls.length, 0);
  });
  await t.test('a caller outside the project workspace cannot start a researcher', async st => {
    const f = await fixture(st);
    f.service.sessions = { get: () => ({ header: { cwd: join(f.root, 'other-workspace') } }) };
    await assert.rejects(f.start(), /outside the DSH session workspace/);
    assert.equal(f.calls.length, 0);
    assert.deepEqual(f.agents(), []);
  });
  await t.test('parent delivery admission rejection records the actual backend error', async st => {
    const f = await fixture(st);
    let delegated;
    f.service.subagents.startActivation = async spec => { delegated = spec; throw new Error('session persistence unavailable'); };
    await assert.rejects(f.start(), /session persistence unavailable/);
    assert.equal(delegated.delivery, 'parent');
    assert.deepEqual(f.agents().map(({ childId, status, summary }) => ({ childId, status, summary })),
      [{ childId: null, status: 'failed', summary: 'Error: session persistence unavailable' }]);
  });
  for (const childId of [null, '   ']) {
    await t.test(`invalid child identity ${JSON.stringify(childId)} aborts without an ambiguous record`, async st => {
      const f = await fixture(st);
      let signal;
      f.service.subagents.startActivation = async spec => { signal = spec.signal; return { childId, result: Promise.resolve({ output: [] }) }; };
      await assert.rejects(f.start(), /child ID/);
      assert.equal(signal.aborted, true);
      assert.deepEqual(f.agents(), []);
      assert.deepEqual(f.manualMessages, []);
    });
  }
});

test('multiple researchers and other roles retain their individual delivery policy', async t => {
  const f = await fixture(t);
  await f.service.scaffoldResearch({ projectId: f.project.id });
  const launched = await f.service.startResearchers({ projectId: f.project.id, count: 3, agent: f.parent });
  await t.test('every researcher in a group uses parent delivery with its exact receipt', () => {
    assert.equal(launched.started.length, 3);
    assert.ok(f.calls.every(call => call.spec.delivery === 'parent' && call.spec.request.parent === f.parent));
    assert.deepEqual(launched.started.map(a => a.childId), f.calls.map(a => a.childId));
  });
  await t.test('group researchers have independent actual Git branches and worktrees', () => {
    assert.equal(new Set(launched.started.map(a => a.branch)).size, 3);
    assert.equal(new Set(launched.started.map(a => a.worktree)).size, 3);
    for (const a of launched.started) assert.equal(git(a.worktree, 'branch', '--show-current'), a.branch);
  });
  await f.service.runComposer({ projectId: f.project.id, agent: f.parent });
  await t.test('Composer remains caller delivery with its existing preset', () => {
    const spec = f.calls.at(-1).spec;
    assert.equal(spec.delivery, 'caller');
    assert.equal(spec.request.agentPreset, 'aleph-composer');
  });
  const branch = 'batch/parent-policy';
  git(f.project.missionRoot, 'branch', branch, 'template');
  await f.service.mutate(f.project.id, p => ({ ...p, batches: [...p.batches, {
    id: 'b-parent-policy', machineId: 'local', status: 'forming', missionIds: [], branch, createdAt: new Date().toISOString(),
  }] }));
  const before = f.calls.length;
  const infraResult = f.service.runInfra({ projectId: f.project.id, batchId: 'b-parent-policy', agent: f.parent });
  // Attach the rejection handler before rejecting the controlled activation.
  const rejected = assert.rejects(infraResult, /stop controlled infra/);
  const deadline = Date.now() + 5000;
  while (f.calls.length === before && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(f.calls.length > before, 'InfraOptimizer must reach activation admission');
  const infra = f.calls.at(-1);
  infra.reject(new Error('stop controlled infra'));
  await rejected;
  await t.test('InfraOptimizer remains caller delivery with its existing preset', () => {
    assert.equal(infra.spec.delivery, 'caller');
    assert.equal(infra.spec.request.agentPreset, 'aleph-infra');
    assert.deepEqual(f.manualMessages, []);
  });
});
