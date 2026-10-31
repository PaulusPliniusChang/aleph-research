import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ProjectService, apply } from '../index-v2.js';

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await condition()) return;
    await delay(25);
  }
  throw new Error('timed out waiting for bounded batch fixture');
}

async function exists(file) {
  try { await readFile(file); return true; } catch { return false; }
}

async function fixture(t, script = 'printf done > "$ALEPH_OUTPUT_DIR/retained.txt"\n') {
  const root = await mkdtemp(join(tmpdir(), 'aleph-restart-test-'));
  const records = new Map();
  const table = { get: (id) => records.get(id), put: async (id, value) => records.set(id, value), entries: () => records.entries() };
  const domain = { table: () => table, close: async () => {} };
  const service = new ProjectService({}, domain, {});
  const workspace = join(root, 'workspace');
  await mkdir(workspace);
  const project = await service.init({ workspace, evalCommand: `printf '{"score":1}\\n'` });
  const repo = project.missionRoot;
  git(repo, 'switch', '-c', 'mission/restart', 'template');
  await mkdir(join(repo, 'missions/restart'), { recursive: true });
  await writeFile(join(repo, 'missions/restart/mission.json'), JSON.stringify({ id: 'restart', entrypoint: 'run.sh' }));
  await writeFile(join(repo, 'missions/restart/run.sh'), script);
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'restart fixture');
  git(repo, 'switch', 'template');
  let current = await service.propose({ projectId: project.id, branch: 'mission/restart', agent: { id: 'owner' } });
  const mission = current.missions[0];
  await service.approve({ projectId: project.id, missionId: mission.id });
  current = await service.formBatch({ projectId: project.id });
  const batch = current.batches[0];
  const worktree = join(workspace, '.aleph/batches', batch.id);
  t.after(async () => {
    service.stopped = true;
    // All test commands are bounded and are allowed to finish before fixture cleanup.
    await rm(root, { recursive: true, force: true });
  });
  return { service, domain, project, mission, batch, workspace, repo, worktree, read: () => table.get(project.id),
    reopen: () => new ProjectService({}, domain, {}),
    change: (update) => service.mutate(project.id, update),
    run: () => service.runBatch({ projectId: project.id, batchId: batch.id }),
  };
}

async function legacyResult(f, complete = true) {
  await mkdir(join(f.workspace, '.aleph/batches'), { recursive: true });
  git(f.repo, 'worktree', 'add', '--detach', f.worktree, f.batch.branch);
  if (complete) {
    await mkdir(join(f.worktree, 'results/restart'), { recursive: true });
    await writeFile(join(f.worktree, 'results/restart/result.json'), JSON.stringify({ mission_id: 'restart', status: 'done', exit_code: 0 }));
    await writeFile(join(f.worktree, 'results/restart/retained.txt'), 'preserve this output');
    await writeFile(join(f.worktree, 'results/batch.json'), JSON.stringify({ missions: [{ mission_id: 'restart', exit_code: 0 }] }));
  }
}

