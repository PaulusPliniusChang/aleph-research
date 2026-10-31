import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runEvaluation } from '../evaluation-process.mjs';
// This exact tagged module gets a disclosed 500ms evaluator deadline in loader.mjs.
import { ProjectService } from '../index-v2.js?evaluation-deadline-test';

const fixture = fileURLToPath(new URL('./fixtures/evaluation-process.py', import.meta.url));
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
function proc(pid) {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = raw.slice(raw.lastIndexOf(')') + 2).trim().split(/\s+/);
    return { state: fields[0], group: Number(fields[2]), session: Number(fields[3]), start: fields[19] };
  } catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return null; throw error; }
}
const live = identity => {
  const current = proc(identity.pid);
  return Boolean(current && current.start === identity.start && !['Z', 'X', 'x'].includes(current.state));
};
function identities(root) {
  return ['entry', 'worker', 'grandchild'].filter(role => existsSync(join(root, `${role}.json`)))
    .map(role => ({ role, ...JSON.parse(readFileSync(join(root, `${role}.json`), 'utf8')) }));
}
function events(root, role) {
  const path = join(root, `${role}.jsonl`);
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
}
async function clean(root) {
  for (const identity of identities(root)) if (live(identity)) process.kill(identity.pid, 'SIGKILL');
  await rm(root, { recursive: true, force: true });
}
async function waitFor(check) {
  const until = Date.now() + 3000;
  while (!check()) { if (Date.now() > until) throw new Error('real process fixture did not become ready'); await pause(10); }
}

