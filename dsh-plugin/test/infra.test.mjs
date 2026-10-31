import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ProjectService, apply, snapshot as projectSnapshot } from '../index-v2.js';

const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const exists = (file) => access(file).then(() => true, () => false);
const settled = (promise) => promise.then((value) => ({ value }), (error) => ({ error }));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function until(check) {
  const end = Date.now() + 8000;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('fixture did not reach the expected execution stage');
    await pause(10);
  }
}
async function check(t, title, assertion) { await t.test(title, assertion); }

// Only the optimizer provider and persistence adapter are replaced. Worktrees,
// optimizer commits, mission processes and result delivery use actual Git/Python.
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'aleph-infra-test-'));
  const records = new Map();
  let beforePut = null;
  const store = { get: (id) => records.get(id), put: async (id, value) => {
    if (beforePut) await beforePut(id, value);
    records.set(id, value);
  }, entries: () => records.entries() };
  const calls = [];
  let failStart = false;
  let startGate = null;
  const subagents = { startActivation: async (request) => {
    const result = deferred();
    const call = { request, result, childId: `child-${calls.length}` };
    calls.push(call);
    if (failStart) { failStart = false; throw new Error('activation start rejected'); }
    const cwd = request.request.cwd;
    await writeFile(join(cwd, 'ALEPH_HANDOFF.md'), 'optimizer handoff\n');
    await writeFile(join(cwd, 'optimizer.txt'), 'uncommitted optimizer output\n');
    if (startGate) await startGate.promise;
    return { childId: call.childId, result: result.promise };
  } };
  const service = new ProjectService({}, { table: () => store }, { subagents });
  async function prepare(name) {
    const workspace = join(root, name);
    await mkdir(workspace);
    const project = await service.init({ workspace });
    return addBatch(project.id, name);
  }
  async function addBatch(projectId, name, machineId = 'local') {
    const project = service.get(projectId);
    const workspace = project.workspace;
    const repo = project.missionRoot;
    const start = join(root, `${name}.started`);
    const release = join(root, `${name}.release`);
    const counter = join(root, `${name}.count`);
    const branch = `mission/${name}`;
    git(repo, ['switch', '-c', branch, 'template']);
    const missionDir = join(repo, 'missions', name);
    await mkdir(missionDir, { recursive: true });
    await writeFile(join(missionDir, 'mission.json'), JSON.stringify({ id: name, entrypoint: 'run.sh' }));
    await writeFile(join(missionDir, 'run.sh'), `#!/usr/bin/env bash\nset -e\npython3 - <<'PY'\nimport pathlib,time\nwith pathlib.Path(${JSON.stringify(counter)}).open('a') as f: f.write('run\\n')\npathlib.Path(${JSON.stringify(start)}).write_text('started')\nend=time.monotonic()+10\nwhile not pathlib.Path(${JSON.stringify(release)}).exists():\n if time.monotonic()>end: raise RuntimeError('test gate expired')\n time.sleep(.01)\nPY\n`);
    git(repo, ['add', '-A']);
    git(repo, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-m', `mission ${name}`]);
    git(repo, ['switch', 'template']);
    let current = await service.propose({ projectId, branch, agent: { id: name } });
    const mission = current.missions.find((item) => item.branch === branch);
    await service.approve({ projectId, missionId: mission.id });
    if (machineId !== 'local') await service.mutate(projectId, (p) => ({ ...p, machines: [...p.machines, { id: machineId, kind: 'local', status: 'idle', batchId: null }] }));
    current = await service.formBatch({ projectId, machineId });
    const batch = current.batches.at(-1);
    return { projectId, batchId: batch.id, batch, mission, repo, workspace, start, release, counter,
      infra: join(workspace, '.aleph', 'infra', batch.id), batchWorktree: join(workspace, '.aleph', 'batches', batch.id), agent: { id: 'leader' } };
  }
  return { root, records, store, subagents, service, calls, prepare, addBatch,
    beforePut: (hook) => { beforePut = hook; },
    failNextStart: () => { failStart = true; }, gateStart: (gate) => { startGate = gate; },
    close: async () => rm(root, { recursive: true, force: true }) };
}

