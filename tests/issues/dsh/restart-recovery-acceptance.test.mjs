import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const source = resolve(process.env.ALEPH_CURRENT_SOURCE || '/home/paulus-chang/项目/aleph');
const { ProjectService, apply } = await import(pathToFileURL(join(source, 'dsh-plugin/index-v2.js')));
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const activeApplications = new Map();
function actualWorktreeProcesses(worktree) {
  const active = [];
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const cwd = readlinkSync('/proc/' + entry + '/cwd');
      if (cwd === worktree || cwd.startsWith(worktree + '/')) active.push(Number(entry));
    } catch (error) {
      if (!['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(error.code)) throw error;
    }
  }
  return active;
}
async function waitForActualExit(worktree) {
  for (let attempt = 0; attempt < 250; attempt++) {
    if (!actualWorktreeProcesses(worktree).length) return;
    await pause(20);
  }
  assert.deepEqual(actualWorktreeProcesses(worktree), [], 'bounded actual runner and supervisor must exit before completed-recovery assertions');
}
async function closeApplication(root) {
  const disposers = activeApplications.get(root) || [];
  activeApplications.delete(root);
  for (const dispose of disposers.reverse()) await dispose();
}
function tableAt(root) {
  const file = join(root, 'table.json');
  if (!existsSync(file)) writeFileSync(file, '{}');
  const read = () => JSON.parse(readFileSync(file, 'utf8'));
  return { get: key => read()[key], entries: () => Object.entries(read()), put: async (key, value) => writeFileSync(file, JSON.stringify({ ...read(), [key]: value })) };
}
async function reopen(root) {
  await closeApplication(root);
  const table = tableAt(root);
  const domain = { table: () => table, close: async () => {} };
  const disposers = [];
  activeApplications.set(root, disposers);
  await apply({ storageDomain: { open: async () => domain }, get: () => undefined, effect: fn => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose); }, tools: { register: () => () => {} }, webServer: { register: () => {} } });
  return new ProjectService({}, domain, {});
}
async function prepare(root, seconds, count = 1) {
  const workspace = join(root, 'workspace');
  mkdirSync(workspace);
  const service = new ProjectService({}, { table: () => tableAt(root) }, {});
  let project = await service.init({ workspace });
  const repo = project.missionRoot;
  for (let n = 0; n < count; n++) {
    const name = n === 0 ? 'restart' : 'restart-' + n;
    git(repo, 'switch', '-c', 'mission/' + name, 'template');
    mkdirSync(join(repo, 'missions', name), { recursive: true });
    writeFileSync(join(repo, 'missions', name, 'mission.json'), JSON.stringify({ id: name, entrypoint: 'run.sh' }));
    writeFileSync(join(repo, 'missions', name, 'run.sh'), `printf 'run\\n' >> '${join(root, 'execution-count.txt')}'\nprintf started > "$ALEPH_OUTPUT_DIR/started.txt"\nsleep ${seconds}\nprintf completed > "$ALEPH_OUTPUT_DIR/completed.txt"\n`);
    git(repo, 'add', '-A');
    git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'restart acceptance fixture');
    git(repo, 'switch', 'template');
    project = await service.propose({ projectId: project.id, branch: 'mission/' + name, agent: { id: 'owner' } });
    await service.approve({ projectId: project.id, missionId: project.missions[n].id });
  }
  project = await service.formBatch({ projectId: project.id });
  const identity = { projectId: project.id, batchId: project.batches[0].id, repo, preBatchTip: project.missions[0].preBatchTip, root };
  writeFileSync(join(root, 'identity.json'), JSON.stringify(identity));
  return { service, identity };
}
async function crashed(name, stillRunning = false, legacy = false) {
  const root = mkdtempSync(join(tmpdir(), 'aleph-recovery-' + name + '-'));
  const worker = spawn(process.execPath, ['--experimental-loader', join(source, 'dsh-plugin/test/loader.mjs'), process.argv[1], 'worker', root], { stdio: ['ignore', 'ignore', 'ignore'], env: { ...process.env, ...(legacy ? { ALEPH_CURRENT_SOURCE: process.env.ALEPH_LEGACY_SOURCE || '/home/paulus-chang/项目/aleph' } : {}) } });
  let identity;
  for (let i = 0; i < 400; i++) {
    if (existsSync(join(root, 'identity.json'))) {
      identity = JSON.parse(readFileSync(join(root, 'identity.json')));
      if (existsSync(join(root, 'execution-count.txt'))) break;
    }
    if (worker.exitCode !== null) throw new Error('fixture process exited before mission started');
    await pause(20);
  }
  assert.ok(identity && existsSync(join(root, 'execution-count.txt')), 'actual mission must start');
  worker.kill('SIGKILL');
  await new Promise(resolve => worker.once('exit', resolve));
  const worktree = join(root, 'workspace/.aleph/batches', identity.batchId);
  const result = join(worktree, 'results/restart/result.json');
  if (!stillRunning) {
    for (let i = 0; i < 200 && !existsSync(result); i++) await pause(20);
    assert.ok(existsSync(result), 'bounded orphan runner must complete');
    await waitForActualExit(worktree);
  }
  return { ...identity, worktree, result };
}
const terminal = value => ['done', 'failed'].includes(value);
const executions = root => readFileSync(join(root, 'execution-count.txt'), 'utf8').trim().split('\n').filter(Boolean).length;
const preserved = (identity, project) => existsSync(identity.result) || Boolean(project.missions[0].resultCommit);

