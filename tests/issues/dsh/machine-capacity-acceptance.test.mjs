import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const source = resolve(process.env.ALEPH_CURRENT_SOURCE || '/home/paulus-chang/项目/aleph');
const { ProjectService, snapshot } = await import(pathToFileURL(join(source, 'dsh-plugin/index-v2.js')));
const git = (repo, ...args) => execFileSync('/usr/bin/git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async (predicate, label) => { const until = Date.now() + 20000; while (!predicate()) { if (Date.now() > until) throw new Error('fixture timeout: ' + label); await sleep(10); } };
const tracked = promise => { const result = { state: 'pending' }; result.promise = promise.then(value => Object.assign(result, { state: 'fulfilled', value, completed: performance.now() }), error => Object.assign(result, { state: 'rejected', error: String(error), completed: performance.now() })); return result; };

async function fixture(label, exitCode = 0, waiting = false) {
  const root = mkdtempSync(join(tmpdir(), 'aleph-capacity-' + label + '-'));
  const workspace = join(root, 'workspace'); mkdirSync(workspace);
  const file = join(root, 'projects.json'); writeFileSync(file, '{}');
  const load = () => JSON.parse(readFileSync(file, 'utf8'));
  const table = { get: id => load()[id], entries: () => Object.entries(load()), put: async (id, value) => writeFileSync(file, JSON.stringify({ ...load(), [id]: value })) };
  const service = new ProjectService({}, { table: () => table }, {});
  const project = await service.init({ workspace });
  const repo = project.missionRoot;
  const missions = [];
  for (const name of waiting ? ['work', 'waiting'] : ['work']) {
    const branch = 'mission/' + name;
    git(repo, 'switch', '-c', branch, 'template');
    const dir = join(repo, 'missions', name); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'mission.json'), JSON.stringify({ id: name, entrypoint: 'run.sh' }));
    writeFileSync(join(dir, 'run.sh'), `printf '%s\\n' "$ALEPH_OUTPUT_DIR" >> '${join(root, name + '-starts.txt')}'\n` +
      (name === 'work' ? 'while [ ! -e "$ALEPH_OUTPUT_DIR/release" ]; do sleep .02; done\n' : '') +
      `printf completed > "$ALEPH_OUTPUT_DIR/completed.txt"\nexit ${name === 'work' ? exitCode : 0}\n`);
    git(repo, 'add', '-A'); git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', name);
    const tip = git(repo, 'rev-parse', 'HEAD'); git(repo, 'switch', 'template');
    const proposed = await service.propose({ projectId: project.id, branch, agent: { id: 'parent' } });
    const mission = proposed.missions.at(-1); missions.push({ ...mission, tip, name });
    if (name === 'work') await service.approve({ projectId: project.id, missionId: mission.id });
  }
  return { root, workspace, repo, service, id: project.id, missions, initial: project,
    get: () => service.get(project.id), output: batch => join(workspace, '.aleph/batches', batch.id, 'results/work') };
}