test('Linux evaluation group owns real entry, descendants, output and signal escalation', { skip: process.platform !== 'linux' }, async t => {
  const point = (name, fn) => t.test(name, fn);
  for (const mode of ['success', 'failure', 'direct', 'tree', 'ignore-entry', 'ignore-grandchild', 'background-success', 'background-failure', 'overflow']) {
    const root = await mkdtemp(join(tmpdir(), `aleph-evaluation-${mode}-`));
    try {
      let result;
      let error;
      const before = Date.now();
      try {
        result = await runEvaluation('python3', [fixture, root, mode], {
          cwd: root, env: { ALEPH_SOLUTION_DIR: root }, timeout: 500, graceMs: 80, killWaitMs: 1000,
          ...(mode === 'overflow' ? { maxBuffer: 1024 } : {}),
        });
      } catch (failure) { error = failure; }
      const returned = Date.now();
      const records = identities(root);
      await point(`${mode}: entry really executed in requested cwd and environment`, () => {
        assert.equal(records[0]?.cwd, root);
        assert.equal(records[0]?.solution, root);
      });
      await point(`${mode}: owned session and group are isolated from Host`, () => {
        assert.equal(records[0]?.pgid, records[0]?.pid);
        assert.equal(records[0]?.sid, records[0]?.pid);
        assert.notEqual(records[0]?.pgid, proc(process.pid).group);
      });
      await point(`${mode}: all observed real owned processes stopped before return`, () => {
        assert.ok(records.length > 0);
        assert.deepEqual(records.filter(live), []);
      });
      if (['success', 'background-success'].includes(mode)) {
        await point(`${mode}: valid score output remains parseable`, () => {
          assert.equal(error, undefined);
          assert.equal(JSON.parse(result.stdout).score, mode === 'success' ? 17 : 19);
        });
      } else {
        await point(`${mode}: failure retains its actual category and safe-stop marker`, () => {
          assert.equal(result, undefined);
          assert.equal(error?.evaluationStopped, true);
          assert.equal(error?.code, mode === 'failure' ? 7 : mode === 'background-failure' ? 9
            : mode === 'overflow' ? 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' : 'ETIMEDOUT');
        });
      }
      if (['tree', 'ignore-entry', 'ignore-grandchild', 'background-success', 'background-failure'].includes(mode)) {
        await point(`${mode}: worker and grandchild are ordinary owned descendants`, () => {
          assert.equal(records.length, 3);
          assert.equal(records[1].ppid, records[0].pid);
          assert.equal(records[2].ppid, records[1].pid);
          assert.ok(records.every(identity => identity.pgid === records[0].pid));
        });
        await pause(60);
        await point(`${mode}: descendant heartbeats do not continue after return`, () => {
          assert.ok(!events(root, 'grandchild').some(event => event.kind === 'heartbeat' && event.at / 1e6 > returned));
        });
      }
      if (mode === 'success') {
        await point('successful output preserves UTF-8 and stderr', () => {
          assert.equal(JSON.parse(result.stdout).text, '评估成功');
          assert.match(result.stderr, /evaluation warning/);
        });
      }
      if (mode === 'ignore-entry' || mode === 'ignore-grandchild') {
        await point(`${mode}: ignored TERM receives real escalation before bounded failure`, () => {
          const role = mode === 'ignore-entry' ? 'entry' : 'grandchild';
          assert.ok(events(root, role).some(event => event.kind === 'signal' && event.signal === 15));
          assert.ok(returned - before >= 550 && returned - before < 4000);
          assert.equal(live(records.find(identity => identity.role === role)), false);
        });
      }
      if (mode === 'overflow') {
        await point('output overflow preserves bounded stdout for diagnosis', () => assert.equal(Buffer.byteLength(error.stdout), 1024));
      }
    } finally { await clean(root); }
  }
  await point('spawn failure retains ENOENT and allows safe cleanup', async () => {
    await assert.rejects(runEvaluation('/not/an/aleph-evaluator', [], { timeout: 100 }), error => error.code === 'ENOENT' && error.evaluationStopped === true);
  });
  const root = await mkdtemp(join(tmpdir(), 'aleph-evaluation-unrelated-'));
  const unrelated = spawn('python3', [fixture, root, 'direct'], { detached: true, stdio: 'ignore' });
  try {
    await waitFor(() => identities(root).length === 1);
    const sentinel = identities(root)[0];
    await point('timeout leaves another owned session running even from the same cwd', async () => {
      await assert.rejects(runEvaluation('python3', ['-c', 'import time;time.sleep(10)'], {
        cwd: root, timeout: 100, graceMs: 40, killWaitMs: 1000,
      }), { code: 'ETIMEDOUT' });
      assert.equal(live(sentinel), true);
    });
  } finally {
    const exited = new Promise(resolve => unrelated.once('exit', resolve));
    unrelated.kill('SIGKILL');
    await exited;
    await clean(root);
  }
});

function memoryTable() {
  const data = new Map();
  return { get: id => data.get(id), put: async (id, value) => data.set(id, value), entries: () => data.entries() };
}

test('evaluation service stops computation before Git cleanup and preserves researcher worktrees', { skip: process.platform !== 'linux' }, async t => {
  const point = (name, fn) => t.test(name, fn);
  for (const [scope, mode, owned] of [['normal', 'success', false], ['nonzero', 'failure', false],
    ['timeout-temporary', 'ignore-grandchild', false], ['timeout-owned', 'tree', true]]) {
    const root = await mkdtemp(join(tmpdir(), `aleph-evaluation-service-${scope}-`));
    const gate = join(root, 'observations');
    try {
      await mkdir(gate);
      const table = memoryTable();
      const service = new ProjectService({}, { table: () => table }, {});
      const evaluator = join(root, 'evaluator');
      await mkdir(evaluator);
      const p = await service.init({ workspace: root, evalRoot: evaluator,
        evalCommand: `python3 ${quote(fixture)} ${quote(gate)} ${quote(mode)}` });
      await writeFile(join(p.researchRoot, 'algorithm.txt'), 'research input\n');
      git(p.researchRoot, ['add', 'algorithm.txt']);
      git(p.researchRoot, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'research input']);
      const before = git(p.researchRoot, ['rev-parse', 'HEAD']);
      const agent = { id: `${scope}-researcher` };
      let ownWorktree;
      if (owned) {
        ownWorktree = join(root, 'owned-research');
        git(p.researchRoot, ['worktree', 'add', '-b', 'research/owned', ownWorktree]);
        await service.mutate(p.id, current => ({ ...current, agents: [{ role: 'researcher', childId: agent.id,
          worktree: ownWorktree, branch: 'research/owned', status: 'running', summary: null, updatedAt: new Date().toISOString() }] }));
      }
      let result;
      let error;
      const evaluation = service.evaluate({ projectId: p.id, agent }).then(value => ({ result: value }), failure => ({ error: failure }));
      if (owned) {
        // Admission requires committed input; later edits remain in the source,
        // while computation and process cleanup operate on a separate snapshot.
        await waitFor(() => existsSync(join(gate, 'entry.json')));
        await writeFile(join(ownWorktree, 'uncommitted.txt'), 'retain research\n');
      }
      ({ result, error } = await evaluation);
      const stoppedAt = Date.now();
      const records = identities(gate);
      const solution = records[0].solution;
      const state = service.get(p.id);
      await point(`${scope}: evaluator cwd uses evalRoot while solution is the research code`, () => {
        assert.equal(records[0].cwd, evaluator);
        assert.notEqual(records[0].solution, evaluator);
      });
      await point(`${scope}: no owned real calculation survives service completion`, () => assert.deepEqual(records.filter(live), []));
      await point(`${scope}: stopped evaluation snapshot is removed while the source remains`, () => {
        assert.equal(existsSync(solution), false);
        assert.equal(git(p.researchRoot, ['worktree', 'list', '--porcelain']).includes(solution), false);
        if (owned) {
          assert.ok(existsSync(ownWorktree));
          assert.ok(git(p.researchRoot, ['worktree', 'list', '--porcelain']).includes(ownWorktree));
        }
      });
      await point(`${scope}: evaluator and project directories remain`, () => assert.ok(existsSync(evaluator) && existsSync(root)));
      if (mode === 'success') {
        await point('normal: score, evaluated commit and independent report ref remain correct', () => {
          assert.equal(error, undefined);
          assert.equal(result.score, 17);
          assert.equal(result.evaluatedCommit, before);
          assert.equal(git(p.researchRoot, ['rev-parse', result.evaluationRef]), result.researchCommit);
        });
        await point('normal: best and history record only completed evaluation', () => {
          assert.equal(state.evaluations.length, 1);
          assert.equal(state.best.score, 17);
        });
      } else {
        await point(`${scope}: original failure category remains visible`, () => assert.equal(error?.code, mode === 'failure' ? 7 : 'ETIMEDOUT'));
        await point(`${scope}: no failed result enters history or best`, () => {
          assert.equal(result, undefined);
          assert.equal((state.evaluations ?? []).length, 0);
          assert.equal(state.best ?? null, null);
        });
        await point(`${scope}: research source branch remains at original commit`, () => assert.equal(git(p.researchRoot, ['rev-parse', 'HEAD']), before));
      }
      if (mode === 'tree' || mode === 'ignore-grandchild') {
        await pause(60);
        await point(`${scope}: no descendant observed premature solution deletion`, () => {
          assert.ok(events(gate, 'grandchild').some(event => event.kind === 'heartbeat'));
          assert.ok(events(gate, 'grandchild').every(event => event.solutionExists));
          assert.ok(!events(gate, 'grandchild').some(event => event.at / 1e6 > stoppedAt));
        });
      }
      if (owned) await point('owned timeout preserves uncommitted research', () => assert.equal(readFileSync(join(ownWorktree, 'uncommitted.txt'), 'utf8'), 'retain research\n'));
    } finally {
      if (existsSync(gate)) await clean(gate);
      await rm(root, { recursive: true, force: true });
    }
  }
});

