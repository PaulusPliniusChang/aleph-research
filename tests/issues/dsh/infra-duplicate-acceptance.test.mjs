import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const source = resolve(process.env.ALEPH_CURRENT_SOURCE || '/home/paulus-chang/项目/aleph');
const { ProjectService, apply } = await import(pathToFileURL(join(source, 'dsh-plugin/index-v2.js')));
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const outcome = promise => promise.then(value => ({ value }), error => ({ error: String(error) }));
async function until(predicate) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await pause(10); }
  assert.ok(predicate(), 'bounded fixture must reach requested public state');
}
function activationService() {
  const calls = [];
  let failNext = false;
  return {
    calls,
    fail() { failNext = true; },
    async startActivation(options) {
      if (failNext) { failNext = false; throw new Error('deterministic activation startup failure'); }
      let release, cancel;
      const result = new Promise((resolve, reject) => { release = resolve; cancel = reject; });
      const call = { options, cancel: () => cancel(new Error('fixture cleanup after premature direct computation')), release: () => release({ output: [{ type: 'text', text: 'deterministic infra finished' }] }), childId: 'fixture-child-' + calls.length };
      calls.push(call);
      const cwd = options.request.cwd;
      writeFileSync(join(cwd, 'ALEPH_HANDOFF.md'), 'Deterministic optimization fixture.\n');
      writeFileSync(join(cwd, 'missions/infra/run.sh'), readFileSync(join(cwd, 'missions/infra/run.sh'), 'utf8') + '\n# pending optimizer modification\n');
      mkdirSync(join(cwd, 'scratch/cache'), { recursive: true });
      writeFileSync(join(cwd, 'scratch/cache/active.txt'), 'active optimizer marker\n');
      return { childId: call.childId, result };
    },
  };
}
const disposers = [];
async function fixture(name, { slow = false, registered = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aleph-infra-' + name + '-'));
  const workspace = join(root, 'workspace');
  mkdirSync(workspace);
  const values = new Map();
  const table = { get: key => values.get(key), entries: () => [...values.entries()], put: async (key, value) => { values.set(key, value); } };
  const subagents = activationService();
  const service = new ProjectService({}, { table: () => table }, { subagents });
  let project = await service.init({ workspace });
  const repo = project.missionRoot;
  git(repo, 'switch', '-c', 'mission/infra', 'template');
  mkdirSync(join(repo, 'missions/infra'), { recursive: true });
  writeFileSync(join(repo, 'missions/infra/mission.json'), JSON.stringify({ id: 'infra', entrypoint: 'run.sh' }));
  const gate = slow ? `i=0; while [ ! -e '${join(root, 'release-runner')}' ] && [ $i -lt 500 ]; do i=$((i+1)); sleep 0.02; done\n` : '';
  writeFileSync(join(repo, 'missions/infra/run.sh'), `printf 'run\\n' >> '${join(root, 'executions.txt')}'\n${gate}printf completed > "$ALEPH_OUTPUT_DIR/completed.txt"\n`);
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'deterministic infra duplicate fixture');
  git(repo, 'switch', 'template');
  project = await service.propose({ projectId: project.id, branch: 'mission/infra', agent: { id: 'parent-one' } });
  await service.approve({ projectId: project.id, missionId: project.missions[0].id });
  project = await service.formBatch({ projectId: project.id });
  const batch = project.batches[0];
  const tools = new Map();
  if (registered) {
    await apply({
      storageDomain: { open: async () => ({ table: () => table, close: async () => {} }) },
      get: name => name === 'subagents' ? subagents : undefined,
      effect: fn => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose); },
      tools: { register: definition => { tools.set(definition.name, definition); return () => {}; } },
      webServer: { register: () => {} },
    });
  }
  const invoke = (name, agent = { id: 'parent-one' }) => tools.get(name).execute({ project_id: project.id, batch_id: batch.id }, { agent });
  return { invoke, tools, releaseRunner: () => writeFileSync(join(root, 'release-runner'), ''), batchWorktree: join(workspace, '.aleph/batches', batch.id), root, repo, service, subagents, projectId: project.id, batchId: batch.id, branch: batch.branch, worktree: join(workspace, '.aleph/infra', batch.id), args: { projectId: project.id, batchId: batch.id, agent: { id: 'parent-one' } } };
}
async function startPending(f) {
  let settled = false;
  const pending = outcome(f.service.runInfra(f.args)).then(result => { settled = true; return result; });
  await until(() => f.subagents.calls.length === 1 && f.service.get(f.projectId).agents.some(agent => agent.role === 'infra' && agent.status === 'running'));
  return { pending, settled: () => settled };
}

