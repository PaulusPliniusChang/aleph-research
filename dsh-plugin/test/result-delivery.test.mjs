import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ProjectService, snapshot } from '../index-v2.js';

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const pause = () => new Promise(resolve => setTimeout(resolve, 10));
function commit(repo, message) {
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aleph-delivery-'));
  const workspace = join(root, 'workspace'); mkdirSync(workspace);
  const records = new Map();
  const table = {
    get: id => structuredClone(records.get(id)),
    put: async (id, record) => records.set(id, structuredClone(record)),
    entries: () => [...records].map(([id, record]) => [id, structuredClone(record)]),
  };
  const service = new ProjectService({}, { table: () => table }, {});
  const project = await service.init({ workspace });
  const repo = project.missionRoot;
  const branch = 'mission/train';
  git(repo, 'switch', '-c', branch, 'template');
  const missionDir = join(repo, 'missions', 'train'); mkdirSync(missionDir, { recursive: true });
  writeFileSync(join(missionDir, 'mission.json'), JSON.stringify({ id: 'train', entrypoint: 'run.sh' }));
  writeFileSync(join(missionDir, 'source.txt'), 'original\n');
  writeFileSync(join(missionDir, 'run.sh'),
    `cat source.txt > ${quote(join(root, 'executed-source'))}\n` +
    `git rev-parse HEAD > ${quote(join(root, 'executed-commit'))}\n` +
    `printf execution >> ${quote(join(root, 'executions'))}\n` +
    `touch ${quote(join(root, 'ready'))}\n` +
    `for n in $(seq 1 1000); do test -f ${quote(join(root, 'release'))} && break; sleep .01; done\n` +
    `test -f ${quote(join(root, 'release'))} || exit 73\n`);
  const original = commit(repo, 'original mission');
  git(repo, 'switch', 'template');
  const proposed = await service.propose({ projectId: project.id, branch, agent: { id: 'researcher' } });
  const missionId = proposed.missions[0].id;
  await service.approve({ projectId: project.id, missionId });
  const formed = await service.formBatch({ projectId: project.id });
  const batch = formed.batches[0];
  const advance = (stay = false) => {
    git(repo, 'switch', branch);
    writeFileSync(join(missionDir, 'source.txt'), 'research correction\n');
    const updated = commit(repo, 'research after batch composition');
    if (!stay) git(repo, 'switch', 'template');
    return updated;
  };
  return { root, workspace, repo, branch, missionDir, original, project, service, missionId, formed, batch, advance };
}

