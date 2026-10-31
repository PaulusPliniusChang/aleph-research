import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runOwnedCommand, stopRecordedExecution, observeRecordedExecution } from './execution-owner.mjs';

const timestamp = () => new Date().toISOString();
const id = prefix => `${prefix}-${randomUUID()}`;
export const controlOf = project => project.control ?? { state: 'running', revision: 0 };
export const conflict = message => Object.assign(new Error(message), { code: 'ALEPH_CONTROL_CONFLICT', status: 409 });

/** One Host writes a project. All bounded state/Git publication uses this lock. */
export class ProjectControls {
  constructor(service) {
    this.service = service;
    this.locks = new Map();
    this.owners = new Map();
    this.composers = new Map();
    this.hostId = id('host');
    this.cancellations = new Map();
  }

  async lock(projectId, work) {
    const previous = this.locks.get(projectId) ?? Promise.resolve();
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const tail = previous.catch(() => {}).then(() => held);
    this.locks.set(projectId, tail);
    await previous.catch(() => {});
    try { return await work(); }
    finally { release(); if (this.locks.get(projectId) === tail) this.locks.delete(projectId); }
  }

  project(projectId) {
    const project = this.service.get(projectId);
    if (!project) throw Object.assign(new Error(`project not found: ${projectId}`), { status: 404 });
    return project;
  }

  gate(projectId, action = 'dispatch') {
    const project = this.project(projectId);
    const state = controlOf(project).state;
    if (state !== 'running' && !(state === 'paused' && action === 'approve')) {
      throw conflict(`project ${projectId} is ${state}; ${action} is blocked; saved work is retained`);
    }
    return project;
  }

  async admitted(projectId, action, work) {
    return this.lock(projectId, () => { this.gate(projectId, action); return work(); });
  }

  async maybeFinished(projectId) {
    await this.lock(projectId, async () => {
      const project = this.project(projectId);
      if (controlOf(project).state !== 'finishing') return;
      const active = project.batches.some(batch => ['running', 'cancelling'].includes(batch.status) || batch.execution?.active)
        || [...this.owners.values()].some(owner => owner.projectId === projectId);
      if (!active) await this.service.mutate(projectId, current => ({ ...current,
        control: { ...controlOf(current), state: 'finished', changedAt: timestamp() } }));
    });
    if (controlOf(this.project(projectId)).state === 'finished') {
      const owner = this.composers.get(projectId);
      if (owner?.receipt?.dispose && !owner.cleanupPromise) {
        await this.service.mutate(projectId, p => ({ ...p, control: { ...controlOf(p), composerCleanup: 'pending' } }));
        // A Composer can be the caller of the last running Host tool. Its dispose
        // waits for that tool to return; never await disposal from the same tool.
        owner.cleanupPromise = new Promise(resolve => setImmediate(resolve)).then(async () => {
          try {
            await owner.receipt.dispose();
            this.composers.delete(projectId);
            await this.service.mutate(projectId, p => ({ ...p, control: { ...controlOf(p), composerCleanup: 'complete', cleanupError: null } }));
          } catch (error) {
            await this.service.mutate(projectId, p => ({ ...p, control: { ...controlOf(p), composerCleanup: 'failed', cleanupError: String(error) } }));
          }
        }).catch(() => {});
      }
    }
  }