test('one owner protects activation, optimization, execution and result delivery', async (t) => {
  const f = await fixture();
  const b = await f.prepare('protected');
  const gate = deferred();
  f.gateStart(gate);
  const first = settled(f.service.runInfra(b));
  try {
    await until(async () => f.calls.length === 1 && await exists(join(b.infra, 'optimizer.txt')));
    await check(t, 'execution is reserved before activation start resolves', () => assert.equal(f.service.get(b.projectId).batches[0].status, 'running'));
    await check(t, 'persisted phase distinguishes active infrastructure', () => assert.equal(f.service.get(b.projectId).batches[0].phase, 'infra'));
    await check(t, 'snapshot exposes infrastructure phase', () => assert.equal(projectSnapshot(f.service.get(b.projectId)).batches[0].phase, 'infra'));
    await check(t, 'overlap is rejected while activation start is pending', () => assert.rejects(f.service.runInfra(b), /active execution/));
    await check(t, 'direct execution cannot bypass pending infrastructure', () => assert.rejects(f.service.runBatch(b), /active execution/));
    await check(t, 'rejected requests do not delete optimizer output', async () => assert.equal(await readFile(join(b.infra, 'optimizer.txt'), 'utf8'), 'uncommitted optimizer output\n'));
    gate.resolve();
    await until(() => (f.service.get(b.projectId).agents ?? []).length === 1);
    await check(t, 'duplicate does not start an extra optimizer', () => assert.equal(f.calls.length, 1));
    await check(t, 'overlap is rejected while activation result is pending', () => assert.rejects(f.service.runInfra(b), /active execution/));
    await check(t, 'losing requests do not release the original owner', () => assert.rejects(f.service.runBatch(b), /active execution/));
    const reopened = new ProjectService({}, { table: () => f.store }, { subagents: f.subagents });
    await check(t, 'recreated service rejects a persisted active optimizer', () => assert.rejects(reopened.runInfra(b), /not runnable/));
    await check(t, 'recreated service cannot run compute over active optimizer', () => assert.rejects(reopened.runBatch(b), /not runnable/));
    await check(t, 'rejected recreated service retains infrastructure phase', () => assert.equal(f.service.get(b.projectId).batches[0].phase, 'infra'));
    f.calls[0].result.resolve({ output: [] });
    await until(() => exists(b.start));
    await check(t, 'phase transitions to actual computation', () => assert.equal(f.service.get(b.projectId).batches[0].phase, 'batch'));
    await check(t, 'infrastructure worktree remains until computation ends', async () => assert.equal(await exists(join(b.infra, 'ALEPH_HANDOFF.md')), true));
    await check(t, 'optimizer changes are committed before computation', () => assert.equal(git(b.repo, ['show', `${b.batch.branch}:optimizer.txt`]), 'uncommitted optimizer output'));
    await check(t, 'duplicate infrastructure is rejected during computation', () => assert.rejects(f.service.runInfra(b), /active execution/));
    await check(t, 'duplicate direct execution is rejected during computation', () => assert.rejects(f.service.runBatch(b), /active execution/));
    await check(t, 'running batch worktree survives duplicate requests', async () => assert.equal(await exists(join(b.batchWorktree, 'batch_runner.py')), true));
    await check(t, 'compute is launched exactly once', async () => assert.equal(await readFile(b.counter, 'utf8'), 'run\n'));
    const delivery = deferred();
    const allowDelivery = deferred();
    f.beforePut(async (id, value) => {
      if (id === b.projectId && value.batches[0].status === 'done') {
        delivery.resolve();
        await allowDelivery.promise;
      }
    });
    await writeFile(b.release, 'release');
    await delivery.promise;
    try {
      await check(t, 'owner remains reserved while final delivery persistence waits', () => assert.rejects(f.service.runInfra(b), /active execution/));
      await check(t, 'direct runner cannot bypass pending delivery', () => assert.rejects(f.service.runBatch(b), /active execution/));
      await check(t, 'pending delivery preserves optimizer worktree', async () => assert.equal(await exists(join(b.infra, 'optimizer.txt')), true));
      await check(t, 'pending delivery has already written the mission result', () => assert.equal(JSON.parse(git(b.repo, ['show', `${b.mission.branch}:results/protected/result.json`])).status, 'done'));
    } finally { allowDelivery.resolve(); }
    const result = await first;
    await check(t, 'original flow completes without rejection', () => assert.equal(result.error, undefined));
    const final = f.service.get(b.projectId);
    await check(t, 'original batch completes', () => assert.equal(final.batches[0].status, 'done'));
    await check(t, 'original mission completes', () => assert.equal(final.missions[0].status, 'done'));
    await check(t, 'original optimizer retains success', () => assert.equal(final.agents[0].status, 'done'));
    await check(t, 'machine is released after computation', () => assert.equal(final.machines[0].status, 'idle'));
    await check(t, 'delivered commit is the actual mission branch tip', () => assert.equal(final.missions[0].resultCommit, git(b.repo, ['rev-parse', b.mission.branch])));
    await check(t, 'delivered result retains the batch identity', () => assert.equal(JSON.parse(git(b.repo, ['show', `${b.mission.branch}:results/protected/result.json`])).batch_id, b.batchId));
    await check(t, 'completed infrastructure rerun is explicitly rejected', () => assert.rejects(f.service.runInfra(b), /not runnable/));
    await check(t, 'completed direct rerun is explicitly rejected', () => assert.rejects(f.service.runBatch(b), /not runnable/));
    await check(t, 'completed requests cannot run compute twice', async () => assert.equal(await readFile(b.counter, 'utf8'), 'run\n'));
  } finally {
    gate.resolve();
    for (const call of f.calls) call.result.resolve({ output: [] });
    await writeFile(b.release, 'release');
    await first;
    await f.close();
  }
});

