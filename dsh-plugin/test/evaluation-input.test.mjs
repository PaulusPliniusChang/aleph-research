import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ProjectService, apply } from '../index-v2.js';

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const quote = text => "'" + text.replaceAll("'", "'\\''") + "'";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const commit = (repo, message) => { git(repo, 'add', '-A'); git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', message); return git(repo, 'rev-parse', 'HEAD'); };
function memoryTable() {
  const values = new Map();
  return { get: id => values.get(id), put: async (id, value) => values.set(id, value), entries: () => values.entries() };
}
async function until(check) {
  const end = Date.now() + 5000;
  while (!check()) { if (Date.now() > end) throw new Error('evaluation fixture timeout'); await pause(10); }
}
async function fixture({ owned = true, gated = false, ownerPath = 'owned research' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'aleph-19-中文 '));
  const gate = join(root, 'gate'); const evaluator = join(root, 'evaluator');
  await mkdir(gate); await mkdir(evaluator);
  const script = join(evaluator, 'evaluate.py');
  await writeFile(script, `import json,os,time\nfrom pathlib import Path\nimport subprocess\ng=Path(${JSON.stringify(gate)})\ns=Path(os.environ['ALEPH_SOLUTION_DIR'])\ng.joinpath('started.json').write_text(json.dumps({'solution':str(s),'cwd':os.getcwd(),'head':subprocess.check_output(['git','-C',str(s),'rev-parse','HEAD'],text=True).strip(),'branch':subprocess.run(['git','-C',str(s),'symbolic-ref','--quiet','HEAD'],capture_output=True,text=True).stdout.strip()}))\nif ${gated ? 'True' : 'False'}:\n end=time.monotonic()+12\n while not g.joinpath('release').exists():\n  if time.monotonic()>end: raise RuntimeError('release deadline')\n  time.sleep(.01)\na=s.joinpath('algorithm.txt').read_text().strip()\ne=s.joinpath('extra.txt').read_text().strip() if s.joinpath('extra.txt').exists() else None\nr={'algorithm':a,'extra':e,'score':int(a)+(int(e) if e else 0)}\ns.joinpath('generated.txt').write_text('evaluation output')\ng.joinpath('read.json').write_text(json.dumps(r))\nprint(json.dumps(r))\n`);
  const table = memoryTable(); const service = new ProjectService({}, { table: () => table }, {});
  const project = await service.init({ workspace: root, evalRoot: evaluator, evalCommand: 'python3 ' + quote(script) });
  await writeFile(join(project.researchRoot, 'algorithm.txt'), '3\n');
  await writeFile(join(project.researchRoot, '.gitignore'), 'ignored.txt\n');
  const base = commit(project.researchRoot, 'algorithm 3');
  const agent = { id: 'researcher-19' }; const branch = 'research/input';
  const source = owned ? join(root, ownerPath) : project.researchRoot;
  if (owned) {
    git(project.researchRoot, 'worktree', 'add', '-b', branch, source);
    await service.mutate(project.id, p => ({ ...p, agents: [{ role: 'researcher', childId: agent.id, worktree: source, branch, status: 'running', summary: null, updatedAt: new Date().toISOString() }] }));
  }
  return { root, gate, evaluator, script, table, service, project, base, agent, branch, source,
    evaluate: extra => service.evaluate({ projectId: project.id, agent, ...extra }),
    entry: () => JSON.parse(readFileSync(join(gate, 'started.json'), 'utf8')),
    read: () => JSON.parse(readFileSync(join(gate, 'read.json'), 'utf8')),
    release: () => writeFileSync(join(gate, 'release'), 'release'),
    close: async () => { writeFileSync(join(gate, 'release'), 'release'); await rm(root, { recursive: true, force: true }); },
  };
}
async function rejection(f, extra) {
  const before = git(f.source, 'status', '--porcelain=v1', '-z', '--untracked-files=all');
  const index = git(f.source, 'ls-files', '--stage', '-z');
  const refs = git(f.project.researchRoot, 'show-ref');
  const registration = git(f.project.researchRoot, 'worktree', 'list', '--porcelain');
  let failure;
  try { await f.evaluate(extra); } catch (error) { failure = error; }
  assert.equal(failure?.code, 'ALEPH_EVALUATION_UNCOMMITTED');
  assert.equal(failure.worktree, f.source);
  assert.match(failure.message, /Commit the listed changes and untracked files, then retry/);
  assert.equal(existsSync(join(f.gate, 'started.json')), false);
  assert.equal(git(f.source, 'status', '--porcelain=v1', '-z', '--untracked-files=all'), before);
  assert.equal(git(f.source, 'ls-files', '--stage', '-z'), index);
  assert.equal(git(f.project.researchRoot, 'show-ref'), refs);
  assert.equal(git(f.project.researchRoot, 'worktree', 'list', '--porcelain'), registration);
  assert.equal((f.service.get(f.project.id).evaluations ?? []).length, 0);
  assert.equal(f.service.get(f.project.id).best ?? null, null);
  return failure;
}

