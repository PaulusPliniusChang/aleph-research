import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runOwnedCommand, stopRecordedExecution } from './execution-owner.mjs';

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

  async recover() {
    for (const original of this.service.list()) {
      for (const batch of original.batches) {
        if (batch.status === 'cancelling') { await this.cancelBatch({ projectId: original.id, batchId: batch.id }); continue; }
        if (!batch.execution?.active) continue;
        let failure;
        try {
          if (batch.execution.role === 'infra') throw new Error('InfraOptimizer activation identity unavailable after Host restart');
          for (const command of batch.execution.commands ?? []) {
            if (command.phase !== 'stopped') await stopRecordedExecution(command.receiptPath, command.id);
          }
        } catch (error) { failure = String(error); }
        await this.service.mutate(original.id, p => ({ ...p,
          batches: p.batches.map(b => b.id === batch.id ? { ...b,
            status: failure ? 'cancelling' : 'failed', finishedAt: failure ? null : timestamp(),
            execution: { ...b.execution, active: Boolean(failure), phase: failure ? 'uncertain' : 'stopped' },
            ...(failure ? { cancellation: { operationId: id('recover'), reason: 'Host restart', requestedAt: timestamp(), complete: false, cleanupError: failure } }
              : { summary: { ...b.summary, runnerError: 'interrupted by Host restart' } }) } : b),
          missions: p.missions.map(m => m.batchId === batch.id && ['batched', 'running'].includes(m.status)
            ? { ...m, ...(failure ? {} : { status: 'failed', finishedAt: timestamp(), error: 'interrupted by Host restart' }) } : m),
          machines: p.machines.map(machine => !failure && machine.batchId === batch.id && machine.executionId === batch.execution.id
            ? { ...machine, status: 'idle', batchId: null, executionId: null } : machine),
        }));
      }
      // Legacy runs have no authority receipt: retain live/unknown computation; never signal by cwd.
      const interrupted = new Set(original.batches.filter(b => !b.execution && b.status === 'running'
        && !this.service.hasProcessUnder(join(original.workspace, '.aleph', 'batches', b.id))).map(b => b.id));
      await this.service.mutate(original.id, p => ({ ...p,
        agents: (p.agents ?? []).map(a => a.status === 'running' ? { ...a, status: 'failed', summary: 'interrupted by Host restart', updatedAt: timestamp() } : a),
        batches: p.batches.map(b => interrupted.has(b.id) ? { ...b, status: 'failed', finishedAt: timestamp(), summary: { runnerError: 'interrupted by Host restart' } } : b),
        missions: p.missions.map(m => interrupted.has(m.batchId) && ['batched', 'running'].includes(m.status) ? { ...m, status: 'failed', finishedAt: timestamp(), error: 'interrupted by Host restart' } : m),
        machines: p.machines.map(machine => interrupted.has(machine.batchId) ? { ...machine, status: 'idle', batchId: null, executionId: null } : machine),
      }));
      await this.maybeFinished(original.id);
    }
  }
}