test('failed activation releases only its own reservation and permits retry', async (t) => {
  const f = await fixture();
  const b = await f.prepare('retry');
  try {
    f.failNextStart();
    await check(t, 'initial activation failure reaches caller', () => assert.rejects(f.service.runInfra(b), /activation start rejected/));
    await check(t, 'precompute failure restores runnable state', () => assert.equal(f.service.get(b.projectId).batches[0].status, 'forming'));
    await check(t, 'precompute failure clears its phase', () => assert.equal(f.service.get(b.projectId).batches[0].phase, null));
    await check(t, 'machine remains assigned to retryable batch', () => assert.equal(f.service.get(b.projectId).machines[0].batchId, b.batchId));
    await check(t, 'failed activation did not execute compute', async () => assert.equal(await exists(b.counter), false));
    await writeFile(b.release, 'release');
    const retry = settled(f.service.runInfra(b));
    await until(() => f.calls.length === 2 && (f.service.get(b.projectId).agents ?? []).length === 1);
    await check(t, 'retry starts exactly one fresh optimizer', () => assert.equal(f.calls.length, 2));
    await check(t, 'retry has a usable Git worktree', () => assert.equal(git(b.infra, ['rev-parse', '--is-inside-work-tree']), 'true'));
    f.calls[1].result.resolve({ output: [] });
    const final = await retry;
    await check(t, 'legitimate retry succeeds', () => assert.equal(final.error, undefined));
    await check(t, 'retry completes batch', () => assert.equal(f.service.get(b.projectId).batches[0].status, 'done'));
    await check(t, 'retry executes compute once', async () => assert.equal(await readFile(b.counter, 'utf8'), 'run\n'));
  } finally { await f.close(); }
});

test('independent batches preserve separate optimizer records and execution rights', async (t) => {
  const f = await fixture();
  const a = await f.prepare('first');
  const b = await f.addBatch(a.projectId, 'second', 'other-machine');
  const c = await f.prepare('other-project');
  // Use the same public batch id in another project to verify the full key.
  await f.service.mutate(c.projectId, (p) => ({ ...p,
    batches: p.batches.map((batch) => ({ ...batch, id: a.batchId })),
    missions: p.missions.map((mission) => ({ ...mission, batchId: a.batchId })),
    machines: p.machines.map((machine) => ({ ...machine, batchId: a.batchId })) }));
  c.batchId = a.batchId;
  const runs = [a, b, c].map((batch) => settled(f.service.runInfra(batch)));
  try {
    await until(() => f.calls.length === 3 && f.service.get(a.projectId).agents?.length === 2 && f.service.get(c.projectId).agents?.length === 1);
    await check(t, 'different batches may optimize concurrently', () => assert.equal(f.service.get(a.projectId).agents.filter((x) => x.status === 'running').length, 2));
    await check(t, 'same batch id in another project is independent', () => assert.equal(f.service.get(c.projectId).batches[0].status, 'running'));
    const firstCall = f.calls.find((call) => call.request.request.cwd === a.infra);
    firstCall.result.resolve({ output: [] });
    await until(() => exists(a.start));
    await check(t, 'completing one optimizer leaves the other active', () => assert.equal(f.service.get(a.projectId).agents.find((x) => x.branch === b.batch.branch).status, 'running'));
    await check(t, 'one batch cannot release another reservation', () => assert.equal(f.service.get(a.projectId).machines.find((x) => x.id === 'other-machine').status, 'busy'));
    await writeFile(a.release, 'release');
    await runs[0];
    await check(t, 'first completed batch does not change second batch state', () => assert.equal(f.service.get(a.projectId).batches.find((x) => x.id === b.batchId).phase, 'infra'));
    await check(t, 'first completion cannot release second owner', () => assert.rejects(f.service.runBatch(b), /active execution/));
    for (const batch of [b, c]) await writeFile(batch.release, 'release');
    for (const call of f.calls) call.result.resolve({ output: [] });
    const results = await Promise.all(runs);
    await check(t, 'all independent runs finish successfully', () => assert.ok(results.every((result) => !result.error)));
    await check(t, 'both batches in first project deliver results', () => assert.ok(f.service.get(a.projectId).missions.every((mission) => mission.status === 'done' && mission.resultCommit)));
    await check(t, 'same-id batch in other project delivers its result', () => assert.equal(f.service.get(c.projectId).missions[0].status, 'done'));
  } finally {
    for (const batch of [a, b, c]) await writeFile(batch.release, 'release');
    for (const call of f.calls) call.result.resolve({ output: [] });
    await Promise.all(runs);
    await f.close();
  }
});