test('owned committed input is evaluated as an independent snapshot', async t => {
  const f = await fixture();
  try {
    const result = await f.evaluate(); const entry = f.entry(); const read = f.read();
    await t.test('Python reads a separate detached worktree at the captured commit', () => { assert.notEqual(entry.solution, f.source); assert.equal(entry.head, f.base); assert.equal(entry.branch, ''); });
    await t.test('Python-read committed input produces the expected score', () => { assert.equal(read.algorithm, '3'); assert.equal(result.score, 3); });
    await t.test('evaluator cwd remains external to the submitted solution', () => { assert.equal(entry.cwd, f.evaluator); assert.notEqual(entry.cwd, entry.solution); });
    await t.test('returned source commit identifies the actual snapshot input', () => assert.equal(result.evaluatedCommit, entry.head));
    await t.test('report parent and submitted code tree match the captured input', () => { assert.equal(git(f.source, 'rev-parse', result.researchCommit + '^'), f.base); assert.equal(git(f.source, 'show', result.researchCommit + ':algorithm.txt'), read.algorithm); assert.equal(git(f.source, 'rev-parse', result.researchCommit + '^{tree}'), git(f.source, 'rev-parse', f.base + '^{tree}')); });
    await t.test('report remains reachable after temporary snapshot removal', () => { assert.equal(existsSync(entry.solution), false); assert.equal(git(f.source, 'rev-parse', result.evaluationRef), result.researchCommit); });
    await t.test('original researcher worktree and branch identity remain available', () => { assert.ok(existsSync(f.source)); assert.equal(git(f.source, 'symbolic-ref', 'HEAD'), 'refs/heads/' + f.branch); assert.ok(git(f.source, 'worktree', 'list', '--porcelain').includes(f.source)); });
    await t.test('evaluation output is absent from original files and report tree', () => { assert.equal(existsSync(join(f.source, 'generated.txt')), false); assert.throws(() => git(f.source, 'show', result.researchCommit + ':generated.txt')); assert.equal(git(f.source, 'status', '--porcelain'), ''); });
  } finally { await f.close(); }
});

test('uncommitted selected input is rejected without changing source or publishing results', async t => {
  for (const mode of ['unstaged','staged','mixed','untracked','nested-untracked','deleted','staged-deleted','staged-new','renamed','explicit-owned','default-root','commit-retry']) {
    await t.test(mode, async () => {
      const f = await fixture({ owned: mode !== 'default-root' });
      try {
        const algorithm = join(f.source, 'algorithm.txt');
        if (['unstaged','staged','mixed','explicit-owned','default-root','commit-retry'].includes(mode)) await writeFile(algorithm, '7\n');
        if (['staged','mixed'].includes(mode)) git(f.source, 'add', 'algorithm.txt');
        if (mode === 'mixed') await writeFile(algorithm, '9\n');
        if (mode === 'untracked') await writeFile(join(f.source, 'extra.txt'), '11\n');
        if (mode === 'nested-untracked') { await mkdir(join(f.source, 'input dir')); await writeFile(join(f.source, 'input dir', 'data file.csv'), '11\n'); }
        if (mode === 'deleted') await rm(algorithm);
        if (mode === 'staged-deleted') git(f.source, 'rm', 'algorithm.txt');
        if (mode === 'staged-new') { await writeFile(join(f.source, 'extra.txt'), '11\n'); git(f.source, 'add', 'extra.txt'); }
        if (mode === 'renamed') git(f.source, 'mv', 'algorithm.txt', 'new algorithm.txt');
        const error = await rejection(f, mode === 'explicit-owned' ? { branch: f.branch } : {});
        assert.ok(error.changes.length > 0);
        if (mode === 'mixed') assert.equal(error.changes.find(c => c.path === 'algorithm.txt').status, 'MM');
        if (mode === 'commit-retry') { const submitted = commit(f.source, 'submit changed input'); const result = await f.evaluate(); assert.equal(result.score, 7); assert.equal(result.evaluatedCommit, submitted); assert.equal(git(f.source, 'show', result.researchCommit + ':algorithm.txt'), '7'); }
      } finally { await f.close(); }
    });
  }
});

