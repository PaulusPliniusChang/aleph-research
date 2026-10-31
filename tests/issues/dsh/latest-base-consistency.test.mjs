import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const source = resolve(process.env.ALEPH_CURRENT_SOURCE || '/home/paulus-chang/项目/aleph');
const { ProjectService, snapshot } = await import(pathToFileURL(join(source, 'dsh-plugin/index-v2.js')));
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const commit = (repo, message) => {
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
};

async function fixture(label, names) {
  const root = mkdtempSync(join(tmpdir(), 'aleph-base-' + label + '-'));
  const workspace = join(root, 'workspace');
  mkdirSync(workspace);
  const file = join(root, 'projects.json');
  writeFileSync(file, '{}');
  const load = () => JSON.parse(readFileSync(file, 'utf8'));
  const table = { get: id => load()[id], entries: () => Object.entries(load()), put: async (id, value) => writeFileSync(file, JSON.stringify({ ...load(), [id]: value })) };
  const service = new ProjectService({}, { table: () => table }, {});
  const project = await service.init({ workspace });
  const repo = project.missionRoot;
  const template = git(repo, 'rev-parse', 'template');
  const missions = [];
  for (const name of names) {
    const branch = 'mission/' + name;
    git(repo, 'switch', '-c', branch, 'template');
    const dir = join(repo, 'missions', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'mission.json'), JSON.stringify({ id: name, entrypoint: 'run.sh' }));
    writeFileSync(join(dir, 'source.txt'), name + '-initial\n');
    writeFileSync(join(dir, 'run.sh'), `git rev-parse HEAD > '${join(root, name + '-runtime-head.txt')}'\ncat source.txt > '${join(root, name + '-runtime-source.txt')}'\nprintf 'run\\n' >> '${join(root, name + '-executions.txt')}'\nprintf complete > "$ALEPH_OUTPUT_DIR/completed.txt"\n`);
    const initialTip = commit(repo, 'initial mission ' + name);
    git(repo, 'switch', 'template');
    const proposed = await service.propose({ projectId: project.id, branch, agent: { id: 'owner-' + name } });
    const record = proposed.missions.at(-1);
    missions.push({ name, branch, initialTip, expectedTip: initialTip, expectedSource: name + '-initial', record });
  }
  return { root, repo, service, projectId: project.id, template, missions };
}

function advance(f, mission, label) {
  git(f.repo, 'switch', mission.branch);
  mission.expectedSource = mission.name + '-' + label;
  writeFileSync(join(f.repo, 'missions', mission.name, 'source.txt'), mission.expectedSource + '\n');
  mission.expectedTip = commit(f.repo, 'advance ' + mission.name + ' ' + label);
  git(f.repo, 'switch', 'template');
}

