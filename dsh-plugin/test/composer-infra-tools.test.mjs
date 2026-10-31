import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply } from '../index-v2.js';

const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const wait = async (fn, label) => {
  const end = Date.now() + 8000;
  while (!await fn()) {
    if (Date.now() > end) throw new Error(`fixture timeout: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

async function harness(t) {
  const root = await mkdtemp(join(tmpdir(), 'aleph-composer-infra-tools-'));
  const workspace = join(root, 'work space 中文');
  await mkdir(workspace);
  const records = new Map(), sessions = new Map(), definitions = new Map(), predicates = new Map();
  const effects = [], activations = [], messages = [], toolCalls = [], errors = [], missions = [];
  const table = { get: key => records.has(key) ? structuredClone(records.get(key)) : undefined,
    async put(key, value) { records.set(key, structuredClone(value)); },
    entries: () => [...records].map(([key, value]) => [key, structuredClone(value)]) };
  const session = (id, preset, cwd = workspace) => sessions.set(id, { header: { id, cwd }, preset });
  session('leader', 'aleph');
  session('researcher', 'aleph-researcher');
  session('optimizer', 'aleph-infra');
  session('ordinary', 'general');
  session('no-preset', null);
  let projectId;
  const visible = id => [...definitions.keys()].filter(name => !predicates.get(name) || predicates.get(name)({ agent: { id } }));
  // Public invocation observes the registration predicate before calling Host
  // code, as the actual DSH tool list does. Hidden-tool fallbacks are forbidden.
  const invoke = async (name, args, caller = 'leader') => {
    if (!visible(caller).includes(name)) throw new Error(`tool ${name} is unavailable to ${caller}`);
    toolCalls.push({ name, caller });
    return definitions.get(name).execute(args, { agent: { id: caller } });
  };
  const state = async () => (await invoke('aleph_status', { project_id: projectId }))[0];
  const pump = async a => {
    if (a.pumping) return;
    a.pumping = true;
    try {
      while (true) {
        const p = (await invoke('aleph_status', { project_id: projectId }, a.childId))[0];
        if (!p.missions.some(m => m.status === 'approved') || p.machines[0].status !== 'idle') break;
        const formed = await invoke('aleph_form_batch', { project_id: projectId }, a.childId);
        const batch = formed.batches.find(b => b.status === 'forming');
        const operation = ++a.dispatches === 2 ? 'aleph_run_infra' : 'aleph_run_batch';
        await invoke(operation, { project_id: projectId, batch_id: batch.id }, a.childId);
      }
    } catch (error) { errors.push(error); }
    finally { a.pumping = false; }
  };
  const subagents = {
    async startActivation(spec) {
      const childId = `child-${activations.length}`;
      let resolve;
      const result = new Promise(done => { resolve = done; });
      const a = { childId, spec, resolve, result, dispatches: 0, pumping: false };
      activations.push(a);
      session(childId, spec.request.agentPreset, spec.request.cwd);
      if (spec.request.agentPreset === 'aleph-composer') setImmediate(() => { void pump(a); });
      if (spec.request.agentPreset === 'aleph-infra') {
        // Only optimizer actions are substituted. The Host really creates the
        // optimizer worktree, commits its output, and executes Python and Git.
        await writeFile(join(spec.request.cwd, 'ALEPH_HANDOFF.md'), 'Static inspection completed; existing batch code retained.');
        setImmediate(() => resolve({ output: [{ type: 'text', text: 'Static inspection completed.' }] }));
      }
      return { childId, result, dispose: async () => resolve({ output: [] }) };
    },
    async sendMessage(parent, childId, content) {
      messages.push({ parent, childId, content });
      const a = activations.find(item => item.childId === childId);
      if (a?.spec.request.agentPreset === 'aleph-composer') setImmediate(() => { void pump(a); });
    },
  };
  await apply({
    storageDomain: { open: async () => ({ table: () => table, close: async () => {} }) },
    get: name => ({ sessions: { get: id => sessions.get(id) }, subagents,
      agentPresets: { presetForSession: item => item.preset } })[name],
    effect(fn) { const dispose = fn(); if (dispose) effects.push(dispose); },
    tools: { register(definition, options) { definitions.set(definition.name, definition); predicates.set(definition.name, options?.when); return () => {}; } },
    webServer: { register: () => {} },
  });
  t.after(async () => {
    for (const m of missions) await writeFile(m.gate, 'release');
    await wait(() => activations.every(a => !a.pumping), 'pending Composer cleanup').catch(() => {});
    for (const dispose of effects.reverse()) dispose();
    for (const a of activations) a.resolve({ output: [] });
    await rm(root, { recursive: true, force: true });
  });
  const project = await invoke('aleph_init_project', { workspace });
  projectId = project.id;
  const mission = async (name, held = false) => {
    const m = await invoke('aleph_start_mission', { project_id: projectId, name });
    const gate = join(root, `${name}-release`), counter = join(root, `${name}-count`);
    await writeFile(join(m.missionDir, 'run.sh'), `#!/bin/sh\nset -e\nprintf 'run\\n' >> '${counter}'\nprintf started > "$ALEPH_OUTPUT_DIR/started.txt"\n${held ? `while [ ! -f '${gate}' ]; do sleep .02; done\n` : ''}printf '${name}-output' > "$ALEPH_OUTPUT_DIR/artifact.txt"\n`);
    git(m.worktree, 'add', '-A');
    git(m.worktree, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', name);
    const tip = git(m.worktree, 'rev-parse', 'HEAD');
    const proposed = await invoke('aleph_propose_mission', { project_id: projectId, branch: m.branch }, 'researcher');
    const recorded = { ...m, recordId: proposed.missions.find(item => item.branch === m.branch).id, gate, counter, tip };
    missions.push(recorded);
    return recorded;
  };
  return { root, workspace, project, session, sessions, visible, definitions, invoke, state, mission, activations, messages, toolCalls, errors };
}

test('Infra dispatch visibility follows the current session preset with Leader controls isolated', async t => {
  const f = await harness(t);
  f.session('composer', 'aleph-composer');
  await t.test('Composer receives the Infra dispatch tool', () => assert.ok(f.visible('composer').includes('aleph_run_infra')));
  await t.test('Leader retains the Infra dispatch tool', () => assert.ok(f.visible('leader').includes('aleph_run_infra')));
  await t.test('researchers do not receive the Infra dispatch tool', () => assert.equal(f.visible('researcher').includes('aleph_run_infra'), false));
  await t.test('InfraOptimizer cannot recursively dispatch another optimizer', () => assert.equal(f.visible('optimizer').includes('aleph_run_infra'), false));
  await t.test('ordinary presets do not receive the Infra dispatch tool', () => assert.equal(f.visible('ordinary').includes('aleph_run_infra'), false));
  await t.test('a session without a preset receives no Infra dispatch authority', () => assert.equal(f.visible('no-preset').includes('aleph_run_infra'), false));
  await t.test('a missing session cannot acquire Infra dispatch authority', () => assert.equal(f.visible('absent-session').includes('aleph_run_infra'), false));
  await t.test('preset changes remove previously granted Composer Infra authority', () => {
    f.session('composer', 'aleph-researcher');
    assert.equal(f.visible('composer').includes('aleph_run_infra'), false);
    f.session('composer', 'aleph-composer');
  });
  await t.test('restoring the Composer preset restores Infra availability', () => assert.ok(f.visible('composer').includes('aleph_run_infra')));
  await t.test('Composer retains the existing direct batch execution route', () => assert.ok(f.visible('composer').includes('aleph_run_batch')));
  await t.test('Composer retains batch formation', () => assert.ok(f.visible('composer').includes('aleph_form_batch')));
  await t.test('Composer still cannot approve proposals', () => assert.equal(f.visible('composer').includes('aleph_approve_mission'), false));
  await t.test('Composer still cannot start researchers', () => {
    assert.equal(f.visible('composer').includes('aleph_run_researcher'), false);
    assert.equal(f.visible('composer').includes('aleph_run_researchers'), false);
  });
  await t.test('Composer still cannot start another Composer', () => assert.equal(f.visible('composer').includes('aleph_run_composer'), false));
  await t.test('denied caller never reaches the Infra activation route', async () => {
    await assert.rejects(f.invoke('aleph_run_infra', { project_id: f.project.id, batch_id: 'absent' }, 'researcher'), /unavailable/);
    assert.equal(f.activations.length, 0);
  });
});

test('persistent Composer completes direct, Infra and subsequent queue dispatch using only visible tools', async t => {
  const f = await harness(t);
  const first = await f.mission('first', true), second = await f.mission('second'), third = await f.mission('third');
  await t.test('unapproved proposals neither dispatch work nor start Composer', async () => {
    const p = await f.state();
    assert.equal(p.batches.length, 0);
    assert.equal(f.activations.length, 0);
    assert.equal(existsSync(first.counter), false);
  });
  await f.invoke('aleph_approve_mission', { project_id: f.project.id, mission_id: first.recordId });
  await wait(() => existsSync(first.counter), 'first dispatch did not start');
  const running = await f.state(), composer = f.activations.find(a => a.spec.request.agentPreset === 'aleph-composer');
  await t.test('approval starts exactly one persistent Composer', () => {
    assert.ok(composer.childId);
    assert.equal(f.activations.filter(a => a.spec.request.agentPreset === 'aleph-composer').length, 1);
  });
  await t.test('the actual Composer request asks for the now available Infra tool', () => {
    assert.match(composer.spec.request.prompt.map(p => p.text).join('\n'), /aleph_run_infra/);
    assert.ok(f.visible(composer.childId).includes('aleph_run_infra'));
  });
  await t.test('the first batch runs directly as the Composer session', () => {
    assert.equal(running.batches[0].status, 'running');
    assert.ok(f.toolCalls.some(c => c.caller === composer.childId && c.name === 'aleph_run_batch'));
  });
  await t.test('running work owns its exact local machine', () => assert.equal(running.machines[0].batchId, running.batches[0].id));
  await f.invoke('aleph_approve_mission', { project_id: f.project.id, mission_id: second.recordId });
  await t.test('busy approval preserves queued work and the original machine owner', async () => {
    const p = await f.state();
    assert.equal(p.missions.find(m => m.id === second.recordId).status, 'approved');
    assert.equal(p.machines[0].batchId, running.batches[0].id);
    assert.equal(existsSync(second.counter), false);
  });
  await writeFile(first.gate, 'release');
  await wait(async () => (await f.state()).missions.filter(m => m.status === 'done').length === 2 || f.errors.length, 'Infra dispatch did not complete');
  assert.deepEqual(f.errors, []);
  const two = await f.state(), infra = f.activations.find(a => a.spec.request.agentPreset === 'aleph-infra');
  await t.test('second queued work reaches done through registered Infra dispatch', () => {
    assert.equal(two.missions.find(m => m.id === second.recordId).status, 'done');
    assert.ok(f.toolCalls.some(c => c.caller === composer.childId && c.name === 'aleph_run_infra'));
  });
  await t.test('InfraOptimizer starts once with the Composer as its parent', () => {
    assert.equal(f.activations.filter(a => a.spec.request.agentPreset === 'aleph-infra').length, 1);
    assert.equal(infra.spec.request.parent.id, composer.childId);
  });
  await t.test('InfraOptimizer uses its own batch worktree', () => {
    assert.ok(infra.spec.request.cwd.startsWith(join(f.workspace, '.aleph', 'infra')));
    assert.notEqual(infra.spec.request.cwd, f.project.missionRoot);
  });
  await t.test('Host records successful Infra completion and handoff', () => {
    assert.equal(two.agents.find(a => a.role === 'infra').status, 'done');
    assert.match(git(f.project.missionRoot, 'show', `${two.batches[1].branch}:ALEPH_HANDOFF.md`), /Static inspection completed/);
  });
  await t.test('both execution routes finish separate batches', () => {
    assert.equal(two.batches.length, 2);
    assert.ok(two.batches.every(b => b.status === 'done'));
  });
  await t.test('Infra execution releases machine capacity', () => {
    assert.equal(two.machines[0].status, 'idle');
    assert.equal(two.machines[0].batchId, null);
  });
  await t.test('the direct mission output belongs to its original mission branch', () => {
    assert.equal(git(f.project.missionRoot, 'show', `${first.branch}:results/${first.missionId}/artifact.txt`), 'first-output');
  });
  await t.test('the Infra mission output belongs to its original mission branch', () => {
    assert.equal(git(f.project.missionRoot, 'show', `${second.branch}:results/${second.missionId}/artifact.txt`), 'second-output');
  });
  await t.test('direct and Infra work each compute exactly once', async () => {
    assert.equal(await readFile(first.counter, 'utf8'), 'run\n');
    assert.equal(await readFile(second.counter, 'utf8'), 'run\n');
  });
  await t.test('unapproved third work remains untouched through both executions', () => {
    assert.equal(two.missions.find(m => m.id === third.recordId).status, 'proposed');
    assert.equal(existsSync(third.counter), false);
  });
  await t.test('completion events notify the original Composer', () => {
    assert.ok(f.messages.some(m => m.childId === composer.childId && JSON.stringify(m.content).includes('batch finished')));
  });
  await f.invoke('aleph_approve_mission', { project_id: f.project.id, mission_id: third.recordId });
  await wait(async () => (await f.state()).missions.every(m => m.status === 'done') || f.errors.length, 'subsequent dispatch did not finish');
  assert.deepEqual(f.errors, []);
  const final = await f.state();
  await t.test('later approval wakes the existing Composer without a Leader dispatch command', () => {
    assert.equal(final.missions.find(m => m.id === third.recordId).status, 'done');
    assert.equal(f.activations.filter(a => a.spec.request.agentPreset === 'aleph-composer').length, 1);
  });
  await t.test('all dispatch commands originate in the Composer session', () => {
    const dispatches = f.toolCalls.filter(c => ['aleph_form_batch', 'aleph_run_batch', 'aleph_run_infra'].includes(c.name));
    assert.ok(dispatches.length >= 6);
    assert.ok(dispatches.every(c => c.caller === composer.childId));
  });
  await t.test('later work uses the existing direct route exactly once', async () => {
    assert.equal(f.toolCalls.filter(c => c.caller === composer.childId && c.name === 'aleph_run_batch').length, 2);
    assert.equal(await readFile(third.counter, 'utf8'), 'run\n');
  });
  await t.test('each mission retains a distinct result commit', () => assert.equal(new Set(final.missions.map(m => m.result_commit)).size, 3));
  await t.test('completed continuation leaves no approved queue or occupied machine', () => {
    assert.equal(final.missions.filter(m => m.status === 'approved').length, 0);
    assert.equal(final.machines[0].status, 'idle');
  });
  await t.test('registered visibility never requires a hidden-tool or Leader fallback', () => {
    assert.deepEqual(f.errors, []);
    assert.equal(f.toolCalls.filter(c => c.name === 'aleph_run_infra').length, 1);
    assert.equal(f.toolCalls.find(c => c.name === 'aleph_run_infra').caller, composer.childId);
  });
});
