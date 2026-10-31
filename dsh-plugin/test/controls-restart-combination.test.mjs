import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ProjectService } from '../index-v2.js';
import { observeRecordedExecution, stopRecordedExecution } from '../execution-owner.mjs';

const launcher = fileURLToPath(new URL('../execution-launcher.mjs', import.meta.url));
const wait = async (fn, message) => {
  const end = Date.now() + 6000;
  while (!await fn()) {
    if (Date.now() > end) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

async function fixture(t, { outside = false, cancelling = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'aleph-controls-restart-combination-'));
  const records = new Map();
  const table = { get: key => records.has(key) ? structuredClone(records.get(key)) : undefined,
    entries: () => [...records].map(([k, v]) => [k, structuredClone(v)]),
    async put(k, v) { records.set(k, structuredClone(v)); } };
  const fresh = () => new ProjectService({}, { table: () => table }, { subagents: {} });
  const service = fresh();
  const project = await service.init({ workspace: root });
  const bid = 'orphan-batch';
  const worktree = join(root, '.aleph', 'batches', bid);
  const receiptPath = join(root, 'receipt.json');
  const commandId = 'command-owned';
  const executionId = 'execution-owned';
  const gate = join(root, 'release');
  const marker = join(root, 'started');
  const artifact = join(worktree, 'artifact.txt');
  await mkdir(worktree, { recursive: true });
  await service.mutate(project.id, p => ({ ...p,
    batches: [{ id: bid, machineId: 'local', status: cancelling ? 'cancelling' : 'running',
      branch: 'batch/owned', startedAt: '2026-01-01', summary: { preserved: true },
      ...(cancelling ? { cancellation: { operationId: 'operator-cancel', reason: 'operator request', complete: false } } : {}),
      execution: { id: executionId, hostId: 'departed-host', role: 'batch', active: true, phase: 'command', worktree,
        commands: [{ id: commandId, receiptPath, phase: 'starting' }] } }],
    missions: [{ id: 'undelivered', batchId: bid, status: 'running', resultCommit: null },
      { id: 'delivered', batchId: bid, status: 'done', resultCommit: 'existing-result' }],
    machines: [{ ...p.machines[0], status: 'busy', batchId: bid, executionId }],
  }));
  // A real durable command receipt and go handshake, with no original Host
  // waiter. B separately exercises a killed actual DSH Host.
  const code = `${outside ? 'process.chdir("/");' : ''}
    const fs = require('fs'); fs.writeFileSync(${JSON.stringify(marker)}, String(process.pid));
    const timer = setInterval(() => {
      if (fs.existsSync(${JSON.stringify(gate)})) {
        fs.writeFileSync(${JSON.stringify(artifact)}, 'preserved-result'); clearInterval(timer);
      }
    }, 10);`;
  const child = spawn(process.execPath, [launcher, receiptPath, commandId, process.execPath, '-e', code],
    { cwd: worktree, detached: true, stdio: 'ignore' });
  const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
  let originalReceipt;
  t.after(async () => {
    if (originalReceipt) await writeFile(receiptPath, originalReceipt);
    await stopRecordedExecution(receiptPath, commandId).catch(() => {});
    await exited;
    await rm(root, { recursive: true, force: true });
  });
  await wait(() => existsSync(receiptPath), 'launcher did not publish receipt');
  originalReceipt = await readFile(receiptPath, 'utf8');
  await writeFile(receiptPath + '.go', 'go');
  await wait(() => existsSync(marker), 'user command did not start');
  const read = () => service.get(project.id);
  const recovered = fresh();
  return { root, project, service, fresh, recovered, bid, worktree, receiptPath, commandId, executionId,
    gate, artifact, marker, exited, child, read, originalReceipt,
    release: async () => { await writeFile(gate, 'release'); await exited; } };
}

test('ordinary restart retains an owned command outside its former cwd and finishing drains it', async t => {
  const f = await fixture(t, { outside: true });
  await f.recovered.recoverAfterRestart();
  await t.test('the command leaves the worktree while its launcher and owned group remain active', async () => {
    assert.equal(f.recovered.hasProcessUnder(f.worktree), true); // the launcher still owns this cwd
    assert.equal(await readlink(`/proc/${Number(await readFile(f.marker, 'utf8'))}/cwd`), '/');
  });
  await t.test('receipt observation sees the real owned process group without stopping it', async () => {
    assert.equal((await observeRecordedExecution(f.receiptPath, f.commandId)).active, true);
    assert.equal(f.read().batches[0].status, 'running');
  });
  await t.test('ordinary startup preserves exact execution and machine ownership', () => {
    assert.equal(f.read().batches[0].execution.id, f.executionId);
    assert.equal(f.read().batches[0].execution.active, true);
    assert.equal(f.read().machines[0].executionId, f.executionId);
    assert.equal(f.read().machines[0].batchId, f.bid);
  });
  await t.test('ordinary startup writes no stop fence or cancellation intent', () => {
    assert.equal(existsSync(f.receiptPath + '.stop'), false);
    assert.equal(f.read().batches[0].cancellation, undefined);
  });
  await t.test('repeated startup does not recapture newly running agents', async () => {
    await f.recovered.mutate(f.project.id, p => ({ ...p, agents: [{ role: 'researcher', childId: 'new-child', status: 'running' }] }));
    await f.recovered.recoverAfterRestart();
    assert.equal(f.read().agents[0].status, 'running');
  });
  await t.test('live batch cannot be run a second time', async () => {
    await assert.rejects(f.recovered.runBatch({ projectId: f.project.id, batchId: f.bid }), /active execution/);
    assert.equal((await observeRecordedExecution(f.receiptPath, f.commandId)).active, true);
  });
  await t.test('live batch cannot be reopened by InfraOptimizer', async () => {
    await assert.rejects(f.recovered.runInfra({ projectId: f.project.id, batchId: f.bid, agent: { id: 'leader' } }), /active execution/);
    assert.equal(existsSync(f.receiptPath + '.stop'), false);
  });
  await f.recovered.controls.change({ projectId: f.project.id, operation: 'pause' });
  await t.test('pause survives recovery and blocks new dispatch', async () => {
    await f.recovered.recoverAfterRestart();
    await assert.rejects(f.recovered.formBatch({ projectId: f.project.id }), /paused/);
    assert.equal(f.read().control.state, 'paused');
  });
  await t.test('pause and follow-up preserve the active computation', async () => {
    await f.recovered.checkRecoveredBatches();
    assert.equal((await observeRecordedExecution(f.receiptPath, f.commandId)).active, true);
    assert.equal(f.read().machines[0].status, 'busy');
  });
  await f.recovered.controls.change({ projectId: f.project.id, operation: 'finish' });
  await t.test('finish waits for the captured computation instead of stopping it', async () => {
    assert.equal(f.read().control.state, 'finishing');
    await f.recovered.checkRecoveredBatches();
    assert.equal((await observeRecordedExecution(f.receiptPath, f.commandId)).active, true);
    assert.equal(existsSync(f.receiptPath + '.stop'), false);
  });
  await t.test('finishing project rejects fresh work and cannot resume', async () => {
    await assert.rejects(f.recovered.startMission({ projectId: f.project.id }), /finishing/);
    await assert.rejects(f.recovered.controls.change({ projectId: f.project.id, operation: 'resume' }), /cannot resume/);
  });
  await f.release();
  await f.recovered.checkRecoveredBatches();
  await t.test('natural exit closes only the captured batch and execution', () => {
    assert.equal(f.read().batches[0].status, 'failed');
    assert.equal(f.read().batches[0].execution.active, false);
    assert.equal(f.read().batches[0].execution.phase, 'stopped');
    assert.equal(f.read().batches[0].summary.preserved, true);
  });
  await t.test('natural exit releases the exact machine and clears execution ownership', () => {
    assert.equal(f.read().machines[0].status, 'idle');
    assert.equal(f.read().machines[0].batchId, null);
    assert.equal(f.read().machines[0].executionId, null);
  });
  await t.test('natural exit finishes the previously finishing project', () => assert.equal(f.read().control.state, 'finished'));
  await t.test('delivered mission history survives while undelivered work is explicitly interrupted', () => {
    assert.equal(f.read().missions[0].status, 'failed');
    assert.equal(f.read().missions[0].resultCommit, null);
    assert.equal(f.read().missions[1].status, 'done');
    assert.equal(f.read().missions[1].resultCommit, 'existing-result');
  });
  await t.test('computed output and original receipt remain untouched for inspection', async () => {
    assert.equal(await readFile(f.artifact, 'utf8'), 'preserved-result');
    assert.equal(await readFile(f.receiptPath, 'utf8'), f.originalReceipt);
    assert.equal(existsSync(f.receiptPath + '.stop'), false);
  });
  await t.test('later ticks preserve new agent state and publish a single interruption', async () => {
    await f.recovered.checkRecoveredBatches();
    assert.equal(f.read().agents[0].status, 'running');
    assert.equal(f.read().violations.filter(v => v.includes(`batch ${f.bid} interrupted`)).length, 1);
  });
});

test('explicit cancellation after ordinary recovery still stops the exact durable command', async t => {
  const f = await fixture(t);
  await f.recovered.recoverAfterRestart();
  const result = await f.recovered.controls.cancelBatch({ projectId: f.project.id, batchId: f.bid, reason: 'operator request' });
  await f.exited;
  await t.test('explicit cancellation confirms the owned group has stopped', async () => {
    assert.equal(result.complete, true);
    assert.equal((await observeRecordedExecution(f.receiptPath, f.commandId)).active, false);
  });
  await t.test('explicit cancellation persists a durable stop fence', () => assert.equal(existsSync(f.receiptPath + '.stop'), true));
  await t.test('explicit cancellation reaches cancelled and inactive state', () => {
    assert.equal(f.read().batches[0].status, 'cancelled');
    assert.equal(f.read().batches[0].execution.active, false);
    assert.equal(f.read().batches[0].cancellation.reason, 'operator request');
  });
  await t.test('explicit cancellation releases its exact machine', () => {
    assert.equal(f.read().machines[0].status, 'idle');
    assert.equal(f.read().machines[0].executionId, null);
  });
  await t.test('explicit cancellation preserves delivered results and cancels undelivered work', () => {
    assert.equal(f.read().missions[0].status, 'cancelled');
    assert.equal(f.read().missions[1].status, 'done');
    assert.equal(f.read().missions[1].resultCommit, 'existing-result');
  });
  await t.test('cancellation diagnostics preserve the original worktree path', async () => {
    const diagnostic = JSON.parse(await readFile(join(f.read().batches[0].cancellation.diagnosticPath, 'cancellation.json'), 'utf8'));
    assert.equal(diagnostic.preservedWorktree, f.worktree);
    assert.equal(existsSync(f.worktree), true);
  });
  await t.test('repeated cancellation retains the first operation identifier', async () => {
    const again = await f.recovered.controls.cancelBatch({ projectId: f.project.id, batchId: f.bid });
    assert.equal(again.idempotent, true);
    assert.equal(again.batch.cancellation.operationId, result.batch.cancellation.operationId);
  });
  await t.test('stale recovery tick cannot turn cancelled into failed', async () => {
    await f.recovered.checkRecoveredBatches();
    assert.equal(f.read().batches[0].status, 'cancelled');
    assert.equal(f.recovered.controls.restartedBatches.size, 0);
    assert.equal(existsSync(f.artifact), false);
  });
});

test('startup resumes a persisted explicit cancellation while ordinary observations remain read only', async t => {
  const f = await fixture(t, { cancelling: true });
  await f.service.mutate(f.project.id, p => ({ ...p, control: { state: 'finishing', revision: 2 } }));
  await f.recovered.recoverAfterRestart();
  await f.exited;
  await t.test('persisted cancellation is completed during startup', () => assert.equal(f.read().batches[0].status, 'cancelled'));
  await t.test('persisted cancellation stops the live group and writes its fence', async () => {
    assert.equal((await observeRecordedExecution(f.receiptPath, f.commandId)).active, false);
    assert.equal(existsSync(f.receiptPath + '.stop'), true);
  });
  await t.test('startup retains the operator cancellation identity and reason', () => {
    assert.equal(f.read().batches[0].cancellation.operationId, 'operator-cancel');
    assert.equal(f.read().batches[0].cancellation.reason, 'operator request');
  });
  await t.test('persisted cancellation allows the finishing project to settle', () => {
    assert.equal(f.read().control.state, 'finished');
    assert.equal(f.read().machines[0].status, 'idle');
  });
});

test('unverifiable command ownership retains busy execution until observation becomes trustworthy', async t => {
  const f = await fixture(t);
  const receipt = JSON.parse(f.originalReceipt);
  await writeFile(f.receiptPath, JSON.stringify({ ...receipt, start: '0' }));
  await f.recovered.recoverAfterRestart();
  await t.test('changed process start identity retains active batch and machine', () => {
    assert.equal(f.read().batches[0].status, 'running');
    assert.equal(f.read().batches[0].execution.active, true);
    assert.equal(f.read().machines[0].status, 'busy');
  });
  await t.test('uncertain ordinary recovery cannot create cancellation intent or a stop fence', () => {
    assert.equal(f.read().batches[0].cancellation, undefined);
    assert.equal(existsSync(f.receiptPath + '.stop'), false);
  });
  // A mismatched execution id remains uncertain independently of PID lifetime.
  await writeFile(f.receiptPath, JSON.stringify({ ...receipt, executionId: 'another-command' }));
  await f.release();
  await t.test('a receipt belonging to another execution stays tracked even after its processes exit', async () => {
    await f.recovered.checkRecoveredBatches();
    assert.equal(f.read().batches[0].status, 'running');
    assert.equal(f.recovered.controls.restartedBatches.size, 1);
  });
  await t.test('restoring trustworthy ownership permits the next tick to settle without a restart', async () => {
    await writeFile(f.receiptPath, f.originalReceipt);
    await f.recovered.checkRecoveredBatches();
    assert.equal(f.read().batches[0].status, 'failed');
  });
});

test('ordinary infra recovery preserves uncertainty and explicit cancellation keeps its receipt boundary', async t => {
  const f = await fixture(t);
  await f.release();
  await f.service.mutate(f.project.id, p => ({ ...p, batches: p.batches.map(b => ({ ...b, status: 'forming',
    execution: { ...b.execution, role: 'infra', commands: [] } })) }));
  await f.recovered.recoverAfterRestart();
  await t.test('unreconstructed InfraOptimizer activation stays active with the machine occupied', () => {
    assert.equal(f.read().batches[0].status, 'forming');
    assert.equal(f.read().batches[0].execution.active, true);
    assert.equal(f.read().machines[0].status, 'busy');
  });
  await t.test('ordinary infra recovery creates neither cancellation nor stop fences', () => {
    assert.equal(f.read().batches[0].cancellation, undefined);
    assert.equal(existsSync(f.receiptPath + '.stop'), false);
  });
  await t.test('uncertain infra recovery prevents a duplicate activation', async () => {
    await assert.rejects(f.recovered.runInfra({ projectId: f.project.id, batchId: f.bid, agent: { id: 'leader' } }), /active execution/);
    assert.equal(f.read().batches[0].status, 'forming');
  });
  await t.test('explicit infra cancellation remains incomplete without the exact activation receipt', async () => {
    const result = await f.recovered.controls.cancelBatch({ projectId: f.project.id, batchId: f.bid });
    assert.equal(result.complete, false);
    assert.equal(result.batch.status, 'cancelling');
    assert.match(result.error, /receipt is unavailable/);
    assert.equal(f.read().machines[0].status, 'busy');
  });
});

test('recovered settlement respects execution replacements and newer machine owners', async t => {
  for (const change of ['execution-id', 'execution-host', 'machine-execution']) {
    await t.test(change, async st => {
      const f = await fixture(st);
      await f.recovered.recoverAfterRestart();
      await f.service.mutate(f.project.id, p => ({ ...p,
        batches: p.batches.map(b => change === 'machine-execution' ? b : { ...b,
          execution: { ...b.execution, ...(change === 'execution-id' ? { id: 'replacement' } : { hostId: 'replacement-host' }) } }),
        machines: p.machines.map(m => change === 'machine-execution' ? { ...m, executionId: 'replacement' } : m),
      }));
      await f.release();
      await f.recovered.checkRecoveredBatches();
      assert.equal(f.read().machines[0].status, 'busy');
      assert.equal(f.read().batches[0].status, change === 'machine-execution' ? 'failed' : 'running');
      assert.equal(f.recovered.controls.restartedBatches.size, 0);
    });
  }
});