test('ALEPH-01 actual machine capacity, rejection, release and concurrent public composition', async t => {
  const observations = [];
  const points = async (label, checks) => { for (const [name, check] of checks) await t.test(label + ': ' + name, check); };
  for (const exitCode of [0, 7]) {
    const label = exitCode ? 'task failure releases machine' : 'task success releases machine';
    const f = await fixture(exitCode ? 'failure' : 'success', exitCode, true);
    const formed = await f.service.formBatch({ projectId: f.id }); const batch = formed.batches[0];
    await f.service.approve({ projectId: f.id, missionId: f.missions[1].id });
    await points(label, [
      ['project has one actual machine', () => assert.equal(f.get().machines.length, 1)],
      ['composition persists busy reservation', () => assert.equal(f.get().machines[0].status, 'busy')],
      ['reservation names the formed batch', () => assert.equal(f.get().machines[0].batchId, batch.id)],
      ['persisted mission belongs to formed batch', () => assert.equal(f.get().missions[0].batchId, batch.id)],
      ['actual Git branch includes mission commit', () => assert.equal(git(f.repo, 'merge-base', '--is-ancestor', f.missions[0].tip, batch.branch), '')],
      ['sequential composition while reserved rejects busy', () => assert.rejects(f.service.formBatch({ projectId: f.id }), /busy/)],
      ['rejected composition adds no batch', () => assert.equal(f.get().batches.length, 1)],
      ['rejected composition preserves waiting approved mission', () => assert.equal(f.get().missions[1].status, 'approved')],
    ]);
    const run = tracked(f.service.runBatch({ projectId: f.id, batchId: batch.id }));
    await wait(() => existsSync(join(f.root, 'work-starts.txt')), 'actual task start');
    await points(label + '/active', [
      ['actual task executes once', () => assert.equal(readFileSync(join(f.root, 'work-starts.txt'), 'utf8').trim().split('\n').length, 1)],
      ['machine remains busy during actual compute', () => assert.equal(f.get().machines[0].status, 'busy')],
      ['active compute keeps same owner', () => assert.equal(f.get().machines[0].batchId, batch.id)],
      ['composition during compute rejects busy', () => assert.rejects(f.service.formBatch({ projectId: f.id }), /busy/)],
    ]);
    writeFileSync(join(f.output(batch), 'release'), 'release'); await run.promise;
    const finished = f.get();
    await points(label + '/terminal', [
      ['run call finishes without infrastructure error', () => assert.equal(run.state, 'fulfilled')],
      ['batch records actual success or task failure', () => assert.equal(finished.batches[0].status, exitCode ? 'failed' : 'done')],
      ['terminal execution releases machine', () => assert.equal(finished.machines[0].status, 'idle')],
      ['terminal execution clears reservation', () => assert.equal(finished.machines[0].batchId, null)],
      ['waiting mission was not run prematurely', () => assert.equal(existsSync(join(f.root, 'waiting-starts.txt')), false)],
    ]);
    const next = await f.service.formBatch({ projectId: f.id }); const nextBatch = next.batches.at(-1);
    await points(label + '/reuse', [
      ['new batch receives released machine', () => assert.equal(next.machines[0].batchId, nextBatch.id)],
      ['new batch contains only waiting mission', () => assert.deepEqual(nextBatch.missionIds, [f.missions[1].id])],
    ]);
    const done = await f.service.runBatch({ projectId: f.id, batchId: nextBatch.id });
    await points(label + '/reuse-done', [
      ['waiting task eventually executes once', () => assert.equal(readFileSync(join(f.root, 'waiting-starts.txt'), 'utf8').trim().split('\n').length, 1)],
      ['machine returns idle after reuse', () => assert.equal(done.machines[0].status, 'idle')],
    ]);
    observations.push({ label, root: f.root, formed, finished, done });
  }

  const f = await fixture('concurrent');
  const control = join(f.root, 'control'); mkdirSync(control); const bin = join(f.root, 'bin'); mkdirSync(bin);
  copyFileSync(join(dirname(fileURLToPath(import.meta.url)), 'form-batch-git-scheduler.py'), join(bin, 'git')); chmodSync(join(bin, 'git'), 0o755);
  writeFileSync(join(control, 'armed.json'), JSON.stringify({ repo: f.repo }));
  const originalPath = process.env.PATH; const originalControl = process.env.ALEPH_FORM_GIT_CONTROL;
  process.env.PATH = bin + ':' + originalPath; process.env.ALEPH_FORM_GIT_CONTROL = control;
  let race;
  try {
    // Observe first actual Git entry before starting the second public call,
    // while composition is still pending and the machine remains idle. The
    // first Git process is never gated; only the second template read waits.
    const first = tracked(f.service.formBatch({ projectId: f.id }));
    await wait(() => existsSync(join(control, 'entered-1.json')), 'first public call reaches actual Git');
    assert.equal(first.state, 'pending', 'fixture must overlap actual public calls');
    assert.equal(f.get().machines[0].status, 'idle', 'fixture must enter second call before first durable claim');
    const second = tracked(f.service.formBatch({ projectId: f.id }));
    await first.promise;
    await wait(() => second.state !== 'pending' || existsSync(join(control, 'entered-2.json')), 'second public call reaches Git or rejects');
    const afterFirst = f.get();
    writeFileSync(join(control, 'release-second'), 'release'); await second.promise;
    const afterBoth = f.get();
    const active = afterBoth.batches.filter(b => ['forming', 'running'].includes(b.status));
    await points('controlled concurrent composition', [
      ['first public call succeeds', () => assert.equal(first.state, 'fulfilled')],
      ['first batch owns machine before second Git proceeds', () => assert.equal(afterFirst.machines[0].batchId, afterFirst.batches[0].id)],
      ['second call rejects already claimed machine', () => assert.equal(second.state, 'rejected')],
      ['actual persisted capacity allows one unfinished batch', () => assert.equal(active.length, 1)],
      ['machine owner remains the original batch', () => assert.equal(afterBoth.machines[0].batchId, afterFirst.batches[0].id)],
      ['mission remains assigned to original batch', () => assert.equal(afterBoth.missions[0].batchId, afterFirst.batches[0].id)],
      ['every actual batch contains captured mission ancestor', () => { for (const batch of active) assert.equal(git(f.repo, 'merge-base', '--is-ancestor', f.missions[0].tip, batch.branch), ''); }],
      ['every actual batch targets the one local machine', () => assert.ok(active.every(batch => batch.machineId === 'local'))],
    ]);
    const executions = [];
    for (const batch of active) {
      const execution = tracked(f.service.runBatch({ projectId: f.id, batchId: batch.id })); executions.push({ batch, execution });
      await wait(() => existsSync(join(f.output(batch), 'result.json')) || (existsSync(join(f.root, 'work-starts.txt')) && readFileSync(join(f.root, 'work-starts.txt'), 'utf8').includes(f.output(batch))), 'actual batch starts');
    }
    const starts = readFileSync(join(f.root, 'work-starts.txt'), 'utf8').trim().split('\n');
    await points('actual simultaneous task capacity', [
      ['single machine never launches two batches simultaneously', () => assert.equal(starts.length, 1)],
      ['every recorded start belongs to an actual distinct batch worktree', () => assert.deepEqual(new Set(starts), new Set(active.map(batch => f.output(batch))))],
    ]);
    for (const { batch, execution } of executions) {
      writeFileSync(join(f.output(batch), 'release'), 'release'); await execution.promise;
    }
    await points('race cleanup', [
      ['actual batch runs reach terminal calls', () => assert.ok(executions.every(item => item.execution.state === 'fulfilled'))],
      ['machine is idle after all actual compute completes', () => assert.equal(f.get().machines[0].status, 'idle')],
    ]);
    race = { root: f.root, first, second, afterFirst, afterBoth, starts, final: f.get(), git: readdirSync(control).filter(name => name.startsWith('git-')).map(name => JSON.parse(readFileSync(join(control, name), 'utf8'))) };
  } finally {
    process.env.PATH = originalPath;
    if (originalControl === undefined) delete process.env.ALEPH_FORM_GIT_CONTROL; else process.env.ALEPH_FORM_GIT_CONTROL = originalControl;
  }
  observations.push({ label: 'controlled concurrent public composition and actual tasks', ...race });
  if (process.env.ALEPH_CAPACITY_OBSERVATIONS) writeFileSync(process.env.ALEPH_CAPACITY_OBSERVATIONS, JSON.stringify({ source, source_sha: git(source, 'rev-parse', 'HEAD'), source_tracked_dirty: git(source, 'status', '--porcelain', '--untracked-files=no'), command: [process.execPath, ...process.execArgv, '--test', 'tests/issues/dsh/machine-capacity-acceptance.test.mjs'], boundary: 'Actual ProjectService/Git/runner/tasks; disk JSON storage adapter and loader stubs replace DSH package definitions. Transparent Git wrapper delays only second initial rev-parse template until first composition persists. Concurrent product requests are the test subject; no product modifications or fake records. Controlled interleaving, not natural incidence frequency.', observations }, null, 2));
});