test('ALEPH-06 current mission record, composition, runtime and delivery commit consistency', async t => {
  const observations = [];
  const points = async (label, checks) => { for (const [name, check] of checks) await t.test(label + ': ' + name, check); };
  for (const scenario of [
    { label: 'unchanged single mission', names: ['unchanged'] },
    { label: 'mission advances after proposal', names: ['proposed'], advanceBeforeApproval: true },
    { label: 'independent approved missions advance before composition', names: ['alpha', 'beta'], advanceAfterApproval: true },
  ]) {
    const f = await fixture(scenario.names[0], scenario.names);
    for (const m of f.missions) {
      await points(scenario.label + '/' + m.name + '/proposal', [
        ['records the actual named mission branch', () => assert.equal(m.record.branch, m.branch)],
        ['does not claim an execution baseline before composition', () => assert.equal(m.record.preBatchTip, null)],
      ]);
      if (scenario.advanceBeforeApproval) advance(f, m, 'after-proposal');
      await f.service.approve({ projectId: f.projectId, missionId: m.record.id });
      if (scenario.advanceAfterApproval) advance(f, m, 'after-approval');
    }
    const formed = await f.service.formBatch({ projectId: f.projectId });
    const batch = formed.batches[0];
    const batchTip = git(f.repo, 'rev-parse', batch.branch);
    const formedSnapshot = snapshot(formed);
    await points(scenario.label + '/composition', [
      ['records the actual template baseline of the batch', () => assert.equal(batch.baseTip, f.template)],
      ['batch contains precisely the approved mission identities', () => assert.deepEqual(batch.missionIds, f.missions.map(m => m.record.id))],
    ]);
    for (const m of f.missions) {
      const record = formed.missions.find(x => x.id === m.record.id);
      const visible = formedSnapshot.missions.find(x => x.id === m.record.id);
      await points(scenario.label + '/' + m.name + '/formed', [
        ['captures the current branch tip rather than an earlier proposal tip', () => assert.equal(record.preBatchTip, m.expectedTip)],
        ['public snapshot exposes the same captured commit', () => assert.equal(visible.pre_batch_tip, m.expectedTip)],
        ['actual composed batch descends from captured mission tip', () => assert.equal(git(f.repo, 'merge-base', '--is-ancestor', m.expectedTip, batchTip), '')],
        ['actual composed source matches captured mission source', () => assert.equal(git(f.repo, 'show', batchTip + ':missions/' + m.name + '/source.txt'), m.expectedSource)],
      ]);
    }
    const finished = await f.service.runBatch({ projectId: f.projectId, batchId: batch.id });
    const finalSnapshot = snapshot(finished);
    await points(scenario.label + '/finished', [
      ['batch finishes successfully', () => assert.equal(finished.batches[0].status, 'done')],
      ['machine is released after result delivery', () => assert.equal(finished.machines[0].status, 'idle')],
    ]);
    const delivered = [];
    for (const m of f.missions) {
      const record = finished.missions.find(x => x.id === m.record.id);
      const visible = finalSnapshot.missions.find(x => x.id === m.record.id);
      const parent = git(f.repo, 'rev-parse', record.resultCommit + '^');
      const envelope = JSON.parse(git(f.repo, 'show', record.resultCommit + ':results/' + m.name + '/result.json'));
      await points(scenario.label + '/' + m.name + '/delivery', [
        ['real task ran the actual composed commit', () => assert.equal(readFileSync(join(f.root, m.name + '-runtime-head.txt'), 'utf8').trim(), batchTip)],
        ['real task read the expected current mission source', () => assert.equal(readFileSync(join(f.root, m.name + '-runtime-source.txt'), 'utf8').trim(), m.expectedSource)],
        ['delivery commit parent equals recorded pre-batch commit', () => assert.equal(parent, record.preBatchTip)],
        ['recorded pre-batch commit remains the composed mission tip', () => assert.equal(record.preBatchTip, m.expectedTip)],
        ['recorded result commit equals actual mission branch tip', () => assert.equal(record.resultCommit, git(f.repo, 'rev-parse', m.branch))],
        ['public result record names that same delivered commit', () => assert.equal(visible.result_commit, record.resultCommit)],
        ['delivered branch retains the source used by the task', () => assert.equal(git(f.repo, 'show', m.branch + ':missions/' + m.name + '/source.txt'), m.expectedSource)],
        ['delivery adds only this mission artifacts and result envelope to its baseline', () => assert.deepEqual(git(f.repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', record.resultCommit).split('\n'), ['completed.txt', 'result.json', 'run.log'].map(name => 'results/' + m.name + '/' + name))],
        ['actual result envelope identifies the composed batch and mission', () => { assert.equal(envelope.batch_id, batch.id); assert.equal(envelope.mission_id, m.name); assert.equal(envelope.status, 'done'); }],
        ['actual task executed once', () => assert.deepEqual(readFileSync(join(f.root, m.name + '-executions.txt'), 'utf8').trim().split('\n'), ['run'])],
      ]);
      delivered.push({ name: m.name, expectedTip: m.expectedTip, record, parent, envelope });
    }
    observations.push({ scenario: scenario.label, root: f.root, template: f.template, batchTip, formed, finished, delivered });
  }
  if (process.env.ALEPH_BASE_OBSERVATIONS) writeFileSync(process.env.ALEPH_BASE_OBSERVATIONS, JSON.stringify({ source, source_sha: git(source, 'rev-parse', 'HEAD'), source_tracked_dirty: git(source, 'status', '--porcelain', '--untracked-files=no'), command: [process.execPath, ...process.execArgv, '--test', 'tests/issues/dsh/base-consistency-acceptance.test.mjs'], environment: { ALEPH_CURRENT_SOURCE: source, ALEPH_BASE_OBSERVATIONS: process.env.ALEPH_BASE_OBSERVATIONS }, boundary: 'Actual current ProjectService, Git merges, runner and shell task; disk JSON project storage adapter and loader package definitions replace DSH runtime dependencies. Real DSH validated separately. Tests do not require any global SOTA inheritance and do not mutate mission branches after composition.', observations }, null, 2));
});
