import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ProjectService, apply } from '../index-v2.js';

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
const waitFor = async (fn, label, timeout = 5000) => {
  const end = Date.now() + timeout;
  while (!await fn()) {
    if (Date.now() > end) throw new Error(`timeout: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};
const agent = (childId, status = 'running') => ({ role: 'researcher', childId, status, summary: null, updatedAt: '2000-01-01' });

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'aleph-restart-followup-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const workspace = join(root, 'work space 中文');
  await mkdir(workspace);
  const records = new Map();
  let failWrites = false;
  const table = {
    get: key => records.get(key), entries: () => records.entries(),
    async put(key, value) { if (failWrites) throw new Error('durable write failed'); records.set(key, value); },
  };
  const domain = { table: () => table, close: async () => {} };
  const fresh = () => new ProjectService({}, domain, {});
  const service = fresh();
  const project = await service.init({ workspace });
  const counter = join(root, 'executions.txt');
  const gate = join(root, 'gate');
  const createMission = async label => {
    const branch = `mission/${label}`;
    git(project.missionRoot, 'switch', '-c', branch, 'template');
    const dir = join(project.missionRoot, 'missions', label);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'mission.json'), JSON.stringify({ id: label, entrypoint: 'run.sh' }));
    await writeFile(join(dir, 'run.sh'), `printf 'run\\n' >> '${counter}'\nprintf started > "$ALEPH_OUTPUT_DIR/started"\nwhile [ ! -f '${gate}' ]; do sleep .02; done\nprintf result > "$ALEPH_OUTPUT_DIR/artifact.txt"\n`);
    git(project.missionRoot, 'add', '-A');
    git(project.missionRoot, '-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-m', label);
    git(project.missionRoot, 'switch', 'template');
    let current = await service.propose({ projectId: project.id, branch, agent: { id: 'owner' } });
    const mission = current.missions.at(-1);
    // Avoid starting Composer; approval semantics are not part of this repair.
    await service.mutate(project.id, p => ({ ...p, missions: p.missions.map(m => m.id === mission.id ? { ...m, status: 'approved' } : m) }));
    return mission;
  };
  const mission = await createMission('first');
  const formed = await service.formBatch({ projectId: project.id });
  const batch = formed.batches[0];
  const worktree = join(workspace, '.aleph', 'batches', batch.id);
  const tip = git(project.missionRoot, 'rev-parse', mission.branch);
  const read = () => service.get(project.id);
  const runOrphan = async () => {
    await mkdir(join(workspace, '.aleph', 'batches'), { recursive: true });
    git(project.missionRoot, 'worktree', 'add', '--detach', worktree, batch.branch);
    await service.mutate(project.id, p => ({ ...p, batches: p.batches.map(b => ({ ...b, status: 'running', startedAt: '2026-01-01T00:00:00.000Z' })) }));
    const process = spawn('python3', ['batch_runner.py'], { cwd: worktree, stdio: 'ignore', env: { ...globalThis.process.env, ALEPH_WORKSPACE: workspace } });
    const done = new Promise((resolve, reject) => { process.once('error', reject); process.once('exit', code => resolve(code)); });
    t.after(async () => { process.kill('SIGKILL'); await done; });
    await waitFor(() => existsSync(join(worktree, 'results', 'first', 'started')), 'actual runner starts');
    return { process, done };
  };
  return { root, workspace, project, service, fresh, domain, table, records, counter, gate, mission, batch, worktree, tip, read, runOrphan, createMission, failWrites: value => { failWrites = value; } };
}

test('restart preserves a legitimate unexecuted forming reservation', async t => {
  const f = await fixture(t);
  const recovered = f.fresh();
  await recovered.recoverAfterRestart();
  await t.test('forming batch remains forming with the original identity', () => {
    assert.equal(f.read().batches[0].id, f.batch.id);
    assert.equal(f.read().batches[0].status, 'forming');
  });
  await t.test('batched mission keeps its batch ownership', () => {
    assert.equal(f.read().missions[0].status, 'batched');
    assert.equal(f.read().missions[0].batchId, f.batch.id);
  });
  await t.test('machine remains busy for the original forming batch', () => {
    assert.equal(f.read().machines[0].status, 'busy');
    assert.equal(f.read().machines[0].batchId, f.batch.id);
  });
  await t.test('startup neither executes compute nor moves the mission branch', () => {
    assert.equal(existsSync(f.counter), false);
    assert.equal(git(f.project.missionRoot, 'rev-parse', f.mission.branch), f.tip);
  });
  await f.createMission('second');
  await t.test('another batch cannot steal the reserved machine', async () => {
    await assert.rejects(recovered.formBatch({ projectId: f.project.id }), /machine local is busy/);
    assert.equal(f.read().batches.length, 1);
    assert.equal(f.read().machines[0].batchId, f.batch.id);
  });
  await t.test('periodic follow-up does not expire an unexecuted forming batch', async () => {
    await recovered.checkRecoveredBatches();
    await recovered.checkRecoveredBatches();
    assert.equal(f.read().batches[0].status, 'forming');
    assert.equal(recovered.controls.restartedBatches.size, 0);
  });
  await writeFile(f.gate, 'release');
  await recovered.runBatch({ projectId: f.project.id, batchId: f.batch.id });
  await t.test('the original forming batch can still run and deliver its own result', () => {
    assert.equal(f.read().batches[0].status, 'done');
    assert.equal(f.read().missions[0].status, 'done');
    assert.ok(f.read().missions[0].resultCommit);
    assert.equal(f.read().machines[0].status, 'idle');
    assert.equal(readFileSync(f.counter, 'utf8'), 'run\n');
  });
});

test('startup captures a real live runner and later reconciles its exit without another restart', async t => {
  const f = await fixture(t);
  const runner = await f.runOrphan();
  await f.service.mutate(f.project.id, p => ({ ...p, agents: [agent('stale')] }));
  const recovered = f.fresh();
  await recovered.recoverAfterRestart();
  await t.test('live runner is detected under its actual worktree', () => assert.equal(recovered.hasProcessUnder(f.worktree), true));
  await t.test('live startup preserves running batch and exact machine reservation', () => {
    assert.equal(f.read().batches[0].status, 'running');
    assert.deepEqual(f.read().machines[0], { id: 'local', kind: 'local', status: 'busy', batchId: f.batch.id });
  });
  await t.test('startup closes only its stale agent snapshot', () => {
    assert.equal(f.read().agents[0].status, 'failed');
    assert.match(f.read().agents[0].summary, /Host restart/);
  });
  await recovered.mutate(f.project.id, p => ({ ...p, agents: [...p.agents, agent('new-child')] }));
  await t.test('live follow-up preserves new agents and does not duplicate computation', async () => {
    await recovered.checkRecoveredBatches();
    assert.equal(f.read().agents[1].status, 'running');
    assert.equal(readFileSync(f.counter, 'utf8'), 'run\n');
  });
  await t.test('a repeated startup call is idempotent and does not recapture agents', async () => {
    await recovered.recoverAfterRestart();
    assert.equal(f.read().agents[1].status, 'running');
    assert.equal(recovered.controls.restartedBatches.size, 1);
  });
  await t.test('explicit live rerun is refused before altering the worktree', async () => {
    await assert.rejects(recovered.runBatch({ projectId: f.project.id, batchId: f.batch.id }), /active execution or status/);
    assert.equal(recovered.hasProcessUnder(f.worktree), true);
    assert.equal(readFileSync(f.counter, 'utf8'), 'run\n');
  });
  await writeFile(f.gate, 'release');
  assert.equal(await runner.done, 0);
  await waitFor(() => recovered.hasProcessUnder(f.worktree) === false, 'actual runner exits');
  await recovered.checkRecoveredBatches();
  await t.test('post-exit follow-up marks the captured batch interrupted with a completion time', () => {
    assert.equal(f.read().batches[0].status, 'failed');
    assert.ok(f.read().batches[0].finishedAt);
    assert.match(f.read().batches[0].summary.runnerError, /Host restart/);
  });
  await t.test('the blocked mission reaches explicit failed state without a forged result commit', () => {
    assert.equal(f.read().missions[0].status, 'failed');
    assert.match(f.read().missions[0].error, /Host restart/);
    assert.ok(f.read().missions[0].finishedAt);
    assert.equal(f.read().missions[0].resultCommit, null);
  });
  await t.test('only the exact completed reservation is released', () => {
    assert.equal(f.read().machines[0].status, 'idle');
    assert.equal(f.read().machines[0].batchId, null);
    assert.equal(recovered.controls.restartedBatches.size, 0);
  });
  await t.test('actual output and registered worktree remain available for inspection', async () => {
    assert.equal(JSON.parse(await readFile(join(f.worktree, 'results/first/result.json'), 'utf8')).status, 'done');
    assert.equal(await readFile(join(f.worktree, 'results/first/artifact.txt'), 'utf8'), 'result');
    assert.ok(git(f.project.missionRoot, 'worktree', 'list', '--porcelain').includes(f.worktree));
    assert.equal(git(f.project.missionRoot, 'rev-parse', f.mission.branch), f.tip);
  });
  await t.test('terminal rerun is rejected and completed output is not erased', async () => {
    await assert.rejects(recovered.runBatch({ projectId: f.project.id, batchId: f.batch.id }), /active execution or status/);
    assert.equal(readFileSync(f.counter, 'utf8'), 'run\n');
    assert.ok(existsSync(join(f.worktree, 'results/first/result.json')));
  });
  await t.test('subsequent follow-up and another Host recovery preserve the terminal record', async () => {
    const terminal = structuredClone(f.read().batches[0]);
    await recovered.checkRecoveredBatches();
    await f.fresh().recoverAfterRestart();
    assert.deepEqual(f.read().batches[0], terminal);
    assert.equal(readFileSync(f.counter, 'utf8'), 'run\n');
  });
});

test('recovery does not take ownership of new, replaced or already terminal work', async t => {
  for (const field of ['startedAt', 'branch', 'machineId']) {
    await t.test(`a changed ${field} prevents an old observation from settling a replacement`, async st => {
      const f = await fixture(st);
      await f.service.mutate(f.project.id, p => ({ ...p, batches: p.batches.map(b => ({ ...b, status: 'running' })) }));
      const recovered = f.fresh();
      recovered.hasProcessUnder = () => true;
      await recovered.recoverAfterRestart();
      await recovered.mutate(f.project.id, p => ({ ...p, batches: p.batches.map(b => ({ ...b, [field]: 'replacement' })) }));
      recovered.hasProcessUnder = () => false;
      await recovered.checkRecoveredBatches();
      assert.equal(f.read().batches[0].status, 'running');
      assert.equal(f.read().machines[0].status, 'busy');
      assert.equal(recovered.controls.restartedBatches.size, 0);
    });
  }
  await t.test('new running work after startup is never added to orphan tracking', async st => {
    const f = await fixture(st);
    const recovered = f.fresh();
    await recovered.recoverAfterRestart();
    await recovered.mutate(f.project.id, p => ({ ...p, batches: p.batches.map(b => ({ ...b, status: 'running' })) }));
    await recovered.checkRecoveredBatches();
    assert.equal(f.read().batches[0].status, 'running');
    assert.equal(f.read().machines[0].status, 'busy');
  });
  await t.test('a newer machine owner is not released by an old batch completion', async st => {
    const f = await fixture(st);
    await f.service.mutate(f.project.id, p => ({ ...p, batches: p.batches.map(b => ({ ...b, status: 'running' })) }));
    const recovered = f.fresh();
    recovered.hasProcessUnder = () => true;
    await recovered.recoverAfterRestart();
    await recovered.mutate(f.project.id, p => ({ ...p, machines: p.machines.map(m => ({ ...m, batchId: 'new-owner' })) }));
    recovered.hasProcessUnder = () => false;
    await recovered.checkRecoveredBatches();
    assert.equal(f.read().batches[0].status, 'failed');
    assert.equal(f.read().machines[0].batchId, 'new-owner');
    assert.equal(f.read().machines[0].status, 'busy');
  });
  await t.test('a normally settled record wins over a stale restart observation', async st => {
    const f = await fixture(st);
    await f.service.mutate(f.project.id, p => ({ ...p, batches: p.batches.map(b => ({ ...b, status: 'running' })) }));
    const recovered = f.fresh();
    recovered.hasProcessUnder = () => true;
    await recovered.recoverAfterRestart();
    await recovered.mutate(f.project.id, p => ({ ...p, batches: p.batches.map(b => ({ ...b, status: 'done', summary: { normal: true } })) }));
    recovered.hasProcessUnder = () => false;
    await recovered.checkRecoveredBatches();
    assert.equal(f.read().batches[0].status, 'done');
    assert.deepEqual(f.read().batches[0].summary, { normal: true });
  });
});

test('uncertainty, failed writes and overlapping ticks retain safe recovery ownership', async t => {
  const f = await fixture(t);
  await f.service.mutate(f.project.id, p => ({ ...p, batches: p.batches.map(b => ({ ...b, status: 'running', summary: { preserved: 1 } })) }));
  const recovered = f.fresh();
  recovered.hasProcessUnder = () => null;
  await recovered.recoverAfterRestart();
  await t.test('an unknown observation preserves busy running state for a future tick', () => {
    assert.equal(f.read().batches[0].status, 'running');
    assert.equal(f.read().machines[0].status, 'busy');
    assert.equal(recovered.controls.restartedBatches.size, 1);
  });
  f.failWrites(true);
  recovered.hasProcessUnder = () => false;
  await recovered.checkRecoveredBatches();
  await t.test('a failed durable write keeps the original reservation and tracked batch', () => {
    assert.equal(f.read().batches[0].status, 'running');
    assert.equal(f.read().machines[0].batchId, f.batch.id);
    assert.equal(recovered.controls.restartedBatches.size, 1);
  });
  f.failWrites(false);
  const first = recovered.checkRecoveredBatches();
  const second = recovered.checkRecoveredBatches();
  await t.test('overlapping ticks share one pending reconciliation', () => assert.equal(first, second));
  await first;
  await t.test('a later successful write closes the batch and preserves earlier summary fields', () => {
    assert.equal(f.read().batches[0].status, 'failed');
    assert.equal(f.read().batches[0].summary.preserved, 1);
    assert.equal(f.read().machines[0].status, 'idle');
    assert.equal(recovered.controls.restartedBatches.size, 0);
  });
  await t.test('retry and overlap produce only one interruption diagnostic', async () => {
    await recovered.checkRecoveredBatches();
    assert.equal(f.read().violations.filter(v => v.includes(`batch ${f.batch.id} interrupted`)).length, 1);
  });
});

test('already delivered results and invalid reservations remain stable across startup', async t => {
  const f = await fixture(t);
  await writeFile(f.gate, 'release');
  await f.service.runBatch({ projectId: f.project.id, batchId: f.batch.id });
  const before = structuredClone(f.read());
  const recovered = f.fresh();
  await recovered.recoverAfterRestart();
  await recovered.checkRecoveredBatches();
  await t.test('done batch and mission retain the delivered commit', () => {
    assert.deepEqual(f.read().batches, before.batches);
    assert.deepEqual(f.read().missions, before.missions);
    assert.equal(git(f.project.missionRoot, 'rev-parse', f.mission.branch), before.missions[0].resultCommit);
  });
  await t.test('done output stays readable from Git without another computation', () => {
    assert.equal(git(f.project.missionRoot, 'show', `${f.mission.branch}:results/first/artifact.txt`), 'result');
    assert.equal(readFileSync(f.counter, 'utf8'), 'run\n');
    assert.equal(f.read().machines[0].status, 'idle');
  });
  await t.test('a busy reservation pointing to a missing batch is released at startup', async () => {
    await f.service.mutate(f.project.id, p => ({ ...p, machines: [{ ...p.machines[0], status: 'busy', batchId: 'absent' }] }));
    await f.fresh().recoverAfterRestart();
    assert.equal(f.read().machines[0].status, 'idle');
    assert.equal(f.read().machines[0].batchId, null);
  });
  await t.test('a batch assigned to another machine cannot justify this machine reservation', async () => {
    await f.service.mutate(f.project.id, p => ({ ...p, batches: [...p.batches, { ...f.batch, id: 'wrong-owner', machineId: 'remote', status: 'forming' }], machines: [{ ...p.machines[0], status: 'busy', batchId: 'wrong-owner' }] }));
    await f.fresh().recoverAfterRestart();
    assert.equal(f.read().machines[0].status, 'idle');
  });
});

test('plugin startup waits for recovery before tool admission and disposes its follow-up timer', async t => {
  const f = await fixture(t);
  await f.service.mutate(f.project.id, p => ({ ...p, agents: [agent('stale')] }));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const originalPut = f.table.put;
  f.table.put = async (...args) => { await gate; return originalPut(...args); };
  const effects = [], registrations = [];
  const startup = apply({
    storageDomain: { open: async () => f.domain }, get: () => undefined,
    effect(fn) { const dispose = fn(); if (dispose) effects.push(dispose); },
    tools: { register: (...args) => { registrations.push(args); return () => {}; } },
    webServer: { register: () => {} },
  });
  t.after(() => { for (const dispose of effects.reverse()) dispose(); });
  await new Promise(resolve => setImmediate(resolve));
  await t.test('no product tool is registered while the startup durable write is pending', () => assert.equal(registrations.length, 0));
  release();
  await startup;
  await t.test('tool admission begins only after stale records settle with the forming reservation retained', () => {
    assert.ok(registrations.length > 0);
    assert.equal(f.read().agents[0].status, 'failed');
    assert.equal(f.read().machines[0].batchId, f.batch.id);
    assert.equal(f.read().machines[0].status, 'busy');
    assert.ok(effects.length >= 2);
  });
});

test('completed orphan output remains preserved when the first restart observes no live runner', async t => {
  const f = await fixture(t);
  const runner = await f.runOrphan();
  await writeFile(f.gate, 'release');
  assert.equal(await runner.done, 0);
  const recovered = f.fresh();
  await recovered.recoverAfterRestart();
  await t.test('the stopped batch and mission are explicitly interrupted on initial recovery', () => {
    assert.equal(f.read().batches[0].status, 'failed');
    assert.equal(f.read().missions[0].status, 'failed');
    assert.equal(f.read().machines[0].status, 'idle');
  });
  await t.test('successful compute output stays readable without claiming a delivered result', async () => {
    assert.equal(JSON.parse(await readFile(join(f.worktree, 'results/first/result.json'), 'utf8')).status, 'done');
    assert.equal(await readFile(join(f.worktree, 'results/first/artifact.txt'), 'utf8'), 'result');
    assert.equal(f.read().missions[0].resultCommit, null);
    assert.equal(git(f.project.missionRoot, 'rev-parse', f.mission.branch), f.tip);
  });
  await t.test('explicit rerun and repeated recovery cannot repeat the completed compute', async () => {
    await assert.rejects(recovered.runBatch({ projectId: f.project.id, batchId: f.batch.id }), /active execution or status/);
    await recovered.checkRecoveredBatches();
    await f.fresh().recoverAfterRestart();
    assert.equal(readFileSync(f.counter, 'utf8'), 'run\n');
    assert.ok(existsSync(join(f.worktree, 'results/first/result.json')));
  });
});

test('the actual plugin timer eventually closes only the startup runner after natural exit', async t => {
  const f = await fixture(t);
  const runner = await f.runOrphan();
  const effects = [];
  await apply({
    storageDomain: { open: async () => f.domain }, get: () => undefined,
    effect(fn) { const dispose = fn(); if (dispose) effects.push(dispose); },
    tools: { register: () => () => {} }, webServer: { register: () => {} },
  });
  t.after(() => { for (const dispose of effects.reverse()) dispose(); });
  await f.service.mutate(f.project.id, p => ({ ...p, agents: [agent('created-after-restart')] }));
  await writeFile(f.gate, 'release');
  assert.equal(await runner.done, 0);
  // This assertion does not manually call a recovery method: apply's real
  // five-second interval must perform the durable transition.
  await waitFor(() => f.read().batches[0].status === 'failed', 'actual plugin interval closes orphan', 10000);
  await t.test('the five-second interval reaches terminal state and releases the owned machine', () => {
    assert.equal(f.read().missions[0].status, 'failed');
    assert.equal(f.read().machines[0].status, 'idle');
    assert.equal(f.read().machines[0].batchId, null);
  });
  await t.test('the interval preserves new agents, compute output and one execution count', () => {
    assert.equal(f.read().agents[0].status, 'running');
    assert.equal(readFileSync(f.counter, 'utf8'), 'run\n');
    assert.ok(existsSync(join(f.worktree, 'results/first/artifact.txt')));
  });
});
