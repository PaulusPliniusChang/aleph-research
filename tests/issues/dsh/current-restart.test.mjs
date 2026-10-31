import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const source = resolve(process.env.ALEPH_CURRENT_SOURCE || '/home/paulus-chang/项目/aleph');
const { ProjectService, apply } = await import(pathToFileURL(join(source, 'dsh-plugin/index-v2.js')));
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function durableTable(root) {
  const file = join(root, 'table.json');
  if (!existsSync(file)) writeFileSync(file, '{}');
  const load = () => JSON.parse(readFileSync(file, 'utf8'));
  return {
    get: key => load()[key],
    entries: () => Object.entries(load()),
    put: async (key, value) => writeFileSync(file, JSON.stringify({ ...load(), [key]: value })),
  };
}

if (process.argv[2] === 'worker') {
  const root = process.argv[3];
  const workspace = join(root, 'workspace');
  mkdirSync(workspace);
  const table = durableTable(root);
  const service = new ProjectService({}, { table: () => table }, {});
  const project = await service.init({ workspace });
  const repo = project.missionRoot;
  git(repo, 'switch', '-c', 'mission/restart', 'template');
  mkdirSync(join(repo, 'missions/restart'), { recursive: true });
  writeFileSync(join(repo, 'missions/restart/mission.json'), JSON.stringify({ id: 'restart', entrypoint: 'run.sh' }));
  writeFileSync(join(repo, 'missions/restart/run.sh'), 'printf started > "$ALEPH_OUTPUT_DIR/started.txt"\nsleep 2\nprintf completed > "$ALEPH_OUTPUT_DIR/completed.txt"\n');
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'restart mission');
  git(repo, 'switch', 'template');
  let current = await service.propose({ projectId: project.id, branch: 'mission/restart', agent: { id: 'owner' } });
  const mission = current.missions[0];
  await service.approve({ projectId: project.id, missionId: mission.id });
  current = await service.formBatch({ projectId: project.id });
  const batch = current.batches[0];
  writeFileSync(join(root, 'identity.json'), JSON.stringify({ projectId: project.id, missionId: mission.id, batchId: batch.id, workspace, repo, preBatchTip: current.missions[0].preBatchTip }));
  await service.runBatch({ projectId: project.id, batchId: batch.id });
} else {
  test('ALEPH-05 current project restart: actual process loss, durable state and safe retry', async t => {
    const root = mkdtempSync(join(tmpdir(), 'aleph-current-restart-auto-'));
    const loader = join(source, 'dsh-plugin/test/loader.mjs');
    const worker = spawn(process.execPath, ['--experimental-loader', loader, process.argv[1], 'worker', root], { stdio: ['ignore', 'ignore', 'pipe'] });
    let workerErrors = '';
    worker.stderr.on('data', value => { workerErrors += value; });
    let identity;
    for (let i = 0; i < 400; i++) {
      if (existsSync(join(root, 'identity.json'))) {
        identity = JSON.parse(readFileSync(join(root, 'identity.json'), 'utf8'));
        if (existsSync(join(identity.workspace, '.aleph/batches', identity.batchId, 'results/restart/started.txt'))) break;
      }
      if (worker.exitCode !== null) throw new Error('worker exited before marker: ' + workerErrors);
      await delay(25);
    }
    assert.ok(identity, 'fixture identity must exist');
    const worktree = join(identity.workspace, '.aleph/batches', identity.batchId);
    assert.ok(existsSync(join(worktree, 'results/restart/started.txt')), 'actual runner must have started');
    const table = durableTable(root);
    const before = table.get(identity.projectId);
    worker.kill('SIGKILL');
    await new Promise(resolve => worker.once('exit', resolve));
    for (let i = 0; i < 200 && !existsSync(join(worktree, 'results/restart/result.json')); i++) await delay(25);
    const storedBeforeReload = table.get(identity.projectId);
    const runnerResult = JSON.parse(readFileSync(join(worktree, 'results/restart/result.json'), 'utf8'));
    const startedMarker = readFileSync(join(worktree, 'results/restart/started.txt'), 'utf8');
    const completedMarker = readFileSync(join(worktree, 'results/restart/completed.txt'), 'utf8');
    const domain = { table: () => table, close: async () => {} };
    const routes = new Map();
    const tools = new Map();
    const effects = [];
    await apply({
      storageDomain: { open: async () => domain },
      get: () => undefined,
      effect: fn => effects.push(fn()),
      tools: { register: definition => { tools.set(definition.name, definition); return () => tools.delete(definition.name); } },
      webServer: { register: route => routes.set(route.path, route) },
    });
    const reopened = new ProjectService({}, domain, {});
    const after = reopened.get(identity.projectId);
    const wait = await reopened.evaluate({ projectId: identity.projectId, agent: { id: 'owner' } });
    const beforeRetryBranch = git(identity.repo, 'rev-parse', 'mission/restart');
    let retryError = null;
    try { await reopened.runBatch({ projectId: identity.projectId, batchId: identity.batchId }); }
    catch (error) { retryError = String(error); }
    const afterRetry = reopened.get(identity.projectId);
    const points = [
      ['project survives host process death', () => assert.equal(after.id, identity.projectId)],
      ['workspace identity survives process death', () => assert.equal(after.workspace, identity.workspace)],
      ['machine reservation existed before crash', () => assert.equal(before.machines[0].status, 'busy')],
      ['machine reservation identifies interrupted batch', () => assert.equal(before.machines[0].batchId, identity.batchId)],
      ['batch record survives crash', () => assert.equal(after.batches[0].id, identity.batchId)],
      ['mission identity survives crash', () => assert.equal(after.missions[0].id, identity.missionId)],
      ['mission owner survives crash', () => assert.equal(after.missions[0].ownerSession, 'owner')],
      ['pre-batch commit survives crash', () => assert.equal(after.missions[0].preBatchTip, identity.preBatchTip)],
      ['mission branch remains valid', () => assert.equal(git(identity.repo, 'rev-parse', 'mission/restart'), identity.preBatchTip)],
      ['actual runner reached start marker', () => assert.equal(startedMarker, 'started')],
      ['bounded runner completed after host death', () => assert.equal(runnerResult.status, 'done')],
      ['actual mission script exited successfully', () => assert.equal(runnerResult.exit_code, 0)],
      ['actual result identifies expected mission', () => assert.equal(runnerResult.mission_id, 'restart')],
      ['mission completion marker was written', () => assert.equal(completedMarker, 'completed')],
      ['runtime package exposes status tool after reload', () => assert.ok(tools.has('aleph_status'))],
      ['runtime package exposes batch tool after reload', () => assert.ok(tools.has('aleph_run_batch'))],
      ['runtime package exposes project snapshot route', () => assert.ok(routes.has('/api/aleph/snapshot'))],
      ['reloaded status includes persisted project', async () => assert.equal((await tools.get('aleph_status').execute({ project_id: identity.projectId }))[0].project.id, identity.projectId)],
      ['result runner cannot mutate durable host state after crash', () => assert.equal(storedBeforeReload.batches[0].status, before.batches[0].status)],
      ['startup reconciles interrupted batch to terminal state', () => assert.ok(['done', 'failed'].includes(after.batches[0].status))],
      ['startup releases or reattaches machine reservation', () => assert.ok(after.machines[0].status === 'idle' || after.batches[0].status === 'running')],
      ['startup reconciles mission blocked by dead host', () => assert.ok(['done', 'failed'].includes(after.missions[0].status))],
      ['reconciled batch has completion timestamp', () => assert.ok(after.batches[0].finishedAt)],
      ['reconciled mission has completion timestamp', () => assert.ok(after.missions[0].finishedAt)],
      ['owner evaluation no longer waits forever for interrupted mission', () => assert.notEqual(wait.status, 'waiting')],
      ['startup recovery preserves completed result or reports interruption', () => assert.ok(after.missions[0].resultCommit || after.missions[0].error)],
      ['retry is safe without stale worktree registration errors', () => assert.ok(retryError === null || (/not runnable/.test(retryError) && ['done', 'failed'].includes(afterRetry.batches[0].status)), retryError)],
      ['safe retry reaches terminal batch state', () => assert.ok(['done', 'failed'].includes(afterRetry.batches[0].status))],
      ['safe retry releases machine reservation', () => assert.equal(afterRetry.machines[0].status, 'idle')],
      ['safe retry reaches terminal mission state', () => assert.ok(['done', 'failed'].includes(afterRetry.missions[0].status))],
      ['safe retry delivers result or explicit mission error', () => assert.ok(afterRetry.missions[0].resultCommit || afterRetry.missions[0].error)],
      ['safe retry preserves result evidence or delivers it without unintended rerun', () => assert.ok(existsSync(join(worktree, 'results/restart/result.json')) || afterRetry.missions[0].resultCommit, 'completed result must remain available when retry is rejected')],
    ];
    writeFileSync(join(root, 'observations.json'), JSON.stringify({ source, identity, before, storedBeforeReload, runnerResult, after, wait, retryError, afterRetry }, null, 2));
    process.stdout.write('EVIDENCE_ROOT=' + root + '\n');
    for (const [name, check] of points) await t.test(name, check);
    for (const dispose of effects.reverse()) await dispose?.();
    // Keep the isolated directory as evidence; the bounded runner has exited.
  });
}