test('direct execution and service recreation cannot bypass an active reservation', async (t) => {
  const f = await fixture();
  const b = await f.prepare('direct');
  const running = settled(f.service.runBatch(b));
  try {
    await until(() => exists(b.start));
    await check(t, 'direct execution records its running state', () => assert.equal(f.service.get(b.projectId).batches[0].status, 'running'));
    await check(t, 'infrastructure cannot bypass direct execution', () => assert.rejects(f.service.runInfra(b), /active execution/));
    await check(t, 'direct execution cannot duplicate itself', () => assert.rejects(f.service.runBatch(b), /active execution/));
    const reopened = new ProjectService({}, { table: () => f.store }, { subagents: f.subagents });
    await check(t, 'recreated service rejects retained running infrastructure', () => assert.rejects(reopened.runInfra(b), /not runnable/));
    await check(t, 'recreated service observes retained running computation', async () => assert.equal((await reopened.runBatch(b)).batches[0].status, 'running'));
    await check(t, 'rejected service recreation does not start optimizer', () => assert.equal(f.calls.length, 0));
    await check(t, 'rejected service recreation preserves live runner files', async () => assert.equal(await exists(join(b.batchWorktree, 'batch_runner.py')), true));
    await writeFile(b.release, 'release');
    const final = await running;
    await check(t, 'original direct execution still completes', () => assert.equal(final.error, undefined));
    await check(t, 'original direct execution delivers results once', async () => assert.equal(await readFile(b.counter, 'utf8'), 'run\n'));
  } finally {
    await writeFile(b.release, 'release');
    await running;
    await f.close();
  }
});

