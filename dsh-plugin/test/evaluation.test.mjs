import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ProjectService } from '../index-v2.js';

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture(scope) {
  const root = await mkdtemp(join(tmpdir(), `aleph-evaluation-product-${scope}-`));
  const workspace = join(root, 'workspace');
  const ready = join(root, 'ready.json');
  const release = join(root, 'release');
  const runner = join(root, 'evaluate.py');
  const records = new Map();
  const table = {
    get: id => records.has(id) ? structuredClone(records.get(id)) : undefined,
    put: async (id, value) => records.set(id, structuredClone(value)),
    entries: () => [...records].map(([id, value]) => [id, structuredClone(value)]),
  };
  await mkdir(workspace);
  await writeFile(runner, `import json,os,pathlib,subprocess,time
root=pathlib.Path(${JSON.stringify(root)})
algorithm=pathlib.Path('algorithm.txt').read_text().strip()
(root/'ready.json').write_text(json.dumps({'algorithm':algorithm,'cwd':os.getcwd(),'solution':os.environ['ALEPH_SOLUTION_DIR']}))
deadline=time.monotonic()+15
while not (root/'release').exists():
 if time.monotonic()>deadline:raise RuntimeError('test release timeout')
 time.sleep(.01)
if ${scope === 'mutating' ? 'True' : 'False'}:
 pathlib.Path('algorithm.txt').write_text('evaluator-generated-content\\n')
 subprocess.run(['git','add','algorithm.txt'],check=True)
print(json.dumps({'score':11,'algorithm':algorithm}))
`);
  const service = new ProjectService({}, { table: () => table }, {});
  const project = await service.init({ workspace, evalCommand: `python3 ${quote(runner)}` });
  const repo = project.researchRoot;
  const commit = message => {
    git(repo, 'add', '-A');
    git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', message);
    return git(repo, 'rev-parse', 'HEAD');
  };
  git(repo, 'switch', '-c', 'research/a');
  await writeFile(join(repo, 'algorithm.txt'), 'algorithm-a\n');
  const source = commit('algorithm a');
  git(repo, 'switch', '-c', 'research/b');
  await writeFile(join(repo, 'algorithm.txt'), 'algorithm-b\n');
  const other = commit('algorithm b');
  git(repo, 'switch', 'research/a');
  return { root, workspace, ready, release, repo, source, other, commit, service, project, table };
}

async function waitReady(f) {
  const deadline = Date.now() + 10000;
  while (!existsSync(f.ready)) {
    if (Date.now() > deadline) throw new Error('evaluation did not reach its real Python evaluator');
    await pause(10);
  }
  return JSON.parse(await readFile(f.ready, 'utf8'));
}