if (process.argv[2] === 'worker') {
  const { service, identity } = await prepare(process.argv[3], 2);
  await service.runBatch({ projectId: identity.projectId, batchId: identity.batchId });
} else {
  test('ALEPH-05 recovery acceptance has distinct execution, delivery, repetition and failure scenarios', async t => {
    t.after(async () => { for (const root of [...activeApplications.keys()]) await closeApplication(root); });
    const observations = [];
    async function points(label, checks) {
      for (const [name, check] of checks) await t.test(label + ': ' + name, check);
    }
    const normalRoot = mkdtempSync(join(tmpdir(), 'aleph-recovery-normal-'));
    const normal = await prepare(normalRoot, 0);
    const completed = await normal.service.runBatch({ projectId: normal.identity.projectId, batchId: normal.identity.batchId });
    const normalTip = git(normal.identity.repo, 'rev-parse', 'mission/restart');
    await points('normal completion', [
      ['batch reaches done', () => assert.equal(completed.batches[0].status, 'done')],
      ['mission reaches done', () => assert.equal(completed.missions[0].status, 'done')],
      ['machine is released', () => assert.equal(completed.machines[0].status, 'idle')],
      ['exactly one actual execution occurs', () => assert.equal(executions(normalRoot), 1)],
      ['result commit is mission branch tip', () => assert.equal(completed.missions[0].resultCommit, normalTip)],
      ['result commit descends from pre-batch branch', () => assert.equal(git(normal.identity.repo, 'merge-base', normalTip, normal.identity.preBatchTip), normal.identity.preBatchTip)],
    ]);
    const completedAgain = (await reopen(normalRoot)).get(normal.identity.projectId);
    await points('already delivered result after restart', [
      ['terminal batch remains terminal', () => assert.equal(completedAgain.batches[0].status, 'done')],
      ['terminal mission remains terminal', () => assert.equal(completedAgain.missions[0].status, 'done')],
      ['result commit is not duplicated', () => assert.equal(completedAgain.missions[0].resultCommit, completed.missions[0].resultCommit)],
      ['mission branch is not moved again', () => assert.equal(git(normal.identity.repo, 'rev-parse', 'mission/restart'), normalTip)],
      ['no execution occurs during restart', () => assert.equal(executions(normalRoot), 1)],
      ['machine stays idle', () => assert.equal(completedAgain.machines[0].status, 'idle')],
    ]);
    const lost = await crashed('completed');
    const reopened = await reopen(lost.root);
    const recovered = reopened.get(lost.projectId);
    await points('completed execution without host delivery', [
      ['batch is reconciled to a terminal state', () => assert.ok(terminal(recovered.batches[0].status))],
      ['mission is reconciled to a terminal state', () => assert.ok(terminal(recovered.missions[0].status))],
      ['machine becomes idle after process really exits', () => assert.equal(recovered.machines[0].status, 'idle')],
      ['finished result is delivered or preserved as evidence', () => assert.ok(preserved(lost, recovered))],
      ['recovery does not rerun finished compute', () => assert.equal(executions(lost.root), 1)],
      ['delivery or explicit interruption is recorded', () => assert.ok(recovered.missions[0].resultCommit || recovered.missions[0].error)],
    ]);
    const beforeRepeat = git(lost.repo, 'rev-parse', 'mission/restart');
    const repeated = (await reopen(lost.root)).get(lost.projectId);
    await points('repeated startup recovery', [
      ['no compute is repeated', () => assert.equal(executions(lost.root), 1)],
      ['mission tip remains stable', () => assert.equal(git(lost.repo, 'rev-parse', 'mission/restart'), beforeRepeat)],
      ['result commit remains stable', () => assert.equal(repeated.missions[0].resultCommit, recovered.missions[0].resultCommit)],
      ['terminal batch state remains stable', () => assert.ok(terminal(repeated.batches[0].status))],
      ['machine is not reserved again', () => assert.equal(repeated.machines[0].status, 'idle')],
      ['preserved result remains available', () => assert.ok(preserved(lost, repeated))],
    ]);
    let repeatError = null;
    const retryService = await reopen(lost.root);
    try { await retryService.runBatch({ projectId: lost.projectId, batchId: lost.batchId }); }
    catch (error) { repeatError = String(error); }
    const retried = retryService.get(lost.projectId);
    await points('explicit retry after interrupted result', [
      ['finished compute is not executed again', () => assert.equal(executions(lost.root), 1)],
      ['rejected retry preserves completed result evidence', () => assert.ok(preserved(lost, retried))],
      ['retry returns terminal state or explicit terminal refusal', () => assert.ok(terminal(retried.batches[0].status) && (!repeatError || /not runnable|already|terminal|completed|failed/.test(repeatError)))],
      ['retry does not strand an idle machine as busy', () => assert.equal(retried.machines[0].status, 'idle')],
    ]);
    const running = await crashed('running', true);
    const whileRunning = (await reopen(running.root)).get(running.projectId);
    await points('orphan subprocess still executing', [
      ['machine reservation is retained while actual compute runs', () => assert.equal(whileRunning.machines[0].status, 'busy')],
      ['compute is not started a second time', () => assert.equal(executions(running.root), 1)],
      ['mission branch is not advanced before completion', () => assert.equal(git(running.repo, 'rev-parse', 'mission/restart'), running.preBatchTip)],
      ['active execution worktree is not deleted', () => assert.ok(existsSync(running.worktree))],
    ]);
    for (let i = 0; i < 200 && !existsSync(running.result); i++) await pause(20);
    await waitForActualExit(running.worktree);
    const afterOrphan = (await reopen(running.root)).get(running.projectId);
    await points('orphan finishes after initial recovery', [
      ['completed work is eventually reconciled', () => assert.ok(terminal(afterOrphan.batches[0].status))],
      ['finished compute is not repeated', () => assert.equal(executions(running.root), 1)],
      ['machine is released after completion', () => assert.equal(afterOrphan.machines[0].status, 'idle')],
      ['finished output is delivered or retained', () => assert.ok(preserved(running, afterOrphan))],
    ]);
    const failed = await crashed('git-failure');
    const refLock = join(failed.repo, '.git/refs/heads/mission/restart.lock');
    writeFileSync(refLock, 'acceptance fixture owns the destination ref lock\n');
    const failedProject = (await reopen(failed.root)).get(failed.projectId);
    await points('Git destination cannot be advanced', [
      ['compute is not repeated on delivery error', () => assert.equal(executions(failed.root), 1)],
      ['completed output survives delivery failure', () => assert.ok(preserved(failed, failedProject))],
      ['batch stops waiting for dead host', () => assert.ok(terminal(failedProject.batches[0].status))],
      ['mission records actual Git lock failure', () => assert.match(failedProject.missions[0].error || '', /lock|exists/i)],
      ['machine is released after actual process exits', () => assert.equal(failedProject.machines[0].status, 'idle')],
    ]);
    rmSync(refLock);
    const concurrentRoot = mkdtempSync(join(tmpdir(), 'aleph-recovery-concurrent-'));
    const concurrent = await prepare(concurrentRoot, 1);
    // Both public calls enter in the same turn; do not serialize the trigger.
    // This is the test subject's concurrency, not independent B operations.
    const firstRun = concurrent.service.runBatch({ projectId: concurrent.identity.projectId, batchId: concurrent.identity.batchId });
    const secondRun = concurrent.service.runBatch({ projectId: concurrent.identity.projectId, batchId: concurrent.identity.batchId });
    const concurrentResults = await Promise.allSettled([firstRun, secondRun]);
    const concurrentProject = concurrent.service.get(concurrent.identity.projectId);
    await points('two calls race for the same batch', [
      ['at least one caller completes successfully', () => assert.ok(concurrentResults.some(item => item.status === 'fulfilled'))],
      ['exactly one actual task executes', () => assert.equal(executions(concurrentRoot), 1)],
      ['batch reaches a terminal outcome', () => assert.ok(terminal(concurrentProject.batches[0].status))],
      ['mission receives one branch result', () => assert.equal(concurrentProject.missions[0].resultCommit, git(concurrent.identity.repo, 'rev-parse', 'mission/restart'))],
      ['machine is released after the winning runner exits', () => assert.equal(concurrentProject.machines[0].status, 'idle')],
    ]);
    // Reproduce the exact public persistence boundary: completed Git delivery
    // exists, but the last durable project is still the pre-delivery snapshot.
    const deliveryRoot = mkdtempSync(join(tmpdir(), 'aleph-recovery-git-window-'));
    const delivery = await prepare(deliveryRoot, 0);
    const durableBeforeDelivery = readFileSync(join(deliveryRoot, 'table.json'), 'utf8');
    const delivered = await delivery.service.runBatch({ projectId: delivery.identity.projectId, batchId: delivery.identity.batchId });
    const deliveredTip = git(delivery.identity.repo, 'rev-parse', 'mission/restart');
    writeFileSync(join(deliveryRoot, 'table.json'), durableBeforeDelivery);
    const reconciledDelivery = (await reopen(deliveryRoot)).get(delivery.identity.projectId);
    await points('Git advanced before storage persistence', [
      ['restart does not rerun compute', () => assert.equal(executions(deliveryRoot), 1)],
      ['mission branch tip does not change', () => assert.equal(git(delivery.identity.repo, 'rev-parse', 'mission/restart'), deliveredTip)],
      ['stored result points to the existing delivery', () => assert.equal(reconciledDelivery.missions[0].resultCommit, delivered.missions[0].resultCommit)],
      ['mission reaches done', () => assert.equal(reconciledDelivery.missions[0].status, 'done')],
      ['batch reaches done', () => assert.equal(reconciledDelivery.batches[0].status, 'done')],
      ['machine is released', () => assert.equal(reconciledDelivery.machines[0].status, 'idle')],
    ]);
    const partialRoot = mkdtempSync(join(tmpdir(), 'aleph-recovery-partial-'));
    const partial = await prepare(partialRoot, 0, 2);
    const beforePartial = JSON.parse(readFileSync(join(partialRoot, 'table.json'), 'utf8'));
    const allDelivered = await partial.service.runBatch({ projectId: partial.identity.projectId, batchId: partial.identity.batchId });
    const partialTips = allDelivered.missions.map(mission => git(partial.identity.repo, 'rev-parse', mission.branch));
    beforePartial[partial.identity.projectId].missions[0] = allDelivered.missions[0];
    writeFileSync(join(partialRoot, 'table.json'), JSON.stringify(beforePartial));
    const recoveredPartial = (await reopen(partialRoot)).get(partial.identity.projectId);
    await points('partially persisted multi-mission delivery', [
      ['completed first mission stays completed', () => assert.equal(recoveredPartial.missions[0].status, 'done')],
      ['completed first mission commit is retained', () => assert.equal(recoveredPartial.missions[0].resultCommit, allDelivered.missions[0].resultCommit)],
      ['second result is recovered', () => assert.equal(recoveredPartial.missions[1].resultCommit, allDelivered.missions[1].resultCommit)],
      ['second mission reaches done', () => assert.equal(recoveredPartial.missions[1].status, 'done')],
      ['both real mission branches remain stable', () => assert.deepEqual(recoveredPartial.missions.map(mission => git(partial.identity.repo, 'rev-parse', mission.branch)), partialTips)],
      ['neither task executes again', () => assert.equal(executions(partialRoot), 2)],
      ['batch reaches done', () => assert.equal(recoveredPartial.batches[0].status, 'done')],
      ['machine becomes idle', () => assert.equal(recoveredPartial.machines[0].status, 'idle')],
    ]);
    const legacy = await crashed('legacy-forming', false, true);
    const legacyBefore = tableAt(legacy.root).get(legacy.projectId);
    const legacyRecovered = (await reopen(legacy.root)).get(legacy.projectId);
    await points('real legacy forming batch with existing execution worktree', [
      ['fixture genuinely lacks a persisted start time', () => assert.equal(legacyBefore.batches[0].startedAt ?? null, null)],
      ['fixture genuinely has legacy forming state', () => assert.equal(legacyBefore.batches[0].status, 'forming')],
      ['recovery ends the interrupted batch', () => assert.ok(terminal(legacyRecovered.batches[0].status))],
      ['recovery ends the interrupted mission', () => assert.ok(terminal(legacyRecovered.missions[0].status))],
      ['legacy compute is not executed again', () => assert.equal(executions(legacy.root), 1)],
      ['completed result remains available or delivered', () => assert.ok(preserved(legacy, legacyRecovered))],
      ['machine is released after legacy runner exits', () => assert.equal(legacyRecovered.machines[0].status, 'idle')],
    ]);
    observations.push({ concurrency: { root: concurrentRoot, concurrentProject, concurrentResults }, deliveryWindow: { root: deliveryRoot, reconciledDelivery, deliveredTip }, partialDelivery: { root: partialRoot, recoveredPartial, partialTips }, legacy: { identity: legacy, legacyBefore, legacyRecovered } });
    observations.push({ normal: { root: normalRoot, completed, completedAgain }, lost: { identity: lost, recovered, repeated, repeatError, retried }, running: { identity: running, whileRunning, afterOrphan }, deliveryFailure: { identity: failed, failedProject } });
    const out = process.env.ALEPH_RECOVERY_OBSERVATIONS;
    if (out) writeFileSync(out, JSON.stringify({ source, source_sha: git(source, 'rev-parse', 'HEAD'), source_tracked_dirty: git(source, 'status', '--porcelain', '--untracked-files=no'), command: [process.execPath, ...process.execArgv, '--test', 'tests/issues/dsh/restart-recovery-acceptance.test.mjs'], environment: { ALEPH_CURRENT_SOURCE: source, ALEPH_RECOVERY_OBSERVATIONS: out }, substitution: 'Real product service/Git/processes with a disk JSON storage adapter and stubbed tool/storage package definitions; actual DSH checked separately.', observations }, null, 2));
  });
}