test('result delivery compares the frozen mission tip and preserves subsequent research', async t => {
  for (const scope of ['stable', 'before-run', 'during-run', 'checked-out', 'stable-checked-out', 'linked-worktree', 'deleted', 'late-change', 'legacy']) {
    const f = await fixture();
    let pending;
    try {
      let expected = f.original;
      let subsequent = null;
      let shouldFail = !['stable', 'legacy'].includes(scope);
      if (scope === 'before-run') subsequent = f.advance();
      if (scope === 'checked-out') subsequent = f.advance(true);
      if (scope === 'stable-checked-out') git(f.repo, 'switch', f.branch);
      if (scope === 'linked-worktree') {
        subsequent = f.advance();
        git(f.repo, 'worktree', 'add', join(f.root, 'research checkout'), f.branch);
      }
      if (scope === 'deleted') git(f.repo, 'branch', '-D', f.branch);
      if (scope === 'legacy') {
        subsequent = f.advance(); expected = subsequent;
        await f.service.mutate(f.project.id, current => ({ ...current,
          missions: current.missions.map(mission => ({ ...mission, preBatchTip: null })) }));
      }
      if (scope === 'late-change') {
        subsequent = f.advance();
        git(f.repo, 'update-ref', `refs/heads/${f.branch}`, f.original, subsequent);
        // A real Git hook advances the mission ref only after the result has
        // been cherry-picked in its detached worktree. No Git call is mocked.
        const hook = join(f.repo, '.git', 'hooks', 'reference-transaction');
        writeFileSync(hook, '#!/bin/sh\n' +
          'test "$1" = committed || exit 0\n' +
          'case "$PWD" in *-mission) ;; *) exit 0;; esac\n' +
          `test ! -f ${quote(join(f.root, 'late-change'))} || exit 0\n` +
          `touch ${quote(join(f.root, 'late-change'))}\n` +
          `git update-ref ${quote(`refs/heads/${f.branch}`)} ${quote(subsequent)} ${quote(f.original)}\n`);
        chmodSync(hook, 0o755);
      }
      pending = f.service.runBatch({ projectId: f.project.id, batchId: f.batch.id });
      const deadline = Date.now() + 15000;
      while (!existsSync(join(f.root, 'ready'))) {
        if (Date.now() > deadline) throw new Error('actual mission did not start');
        await pause();
      }
      if (scope === 'during-run') subsequent = f.advance();
      writeFileSync(join(f.root, 'release'), 'release');
      const finished = await pending;
      const mission = finished.missions[0];
      const batch = finished.batches[0];
      const publicMission = snapshot(finished).missions[0];
      const check = async (name, fn) => t.test(`${scope}: ${name}`, fn);
      await check('executes the batch snapshot rather than later branch changes', () => {
        assert.equal(readFileSync(join(f.root, 'executed-source'), 'utf8'), 'original\n');
        assert.equal(readFileSync(join(f.root, 'executed-commit'), 'utf8').trim(), git(f.repo, 'rev-parse', f.batch.branch));
      });
      await check('runs the mission once', () => assert.equal(readFileSync(join(f.root, 'executions'), 'utf8'), 'execution'));
      await check('persists the delivery outcome', () => assert.equal(f.service.get(f.project.id).missions[0].status, shouldFail ? 'failed' : 'done'));
      await check('records delivery failures in the batch outcome', () => assert.equal(batch.status, shouldFail ? 'failed' : 'done'));
      await check('releases the machine and its batch ownership', () => {
        assert.equal(finished.machines[0].status, 'idle'); assert.equal(finished.machines[0].batchId, null);
      });
      await check('keeps the frozen composition record', () => assert.equal(mission.preBatchTip, scope === 'legacy' ? null : f.original));
      await check('exposes the same result through the public snapshot', () => {
        assert.equal(publicMission.status, mission.status); assert.equal(publicMission.result_commit, mission.resultCommit);
      });
      await check('retains an inspectable result commit', () => assert.equal(git(f.repo, 'cat-file', '-t', mission.resultCommit), 'commit'));
      await check('bases the result on the mission snapshot instead of composed batch code', () => assert.equal(git(f.repo, 'rev-parse', `${mission.resultCommit}^`), expected));
      await check('stores the correct mission and batch identity in the result', () => {
        const result = JSON.parse(git(f.repo, 'show', `${mission.resultCommit}:results/train/result.json`));
        assert.equal(result.mission_id, 'train'); assert.equal(result.batch_id, f.batch.id);
      });
      await check('removes temporary execution and delivery worktrees', () => {
        const worktrees = git(f.repo, 'worktree', 'list', '--porcelain');
        assert.ok(!worktrees.includes(join(f.workspace, '.aleph', 'batches')));
      });
      if (scope === 'deleted') {
        await check('does not recreate the deleted mission branch', () => assert.throws(() => git(f.repo, 'show-ref', '--verify', `refs/heads/${f.branch}`)));
      } else if (shouldFail) {
        await check('keeps the exact existing mission ref', () => assert.equal(git(f.repo, 'rev-parse', f.branch), subsequent ?? f.original));
        await check('keeps the current source on the mission branch', () => assert.equal(git(f.repo, 'show', `${f.branch}:missions/train/source.txt`), subsequent ? 'research correction' : 'original'));
      } else {
        await check('publishes successful results on the mission branch', () => assert.equal(git(f.repo, 'rev-parse', f.branch), mission.resultCommit));
        await check('adds only the result envelope to the chosen source', () => assert.equal(git(f.repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', mission.resultCommit), 'results/train/result.json'));
      }
      if (subsequent) await check('retains the later research commit in normal branch history', () => {
        assert.doesNotThrow(() => git(f.repo, 'merge-base', '--is-ancestor', subsequent, f.branch));
      });
      if (shouldFail) {
        await check('returns an explicit delivery error', () => assert.ok(mission.error));
        if (['checked-out', 'stable-checked-out', 'linked-worktree'].includes(scope)) {
          await check('explains checkout refusal', () => assert.match(mission.error, /checked out.*worktree/i));
        } else {
          await check('explains atomic expected-tip failure', () => assert.match(mission.error, /cannot lock ref|expected/i));
        }
      } else await check('has no delivery error on the successful path', () => assert.equal(mission.error, null));
      if (scope === 'checked-out') await check('leaves checked-out files intact', () => assert.equal(readFileSync(join(f.missionDir, 'source.txt'), 'utf8'), 'research correction\n'));
      if (scope === 'linked-worktree') await check('leaves linked-worktree files intact', () => assert.equal(readFileSync(join(f.root, 'research checkout', 'missions/train/source.txt'), 'utf8'), 'research correction\n'));
      if (scope === 'late-change') await check('actually changed the ref during result construction', () => assert.ok(existsSync(join(f.root, 'late-change'))));
    } finally {
      writeFileSync(join(f.root, 'release'), 'release');
      if (pending) await pending.catch(() => undefined);
      rmSync(f.root, { recursive: true, force: true });
    }
  }
});