// Only the tagged integration helper injects /proc observation denial. Signals,
// subprocesses, Git and subsequent recovery remain real throughout this test.
test('uncertain process cleanup retains code and blocks retries until recovery', { skip: process.platform !== 'linux' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'aleph-evaluation-uncertain-'));
  const gate = join(root, 'observations');
  const nextGate = join(root, 'next-observations');
  try {
    await mkdir(gate);
    await mkdir(nextGate);
    const table = memoryTable();
    const service = new ProjectService({}, { table: () => table }, {});
    const p = await service.init({ workspace: root,
      evalCommand: `python3 ${quote(fixture)} ${quote(gate)} direct` });
    const before = git(p.researchRoot, ['rev-parse', 'HEAD']);
    globalThis.__alephEvaluationProcFault = true;
    let error;
    try { await service.evaluate({ projectId: p.id, agent: { id: 'uncertain' } }); }
    catch (failure) { error = failure; }
    const entry = identities(gate)[0];
    const retained = entry.solution;
    await t.test('observation uncertainty reports diagnostic cleanup failure', () => {
      assert.equal(error?.code, 'ALEPH_EVALUATION_CLEANUP');
      assert.equal(error?.evaluationStopped, false);
      assert.match(error?.message, /injected proc observation denial/);
      assert.match(error?.message, /research worktree retained at/);
      assert.equal(error?.cause?.code, 'ETIMEDOUT');
    });
    await t.test('real unresolved evaluator and solution remain for safe recovery', () => {
      assert.equal(live(entry), true);
      assert.equal(existsSync(retained), true);
      assert.ok(git(p.researchRoot, ['worktree', 'list', '--porcelain']).includes(retained));
    });
    const registrations = git(p.researchRoot, ['worktree', 'list', '--porcelain']);
    await t.test('retry fails before creating another worktree or evaluator', async () => {
      await assert.rejects(service.evaluate({ projectId: p.id, agent: { id: 'uncertain' } }), /injected proc observation denial/);
      assert.equal(git(p.researchRoot, ['worktree', 'list', '--porcelain']), registrations);
      assert.equal(identities(gate)[0].pid, entry.pid);
      assert.equal(live(entry), true);
    });
    await t.test('unresolved evaluation records no report or best result', () => {
      assert.equal((service.get(p.id).evaluations ?? []).length, 0);
      assert.equal(service.get(p.id).best ?? null, null);
      assert.equal(git(p.researchRoot, ['rev-parse', 'HEAD']), before);
    });
    globalThis.__alephEvaluationProcFault = false;
    await service.mutate(p.id, current => ({ ...current, evalCommand: `python3 ${quote(fixture)} ${quote(nextGate)} success` }));
    const result = await service.evaluate({ projectId: p.id, agent: { id: 'uncertain' } });
    await t.test('recovery stops exact previous process before another evaluation succeeds', () => {
      assert.equal(live(entry), false);
      assert.equal(result.score, 17);
      assert.equal(service.get(p.id).evaluations.length, 1);
      assert.equal(service.evaluationCleanup.has(p.id), false);
    });
    await t.test('recovery keeps the previously retained research code available', () => {
      assert.equal(existsSync(retained), true);
      assert.ok(events(gate, 'entry').every(event => event.solutionExists));
      assert.equal(existsSync(identities(nextGate)[0].solution), false);
    });
  } finally {
    delete globalThis.__alephEvaluationProcFault;
    if (existsSync(gate)) await clean(gate);
    if (existsSync(nextGate)) await clean(nextGate);
    await rm(root, { recursive: true, force: true });
  }
});