  async change({ projectId, operation, reason = '', agent = null }) {
    let repeated = false;
    await this.lock(projectId, async () => {
      const project = this.project(projectId);
      const current = controlOf(project);
      let state;
      if (operation === 'pause') {
        if (current.state === 'paused') repeated = true;
        else if (current.state !== 'running') throw conflict(`cannot pause ${current.state} project`);
        state = 'paused';
      } else if (operation === 'resume') {
        if (current.state === 'running') repeated = true;
        else if (current.state !== 'paused') throw conflict(`cannot resume ${current.state} project`);
        state = 'running';
      } else {
        if (['finishing', 'finished'].includes(current.state)) repeated = true;
        state = 'finishing';
      }
      if (!repeated) await this.service.mutate(projectId, p => ({ ...p,
        control: { state, revision: current.revision + 1, changedAt: timestamp(), reason,
          operationId: id(operation) } }));
    });
    let notification = { delivered: false, reason: repeated ? 'already applied' : 'dispatch closed' };
    if (operation === 'resume' && !repeated) {
      notification = await this.service.notifyComposer({ projectId, agent, event: 'project resumed' })
        .catch(error => ({ delivered: false, reason: String(error) }));
    }
    if (operation !== 'resume' && !repeated) {
      const record = (this.project(projectId).agents ?? []).filter(a => a.role === 'composer' && a.childId).pop();
      const parent = record && (this.composers.get(projectId)?.parent ?? this.service.parentAgents?.get(record.childId));
      if (parent && this.service.subagents) {
        try {
          await this.service.subagents.sendMessage(parent, record.childId, [{ type: 'text',
            text: `Project control is ${controlOf(this.project(projectId)).state}. Do not dispatch new work; existing execution may drain.` }], { signal: new AbortController().signal });
          notification = { delivered: true, childId: record.childId };
        } catch (error) { notification = { delivered: false, reason: String(error) }; }
      }
    }
    if (operation === 'finish') await this.maybeFinished(projectId);
    return { projectId, control: controlOf(this.project(projectId)), idempotent: repeated, notification };
  }

  async cancelMission({ projectId, missionId, reason = '' }) {
    return this.lock(projectId, async () => {
      const project = this.project(projectId);
      const mission = project.missions.find(item => item.id === missionId);
      if (!mission) throw Object.assign(new Error(`mission not found: ${missionId}`), { status: 404 });
      if (['batched', 'running'].includes(mission.status)) throw conflict(`mission belongs to batch ${mission.batchId}; cancel that whole batch`);
      const terminal = ['done', 'failed', 'cancelled'].includes(mission.status);
      if (!terminal) await this.service.mutate(projectId, current => ({ ...current,
        missions: current.missions.map(item => item.id === missionId ? { ...item, status: 'cancelled',
          cancelledAt: timestamp(), cancelReason: reason, cancelOperationId: id('cancel-mission'), finishedAt: timestamp() } : item) }));
      return { projectId, mission: this.project(projectId).missions.find(item => item.id === missionId),
        idempotent: terminal, complete: true };
    });
  }

  key(projectId, batchId) { return `${projectId}/${batchId}`; }

  async reserve(projectId, batchId, role) {
    return this.lock(projectId, async () => {
      const project = this.gate(projectId, role);
      const batch = project.batches.find(item => item.id === batchId);
      if (!batch) throw Object.assign(new Error(`batch not found: ${batchId}`), { status: 404 });
      if (batch.status !== 'forming' || batch.execution?.active || this.owners.has(this.key(projectId, batchId))) {
        throw conflict(`batch ${batchId} has active execution or status ${batch.status}`);
      }
      const executionId = id(role);
      const owner = { projectId, batchId, role, executionId, abort: new AbortController(),
        worktree: join(project.workspace, '.aleph', role === 'infra' ? 'infra' : 'batches', batchId),
        commands: [], ordinal: 0, stopped: true, hostId: this.hostId };
      owner.finished = new Promise(resolve => { owner.finish = resolve; });
      this.owners.set(this.key(projectId, batchId), owner);
      try {
        await this.service.mutate(projectId, p => ({ ...p,
          batches: p.batches.map(b => b.id === batchId ? { ...b, execution: {
            id: executionId, role, active: true, hostId: this.hostId, phase: 'reserved', commands: [], worktree: owner.worktree,
          } } : b),
          machines: p.machines.map(machine => machine.batchId === batchId ? { ...machine, executionId } : machine),
        }));
      } catch (error) { this.owners.delete(this.key(projectId, batchId)); owner.finish(); throw error; }
      return owner;
    });
  }

