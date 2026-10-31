import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const source = resolve(process.env.ALEPH_CURRENT_SOURCE || '/home/paulus-chang/项目/aleph');
const { ProjectService, snapshot } = await import(pathToFileURL(join(source, 'dsh-plugin/index-v2.js')));
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ancestor = (repo, from, to) => { try { git(repo, 'merge-base', '--is-ancestor', from, to); return true; } catch (error) { if (error.status === 1) return false; throw error; } };
const commit = (repo, message) => { git(repo, 'add', '-A'); git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', message); return git(repo, 'rev-parse', 'HEAD'); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

async function fixture(scope) {
  const root = mkdtempSync(join(tmpdir(), 'aleph-post-batch-' + scope + '-'));
  const workspace = join(root, 'workspace'); mkdirSync(workspace);
  const storage = join(root, 'projects.json'); writeFileSync(storage, '{}');
  const load = () => JSON.parse(readFileSync(storage, 'utf8'));
  const table = { get: id => load()[id], entries: () => Object.entries(load()),
    put: async (id, value) => writeFileSync(storage, JSON.stringify({ ...load(), [id]: value })) };
  const service = new ProjectService({}, { table: () => table }, {});
  const project = await service.init({ workspace }); const repo = project.missionRoot;
  const branch = 'mission/train'; git(repo, 'switch', '-c', branch, 'template');
  const missionDir = join(repo, 'missions', 'train'); mkdirSync(missionDir, { recursive: true });
  writeFileSync(join(missionDir, 'mission.json'), JSON.stringify({ id: 'train', entrypoint: 'run.sh' }));
  writeFileSync(join(missionDir, 'source.txt'), 'source-original\n');
  writeFileSync(join(missionDir, 'run.sh'),
    `cat source.txt > ${quote(join(root, 'runtime-source.txt'))}\ngit rev-parse HEAD > ${quote(join(root, 'runtime-head.txt'))}\nprintf run >> ${quote(join(root, 'executions.txt'))}\ntouch ${quote(join(root, 'ready'))}\n` +
    `for n in $(seq 1 1500); do test -f ${quote(join(root, 'release'))} && break; sleep .01; done\ntest -f ${quote(join(root, 'release'))} || exit 71\nprintf complete > "$ALEPH_OUTPUT_DIR/completed.txt"\n`);
  const captured = commit(repo, 'initial training code'); git(repo, 'switch', 'template');
  const proposal = await service.propose({ projectId: project.id, branch, agent: { id: scope + '-owner' } });
  const mission = proposal.missions[0]; await service.approve({ projectId: project.id, missionId: mission.id });
  const formed = await service.formBatch({ projectId: project.id }); const batch = formed.batches[0];
  const batchTip = git(repo, 'rev-parse', batch.branch);
  const advance = () => { git(repo, 'switch', branch); writeFileSync(join(missionDir, 'source.txt'), 'source-revised\n');
    const tip = commit(repo, 'researcher correction after composition');
    if (scope !== 'checked-out') git(repo, 'switch', 'template'); return tip; };
  return { root, repo, branch, captured, project, service, formed, batch, batchTip, mission, advance };
}

test('ALEPH-06 post-composition branch changes must survive result delivery or be explicitly rejected', async t => {
  const observations = [];
  const points = async (scope, checks) => { for (const [name, check] of checks) await t.test(scope + ': ' + name, check); };
  for (const scope of ['unchanged', 'before-run', 'during-run', 'checked-out']) {
    const f = await fixture(scope); let advanced = null; let pending;
    try {
      if (['before-run', 'checked-out'].includes(scope)) advanced = f.advance();
      pending = f.service.runBatch({ projectId: f.project.id, batchId: f.batch.id });
      const deadline = Date.now() + 10000;
      while (!existsSync(join(f.root, 'ready'))) { if (Date.now() > deadline) throw new Error('actual task startup timeout'); await pause(10); }
      if (scope === 'during-run') advanced = f.advance();
      const beforeDelivery = git(f.repo, 'rev-parse', f.branch);
      writeFileSync(join(f.root, 'release'), 'release');
      const finished = await pending;
      const mission = finished.missions[0]; const batch = finished.batches[0];
      const tip = git(f.repo, 'rev-parse', f.branch);
      const branchSource = git(f.repo, 'show', f.branch + ':missions/train/source.txt');
      const publicRecord = snapshot(finished).missions[0];
      await points(scope + '/runtime-and-state', [
        ['composition captured original mission tip', () => assert.equal(f.formed.missions[0].preBatchTip, f.captured)],
        ['batch actually contains captured mission tip', () => assert.equal(ancestor(f.repo, f.captured, f.batchTip), true)],
        ['real task reads original composed source', () => assert.equal(readFileSync(join(f.root, 'runtime-source.txt'), 'utf8').trim(), 'source-original')],
        ['real task executes composed batch commit', () => assert.equal(readFileSync(join(f.root, 'runtime-head.txt'), 'utf8').trim(), f.batchTip)],
        ['real task executes exactly once', () => assert.equal(readFileSync(join(f.root, 'executions.txt'), 'utf8'), 'run')],
        ['machine released after actual task and delivery', () => assert.equal(finished.machines[0].status, 'idle')],
        ['machine batch ownership released', () => assert.equal(finished.machines[0].batchId, null)],
        ['captured baseline remains unchanged in record', () => assert.equal(mission.preBatchTip, f.captured)],
        ['public snapshot exposes same baseline', () => assert.equal(publicRecord.pre_batch_tip, f.captured)],
        ['public snapshot agrees with actual mission outcome', () => assert.equal(publicRecord.status, mission.status)],
        ['delivery produced an actual result commit object', () => assert.equal(git(f.repo, 'cat-file', '-t', mission.resultCommit), 'commit')],
        ['result envelope identifies original task', () => assert.equal(JSON.parse(git(f.repo, 'show', mission.resultCommit + ':results/train/result.json')).mission_id, 'train')],
        ['delivery temporary worktree registrations are removed', () => assert.ok(!git(f.repo, 'worktree', 'list', '--porcelain').includes('-mission\n'))],
      ]);
      if (advanced) await points(scope + '/branch-protection', [
        ['post-composition change is genuinely distinct', () => assert.notEqual(advanced, f.captured)],
        ['branch points at new research before delivery', () => assert.equal(beforeDelivery, advanced)],
        ['later research commit remains on mission branch', () => assert.equal(ancestor(f.repo, advanced, tip), true)],
        ['branch retains later research file contents', () => assert.equal(branchSource, 'source-revised')],
        ['delivery preserves research or explicitly reports refusal', () => assert.ok(ancestor(f.repo, advanced, tip) || (mission.status === 'failed' && Boolean(mission.error)))],
        ['captured later commit object still exists independently', () => assert.equal(git(f.repo, 'cat-file', '-t', advanced), 'commit')],
      ]);
      if (scope === 'checked-out') await points(scope + '/git-refusal-control', [
        ['checked-out branch update is reported as failure', () => assert.equal(mission.status, 'failed')],
        ['refusal preserves exact newer branch tip', () => assert.equal(tip, advanced)],
        ['Git refusal reason is retained', () => assert.match(mission.error, /checked out|used by worktree/i)],
        ['batch records delivery failure', () => assert.equal(batch.status, 'failed')],
      ]);
      else await points(scope + '/success-path', [
        ['successful task and delivery have a consistent batch status', () => assert.equal(batch.status, mission.status)],
        ['a done result matches mission branch tip', () => { if (mission.status === 'done') assert.equal(tip, mission.resultCommit); else assert.ok(mission.error); }],
        ['original source remains an ancestor of result commit', () => assert.equal(ancestor(f.repo, f.captured, mission.resultCommit), true)],
      ]);
      observations.push({ scope, root: f.root, captured: f.captured, advanced, beforeDelivery, branchTip: tip,
        branchSource, branchLog: git(f.repo, 'log', '--format=%H', f.branch), formed: f.formed, finished });
    } finally { writeFileSync(join(f.root, 'release'), 'release'); if (pending) await pending.catch(() => {}); }
  }
  if (process.env.ALEPH_POST_BATCH_OBSERVATIONS) writeFileSync(process.env.ALEPH_POST_BATCH_OBSERVATIONS,
    JSON.stringify({ source, source_sha: git(source, 'rev-parse', 'HEAD'),
      boundary: 'Actual current ProjectService, Git composition/delivery, runner and real shell task. JSON disk adapter and package loader substitute DSH services. Original task pauses on file only for actual branch modification. No Git substitution or product source edits. Existing pre-composition suite remains unchanged.', observations }, null, 2));
});