test('research changes after admission cannot change the submitted input', async t => {
  const f = await fixture({ gated: true });
  try {
    const pending = f.evaluate(); await until(() => existsSync(join(f.gate, 'started.json')));
    await writeFile(join(f.source, 'algorithm.txt'), '19\n'); const advanced = commit(f.source, 'later algorithm 19');
    await writeFile(join(f.source, 'extra.txt'), '11\n');
    git(f.source, 'switch', '-c', 'research/other');
    await writeFile(join(f.source, 'algorithm.txt'), '27\n'); const other = commit(f.source, 'other branch algorithm 27');
    f.release(); const result = await pending;
    await t.test('later tracked edits and commits do not change actual Python input', () => { assert.equal(f.read().algorithm, '3'); assert.equal(result.score, 3); });
    await t.test('new untracked research files do not enter the running snapshot', () => assert.equal(f.read().extra, null));
    await t.test('CAS keeps the original branch advanced research commit', () => { assert.equal(git(f.source, 'rev-parse', f.branch), advanced); assert.equal(result.researchBranchUpdated, false); });
    await t.test('switching the original source branch cannot redirect report publication', () => { assert.equal(git(f.source, 'rev-parse', 'research/other'), other); assert.equal(git(f.source, 'symbolic-ref', 'HEAD'), 'refs/heads/research/other'); });
    await t.test('later original research contents are preserved', () => { assert.equal(readFileSync(join(f.source, 'algorithm.txt'), 'utf8'), '27\n'); assert.equal(readFileSync(join(f.source, 'extra.txt'), 'utf8'), '11\n'); });
    await t.test('report preserves the original submitted tree and source identity', () => { assert.equal(result.evaluatedCommit, f.base); assert.equal(git(f.source, 'show', result.researchCommit + ':algorithm.txt'), '3'); });
    await t.test('history and best associate the score with the submitted source', () => { const p = f.service.get(f.project.id); assert.equal(p.evaluations.at(-1).evaluatedCommit, f.base); assert.equal(p.best.commit, f.base); assert.equal(p.best.score, 3); });
    await t.test('report ref is durable without moving either research branch', () => { git(f.source, 'gc', '--prune=now'); assert.equal(git(f.source, 'rev-parse', result.evaluationRef), result.researchCommit); });
  } finally { await f.close(); }
});