  check(owner) {
    const batch = this.project(owner.projectId).batches.find(item => item.id === owner.batchId);
    if (batch?.execution?.id !== owner.executionId || ['cancelling', 'cancelled'].includes(batch.status) || owner.abort.signal.aborted) {
      throw Object.assign(conflict('batch execution was cancelled or superseded'), { code: 'ALEPH_CANCELLED' });
    }
    return batch;
  }

  async command(owner, command, args, options) {
    let record;
    await this.lock(owner.projectId, async () => {
      this.check(owner);
      record = { id: `${owner.executionId}-${++owner.ordinal}`, phase: 'starting',
        receiptPath: join(this.project(owner.projectId).workspace, '.aleph', 'executions', owner.executionId, `${owner.ordinal}.json`) };
      owner.commands.push(record);
      await this.saveCommands(owner, 'command');
    });
    try {
      const result = await runOwnedCommand(command, args, { ...options,
        executionId: record.id, receiptPath: record.receiptPath, signal: owner.abort.signal });
      record.phase = 'stopped';
      return result;
    } catch (error) {
      record.phase = error.executionStopped === false ? 'uncertain' : 'stopped';
      owner.stopped = error.executionStopped !== false;
      owner.cleanupError = owner.stopped ? null : error;
      throw error;
    } finally { await this.saveCommands(owner, 'between-commands'); }
  }

  async saveCommands(owner, phase) {
    await this.service.mutate(owner.projectId, p => ({ ...p, batches: p.batches.map(batch =>
      batch.id === owner.batchId && batch.execution?.id === owner.executionId
        ? { ...batch, execution: { ...batch.execution, phase, commands: owner.commands.map(command => ({ ...command })) } } : batch) }));
  }

  async end(owner) {
    await this.lock(owner.projectId, async () => {
      await this.service.mutate(owner.projectId, p => ({ ...p, batches: p.batches.map(batch =>
        batch.id === owner.batchId && batch.execution?.id === owner.executionId
          ? { ...batch, execution: { ...batch.execution, active: !owner.stopped, phase: owner.stopped ? 'stopped' : 'uncertain' } } : batch) }));
      if (owner.stopped) this.owners.delete(this.key(owner.projectId, owner.batchId));
      owner.finish();
    });
    await this.maybeFinished(owner.projectId);
  }

  async cancelBatch({ projectId, batchId, reason = '' }) {
    let terminal;
    await this.lock(projectId, async () => {
      const project = this.project(projectId);
      const batch = project.batches.find(item => item.id === batchId);
      if (!batch) throw Object.assign(new Error(`batch not found: ${batchId}`), { status: 404 });
      if (['done', 'failed', 'cancelled'].includes(batch.status)) { terminal = batch; return; }
      if (batch.status !== 'cancelling') await this.service.mutate(projectId, p => ({ ...p,
        batches: p.batches.map(item => item.id === batchId ? { ...item, status: 'cancelling',
          cancellation: { operationId: id('cancel-batch'), reason, requestedAt: timestamp(), complete: false } } : item) }));
    });
    if (terminal) return { projectId, batch: terminal, complete: true, idempotent: true };
    const key = this.key(projectId, batchId);
    const owner = this.owners.get(key);
    if (this.cancellations.has(key)) return this.cancellations.get(key);
    const stop = this.completeCancellation(projectId, batchId, owner);
    this.cancellations.set(key, stop);
    stop.finally(() => { this.cancellations.delete(key); }).catch(() => {});
    return stop;
  }

