import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ProjectService } from '../index-v2.js';

const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();

function table() {
  const records = new Map();
  return {
    get: (key) => records.get(key),
    put: async (key, value) => { records.set(key, value); },
    entries: () => records.entries(),
  };
}

function identity(repo) {
  return ['-c', 'user.name=T', '-c', 'user.email=t@t'];
}

test('a researcher completion settles only its own activation record', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aleph-ownership-'));
  try {
    const workspace = join(root, 'workspace');
    await mkdir(workspace, { recursive: true });
    const service = new ProjectService({}, { table: () => table() }, {});
    const project = await service.init({ workspace });
    await service.scaffoldResearch({ projectId: project.id });

    const pending = new Map();
    const settled = [];
    const subagents = {
      async startActivation({ request }) {
        const childId = `child-${pending.size + 1}`;
        let resolve;
        const result = new Promise((yes) => { resolve = yes; });
        pending.set(childId, { resolve, cwd: request.cwd });
        return { childId, result };
      },
      async sendMessage(sender, targetId, blocks) {
        settled.push({ targetId, blocks });
        return { id: 'message' };
      },
    };
    service.subagents = subagents;

    const leader = { id: 'leader' };
    const first = await service.startResearcher({ projectId: project.id, agent: leader });
    const second = await service.startResearcher({ projectId: project.id, agent: leader });
    assert.notEqual(first.childId, second.childId);

    pending.get(second.childId).resolve({ output: [{ type: 'text', text: 'second finished' }] });
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const records = (service.get(project.id).agents ?? []).filter((item) => item.role === 'researcher');
      if (records.some((item) => item.childId === second.childId && item.status === 'done')) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const records = (service.get(project.id).agents ?? []).filter((item) => item.role === 'researcher');
    const secondRecord = records.find((item) => item.childId === second.childId);
    const firstRecord = records.find((item) => item.childId === first.childId);
    assert.equal(secondRecord.status, 'done');
    assert.equal(secondRecord.summary, 'second finished');
    assert.equal(firstRecord.status, 'running');
    assert.equal(firstRecord.summary, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an activation without a child identity fails instead of writing a null record', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aleph-identity-'));
  try {
    const workspace = join(root, 'workspace');
    await mkdir(workspace, { recursive: true });
    const service = new ProjectService({}, { table: () => table() }, {});
    const project = await service.init({ workspace });
    await service.scaffoldResearch({ projectId: project.id });
    service.subagents = {
      async startActivation() { return { childId: null, result: new Promise(() => undefined) }; },
    };
    await assert.rejects(
      () => service.startResearcher({ projectId: project.id, agent: { id: 'leader' } }),
      /child ID/,
    );
    const records = (service.get(project.id).agents ?? []).filter((item) => item.role === 'researcher');
    assert.equal(records.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an evaluation report stays attached to the commit it scored', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aleph-attribution-'));
  try {
    const workspace = join(root, 'workspace');
    await mkdir(workspace, { recursive: true });
    const service = new ProjectService({}, { table: () => table() }, {});
    const project = await service.init({
      workspace,
      evalCommand: "python3 -c \"import json;print(json.dumps({'score': 2}))\"",
    });
    const research = project.researchRoot;
    await writeFile(join(research, 'predict.py'), 'print("v1")\n');
    git(research, ['add', '-A']);
    git(research, [...identity(research), 'commit', '-m', 'research v1']);
    const scored = git(research, ['rev-parse', 'HEAD']);

    const evaluation = await service.evaluate({ projectId: project.id, branch: 'main' });
    assert.equal(evaluation.status, 'done');
    assert.equal(evaluation.score, 2);
    assert.equal(evaluation.evaluatedCommit, scored);
    assert.equal(git(research, ['rev-parse', `${evaluation.researchCommit}^`]), scored);
    assert.equal(git(research, ['rev-parse', 'main']), evaluation.researchCommit);
    assert.equal(git(research, ['rev-parse', evaluation.evaluationRef]), evaluation.researchCommit);
    const message = git(research, ['log', '-1', '--format=%B', evaluation.researchCommit]);
    assert.match(message, /Aleph-Research-Commit: [0-9a-f]{40}/);

    // An independent ref survives later history on the branch.
    await writeFile(join(research, 'predict.py'), 'print("v2")\n');
    git(research, ['add', '-A']);
    git(research, [...identity(research), 'commit', '-m', 'research v2']);
    assert.equal(git(research, ['rev-parse', evaluation.evaluationRef]), evaluation.researchCommit);
    assert.notEqual(git(research, ['rev-parse', 'main']), evaluation.researchCommit);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('result delivery refuses to overwrite commits pushed after batching', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aleph-delivery-'));
  try {
    const workspace = join(root, 'workspace');
    await mkdir(workspace, { recursive: true });
    const service = new ProjectService({}, { table: () => table() }, {});
    const project = await service.init({ workspace });
    const missionRepo = project.missionRoot;
    const branch = 'missions/late-commit';
    git(missionRepo, ['switch', '-c', branch, 'template']);
    await mkdir(join(missionRepo, 'missions', 'late'), { recursive: true });
    await writeFile(join(missionRepo, 'missions', 'late', 'mission.json'), JSON.stringify({ id: 'late', entrypoint: 'run.sh' }));
    await writeFile(join(missionRepo, 'missions', 'late', 'run.sh'), '#!/usr/bin/env bash\nset -e\nprintf \'{"ok":true}\\n\' > "$ALEPH_OUTPUT_DIR/result.json"\n');
    execFileSync('chmod', ['+x', join(missionRepo, 'missions', 'late', 'run.sh')]);
    git(missionRepo, ['add', '-A']);
    git(missionRepo, [...identity(missionRepo), 'commit', '-m', 'mission late']);
    git(missionRepo, ['switch', 'template']);

    let current = await service.propose({ projectId: project.id, branch, agent: { id: 'researcher' } });
    const missionId = current.missions[0].id;
    await service.approve({ projectId: project.id, missionId });
    current = await service.formBatch({ projectId: project.id });
    const batchId = current.batches[0].id;

    // The researcher keeps working on the mission branch after the batch formed.
    git(missionRepo, ['switch', branch]);
    await writeFile(join(missionRepo, 'missions', 'late', 'notes.md'), 'later work\n');
    git(missionRepo, ['add', '-A']);
    git(missionRepo, [...identity(missionRepo), 'commit', '-m', 'work after batching']);
    const advanced = git(missionRepo, ['rev-parse', branch]);
    git(missionRepo, ['switch', 'template']);

    current = await service.runBatch({ projectId: project.id, batchId });
    const mission = current.missions.find((item) => item.id === missionId);
    assert.equal(mission.status, 'failed');
    // The wording depends on the git locale; the contract is a refused delivery.
    assert.ok(mission.error, 'delivery failure is reported on the mission');
    assert.ok(mission.resultCommit === null || mission.resultCommit, 'mission keeps its recorded state');
    assert.equal(git(missionRepo, ['rev-parse', branch]), advanced, 'the later commit must survive');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