test('only selected branch worktrees participate in committed input validation', async t => {
  for (const mode of ['unrelated-root-dirty','unrelated-owned-dirty','raw-commit','detached-owned','missing-ref','mission-wait','overlap','newline-worktree']) {
    await t.test(mode, async () => {
      const f = await fixture({ gated: mode === 'overlap', ownerPath: mode === 'newline-worktree' ? '研究 目录\nsecond line' : 'owned research' });
      try {
        if (mode === 'unrelated-root-dirty') { await writeFile(join(f.project.researchRoot, 'extra.txt'), '99\n'); const r = await f.evaluate({ branch: f.branch }); assert.equal(r.score, 3); assert.equal(readFileSync(join(f.project.researchRoot, 'extra.txt'), 'utf8'), '99\n'); }
        if (mode === 'unrelated-owned-dirty') { git(f.project.researchRoot, 'branch', 'research/unoccupied', f.base); await writeFile(join(f.source, 'algorithm.txt'), '17\n'); const r = await f.evaluate({ branch: 'research/unoccupied' }); assert.equal(r.score, 3); assert.equal(readFileSync(join(f.source, 'algorithm.txt'), 'utf8'), '17\n'); }
        if (mode === 'raw-commit') { await writeFile(join(f.source, 'extra.txt'), '99\n'); await writeFile(join(f.project.researchRoot, 'extra.txt'), '99\n'); const r = await f.evaluate({ branch: f.base }); assert.equal(r.score, 3); assert.equal(r.researchBranchUpdated, false); }
        if (mode === 'detached-owned') { git(f.source, 'switch', '--detach', f.base); const r = await f.evaluate(); assert.equal(r.score, 3); assert.equal(r.researchBranchUpdated, false); assert.equal(f.service.get(f.project.id).evaluations.at(-1).branch, null); }
        if (mode === 'missing-ref') { await assert.rejects(f.evaluate({ branch: 'research/absent' })); assert.equal(existsSync(join(f.gate, 'started.json')), false); assert.equal((f.service.get(f.project.id).evaluations ?? []).length, 0); }
        if (mode === 'mission-wait') { await f.service.mutate(f.project.id, p => ({ ...p, missions: [{ id: 'm-pending', ownerSession: f.agent.id, status: 'approved', branch: 'missions/pending' }] })); const r = await f.evaluate(); assert.equal(r.status, 'waiting'); assert.equal(existsSync(join(f.root, '.aleph', 'evaluations')), false); assert.equal(existsSync(join(f.gate, 'started.json')), false); }
        if (mode === 'overlap') {
          const first = f.evaluate(); await until(() => existsSync(join(f.gate, 'started.json'))); const firstDir = f.entry().solution;
          await writeFile(join(f.source, 'algorithm.txt'), '9\n'); const secondTip = commit(f.source, 'second evaluation input');
          const second = f.evaluate(); await until(() => f.entry().solution !== firstDir); const secondDir = f.entry().solution;
          assert.notEqual(firstDir, secondDir); assert.equal(readFileSync(join(firstDir, 'algorithm.txt'), 'utf8'), '3\n'); assert.equal(readFileSync(join(secondDir, 'algorithm.txt'), 'utf8'), '9\n');
          f.release(); const [a,b] = await Promise.all([first,second]); assert.equal(a.score, 3); assert.equal(b.score, 9); assert.equal(a.evaluatedCommit, f.base); assert.equal(b.evaluatedCommit, secondTip); assert.notEqual(a.evaluationRef, b.evaluationRef);
        }
        if (mode === 'newline-worktree') { await writeFile(join(f.source, 'extra.txt'), '11\n'); await rejection(f, { branch: f.branch }); }
      } finally { await f.close(); }
    });
  }
});

test('history and best retain exact submitted code across sequential results', async t => {
  const f = await fixture();
  try {
    const low = await f.evaluate();
    await writeFile(join(f.source, 'algorithm.txt'), '13\n'); const highTip = commit(f.source, 'algorithm 13'); const high = await f.evaluate();
    await writeFile(join(f.source, 'algorithm.txt'), '5\n'); const weakTip = commit(f.source, 'algorithm 5'); const weak = await f.evaluate();
    const p = f.service.get(f.project.id);
    await t.test('history records actual scores and selected commits in order', () => assert.deepEqual(p.evaluations.map(r => [r.score,r.evaluatedCommit]), [[3,f.base],[13,highTip],[5,weakTip]]));
    await t.test('best source pointer identifies highest-scoring submitted code', () => { assert.equal(p.best.score, 13); assert.equal(p.best.commit, highTip); });
    await t.test('best report and evaluation ref belong to that same high result', () => { assert.equal(p.best.researchCommit, high.researchCommit); assert.equal(p.best.evaluationRef, high.evaluationRef); });
    await t.test('all reported code trees match their actual selected source trees', () => { for (const r of [low,high,weak]) assert.equal(git(f.source, 'rev-parse', r.researchCommit+'^{tree}'), git(f.source, 'rev-parse', r.evaluatedCommit+'^{tree}')); });
    await t.test('every independent report remains reachable after branch advancement and GC', () => { git(f.source, 'gc', '--prune=now'); for (const r of [low,high,weak]) assert.equal(git(f.source, 'rev-parse', r.evaluationRef), r.researchCommit); });
    await t.test('successful evaluation neither stages outputs nor changes the source index tree', () => { assert.equal(git(f.source, 'write-tree'), git(f.source, 'rev-parse', weakTip+'^{tree}')); assert.equal(git(f.source, 'status', '--porcelain'), ''); });
  } finally { await f.close(); }
});