test('live execution survives loss of its Host observer and delivers once', async (t) => {
  const f = await fixture(t, 'printf start >> "$ALEPH_OUTPUT_DIR/executions.txt"\nsleep 1\nprintf finished > "$ALEPH_OUTPUT_DIR/retained.txt"\n');
  const original = f.run();
  await until(() => exists(join(f.worktree, 'results/restart/executions.txt')));
  const before = f.read();
  f.service.stopped = true;
  await original;
  const reopened = f.reopen();
  await reopened.recoverBatches();
  const live = f.read();
  const retry = await reopened.runBatch({ projectId: f.project.id, batchId: f.batch.id });
  await t.test('running batch is durable before mission starts', () => assert.equal(before.batches[0].status, 'running'));
  await t.test('execution has a durable start timestamp', () => assert.ok(before.batches[0].startedAt));
  await t.test('mission running state is durable', () => assert.equal(before.missions[0].status, 'running'));
  await t.test('running machine is reserved for the exact batch', () => assert.equal(before.machines[0].batchId, f.batch.id));
  await t.test('restart does not mark a live runner failed', () => assert.equal(live.batches[0].status, 'running'));
  await t.test('restart does not release a live runner machine', () => assert.equal(live.machines[0].status, 'busy'));
  await t.test('live retry observes existing execution', () => assert.equal(retry.batches[0].status, 'running'));
  await until(async () => {
    await reopened.recoverBatches();
    return f.read().batches[0].status !== 'running';
  });
  const done = f.read();
  const commit = done.missions[0].resultCommit;
  const envelope = JSON.parse(git(f.repo, 'show', `mission/restart:results/restart/result.json`));
  await t.test('orphan execution is not started a second time', async () => assert.equal(await readFile(join(f.worktree, 'results/restart/executions.txt'), 'utf8'), 'start'));
  await t.test('recovered batch reaches done', () => assert.equal(done.batches[0].status, 'done'));
  await t.test('recovered mission reaches done', () => assert.equal(done.missions[0].status, 'done'));
  await t.test('machine is released after actual execution finishes', () => assert.equal(done.machines[0].status, 'idle'));
  await t.test('recovered batch has completion timestamp', () => assert.ok(done.batches[0].finishedAt));
  await t.test('recovered mission has completion timestamp', () => assert.ok(done.missions[0].finishedAt));
  await t.test('resultCommit identifies a commit on the mission branch', () => assert.equal(commit, git(f.repo, 'rev-parse', 'mission/restart')));
  await t.test('delivered result retains the original batch identity', () => assert.equal(envelope.batch_id, f.batch.id));
  await t.test('execution output remains available for infra decisions', async () => assert.equal(await readFile(join(f.worktree, 'results/restart/retained.txt'), 'utf8'), 'finished'));
  const count = git(f.repo, 'rev-list', '--count', 'mission/restart');
  await reopened.recoverBatches();
  await t.test('repeated recovery creates no additional result commit', () => assert.equal(git(f.repo, 'rev-list', '--count', 'mission/restart'), count));
  await t.test('terminal batch retry is rejected without deleting outputs', async () => assert.rejects(reopened.runBatch({ projectId: f.project.id, batchId: f.batch.id }), /not runnable/));

  // Model a crash after branch update but before the mission state write.
  await f.change((current) => ({ ...current,
    batches: current.batches.map((batch) => ({ ...batch, status: 'running', finishedAt: null })),
    missions: current.missions.map((mission) => ({ ...mission, status: 'running', resultCommit: null, finishedAt: null })),
    machines: current.machines.map((machine) => ({ ...machine, status: 'busy', batchId: f.batch.id })),
  }));
  await reopened.recoverBatches();
  await t.test('recovery recognizes delivery committed before storage update', () => assert.equal(f.read().missions[0].resultCommit, commit));
  await t.test('delivery crash window does not duplicate Git history', () => assert.equal(git(f.repo, 'rev-list', '--count', 'mission/restart'), count));
  await t.test('delivery crash window releases the recovered reservation', () => assert.equal(f.read().machines[0].status, 'idle'));
});

test('startup recovers completed legacy batch without execution metadata', async (t) => {
  const f = await fixture(t);
  await legacyResult(f);
  const effects = [];
  const tools = new Map();
  await apply({ storageDomain: { open: async () => f.domain }, get: () => undefined,
    effect: (fn) => effects.push(fn()),
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => {}; } },
    webServer: { register: () => {} },
  });
  t.after(async () => { for (const dispose of effects.reverse()) await dispose?.(); });
  const current = f.read();
  await t.test('startup reconciles legacy forming batch', () => assert.equal(current.batches[0].status, 'done'));
  await t.test('startup delivers legacy mission output', () => assert.equal(current.missions[0].status, 'done'));
  await t.test('startup clears legacy busy reservation', () => assert.equal(current.machines[0].batchId, null));
  await t.test('startup records delivered commit', () => assert.ok(current.missions[0].resultCommit));
  await t.test('startup leaves raw legacy output intact', async () => assert.equal(await readFile(join(f.worktree, 'results/restart/retained.txt'), 'utf8'), 'preserve this output'));
  await t.test('startup exposes the recovered state through public status', async () => assert.equal((await tools.get('aleph_status').execute({ project_id: f.project.id }))[0].missions[0].status, 'done'));
  const evaluated = await f.reopen().evaluate({ projectId: f.project.id, agent: { id: 'owner' } });
  await t.test('owner can evaluate after legacy recovery', () => assert.equal(evaluated.status, 'done'));
});

