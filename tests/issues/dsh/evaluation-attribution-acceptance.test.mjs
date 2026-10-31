import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const source = resolve(process.env.ALEPH_CURRENT_SOURCE || '/home/paulus-chang/项目/aleph');
const { apply } = await import(pathToFileURL(join(source, 'dsh-plugin/index-v2.js')));
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
async function fixture(scope) {
  const root = mkdtempSync(join(tmpdir(), 'aleph-evaluation-' + scope + '-'));
  const workspace = join(root, 'workspace'); mkdirSync(workspace);
  const ready = join(root, 'ready.json'); const release = join(root, 'release');
  const runner = join(root, 'evaluate.py');
  writeFileSync(runner, `import json,os,pathlib,time\nroot=pathlib.Path(${JSON.stringify(root)})\nalgorithm=pathlib.Path('algorithm.txt').read_text().strip()\nrecord={'algorithm':algorithm,'cwd':os.getcwd(),'solution':os.environ['ALEPH_SOLUTION_DIR']}\n(root/'ready.json').write_text(json.dumps(record))\nend=time.monotonic()+15\nwhile not (root/'release').exists():\n if time.monotonic()>end:raise RuntimeError('fixture release timeout')\n time.sleep(.01)\nprint(json.dumps({'score':11 if algorithm=='algorithm-a' else 29,'algorithm':algorithm}))\n`);
  const records = new Map(); const tools = new Map();
  const table = { get: id => records.has(id) ? structuredClone(records.get(id)) : undefined,
    entries: () => [...records].map(([id, value]) => [id, structuredClone(value)]),
    put: async (id, value) => records.set(id, structuredClone(value)) };
  await apply({ storageDomain: { open: async () => ({ table: () => table, close: async () => {} }) },
    get: name => ({ sessions: { get: () => ({ header: { cwd: workspace } }) },
      agentPresets: { presetForSession: () => 'aleph' }, subagents: {} })[name],
    effect: () => {}, tools: { register: d => { tools.set(d.name, d); return () => {}; } },
    webServer: { register: () => {} } });
  const invoke = (name, args) => tools.get(name).execute(args, { agent: { id: scope + '-caller' } });
  const project = await invoke('aleph_init_project', { workspace, eval_command: 'python3 ' + quote(runner) });
  const repo = project.researchRoot;
  const commit = message => { git(repo, 'add', '-A'); git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', message); return git(repo, 'rev-parse', 'HEAD'); };
  git(repo, 'switch', '-c', 'research/a'); writeFileSync(join(repo, 'algorithm.txt'), 'algorithm-a\n');
  const captured = commit('algorithm a');
  git(repo, 'switch', '-c', 'research/b'); writeFileSync(join(repo, 'algorithm.txt'), 'algorithm-b\n');
  const other = commit('algorithm b'); git(repo, 'switch', 'research/a');
  return { root, repo, project, captured, other, ready, release, invoke, commit, table };
}

test('ALEPH-15 evaluation scores and report commits retain actual evaluated source', async t => {
  const observations = [];
  const points = async (scope, checks) => { for (const [name, check] of checks) await t.test(scope + ': ' + name, check); };
  for (const scope of ['stable', 'switch', 'advance']) {
    const f = await fixture(scope); let pending; let evaluated;
    try {
      pending = f.invoke('aleph_evaluate', { project_id: f.project.id });
      const deadline = Date.now() + 10000;
      while (!existsSync(f.ready)) { if (Date.now() > deadline) throw new Error('actual evaluation did not start'); await sleep(10); }
      evaluated = JSON.parse(readFileSync(f.ready, 'utf8'));
      await points(scope + '/input', [
        ['actual evaluator reads algorithm a', () => assert.equal(evaluated.algorithm, 'algorithm-a')],
        ['actual evaluator runs in solution worktree', () => assert.equal(evaluated.cwd, evaluated.solution)],
        ['evaluation directory differs from shared repository', () => assert.notEqual(evaluated.cwd, f.repo)],
        ['evaluation snapshot is captured original commit', () => assert.equal(git(evaluated.cwd, 'rev-parse', 'HEAD'), f.captured)],
        ['evaluation worktree is detached', () => assert.equal(git(evaluated.cwd, 'rev-parse', '--abbrev-ref', 'HEAD'), 'HEAD')],
      ]);
      let advanced = null;
      if (scope === 'switch') git(f.repo, 'switch', 'research/b');
      if (scope === 'advance') { writeFileSync(join(f.repo, 'algorithm.txt'), 'algorithm-a-revised\n'); advanced = f.commit('new research while evaluation waits'); }
      const branchDuring = git(f.repo, 'branch', '--show-current');
      writeFileSync(f.release, 'release');
      const result = await pending;
      const report = git(f.repo, 'show', '-s', '--format=%B', result.researchCommit);
      const parent = git(f.repo, 'rev-parse', result.researchCommit + '^');
      const returnedAlgorithm = git(f.repo, 'show', result.researchCommit + ':algorithm.txt');
      await points(scope + '/report', [
        ['tool records completed evaluation', () => assert.equal(result.status, 'done')],
        ['tool returns same project identity', () => assert.equal(result.projectId, f.project.id)],
        ['score comes from actual algorithm a', () => assert.equal(result.score, 11)],
        ['stdout identifies actual algorithm a', () => assert.equal(JSON.parse(result.stdout.trim()).algorithm, 'algorithm-a')],
        ['successful evaluation emits no stderr', () => assert.equal(result.stderr, '')],
        ['returned research commit exists', () => assert.equal(git(f.repo, 'cat-file', '-t', result.researchCommit), 'commit')],
        ['report contains matching score trailer', () => assert.match(report, /Aleph-Evaluation: 11/)],
        ['report contains evaluated algorithm identity', () => assert.match(report, /"algorithm": "algorithm-a"/)],
        ['report parent is actual evaluated source', () => assert.equal(parent, f.captured)],
        ['returned report tree contains actual evaluated algorithm', () => assert.equal(returnedAlgorithm, 'algorithm-a')],
        ['unrelated research b receives no evaluation commit', () => assert.equal(git(f.repo, 'rev-parse', 'research/b'), f.other)],
        ['evaluation worktree is removed after completion', () => assert.equal(existsSync(evaluated.cwd), false)],
        ['Git worktree registration is removed', () => assert.ok(!git(f.repo, 'worktree', 'list', '--porcelain').includes(evaluated.cwd))],
        ['evaluation does not create compute missions', () => assert.deepEqual(f.table.get(f.project.id).missions, [])],
      ]);
      if (scope === 'advance') await points(scope + '/preservation', [
        ['new research commit remains reachable from own branch', () => assert.equal(git(f.repo, 'merge-base', '--is-ancestor', advanced, 'research/a'), '')],
        ['new research working file is preserved', () => assert.equal(readFileSync(join(f.repo, 'algorithm.txt'), 'utf8').trim(), 'algorithm-a-revised')],
      ]);
      observations.push({ scope, root: f.root, project: f.project.id, captured: f.captured, other: f.other,
        advanced, evaluated, branchDuring, result, report, parent, returnedAlgorithm });
    } finally { writeFileSync(f.release, 'release'); if (pending) await pending.catch(() => {}); }
  }
  if (process.env.ALEPH_EVALUATION_OBSERVATIONS) writeFileSync(process.env.ALEPH_EVALUATION_OBSERVATIONS,
    JSON.stringify({ source, source_sha: git(source, 'rev-parse', 'HEAD'),
      boundary: 'Actual registered tools, ProjectService, Git research repositories, detached worktrees, real Python evaluator and commits. In-memory storage and caller/session services replace DSH services. Evaluator pause only controls time for real branch switch/advance. No product source modification.',
      observations }, null, 2));
});