  async completeCancellation(projectId, batchId, owner) {
    try {
      if (owner) {
        owner.abort.abort();
        // Exact receipt disposal must succeed even when result resolves successfully.
        if (owner.receipt) {
          try { await owner.receipt.dispose(); }
          catch (error) { owner.stopped = false; owner.cleanupError = error; throw error; }
        }
        await owner.finished;
        if (owner.cleanupError?.retryCleanup) {
          await owner.cleanupError.retryCleanup(); owner.stopped = true; owner.cleanupError = null;
        }
        if (!owner.stopped) throw owner.cleanupError ?? new Error('execution cleanup remains uncertain');
      } else {
        const batch = this.project(projectId).batches.find(b => b.id === batchId);
        if (batch.execution?.active) {
          if (batch.execution.role === 'infra') throw new Error('InfraOptimizer receipt is unavailable after restart; cleanup requires operator confirmation');
          for (const command of batch.execution.commands ?? []) {
            if (command.phase === 'stopped') continue;
            await stopRecordedExecution(command.receiptPath, command.id);
          }
        }
      }
      const project = this.project(projectId);
      const batch = project.batches.find(b => b.id === batchId);
      const diagnosticPath = join(project.workspace, '.aleph', 'diagnostics', batch.cancellation.operationId);
      await mkdir(diagnosticPath, { recursive: true });
      await writeFile(join(diagnosticPath, 'cancellation.json'), JSON.stringify({ projectId, batchId,
        cancellation: batch.cancellation, execution: batch.execution, preservedWorktree: batch.execution?.worktree ?? null }, null, 2));
      await this.lock(projectId, async () => {
        await this.service.mutate(projectId, p => ({ ...p,
          batches: p.batches.map(b => b.id === batchId && b.status === 'cancelling' ? { ...b, status: 'cancelled', finishedAt: timestamp(),
            execution: b.execution ? { ...b.execution, active: false, phase: 'stopped' } : undefined,
            cancellation: { ...b.cancellation, complete: true, confirmedAt: timestamp(), diagnosticPath, cleanupError: null } } : b),
          missions: p.missions.map(mission => mission.batchId === batchId && !['done', 'failed', 'cancelled'].includes(mission.status)
            ? { ...mission, status: 'cancelled', cancelledAt: timestamp(), finishedAt: timestamp(), cancelReason: batch.cancellation.reason,
              cancelOperationId: batch.cancellation.operationId } : mission),
          machines: p.machines.map(machine => machine.batchId === batchId
            && (!batch.execution || machine.executionId === batch.execution.id)
            ? { ...machine, status: 'idle', batchId: null, executionId: null } : machine),
        }));
        this.owners.delete(this.key(projectId, batchId));
      });
      await this.maybeFinished(projectId);
      return { projectId, complete: true, batch: this.project(projectId).batches.find(b => b.id === batchId) };
    } catch (error) {
      await this.service.mutate(projectId, p => ({ ...p, batches: p.batches.map(batch => batch.id === batchId
        ? { ...batch, cancellation: { ...batch.cancellation, complete: false, cleanupError: String(error) } } : batch) }));
      return { projectId, complete: false, batch: this.project(projectId).batches.find(b => b.id === batchId), error: String(error) };
    }
  }

  recover() {
    this.restartRecovery ??= this.initializeRecovery();
    return this.restartRecovery;
  }

  restartIdentity(project, batch) {
    return JSON.stringify([project.workspace, project.missionRoot, batch.id, batch.status,
      batch.machineId, batch.branch, batch.baseTip, batch.createdAt, batch.startedAt,
      batch.execution ?? null]);
  }