test('interrupted legacy run has an explicit terminal outcome and retained files', async (t) => {
  const f = await fixture(t);
  await legacyResult(f, false);
  await writeFile(join(f.worktree, 'diagnostic.txt'), 'interrupted diagnostic');
  await f.reopen().recoverBatches();
  const current = f.read();
  await t.test('interruption is a failed batch instead of perpetual forming', () => assert.equal(current.batches[0].status, 'failed'));
  await t.test('interruption unblocks mission ownership wait', () => assert.equal(current.missions[0].status, 'failed'));
  await t.test('interruption includes an actionable explanation', () => assert.match(current.missions[0].error, /interrupted/));
  await t.test('interrupted execution releases only its stopped machine', () => assert.equal(current.machines[0].status, 'idle'));
  await t.test('interruption retains diagnostic worktree files', async () => assert.equal(await readFile(join(f.worktree, 'diagnostic.txt'), 'utf8'), 'interrupted diagnostic'));
  await t.test('interruption result is actually delivered before recording commit', () => assert.equal(current.missions[0].resultCommit, git(f.repo, 'rev-parse', 'mission/restart')));
});

test('delivery Git failure preserves results and releases an ended batch', async (t) => {
  const f = await fixture(t);
  await legacyResult(f);
  await writeFile(join(f.repo, '.git/refs/heads/mission/restart.lock'), 'operator lock');
  await f.reopen().recoverBatches();
  const current = f.read();
  await t.test('delivery failure is terminal for the batch', () => assert.equal(current.batches[0].status, 'failed'));
  await t.test('failed branch update records no false delivered commit', () => assert.equal(current.missions[0].resultCommit, null));
  await t.test('delivery failure contains the Git lock diagnosis', () => assert.match(current.missions[0].error, /lock/));
  await t.test('Git failure does not leave a stopped machine busy', () => assert.equal(current.machines[0].status, 'idle'));
  await t.test('Git failure preserves the original mission branch', () => assert.equal(git(f.repo, 'rev-parse', 'mission/restart'), current.missions[0].preBatchTip));
  await t.test('Git failure retains the only raw result', async () => assert.equal(JSON.parse(await readFile(join(f.worktree, 'results/restart/result.json'), 'utf8')).status, 'done'));
});

test('overlapping starts reserve one execution and setup failures terminate safely', async (t) => {
  const f = await fixture(t, 'printf once >> "$ALEPH_OUTPUT_DIR/executions.txt"\nsleep 0.2\n');
  const first = f.run();
  const duplicate = f.run().catch((error) => error);
  await first;
  const duplicateResult = await duplicate;
  await t.test('overlapping starts launch only one mission program', async () => assert.equal(await readFile(join(f.worktree, 'results/restart/executions.txt'), 'utf8'), 'once'));
  await t.test('competing start is rejected or observes the claimed batch', () => assert.ok(duplicateResult instanceof Error ? /not runnable/.test(duplicateResult.message) : duplicateResult.batches.length === 1));
  await t.test('competing start cannot clear the successful completion', () => assert.equal(f.read().batches[0].status, 'done'));
  const broken = await fixture(t);
  git(broken.repo, 'branch', '-D', broken.batch.branch);
  await broken.run();
  await t.test('worktree setup failure has a terminal batch state', () => assert.equal(broken.read().batches[0].status, 'failed'));
  await t.test('worktree setup failure releases machine reservation', () => assert.equal(broken.read().machines[0].status, 'idle'));
  await t.test('worktree setup failure preserves an explicit mission error', () => assert.match(broken.read().missions[0].error, /startup failed/));
});