test('startup and periodic recovery preserve a pending optimizer and its reservation', async (t) => {
  const f = await fixture();
  const b = await f.prepare('recover-infra');
  const gate = deferred();
  f.gateStart(gate);
  const running = settled(f.service.runInfra(b));
  const effects = [];
  const tools = new Map();
  const reopened = new ProjectService({}, { table: () => f.store }, { subagents: f.subagents });
  try {
    await until(async () => f.calls.length === 1 && await exists(join(b.infra, 'optimizer.txt')));
    await f.service.recoverBatches();
    await check(t, 'original recovery during activation leaves batch running', () => assert.equal(f.service.get(b.projectId).batches[0].status, 'running'));
    await check(t, 'original recovery during activation retains infra phase', () => assert.equal(f.service.get(b.projectId).batches[0].phase, 'infra'));
    await check(t, 'original recovery during activation retains machine', () => assert.equal(f.service.get(b.projectId).machines[0].batchId, b.batchId));
    await reopened.recoverBatches();
    await check(t, 'cold recovery during activation does not fabricate failure', () => assert.equal(f.service.get(b.projectId).missions[0].error, null));
    await check(t, 'cold recovery during activation does not deliver result', () => assert.equal(f.service.get(b.projectId).missions[0].resultCommit, null));
    await check(t, 'cold recovery during activation retains uncommitted output', async () => assert.equal(await readFile(join(b.infra, 'optimizer.txt'), 'utf8'), 'uncommitted optimizer output\n'));
    const domain = { table: () => f.store, close: async () => {} };
    await apply({ storageDomain: { open: async () => domain }, get: () => undefined,
      effect: (effect) => effects.push(effect()), tools: { register: (tool) => { tools.set(tool.name, tool); return () => {}; } },
      webServer: { register: () => {} } });
    await check(t, 'plugin startup leaves optimizer batch running', () => assert.equal(f.service.get(b.projectId).batches[0].status, 'running'));
    await check(t, 'plugin public status retains infrastructure phase', async () => assert.equal((await tools.get('aleph_status').execute({ project_id: b.projectId }))[0].batches[0].phase, 'infra'));
    await pause(1150);
    await check(t, 'periodic recovery does not release optimizer machine', () => assert.equal(f.service.get(b.projectId).machines[0].status, 'busy'));
    await check(t, 'periodic recovery does not create runner worktree', async () => assert.equal(await exists(b.batchWorktree), false));
    await check(t, 'periodic recovery does not start computation', async () => assert.equal(await exists(b.counter), false));
    await check(t, 'periodic recovery preserves pending handoff', async () => assert.equal(await readFile(join(b.infra, 'ALEPH_HANDOFF.md'), 'utf8'), 'optimizer handoff\n'));
    gate.resolve();
    await until(() => f.service.get(b.projectId).agents?.length === 1);
    await reopened.recoverBatch(b.projectId, b.batchId);
    await check(t, 'explicit recovery leaves active optimizer record running', () => assert.equal(f.service.get(b.projectId).agents[0].status, 'running'));
    await check(t, 'explicit recovery leaves mission waiting for original optimizer', () => assert.equal(f.service.get(b.projectId).missions[0].status, 'batched'));
    await check(t, 'cold direct retry cannot consume optimizer reservation', () => assert.rejects(reopened.runBatch(b), /not runnable/));
    await check(t, 'cold optimizer retry cannot replace original session', () => assert.rejects(reopened.runInfra(b), /not runnable/));
    await check(t, 'recovery and retries keep exactly one optimizer', () => assert.equal(f.calls.length, 1));
    await writeFile(b.release, 'release');
    f.calls[0].result.resolve({ output: [] });
    const result = await running;
    await check(t, 'original optimizer completes after all recovery observers', () => assert.equal(result.error, undefined));
    await check(t, 'original optimizer produces delivered mission result', () => assert.equal(f.service.get(b.projectId).missions[0].status, 'done'));
    await check(t, 'original compute executes once after recovery observers', async () => assert.equal(await readFile(b.counter, 'utf8'), 'run\n'));
    await check(t, 'finished compute retains supervisor execution record', () => assert.ok(f.service.get(b.projectId).batches[0].execution?.id));
    await check(t, 'finished batch retains actual source output', async () => assert.equal(await exists(join(b.batchWorktree, 'results/recover-infra/result.json')), true));
  } finally {
    gate.resolve();
    for (const call of f.calls) call.result.resolve({ output: [] });
    await writeFile(b.release, 'release');
    await running;
    for (const dispose of effects.reverse()) await dispose?.();
    await f.close();
  }
});