test('ignore semantics, precise diagnostics, and model instructions match committed-only policy', async t => {
  for (const mode of ['ignored','tracked-ignored','local-exclude','path-diagnostics','rename-diagnostics','instructions']) {
    await t.test(mode, async () => {
      const f = await fixture();
      try {
        if (mode === 'ignored') { await writeFile(join(f.source, 'ignored.txt'), 'private ignored input'); const r = await f.evaluate(); assert.equal(r.score, 3); assert.equal(readFileSync(join(f.source, 'ignored.txt'), 'utf8'), 'private ignored input'); assert.throws(() => git(f.source, 'show', r.researchCommit+':ignored.txt')); }
        if (mode === 'tracked-ignored') { await writeFile(join(f.source, 'ignored.txt'), 'committed once'); git(f.source, 'add', '-f', 'ignored.txt'); git(f.source, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'tracked ignored name'); await writeFile(join(f.source, 'ignored.txt'), 'pending tracked change'); const e = await rejection(f); assert.equal(e.changes.find(c => c.path==='ignored.txt').status, ' M'); }
        if (mode === 'local-exclude') { const exclude = git(f.source, 'rev-parse', '--git-path', 'info/exclude'); await writeFile(exclude, 'local-only.txt\n'); await writeFile(join(f.source,'local-only.txt'),'not submitted'); const r=await f.evaluate(); assert.equal(r.score,3); assert.throws(()=>git(f.source,'show',r.researchCommit+':local-only.txt')); assert.equal(existsSync(join(f.source,'local-only.txt')),true); }
        if (mode === 'path-diagnostics') { const names=['空 格.py','line\nbreak.txt',' leading.txt']; for(const name of names)await writeFile(join(f.source,name),'pending'); const e=await rejection(f); assert.deepEqual(e.changes.map(c=>c.path).sort(),names.sort()); assert.ok(e.changes.every(c=>c.status==='??')); for(const name of names)assert.ok(e.message.includes(JSON.stringify(name))); }
        if (mode === 'rename-diagnostics') { git(f.source,'mv','algorithm.txt','算法 新.py'); const e=await rejection(f); assert.deepEqual(e.changes,[{status:'R ',path:'算法 新.py',originalPath:'algorithm.txt'}]); }
        if (mode === 'instructions') {
          const tools=new Map(); const table=memoryTable();
          await apply({storageDomain:{open:async()=>({table:()=>table,close:async()=>{}})},get:()=>undefined,effect:()=>{},tools:{register:definition=>{tools.set(definition.name,definition);return()=>{};}},webServer:{register:()=>{}}});
          assert.match(tools.get('aleph_evaluate').description,/Commit all research changes and untracked files/); assert.match(tools.get('aleph_evaluate').description,/Git-ignored files are excluded/);
          let prompt; f.service.subagents={startActivation:async request=>{prompt=request.request.prompt[0].text;return {childId:'fixture-researcher',result:new Promise(()=>{}),dispose:async()=>{}};}};
          await f.service.startResearcher({projectId:f.project.id,agent:{id:'leader'}}); assert.match(prompt,/commit all research changes and untracked files before calling aleph_evaluate/); assert.match(prompt,/lists paths to commit before retrying/); assert.match(prompt,/fixed commit/);
        }
      } finally { await f.close(); }
    });
  }
});