test('evaluation report preserves evaluated code and concurrent research history', async t => {
  const points = async (scope, checks) => {
    for (const [name, verify] of checks) await t.test(`${scope}: ${name}`, verify);
  };
  for (const scope of ['stable', 'switch', 'advance', 'dirty', 'mutating', 'detached']) {
    const f = await fixture(scope);
    let pending;
    try {
      if (scope === 'detached') git(f.repo, 'switch', '--detach', f.source);
      if (scope === 'dirty') {
        await writeFile(join(f.repo, 'algorithm.txt'), 'staged-next-algorithm\n');
        git(f.repo, 'add', 'algorithm.txt');
        await writeFile(join(f.repo, 'notes.txt'), 'untracked research notes\n');
      }
      pending = f.service.evaluate({ projectId: f.project.id, agent: { id: 'researcher-a' } });
      const input = await waitReady(f);
      let advance = null;
      if (scope === 'switch') git(f.repo, 'switch', 'research/b');
      if (scope === 'advance') {
        await writeFile(join(f.repo, 'algorithm.txt'), 'algorithm-a-revised\n');
        advance = f.commit('continued research while evaluation runs');
      }
      await writeFile(f.release, 'release');
      const result = await pending;
      const report = git(f.repo, 'show', '-s', '--format=%B', result.researchCommit);
      await points(scope, [
        ['real evaluator reads original committed algorithm', () => assert.equal(input.algorithm, 'algorithm-a')],
        ['real evaluator uses isolated solution directory', () => { assert.equal(input.cwd, input.solution); assert.notEqual(input.cwd, f.repo); }],
        ['successful result identifies project and score', () => { assert.equal(result.status, 'done'); assert.equal(result.projectId, f.project.id); assert.equal(result.score, 11); }],
        ['stdout identifies actual evaluated algorithm', () => assert.equal(JSON.parse(result.stdout).algorithm, 'algorithm-a')],
        ['report parent is evaluated source', () => assert.equal(git(f.repo, 'rev-parse', `${result.researchCommit}^`), f.source)],
        ['report tree preserves evaluated code', () => assert.equal(git(f.repo, 'show', `${result.researchCommit}:algorithm.txt`), 'algorithm-a')],
        ['report records score and explicit source identity', () => { assert.match(report, /Aleph-Evaluation: 11/); assert.ok(report.includes(`Aleph-Research-Commit: ${f.source}`)); }],
        ['tool returns actual evaluated source identity', () => assert.equal(result.evaluatedCommit, f.source)],
        ['independent report reference retains result', () => assert.equal(git(f.repo, 'rev-parse', result.evaluationRef), result.researchCommit)],
        ['unrelated research branch is unchanged', () => assert.equal(git(f.repo, 'rev-parse', 'research/b'), f.other)],
        ['evaluation worktree directory is removed', () => assert.equal(existsSync(input.cwd), false)],
        ['evaluation worktree registration is removed', () => assert.ok(!git(f.repo, 'worktree', 'list', '--porcelain').includes(input.cwd))],
      ]);
      if (scope === 'advance') {
        await points(scope, [
          ['advanced branch tip remains unchanged', () => assert.equal(git(f.repo, 'rev-parse', 'research/a'), advance)],
          ['advanced working files remain unchanged', async () => assert.equal(await readFile(join(f.repo, 'algorithm.txt'), 'utf8'), 'algorithm-a-revised\n')],
          ['result explicitly reports no source branch update', () => assert.equal(result.researchBranchUpdated, false)],
          ['independent report survives Git garbage collection', () => { git(f.repo, 'gc', '--prune=now'); assert.equal(git(f.repo, 'cat-file', '-t', result.researchCommit), 'commit'); }],
        ]);
      } else if (scope === 'detached') {
        await points(scope, [
          ['shared detached HEAD remains at evaluated source', () => assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.source)],
          ['source branch remains unchanged for detached caller', () => assert.equal(git(f.repo, 'rev-parse', 'research/a'), f.source)],
          ['result explicitly reports no branch update', () => assert.equal(result.researchBranchUpdated, false)],
        ]);
      } else {
        await points(scope, [
          ['unchanged source branch receives its report', () => assert.equal(git(f.repo, 'rev-parse', 'research/a'), result.researchCommit)],
          ['result identifies successful source branch update', () => assert.equal(result.researchBranchUpdated, true)],
        ]);
      }
      if (scope === 'switch') await points(scope, [
        ['shared checkout remains on other branch', () => assert.equal(git(f.repo, 'branch', '--show-current'), 'research/b')],
        ['other algorithm working files remain intact', async () => assert.equal(await readFile(join(f.repo, 'algorithm.txt'), 'utf8'), 'algorithm-b\n')],
      ]);
      if (scope === 'dirty') await points(scope, [
        ['shared staged changes are not consumed by report', () => assert.equal(git(f.repo, 'show', ':algorithm.txt'), 'staged-next-algorithm')],
        ['shared working file remains staged new algorithm', async () => assert.equal(await readFile(join(f.repo, 'algorithm.txt'), 'utf8'), 'staged-next-algorithm\n')],
        ['untracked research notes remain intact', async () => assert.equal(await readFile(join(f.repo, 'notes.txt'), 'utf8'), 'untracked research notes\n')],
        ['report does not include unrelated research notes', () => assert.ok(!git(f.repo, 'ls-tree', '--name-only', result.researchCommit).includes('notes.txt'))],
      ]);
      if (scope === 'mutating') await points(scope, [
        ['report tree equals original tree despite evaluator staging', () => assert.equal(git(f.repo, 'rev-parse', `${result.researchCommit}^{tree}`), git(f.repo, 'rev-parse', `${f.source}^{tree}`))],
        ['evaluator output never changes shared working file', async () => assert.equal(await readFile(join(f.repo, 'algorithm.txt'), 'utf8'), 'algorithm-a\n')],
      ]);
    } finally {
      await writeFile(f.release, 'release');
      if (pending) await pending.catch(() => {});
      await rm(f.root, { recursive: true, force: true });
    }
  }

  const f = await fixture('failure');
  try {
    const project = f.table.get(f.project.id);
    project.evalCommand = 'printf evaluator-error >&2; exit 9';
    await f.table.put(project.id, project);
    await points('failure', [
      ['nonzero evaluator exit is returned as failure', async () => assert.rejects(f.service.evaluate({ projectId: project.id, agent: { id: 'a' } }), /evaluator-error/)],
      ['failed evaluation does not update source branch', () => assert.equal(git(f.repo, 'rev-parse', 'research/a'), f.source)],
      ['failed evaluation creates no report reference', () => assert.equal(git(f.repo, 'for-each-ref', '--format=%(refname)', 'refs/aleph/evaluations'), '')],
      ['failed evaluation removes all extra worktree registrations', () => assert.equal(git(f.repo, 'worktree', 'list', '--porcelain').split('\n').filter(line => line.startsWith('worktree ')).length, 1)],
    ]);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
