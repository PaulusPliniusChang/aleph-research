import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ProjectService } from '../index-v2.js';

const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
const git = (repo, ...args) => execFileSync(realGit, ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const commit = (repo, message) => {
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
};

async function fixture(label) {
  const root = await mkdtemp(join(tmpdir(), `aleph-select-${label}-`));
  const workspace = join(root, '项目 空格\nworkspace');
  await mkdir(workspace);
  const data = new Map();
  const table = {
    get: (id) => data.has(id) ? structuredClone(data.get(id)) : undefined,
    put: async (id, value) => data.set(id, structuredClone(value)),
    entries: () => [...data].map(([id, value]) => [id, structuredClone(value)]),
  };
  const service = new ProjectService({}, { table: () => table }, {});
  const project = await service.init({ workspace });
  const repo = project.researchRoot;
  await writeFile(join(repo, 'algorithm.txt'), '10\n');
  const best = commit(repo, 'best algorithm');
  await writeFile(join(repo, 'algorithm.txt'), '20\n');
  const later = commit(repo, 'later algorithm');
  git(repo, 'update-ref', 'refs/aleph/evaluations/test', best);
  await service.mutate(project.id, (current) => ({
    ...current, best: { score: 10, commit: best, branch: 'main' },
    evaluations: [{ id: 'test', evaluatedCommit: best, score: 10 }],
  }));
  return { root, service, project, repo, best, later, args: { projectId: project.id } };
}

async function dirty(repo) {
  await writeFile(join(repo, 'algorithm.txt'), '30\n');
  git(repo, 'add', 'algorithm.txt');
  await writeFile(join(repo, 'algorithm.txt'), '40\n');
  await writeFile(join(repo, 'pending.txt'), 'untracked pending input\n');
}

async function snapshot(repo) {
  return {
    head: git(repo, 'rev-parse', 'HEAD'),
    symbolic: git(repo, 'symbolic-ref', '-q', 'HEAD'),
    index: git(repo, 'write-tree'),
    status: git(repo, 'status', '--porcelain=v1', '-z', '--untracked-files=all'),
    algorithm: await readFile(join(repo, 'algorithm.txt'), 'utf8'),
    pending: await readFile(join(repo, 'pending.txt'), 'utf8').catch(() => null),
  };
}

// Only the enumeration boundary is controlled; all repo state and CAS writes
// use real Git. The race moves an unoccupied branch after the service reads it.
async function withEnumerationGate(f, mode, action) {
  const bin = join(f.root, 'bin');
  await mkdir(bin, { recursive: true });
  const config = join(f.root, 'git-gate.json');
  await writeFile(config, JSON.stringify({ realGit, mode, repo: f.repo, target: 'refs/heads/idle', tip: f.best }));
  await writeFile(join(bin, 'git'), `#!/usr/bin/env python3
import json, os, subprocess, sys
cfg = json.load(open(os.environ['ALEPH_SELECTION_GIT_GATE']))
args = sys.argv[1:]
if args[2:] == ['worktree', 'list', '--porcelain', '-z']:
    if cfg['mode'] == 'failure':
        print('controlled worktree enumeration failure', file=sys.stderr)
        sys.exit(7)
    result = subprocess.run([cfg['realGit'], *args], stdout=subprocess.PIPE)
    if result.returncode == 0 and cfg['mode'] == 'race':
        subprocess.run([cfg['realGit'], '-C', cfg['repo'], 'update-ref', cfg['target'], cfg['tip']], check=True)
    sys.stdout.buffer.write(result.stdout)
    sys.exit(result.returncode)
os.execv(cfg['realGit'], [cfg['realGit'], *args])
`, { mode: 0o755 });
  const priorPath = process.env.PATH;
  const priorGate = process.env.ALEPH_SELECTION_GIT_GATE;
  process.env.PATH = `${bin}:${priorPath}`;
  process.env.ALEPH_SELECTION_GIT_GATE = config;
  try { return await action(); }
  finally {
    process.env.PATH = priorPath;
    if (priorGate === undefined) delete process.env.ALEPH_SELECTION_GIT_GATE;
    else process.env.ALEPH_SELECTION_GIT_GATE = priorGate;
  }
}

test('selection refuses occupied target branches without altering research state', async (t) => {
  for (const linked of [false, true]) {
    for (const pending of [false, true]) {
      const scope = `${linked ? 'linked' : 'main'}-${pending ? 'dirty' : 'clean'}`;
      const f = await fixture(scope);
      try {
        const branch = linked ? 'research/目标' : 'main';
        const target = linked ? join(f.root, '关联 空格\n目录') : f.repo;
        if (linked) git(f.repo, 'worktree', 'add', '-b', branch, target, f.later);
        if (pending) await dirty(target);
        const before = await snapshot(target);
        const mainBefore = await snapshot(f.repo);
        const state = f.service.get(f.project.id);
        const refs = git(f.repo, 'for-each-ref', '--format=%(refname) %(objectname)');
        let error;
        try { await f.service.selectBest({ ...f.args, ...(linked ? { branch: `refs/heads/${branch}` } : {}) }); }
        catch (caught) { error = caught; }
        const point = (name, check) => t.test(`${scope}: ${name}`, check);
        await point('refuses before changing the checked-out target', () => assert.equal(error?.code, 'ALEPH_SELECTION_BRANCH_CHECKED_OUT'));
        await point('diagnostic returns the exact Unicode, space and newline path', () => assert.deepEqual(error.worktrees, [target]));
        await point('diagnostic identifies the exact full branch ref', () => assert.equal(error.branch, `refs/heads/${branch}`));
        await point('message gives reversible save and switch instructions', () => {
          assert.ok(error.message.includes(JSON.stringify([target])));
          assert.match(error.message, /save or commit pending changes/);
          assert.match(error.message, /switch each listed worktree away/);
        });
        await point('target HEAD and symbolic branch remain unchanged', async () => {
          const after = await snapshot(target);
          assert.equal(after.head, before.head); assert.equal(after.symbolic, before.symbolic);
        });
        await point('tracked files, staged tree and untracked inputs remain byte-identical', async () => assert.deepEqual(await snapshot(target), before));
        await point('other checked-out main repository remains unchanged', async () => assert.deepEqual(await snapshot(f.repo), mainBefore));
        await point('all branch and report references remain unchanged', () => assert.equal(git(f.repo, 'for-each-ref', '--format=%(refname) %(objectname)'), refs));
        await point('best, history and complete project state remain unchanged', () => assert.deepEqual(f.service.get(f.project.id), state));
      } finally { await rm(f.root, { recursive: true, force: true }); }
    }
  }
});

test('selection at the best tip is a no-op even for occupied dirty worktrees', async (t) => {
  for (const linked of [false, true]) {
    const f = await fixture(`noop-${linked}`);
    try {
      const branch = linked ? 'research/noop' : 'main';
      let target = f.repo;
      if (linked) {
        target = join(f.root, 'no-op 关联\n目录');
        git(f.repo, 'worktree', 'add', '-b', branch, target, f.best);
      } else {
        git(f.repo, 'switch', '--detach', f.best);
        git(f.repo, 'branch', '-f', 'main', f.best);
        git(f.repo, 'switch', 'main');
      }
      await dirty(target);
      const before = await snapshot(target);
      const refs = git(f.repo, 'for-each-ref', '--format=%(refname) %(objectname)');
      const state = f.service.get(f.project.id);
      const result = await withEnumerationGate(f, 'failure', () => f.service.selectBest({ ...f.args, branch }));
      const point = (name, check) => t.test(`${linked ? 'linked' : 'main'} no-op: ${name}`, check);
      await point('succeeds without requiring an enumeration or clean input', () => assert.equal(result.commit, f.best));
      await point('keeps response branch, previous tip and score', () => assert.deepEqual(result, { projectId: f.project.id, branch, commit: f.best, score: 10, previous: f.best }));
      await point('keeps dirty index, file bytes, HEAD and untracked input', async () => assert.deepEqual(await snapshot(target), before));
      await point('does not write any branch or report ref', () => assert.equal(git(f.repo, 'for-each-ref', '--format=%(refname) %(objectname)'), refs));
      await point('preserves project metadata without a timestamp mutation', () => assert.deepEqual(f.service.get(f.project.id), state));
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});

test('unoccupied selection uses exact branch refs and preserves unrelated worktrees', async (t) => {
  const f = await fixture('unoccupied');
  try {
    git(f.repo, 'branch', 'research/target', f.later);
    const related = join(f.root, 'other 分支\n目录');
    git(f.repo, 'worktree', 'add', '-b', 'research/target-extra', related, f.later);
    git(f.repo, 'tag', 'target-tag', f.later);
    await dirty(f.repo);
    await dirty(related);
    const before = await snapshot(f.repo), relatedBefore = await snapshot(related);
    const state = f.service.get(f.project.id);
    const reportRef = git(f.repo, 'rev-parse', 'refs/aleph/evaluations/test');
    const result = await f.service.selectBest({ ...f.args, branch: 'refs/heads/research/target' });
    await t.test('prefix-similar occupied branch does not block exact target', () => assert.equal(result.commit, f.best));
    await t.test('only the selected local branch moves to the recorded best input', () => assert.equal(git(f.repo, 'rev-parse', 'refs/heads/research/target'), f.best));
    await t.test('result records exact selected branch, old tip and score', () => assert.deepEqual(result, { projectId: f.project.id, branch: 'refs/heads/research/target', commit: f.best, score: 10, previous: f.later }));
    await t.test('unrelated dirty main worktree is preserved', async () => assert.deepEqual(await snapshot(f.repo), before));
    await t.test('prefix-similar dirty linked worktree is preserved', async () => assert.deepEqual(await snapshot(related), relatedBefore));
    await t.test('independent evaluation report ref is preserved', () => assert.equal(git(f.repo, 'rev-parse', 'refs/aleph/evaluations/test'), reportRef));
    await t.test('unrelated tag is preserved', () => assert.equal(git(f.repo, 'rev-parse', 'refs/tags/target-tag'), f.later));
    await t.test('best, evaluation history and all project metadata are preserved', () => assert.deepEqual(f.service.get(f.project.id), state));
    git(f.repo, 'switch', '--detach', f.later);
    const detachedBefore = { head: git(f.repo, 'rev-parse', 'HEAD'), index: git(f.repo, 'write-tree'), text: await readFile(join(f.repo, 'algorithm.txt'), 'utf8') };
    const defaultResult = await f.service.selectBest(f.args);
    await t.test('default main selection succeeds when only detached HEAD uses that commit', () => assert.equal(defaultResult.branch, 'main'));
    await t.test('detached HEAD is not mistaken for an occupied branch', () => assert.equal(git(f.repo, 'rev-parse', 'main'), f.best));
    await t.test('detached files, staged tree and HEAD are preserved', async () => assert.deepEqual({ head: git(f.repo, 'rev-parse', 'HEAD'), index: git(f.repo, 'write-tree'), text: await readFile(join(f.repo, 'algorithm.txt'), 'utf8') }, detachedBefore));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('enumeration failure and expected-tip conflicts cannot silently move a branch', async (t) => {
  const f = await fixture('guards');
  try {
    git(f.repo, 'branch', 'idle', f.later);
    const before = await snapshot(f.repo), state = f.service.get(f.project.id);
    let failure;
    try { await withEnumerationGate(f, 'failure', () => f.service.selectBest({ ...f.args, branch: 'idle' })); }
    catch (error) { failure = error; }
    await t.test('enumeration command failure rejects instead of assuming no worktrees', () => assert.match(String(failure), /controlled worktree enumeration failure/));
    await t.test('enumeration failure leaves the unoccupied target intact', () => assert.equal(git(f.repo, 'rev-parse', 'idle'), f.later));
    await t.test('enumeration failure preserves source files and index', async () => assert.deepEqual(await snapshot(f.repo), before));
    await t.test('enumeration failure preserves report references and metadata', () => {
      assert.equal(git(f.repo, 'rev-parse', 'refs/aleph/evaluations/test'), f.best);
      assert.deepEqual(f.service.get(f.project.id), state);
    });
    let race;
    try { await withEnumerationGate(f, 'race', () => f.service.selectBest({ ...f.args, branch: 'idle' })); }
    catch (error) { race = error; }
    await t.test('real Git compare-and-swap refuses a tip changed after initial capture', () => assert.match(String(race), /cannot lock ref.*expected/s));
    await t.test('concurrent writer tip survives the failed selection transaction', () => assert.equal(git(f.repo, 'rev-parse', 'idle'), f.best));
    await t.test('CAS conflict keeps unrelated source files and index', async () => assert.deepEqual(await snapshot(f.repo), before));
    await t.test('CAS conflict keeps best and history unchanged', () => assert.deepEqual(f.service.get(f.project.id), state));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('invalid selections fail without repurposing tags or creating missing branches', async (t) => {
  const f = await fixture('invalid');
  try {
    git(f.repo, 'tag', 'score', f.later);
    const before = await snapshot(f.repo), state = f.service.get(f.project.id);
    await t.test('explicit tag ref is refused as a non-branch target', async () => assert.rejects(() => f.service.selectBest({ ...f.args, branch: 'refs/tags/score' }), /not a local research branch/));
    await t.test('tag ref stays unchanged after invalid selection', () => assert.equal(git(f.repo, 'rev-parse', 'refs/tags/score'), f.later));
    await t.test('missing branch produces an actionable error', async () => assert.rejects(() => f.service.selectBest({ ...f.args, branch: 'absent' }), /research branch not found/));
    await t.test('missing branch is not implicitly created', () => assert.equal(git(f.repo, 'for-each-ref', '--format=%(refname)', 'refs/heads/absent'), ''));
    await t.test('missing project is refused', async () => assert.rejects(() => f.service.selectBest({ projectId: 'absent' }), /project not found/));
    await f.service.mutate(f.project.id, (current) => ({ ...current, best: null }));
    await t.test('no evaluated best rejects before branch changes', async () => assert.rejects(() => f.service.selectBest(f.args), /no evaluated best result/));
    await t.test('all invalid selections keep HEAD, working input and staged tree', async () => assert.deepEqual(await snapshot(f.repo), before));
    await t.test('invalid selections preserve evaluation history and independent report', () => {
      assert.deepEqual(f.service.get(f.project.id).evaluations, state.evaluations);
      assert.equal(git(f.repo, 'rev-parse', 'refs/aleph/evaluations/test'), f.best);
    });
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