  async initializeRecovery() {
    this.restartedBatches = new Map();
    const originals = this.service.list();
    for (const original of originals) {
      for (const batch of original.batches) {
        if (batch.status !== 'cancelling' && (batch.status === 'running' || batch.execution?.active)) {
          this.restartedBatches.set(this.key(original.id, batch.id), {
            projectId: original.id, batchId: batch.id, identity: this.restartIdentity(original, batch),
          });
        }
      }
      const staleAgents = new Set((original.agents ?? []).filter(a => a.status === 'running').map(a => JSON.stringify(a)));
      await this.lock(original.id, () => this.service.mutate(original.id, p => ({ ...p,
        agents: (p.agents ?? []).map(a => staleAgents.has(JSON.stringify(a))
          ? { ...a, status: 'failed', summary: 'interrupted by Host restart', updatedAt: timestamp() } : a),
        // A forming batch already owns a machine. Cancellation and uncertain
        // activations also retain it until their existing stop contract succeeds.
        machines: p.machines.map(machine => machine.status === 'busy' && !p.batches.some(batch =>
          batch.id === machine.batchId && batch.machineId === machine.id
          && (['forming', 'running', 'cancelling'].includes(batch.status) || batch.execution?.active))
          ? { ...machine, status: 'idle', batchId: null, executionId: null } : machine),
      })));
    }
    // Only persisted user cancellation authorizes stopping during startup.
    for (const original of originals) {
      for (const batch of original.batches) {
        if (batch.status === 'cancelling') await this.cancelBatch({ projectId: original.id, batchId: batch.id });
      }
    }
    await this.checkRecoveredBatches();
    for (const original of originals) await this.maybeFinished(original.id);
  }

  checkRecoveredBatches() {
    if (this.restartCheck) return this.restartCheck;
    this.restartCheck = this.reconcileRecoveredBatches().finally(() => { this.restartCheck = null; });
    return this.restartCheck;
  }

  async recoveredActive(project, batch) {
    if (batch.execution?.active) {
      // Activation disposal requires the exact in-memory receipt. Observation
      // cannot invent a receipt or turn an ordinary restart into cancellation.
      if (batch.execution.role === 'infra') return null;
      for (const command of batch.execution.commands ?? []) {
        if (command.phase === 'stopped') continue;
        try { if ((await observeRecordedExecution(command.receiptPath, command.id)).active) return true; }
        catch { return null; }
      }
    }
    // Keep PR29's readable-cwd observation for legacy/no-command windows too.
    return this.service.hasProcessUnder(batch.execution?.worktree
      ?? join(project.workspace, '.aleph', 'batches', batch.id));
  }

  async reconcileRecoveredBatches() {
    for (const [key, tracked] of this.restartedBatches ?? []) {
      const project = this.service.get(tracked.projectId);
      const batch = project?.batches.find(b => b.id === tracked.batchId);
      const matches = (p, b) => b && this.restartIdentity(p, b) === tracked.identity;
      if (!project || !matches(project, batch)) { this.restartedBatches.delete(key); continue; }
      if (await this.recoveredActive(project, batch) !== false) continue;
      try {
        await this.lock(project.id, () => this.service.mutate(project.id, p => {
          const owned = p.batches.find(b => b.id === tracked.batchId);
          if (!matches(p, owned)) return p;
          const finishedAt = timestamp();
          const terminal = ['done', 'failed', 'cancelled'].includes(owned.status);
          return { ...p,
            batches: p.batches.map(b => b.id === owned.id ? { ...b,
              ...(terminal ? {} : { status: 'failed', finishedAt, summary: { ...b.summary, runnerError: 'interrupted by Host restart' } }),
              ...(b.execution ? { execution: { ...b.execution, active: false, phase: 'stopped' } } : {}),
            } : b),
            missions: p.missions.map(m => m.batchId === owned.id && ['batched', 'running'].includes(m.status)
              ? { ...m, status: 'failed', finishedAt, error: 'interrupted by Host restart' } : m),
            machines: p.machines.map(machine => machine.id === owned.machineId && machine.batchId === owned.id
              && (!owned.execution || machine.executionId === owned.execution.id)
              ? { ...machine, status: 'idle', batchId: null, executionId: null } : machine),
            violations: [...(p.violations ?? []), `${finishedAt} recovered from restart: batch ${owned.id} interrupted`].slice(-50),
          };
        }));
        this.restartedBatches.delete(key);
        await this.maybeFinished(project.id);
      } catch { /* Failed durable settlement is retried on the next tick. */ }
    }
  }
}