test('ALEPH-13 independent InfraOptimizer duplicate-start acceptance', async t => {
  const observations = [];
  async function points(label, checks) { for (const [name, check] of checks) await t.test(label + ': ' + name, check); }
  const normal = await fixture('normal');
  const first = await startPending(normal);
  const call = normal.subagents.calls[0];
  await points('single normal invocation while optimization is pending', [
    ['uses the isolated batch worktree', () => assert.equal(call.options.request.cwd, normal.worktree)],
    ['uses the infra agent preset', () => assert.equal(call.options.request.agentPreset, 'aleph-infra')],
    ['uses the real caller identity', () => assert.equal(call.options.request.parent.id, 'parent-one')],
    ['preserves pending handoff bytes', () => assert.equal(readFileSync(join(normal.worktree, 'ALEPH_HANDOFF.md'), 'utf8'), 'Deterministic optimization fixture.\n')],
    ['waits for pending optimizer completion', () => assert.equal(first.settled(), false)],
  ]);
  call.release();
  const normallyFinished = await first.pending;
  const normalProject = normal.service.get(normal.projectId);
  await points('single normal invocation after completion', [
    ['returns successfully', () => assert.equal(normallyFinished.error, undefined)],
    ['commits the actual optimizer modification to batch branch', () => assert.match(git(normal.repo, 'show', normal.branch + ':missions/infra/run.sh'), /pending optimizer modification/)],
    ['delivers result to the actual mission branch', () => assert.equal(normalProject.missions[0].resultCommit, git(normal.repo, 'rev-parse', 'mission/infra'))],
    ['records optimizer completion', () => assert.equal(normalProject.agents.find(agent => agent.role === 'infra').status, 'done')],
    ['marks batch done', () => assert.equal(normalProject.batches[0].status, 'done')],
    ['releases machine', () => assert.equal(normalProject.machines[0].status, 'idle')],
  ]);
  const normalTip = git(normal.repo, 'rev-parse', normal.branch);
  const repeated = await outcome(normal.service.runInfra(normal.args));
  await points('completed batch is invoked again', [
    ['repeat is explicitly rejected', () => assert.match(repeated.error || '', /not forming|already|completed|done|not runnable/i)],
    ['does not launch another optimizer', () => assert.equal(normal.subagents.calls.length, 1)],
    ['does not change batch branch', () => assert.equal(git(normal.repo, 'rev-parse', normal.branch), normalTip)],
    ['does not repeat actual batch computation', () => assert.equal(readFileSync(join(normal.root, 'executions.txt'), 'utf8').trim().split('\n').length, 1)],
    ['does not reserve the finished machine again', () => assert.equal(normal.service.get(normal.projectId).machines[0].status, 'idle')],
  ]);
  const duplicate = await fixture('active-duplicate');
  const active = await startPending(duplicate);
  const priorHead = git(duplicate.worktree, 'rev-parse', 'HEAD');
  const priorScript = readFileSync(join(duplicate.worktree, 'missions/infra/run.sh'), 'utf8');
  const second = await outcome(duplicate.service.runInfra({ ...duplicate.args, agent: { id: 'parent-two' } }));
  await points('second caller while first optimizer remains pending', [
    ['first optimizer is still pending when repeat returns', () => assert.equal(active.settled(), false)],
    ['repeat reports an existing active execution before Git re-registration', () => { assert.match(second.error || '', /already|active|running|busy|in.progress|reserved|not forming/i); assert.doesNotMatch(second.error || '', /already registered worktree|worktree add/i); }],
    ['retains the active directory', () => assert.ok(existsSync(duplicate.worktree))],
    ['retains uncommitted handoff bytes', () => assert.equal(readFileSync(join(duplicate.worktree, 'ALEPH_HANDOFF.md'), 'utf8'), 'Deterministic optimization fixture.\n')],
    ['retains tracked source modifications', () => assert.equal(readFileSync(join(duplicate.worktree, 'missions/infra/run.sh'), 'utf8'), priorScript)],
    ['retains nested untracked optimizer files', () => assert.equal(readFileSync(join(duplicate.worktree, 'scratch/cache/active.txt'), 'utf8'), 'active optimizer marker\n')],
    ['retains actual Git worktree identity', () => assert.equal(git(duplicate.worktree, 'rev-parse', 'HEAD'), priorHead)],
    ['does not launch a second optimizer', () => assert.equal(duplicate.subagents.calls.length, 1)],
    ['retains the first running optimizer record', () => assert.equal(duplicate.service.get(duplicate.projectId).agents.filter(agent => agent.role === 'infra' && agent.status === 'running').length, 1)],
    ['keeps the active machine reserved', () => assert.equal(duplicate.service.get(duplicate.projectId).machines[0].status, 'busy')],
  ]);
  duplicate.subagents.calls[0].release();
  const firstAfterRepeat = await active.pending;
  await points('first optimizer continues after duplicate rejection', [
    ['first call can complete normally', () => assert.equal(firstAfterRepeat.error, undefined)],
    ['original batch reaches done', () => assert.equal(duplicate.service.get(duplicate.projectId).batches[0].status, 'done')],
    ['original mission receives a result', () => assert.ok(duplicate.service.get(duplicate.projectId).missions[0].resultCommit)],
    ['active machine eventually becomes idle', () => assert.equal(duplicate.service.get(duplicate.projectId).machines[0].status, 'idle')],
  ]);
  const runner = await fixture('running-duplicate', { slow: true, registered: true });
  let runnerSettled = false;
  const running = outcome(runner.invoke('aleph_run_infra')).then(value => { runnerSettled = true; return value; });
  await until(() => runner.subagents.calls.length === 1);
  runner.subagents.calls[0].release();
  await until(() => existsSync(join(runner.root, 'executions.txt')));
  const runnerHead = git(runner.batchWorktree, 'rev-parse', 'HEAD');
  const runnerDirectoryIdentity = statSync(runner.batchWorktree).ino;
  const runnerScript = readFileSync(join(runner.batchWorktree, 'missions/infra/run.sh'), 'utf8');
  let secondSettled = false;
  let secondRunnerResult;
  const runnerRepeat = outcome(runner.invoke('aleph_run_infra', { id: 'parent-two' })).then(value => { secondSettled = true; secondRunnerResult = value; return value; });
  await until(() => secondSettled || runner.subagents.calls.length > 1);
  await points('registered infra repeat after optimizer returned while actual runner is active', [
    ['first invocation remains pending on actual runner', () => assert.equal(runnerSettled, false)],
    ['repeat rejects before starting another optimizer', () => assert.equal(secondSettled, true)],
    ['repeat returns explicit active-execution rejection', () => assert.match(secondRunnerResult?.error || '', /already|active|running|busy|in.progress|reserved|not forming/i)],
    ['does not launch a second optimizer during computation', () => assert.equal(runner.subagents.calls.length, 1)],
    ['retains active batch Git identity', () => assert.equal(git(runner.batchWorktree, 'rev-parse', 'HEAD'), runnerHead)],
    ['retains original running script bytes', () => assert.equal(readFileSync(join(runner.batchWorktree, 'missions/infra/run.sh'), 'utf8'), runnerScript)],
    ['retains original running directory identity', () => assert.equal(statSync(runner.batchWorktree).ino, runnerDirectoryIdentity)],
    ['keeps exactly one actual computation', () => assert.equal(readFileSync(join(runner.root, 'executions.txt'), 'utf8').trim().split('\n').length, 1)],
    ['keeps machine busy during actual computation', () => assert.equal(runner.service.get(runner.projectId).machines[0].status, 'busy')],
  ]);
  runner.releaseRunner();
  for (const activation of runner.subagents.calls) activation.release();
  const runnerFirstResult = await running;
  const runnerSecondResult = await runnerRepeat;
  await points('registered infra repeat preserves final delivery', [
    ['first invocation completes normally', () => assert.equal(runnerFirstResult.error, undefined)],
    ['batch completes successfully', () => assert.equal(runner.service.get(runner.projectId).batches[0].status, 'done')],
    ['mission receives a result exactly once', () => assert.equal(git(runner.repo, 'log', '--format=%s', 'mission/infra').split('\n').filter(line => line.startsWith('mission result ')).length, 1)],
    ['actual computation executes exactly once', () => assert.equal(readFileSync(join(runner.root, 'executions.txt'), 'utf8').trim().split('\n').length, 1)],
    ['machine becomes idle after delivery', () => assert.equal(runner.service.get(runner.projectId).machines[0].status, 'idle')],
  ]);
  const cross = await fixture('direct-batch-versus-infra', { slow: true, registered: true });
  const crossInfra = outcome(cross.invoke('aleph_run_infra'));
  await until(() => cross.subagents.calls.length === 1);
  const activeInfraBytes = readFileSync(join(cross.worktree, 'missions/infra/run.sh'), 'utf8');
  let crossSettled = false;
  let directResult;
  const direct = outcome(cross.invoke('aleph_run_batch')).then(value => { crossSettled = true; directResult = value; return value; });
  await until(() => crossSettled || existsSync(join(cross.root, 'executions.txt')));
  await points('registered direct batch versus active registered infra', [
    ['registered infra tool exists', () => assert.ok(cross.tools.has('aleph_run_infra'))],
    ['registered batch tool exists', () => assert.ok(cross.tools.has('aleph_run_batch'))],
    ['direct batch rejects without starting computation', () => assert.equal(crossSettled, true)],
    ['direct batch reports active execution', () => assert.match(directResult?.error || '', /already|active|running|busy|in.progress|reserved|not forming/i)],
    ['does not create premature batch computation', () => assert.equal(existsSync(join(cross.root, 'executions.txt')), false)],
    ['preserves active optimizer source bytes', () => assert.equal(readFileSync(join(cross.worktree, 'missions/infra/run.sh'), 'utf8'), activeInfraBytes)],
    ['preserves one active optimizer', () => assert.equal(cross.subagents.calls.length, 1)],
  ]);
  cross.releaseRunner();
  await direct;
  const crossProtected = Boolean(directResult?.error);
  if (crossProtected) cross.subagents.calls[0].release();
  else cross.subagents.calls[0].cancel();
  const crossFinal = await crossInfra;
  if (crossProtected) await points('registered direct rejection allows original infra to finish', [
    ['original infra completes normally', () => assert.equal(crossFinal.error, undefined)],
    ['original batch finishes done', () => assert.equal(cross.service.get(cross.projectId).batches[0].status, 'done')],
    ['computes exactly once after optimization', () => assert.equal(readFileSync(join(cross.root, 'executions.txt'), 'utf8').trim().split('\n').length, 1)],
    ['delivers one result commit', () => assert.equal(git(cross.repo, 'log', '--format=%s', 'mission/infra').split('\n').filter(line => line.startsWith('mission result ')).length, 1)],
  ]);
  observations.push({ runner: { root: runner.root, runnerFirstResult, runnerSecondResult, project: runner.service.get(runner.projectId) }, directVersusInfra: { root: cross.root, directResult, crossFinal, project: cross.service.get(cross.projectId) } });
  const invalid = await fixture('invalid-input');
  const noCaller = await outcome(invalid.service.runInfra({ ...invalid.args, agent: undefined }));
  const noProject = await outcome(invalid.service.runInfra({ ...invalid.args, projectId: 'missing' }));
  const noBatch = await outcome(invalid.service.runInfra({ ...invalid.args, batchId: 'missing' }));
  const dependency = invalid.service.subagents;
  invalid.service.subagents = null;
  const noService = await outcome(invalid.service.runInfra(invalid.args));
  invalid.service.subagents = dependency;
  await points('invalid invocation cannot start optimization', [
    ['caller identity is required', () => assert.match(noCaller.error || '', /calling Agent|required/i)],
    ['missing project is rejected', () => assert.match(noProject.error || '', /project not found/i)],
    ['missing batch is rejected', () => assert.match(noBatch.error || '', /batch not found/i)],
    ['missing activation dependency is rejected', () => assert.match(noService.error || '', /subagent.*unavailable/i)],
    ['invalid calls launch no optimizer', () => assert.equal(invalid.subagents.calls.length, 0)],
    ['invalid calls do not create an optimization worktree', () => assert.equal(existsSync(invalid.worktree), false)],
  ]);
  const failedStart = await fixture('start-failure');
  failedStart.subagents.fail();
  const startupError = await outcome(failedStart.service.runInfra(failedStart.args));
  const retry = await startPending(failedStart);
  failedStart.subagents.calls[0].release();
  const retryResult = await retry.pending;
  await points('initial optimizer startup fails before any active execution', [
    ['records an explicit startup error', () => assert.match(startupError.error || '', /activation startup failure/i)],
    ['subsequent legal invocation can complete', () => assert.equal(retryResult.error, undefined)],
    ['successful retry executes batch exactly once', () => assert.equal(readFileSync(join(failedStart.root, 'executions.txt'), 'utf8').trim().split('\n').length, 1)],
    ['successful retry releases machine', () => assert.equal(failedStart.service.get(failedStart.projectId).machines[0].status, 'idle')],
  ]);
  observations.push({ normal: { root: normal.root, normalProject, normallyFinished, repeated }, duplicate: { root: duplicate.root, second, firstAfterRepeat, project: duplicate.service.get(duplicate.projectId) }, invalid: { root: invalid.root, noCaller, noProject, noBatch, noService }, startupFailure: { root: failedStart.root, startupError, retryResult } });
  for (const dispose of disposers.reverse()) await dispose();
  if (process.env.ALEPH_INFRA_OBSERVATIONS) writeFileSync(process.env.ALEPH_INFRA_OBSERVATIONS, JSON.stringify({ source, source_sha: git(source, 'rev-parse', 'HEAD'), source_tracked_dirty: git(source, 'status', '--porcelain', '--untracked-files=no'), command: [process.execPath, ...process.execArgv, '--test', 'tests/issues/dsh/infra-duplicate-acceptance.test.mjs'], environment: { ALEPH_CURRENT_SOURCE: source, ALEPH_INFRA_OBSERVATIONS: process.env.ALEPH_INFRA_OBSERVATIONS }, substitution: 'Only subagent activation/result and Map-backed storage are deterministic; service, registered tool handlers, Git and batch runner are actual product code. If direct batch wrongly runs during active infra, let that premature compute complete, then reject only the still-held fixture activation for cleanup; do not count that cancellation as product behavior. Four final successful-infra delivery assertions run only when direct batch was correctly rejected.', observations }, null, 2));
});