test('optimizer handoff to supervised compute survives losing its Host observer', async (t) => {
  const f = await fixture();
  const b = await f.prepare('infra-orphan');
  const running = settled(f.service.runInfra(b));
  const reopened = new ProjectService({}, { table: () => f.store }, { subagents: f.subagents });
  try {
    await until(() => f.service.get(b.projectId).agents?.length === 1);
    f.calls[0].result.resolve({ output: [] });
    await until(() => exists(b.start));
    await check(t, 'handoff records batch phase before mission starts', () => assert.equal(f.service.get(b.projectId).batches[0].phase, 'batch'));
    await check(t, 'handoff records execution identity before mission starts', () => assert.ok(f.service.get(b.projectId).batches[0].execution?.id));
    f.service.stopped = true;
    const original = await running;
    await check(t, 'observer stops without aborting original flow', () => assert.equal(original.error, undefined));
    await check(t, 'stopped observer leaves computation running', () => assert.equal(f.service.get(b.projectId).batches[0].status, 'running'));
    await reopened.recoverBatches();
    await check(t, 'reopened recovery preserves live compute machine', () => assert.equal(f.service.get(b.projectId).machines[0].status, 'busy'));
    await check(t, 'reopened recovery preserves mission running state', () => assert.equal(f.service.get(b.projectId).missions[0].status, 'running'));
    await check(t, 'reopened direct retry observes existing supervised execution', async () => assert.equal((await reopened.runBatch(b)).batches[0].status, 'running'));
    await check(t, 'reopened optimizer cannot start over supervised execution', () => assert.rejects(reopened.runInfra(b), /not runnable/));
    await check(t, 'orphan supervisor is not run twice', async () => assert.equal(await readFile(b.counter, 'utf8'), 'run\n'));
    await writeFile(b.release, 'release');
    await until(async () => { await reopened.recoverBatches(); return f.service.get(b.projectId).batches[0].status === 'done'; });
    const final = f.service.get(b.projectId);
    await check(t, 'recovery completes batch after original observer exits', () => assert.equal(final.batches[0].status, 'done'));
    await check(t, 'recovery delivers mission after original observer exits', () => assert.equal(final.missions[0].status, 'done'));
    await check(t, 'recovery releases machine only after compute completion', () => assert.equal(final.machines[0].status, 'idle'));
    await check(t, 'recovery retains optimizer success record', () => assert.equal(final.agents[0].status, 'done'));
    await check(t, 'recovery delivers to actual mission branch', () => assert.equal(final.missions[0].resultCommit, git(b.repo, ['rev-parse', b.mission.branch])));
    await check(t, 'recovery retains optimizer edits on batch branch', () => assert.equal(git(b.repo, ['show', `${b.batch.branch}:optimizer.txt`]), 'uncommitted optimizer output'));
    await check(t, 'recovery retains raw compute output', async () => assert.equal(await exists(join(b.batchWorktree, 'results/infra-orphan/result.json')), true));
    const count = git(b.repo, ['rev-list', '--count', b.mission.branch]);
    await reopened.recoverBatches();
    await check(t, 'repeated recovery creates no duplicate delivery commit', () => assert.equal(git(b.repo, ['rev-list', '--count', b.mission.branch]), count));
    await check(t, 'repeated recovery creates no duplicate computation', async () => assert.equal(await readFile(b.counter, 'utf8'), 'run\n'));
  } finally {
    f.service.stopped = true;
    for (const call of f.calls) call.result.resolve({ output: [] });
    await writeFile(b.release, 'release');
    await running;
    await until(async () => { await reopened.recoverBatches(); return f.service.get(b.projectId).batches[0].status !== 'running'; });
    await f.close();
  }
});

test('optimizer rejection permits retry without reverting a terminal batch', async (t) => {
  const f = await fixture();
  const b = await f.prepare('rejected');
  let running = settled(f.service.runInfra(b));
  try {
    await until(() => f.service.get(b.projectId).agents?.length === 1);
    f.calls[0].result.reject(new Error('optimizer result rejected'));
    await check(t, 'optimizer failure reaches original caller', async () => assert.match((await running).error.message, /optimizer result rejected/));
    await check(t, 'optimizer failure is recorded on its own child', () => assert.equal(f.service.get(b.projectId).agents[0].status, 'failed'));
    await check(t, 'failure before runner restores forming', () => assert.equal(f.service.get(b.projectId).batches[0].status, 'forming'));
    await check(t, 'optimizer failure does not launch runner', async () => assert.equal(await exists(b.counter), false));
    running = settled(f.service.runInfra(b));
    await until(() => f.service.get(b.projectId).agents?.length === 2);
    // A terminal state written while this owner waits must not be undone by
    // its later rejection. This also exercises the catch ownership boundary.
    await f.service.mutate(b.projectId, (p) => ({ ...p, batches: p.batches.map((batch) => ({ ...batch, status: 'failed' })) }));
    f.calls[1].result.reject(new Error('second optimizer rejected'));
    await running;
    await check(t, 'owner failure cannot revert an already failed batch', () => assert.equal(f.service.get(b.projectId).batches[0].status, 'failed'));
    await check(t, 'failed terminal batch rejects infrastructure retry', () => assert.rejects(f.service.runInfra(b), /not runnable/));
    await check(t, 'failed terminal batch rejects direct retry', () => assert.rejects(f.service.runBatch(b), /not runnable/));
    await check(t, 'rejected retries preserve failed terminal state', () => assert.equal(f.service.get(b.projectId).batches[0].status, 'failed'));
  } finally {
    for (const call of f.calls) call.result.resolve({ output: [] });
    await running;
    await f.close();
  }
});
