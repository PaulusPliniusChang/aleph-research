import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ProjectService } from '../index-v2.js';

const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function git(repo, ...args) {
  return execFileSync(realGit, ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
async function until(predicate) {
  const end = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('composition fixture timed out');
    await sleep(5);
  }
}
function tracked(promise) {
  const result = { state: 'pending' };
  result.promise = promise.then((value) => { result.state = 'fulfilled'; result.value = value; }, (error) => { result.state = 'rejected'; result.error = error; });
  return result;
}
async function fixture(t, label) {
  const root = await mkdtemp(join(tmpdir(), `aleph-composition-${label}-`));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, 'workspace');
  await mkdir(workspace);
  const records = new Map();
  let failPut = null;
  const table = {
    get: (id) => records.has(id) ? structuredClone(records.get(id)) : undefined,
    entries: () => [...records].map(([id, value]) => [id, structuredClone(value)]),
    put: async (id, value) => {
      const mode = failPut; failPut = null;
      if (mode === 'before') throw new Error('fixture storage failed before write');
      records.set(id, structuredClone(value));
      if (mode === 'after') throw new Error('fixture storage failed after write');
    },
  };
  const domain = { table: () => table };
  const service = new ProjectService({}, domain, {});
  const project = await service.init({ workspace });
  const repo = project.missionRoot;
  const get = () => table.get(project.id);
  async function update(fn) { await table.put(project.id, fn(get())); }
  async function mission(name, options = {}) {
    const branch = `mission/${name}`;
    git(repo, 'switch', '-c', branch, 'template');
    const dir = join(repo, 'missions', name); await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'mission.json'), JSON.stringify({ id: name, entrypoint: 'run.sh' }));
    await writeFile(join(dir, 'run.sh'), '#!/bin/sh\ntrue\n');
    if (options.shared) await writeFile(join(repo, 'shared.txt'), name + '\n');
    git(repo, 'add', '-A');
    git(repo, '-c', 'user.name=Composition test', '-c', 'user.email=test@localhost', 'commit', '-m', `mission ${name}`);
    const tip = git(repo, 'rev-parse', branch);
    git(repo, 'switch', 'template');
    const proposed = await service.propose({ projectId: project.id, branch, agent: { id: `researcher-${name}` } });
    const entry = proposed.missions.at(-1);
    await service.approve({ projectId: project.id, missionId: entry.id });
    return { ...entry, tip };
  }
  const branches = () => git(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/batch/').split('\n').filter(Boolean);
  return { root, repo, service, domain, table, project, get, update, mission, branches,
    failNextPut: (mode) => { failPut = mode; },
    compose: (machineId = 'local') => service.formBatch({ projectId: project.id, machineId }),
  };
}
async function gate(t, f) {
  const control = join(f.root, 'control'); await mkdir(control);
  const bin = join(f.root, 'bin'); await mkdir(bin);
  const wrapper = join(bin, 'git');
  await writeFile(wrapper, `#!/usr/bin/env python3
import json, os, pathlib, subprocess, sys, time
c=pathlib.Path(os.environ['ALEPH_COMPOSITION_CONTROL'])
with (c/'commands').open('a') as out: out.write(json.dumps(sys.argv[1:])+'\\n')
if sys.argv[-2:]==['rev-parse','template']:
    try: fd=os.open(c/'claimed',os.O_CREAT|os.O_EXCL|os.O_WRONLY); os.close(fd); first=True
    except FileExistsError: first=False
    if first:
        (c/'entered').write_text('entered')
        end=time.monotonic()+15
        while not (c/'release').exists():
            if time.monotonic()>end: raise TimeoutError('composition gate was not released')
            time.sleep(.005)
sys.exit(subprocess.call([os.environ['ALEPH_COMPOSITION_REAL_GIT'],*sys.argv[1:]]))
`);
  await chmod(wrapper, 0o755);
  const previous = { PATH: process.env.PATH, control: process.env.ALEPH_COMPOSITION_CONTROL, real: process.env.ALEPH_COMPOSITION_REAL_GIT };
  process.env.PATH = bin + ':' + previous.PATH;
  process.env.ALEPH_COMPOSITION_CONTROL = control;
  process.env.ALEPH_COMPOSITION_REAL_GIT = realGit;
  const release = () => writeFileSync(join(control, 'release'), 'release');
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    if (existsSync(control)) release();
    process.env.PATH = previous.PATH;
    if (previous.control === undefined) delete process.env.ALEPH_COMPOSITION_CONTROL; else process.env.ALEPH_COMPOSITION_CONTROL = previous.control;
    if (previous.real === undefined) delete process.env.ALEPH_COMPOSITION_REAL_GIT; else process.env.ALEPH_COMPOSITION_REAL_GIT = previous.real;
  };
  t.after(close);
  return { release, close, entered: () => until(() => existsSync(join(control, 'entered'))),
    commands: () => existsSync(join(control, 'commands')) ? readFileSync(join(control, 'commands'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [] };
}

test('composition preserves capacity, repository state and ownership', async (t) => {
  const checks = async (scope, cases) => { for (const [name, check] of cases) await t.test(`${scope}: ${name}`, check); };

  const f = await fixture(t, 'same-machine');
  const m = await f.mission('one');
  const g = await gate(t, f);
  const first = tracked(f.compose()); await g.entered();
  const second = tracked(f.compose()); await sleep(20);
  await checks('same machine while composing', [
    ['first composition remains active before release', () => assert.equal(first.state, 'pending')],
    ['second composition waits instead of racing Git', () => assert.equal(second.state, 'pending')],
    ['only one template read reaches Git', () => assert.equal(g.commands().filter(args => args.slice(-2).join(' ') === 'rev-parse template').length, 1)],
  ]);
  g.release(); await first.promise; await second.promise;
  const current = f.get(); const batch = current.batches[0];
  await checks('same machine after composition', [
    ['first request succeeds', () => assert.equal(first.state, 'fulfilled')],
    ['second request rejects busy capacity', () => { assert.equal(second.state, 'rejected'); assert.match(second.error.message, /busy/); }],
    ['only one batch is persisted', () => assert.equal(current.batches.length, 1)],
    ['machine is busy', () => assert.equal(current.machines[0].status, 'busy')],
    ['machine retains first batch ownership', () => assert.equal(current.machines[0].batchId, batch.id)],
    ['mission retains first batch ownership', () => assert.equal(current.missions[0].batchId, batch.id)],
    ['mission is batched', () => assert.equal(current.missions[0].status, 'batched')],
    ['batch contains the selected mission once', () => assert.deepEqual(batch.missionIds, [m.id])],
    ['recorded mission base matches merged commit', () => assert.equal(current.missions[0].preBatchTip, m.tip)],
    ['batch contains the exact mission commit', () => assert.equal(git(f.repo, 'merge-base', m.tip, batch.branch), m.tip)],
    ['shared checkout returns to template', () => assert.equal(git(f.repo, 'branch', '--show-current'), 'template')],
    ['no unpublished batch branch is left', () => assert.deepEqual(f.branches(), [batch.branch])],
  ]);
  g.close();

  const shared = await fixture(t, 'shared-repository');
  const ma = await shared.mission('alpha'); const mb = await shared.mission('beta');
  await shared.update(p => ({ ...p, machines: [...p.machines, { id: 'second', kind: 'local', status: 'idle', batchId: null }] }));
  const alias = join(shared.root, 'mission-alias'); await symlink(shared.repo, alias);
  const siblingService = new ProjectService({}, shared.domain, {});
  const originalGet = siblingService.get.bind(siblingService);
  siblingService.get = id => { const p = originalGet(id); return p ? { ...p, missionRoot: alias } : p; };
  const sharedGate = await gate(t, shared);
  const primary = tracked(shared.compose()); await sharedGate.entered();
  const sibling = tracked(siblingService.formBatch({ projectId: shared.project.id, machineId: 'second' }));
  await sleep(20);
  await checks('cross service and machine', [
    ['symlink alias shares the composition guard', () => assert.equal(sibling.state, 'pending')],
    ['independent service does not enter a second template read', () => assert.equal(sharedGate.commands().filter(args => args.slice(-2).join(' ') === 'rev-parse template').length, 1)],
  ]);
  sharedGate.release(); await primary.promise; await sibling.promise;
  const combined = shared.get(); const combinedBatch = combined.batches[0];
  await checks('shared mission selection', [
    ['first machine composition succeeds', () => assert.equal(primary.state, 'fulfilled')],
    ['second machine rechecks current approved missions', () => { assert.equal(sibling.state, 'rejected'); assert.match(sibling.error.message, /no approved missions/); }],
    ['only one combined batch is published', () => assert.equal(combined.batches.length, 1)],
    ['both missions belong only to first batch', () => assert.ok(combined.missions.every(mission => mission.batchId === combinedBatch.id))],
    ['batch includes distinct selected missions', () => assert.deepEqual(combinedBatch.missionIds, [ma.id, mb.id])],
    ['unused second machine remains idle and unowned', () => assert.deepEqual(combined.machines[1], { id: 'second', kind: 'local', status: 'idle', batchId: null })],
    ['first mission commit remains in composed history', () => assert.equal(git(shared.repo, 'merge-base', ma.tip, combinedBatch.branch), ma.tip)],
    ['second mission commit remains in composed history', () => assert.equal(git(shared.repo, 'merge-base', mb.tip, combinedBatch.branch), mb.tip)],
    ['shared repository has no stray batch branches', () => assert.deepEqual(shared.branches(), [combinedBatch.branch])],
    ['shared repository checkout is restored', () => assert.equal(git(shared.repo, 'branch', '--show-current'), 'template')],
  ]);
  sharedGate.close();

  const missing = await fixture(t, 'missing-branch');
  const missingMission = await missing.mission('missing');
  git(missing.repo, 'branch', '-D', missingMission.branch);
  const failedMissing = tracked(missing.compose()); await failedMissing.promise;
  await checks('missing mission branch cleanup', [
    ['missing branch rejects composition', () => assert.equal(failedMissing.state, 'rejected')],
    ['failed composition publishes no batch', () => assert.equal(missing.get().batches.length, 0)],
    ['failed composition preserves idle machine', () => assert.equal(missing.get().machines[0].status, 'idle')],
    ['failed composition preserves approved mission', () => assert.equal(missing.get().missions[0].status, 'approved')],
    ['failed composition restores template checkout', () => assert.equal(git(missing.repo, 'branch', '--show-current'), 'template')],
    ['failed composition removes unpublished branch', () => assert.deepEqual(missing.branches(), [])],
  ]);
  git(missing.repo, 'branch', missingMission.branch, missingMission.tip);
  const retriedMissing = await missing.compose();
  await checks('missing branch retry', [
    ['failure releases guard for a valid retry', () => assert.equal(retriedMissing.batches.length, 1)],
    ['retry retains exact mission tip', () => assert.equal(retriedMissing.missions[0].preBatchTip, missingMission.tip)],
    ['retry assigns machine to the new batch', () => assert.equal(retriedMissing.machines[0].batchId, retriedMissing.batches[0].id)],
  ]);

  const conflict = await fixture(t, 'merge-conflict');
  const ca = await conflict.mission('conflict-a', { shared: true });
  const cb = await conflict.mission('conflict-b', { shared: true });
  const failedConflict = tracked(conflict.compose()); await failedConflict.promise;
  await checks('merge conflict rollback', [
    ['actual Git conflict rejects composition', () => { assert.equal(failedConflict.state, 'rejected'); assert.match(failedConflict.error.message, /merge conflict/); }],
    ['original Git failure is retained as cause', () => assert.ok(failedConflict.error.cause instanceof Error)],
    ['conflict publishes no batch', () => assert.equal(conflict.get().batches.length, 0)],
    ['conflict leaves both missions approved', () => assert.ok(conflict.get().missions.every(m => m.status === 'approved' && m.batchId === null))],
    ['conflict preserves idle machine', () => assert.equal(conflict.get().machines[0].status, 'idle')],
    ['conflict leaves clean working tree', () => assert.equal(git(conflict.repo, 'status', '--porcelain'), '')],
    ['conflict restores template checkout', () => assert.equal(git(conflict.repo, 'branch', '--show-current'), 'template')],
    ['conflict removes unpublished branch', () => assert.deepEqual(conflict.branches(), [])],
    ['conflict preserves first mission branch', () => assert.equal(git(conflict.repo, 'rev-parse', ca.branch), ca.tip)],
    ['conflict preserves second mission branch', () => assert.equal(git(conflict.repo, 'rev-parse', cb.branch), cb.tip)],
  ]);
  await conflict.update(p => ({ ...p, missions: p.missions.map(m => m.id === cb.id ? { ...m, status: 'proposed' } : m) }));
  const retryConflict = await conflict.compose();
  await checks('merge conflict retry', [
    ['valid selection succeeds after rollback', () => assert.equal(retryConflict.batches.length, 1)],
    ['retry contains only approved mission', () => assert.deepEqual(retryConflict.batches[0].missionIds, [ca.id])],
    ['unselected mission remains unowned', () => assert.equal(retryConflict.missions.find(m => m.id === cb.id).batchId, null)],
  ]);

  for (const change of ['machine-owner', 'mission-branch']) {
    const changed = await fixture(t, change);
    const cm = await changed.mission('changed');
    if (change === 'mission-branch') git(changed.repo, 'branch', 'mission/replacement', cm.tip);
    const cg = await gate(t, changed);
    const composing = tracked(changed.compose()); await cg.entered();
    await changed.service.mutate(changed.project.id, p => change === 'machine-owner'
      ? { ...p, machines: p.machines.map(m => ({ ...m, status: 'busy', batchId: 'other-owner' })) }
      : { ...p, missions: p.missions.map(m => ({ ...m, branch: 'mission/replacement' })) });
    const concurrentState = changed.get();
    cg.release(); await composing.promise;
    await checks(`publication validation ${change}`, [
      ['stale composition is rejected', () => assert.equal(composing.state, 'rejected')],
      ['rejection identifies changed capacity or mission', () => assert.match(composing.error.message, /busy|changed during batch composition/)],
      ['concurrent machine state remains intact', () => assert.deepEqual(changed.get().machines, concurrentState.machines)],
      ['concurrent mission state remains intact', () => assert.deepEqual(changed.get().missions, concurrentState.missions)],
      ['stale batch is never published', () => assert.equal(changed.get().batches.length, 0)],
      ['stale unpublished branch is removed', () => assert.deepEqual(changed.branches(), [])],
      ['checkout is restored after validation rejection', () => assert.equal(git(changed.repo, 'branch', '--show-current'), 'template')],
    ]);
    cg.close();
    await changed.service.mutate(changed.project.id, p => ({ ...p,
      machines: p.machines.map(m => ({ ...m, status: 'idle', batchId: null })),
    }));
    const recovered = await changed.compose();
    await checks(`publication retry ${change}`, [
      ['valid current state can compose after rejection', () => assert.equal(recovered.batches.length, 1)],
      ['retry uses current mission identity and exact tip', () => { assert.deepEqual(recovered.batches[0].missionIds, [cm.id]); assert.equal(recovered.missions[0].preBatchTip, cm.tip); }],
    ]);
  }

  for (const failure of ['before', 'after']) {
    const storage = await fixture(t, `storage-${failure}`);
    const sm = await storage.mission('storage');
    storage.failNextPut(failure);
    const failed = tracked(storage.compose()); await failed.promise;
    await checks(`storage ${failure} write`, [
      ['storage failure is returned to caller', () => { assert.equal(failed.state, 'rejected'); assert.match(failed.error.message, new RegExp(`failed ${failure} write`)); }],
      ['storage failure leaves checkout on template', () => assert.equal(git(storage.repo, 'branch', '--show-current'), 'template')],
      ['source mission commit is preserved', () => assert.equal(git(storage.repo, 'rev-parse', sm.branch), sm.tip)],
    ]);
    if (failure === 'before') {
      await checks('unpublished storage failure', [
        ['no batch is persisted before failed write', () => assert.equal(storage.get().batches.length, 0)],
        ['idle machine retains no owner', () => assert.deepEqual(storage.get().machines[0], { id: 'local', kind: 'local', status: 'idle', batchId: null })],
        ['approved mission remains unowned', () => { assert.equal(storage.get().missions[0].status, 'approved'); assert.equal(storage.get().missions[0].batchId, null); }],
        ['unpublished branch is removed', () => assert.deepEqual(storage.branches(), [])],
      ]);
      const retry = await storage.compose();
      await checks('storage failure retry', [
        ['guard is released after storage rejection', () => assert.equal(retry.batches.length, 1)],
        ['retry publishes a valid branch', () => assert.equal(git(storage.repo, 'merge-base', sm.tip, retry.batches[0].branch), sm.tip)],
      ]);
    } else {
      const persisted = storage.get(); const sb = persisted.batches[0];
      await checks('already persisted storage failure', [
        ['published batch remains recorded', () => assert.equal(persisted.batches.length, 1)],
        ['published branch is not deleted', () => assert.deepEqual(storage.branches(), [sb.branch])],
        ['published branch still contains mission commit', () => assert.equal(git(storage.repo, 'merge-base', sm.tip, sb.branch), sm.tip)],
        ['machine still belongs to persisted batch', () => assert.equal(persisted.machines[0].batchId, sb.id)],
        ['mission still belongs to persisted batch', () => assert.equal(persisted.missions[0].batchId, sb.id)],
        ['duplicate retry cannot overwrite persisted owner', () => assert.rejects(storage.compose(), /busy/)],
      ]);
    }
  }
});
