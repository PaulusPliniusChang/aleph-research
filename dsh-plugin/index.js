/**
 * AlephResearch Host plugin (DSH-native control plane).
 *
 * Campaign, mission and branch state lives in the DSH storage domain
 * `aleph-research`; no `~/.aleph` pointer, SQLite sidecar or external daemon is
 * used. Leader tools create campaigns and dispatch one researcher per mission
 * through `ctx.subagents.startActivation` with the `aleph-researcher` preset.
 * Mission worktrees and logs stay inside the selected DSH workspace.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { cpus, freemem, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { z } from 'zod';

const execFileAsync = promisify(execFile);
const DOMAIN_NAME = 'aleph_research';
const HANDOFF_FILE = 'ALEPH_HANDOFF.md';

const missionSchema = z.object({
  id: z.string(),
  description: z.string(),
  status: z.enum(['queued', 'running', 'done', 'failed']),
  strategy: z.string(),
  baseBranch: z.string(),
  branch: z.string(),
  baseCommit: z.string().nullable(),
  commit: z.string().nullable(),
  score: z.number().nullable(),
  error: z.string().nullable(),
  childId: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  reclaimed: z.boolean(),
  batch: z.string().nullable().optional(),
  promoted: z.boolean().optional(),
  priority: z.number().optional(),
  vramMb: z.number().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  gpuSeconds: z.number().nullable().optional(),
  evalSeconds: z.number().nullable().optional(),
  diskBytes: z.number().nullable().optional(),
});

const campaignSchema = z.object({
  id: z.string(),
  title: z.string(),
  workspace: z.string(),
  status: z.enum(['running', 'paused', 'draft']),
  exploration: z.number(),
  budget: z.number().nullable().optional(),
  spent: z.number(),
  sotaBranch: z.string().nullable(),
  sotaScore: z.number(),
  evalCommand: z.string(),
  researchRoot: z.string(),
  visibleData: z.string().nullable(),
  testsetPath: z.string().nullable().optional(),
  submissionPython: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  missions: z.array(missionSchema),
  maxParallel: z.number().int().optional(),
  batches: z.array(z.object({
    id: z.string(),
    brief: z.string(),
    count: z.number().int(),
    createdAt: z.string(),
  })).optional(),
  infra: z.object({
    cpuCount: z.number().int(),
    gpuCount: z.number().int(),
    gpuNames: z.array(z.string()),
    gpuMemoryTotalMb: z.number().nullable().optional(),
    gpuMemoryFreeMb: z.number().nullable().optional(),
    maxParallel: z.number().int(),
    diskFreeBytes: z.number().nullable(),
    diskTotalBytes: z.number().nullable(),
    memoryTotalBytes: z.number().nullable(),
    checkedAt: z.string(),
  }).optional(),
  agents: z.array(z.object({
    role: z.enum(['composer', 'infra']),
    childId: z.string().nullable(),
    status: z.enum(['running', 'done', 'failed']),
    summary: z.string().nullable(),
    branch: z.string().nullable().optional(),
    updatedAt: z.string(),
  })).optional(),
  runtime: z.object({
    ompThreads: z.number().int(),
    evalTimeoutMs: z.number().int(),
  }).optional(),
  cache: z.object({
    hits: z.number().int(),
    misses: z.number().int(),
    entries: z.record(z.string(), z.number()),
  }).optional(),
  costProfile: z.object({
    missions: z.number().int(),
    gpuSeconds: z.number(),
    evalSeconds: z.number(),
    diskBytes: z.number(),
  }).optional(),
  budgetVector: z.object({
    missions: z.number().nullable(),
    gpuSeconds: z.number().nullable(),
    diskBytes: z.number().nullable(),
  }).optional(),
});

const campaignDomain = defineDomain({
  name: DOMAIN_NAME,
  version: 1,
  tables: { campaigns: domainTable(campaignSchema) },
});

const STRATEGIES = ['L0', 'L1', 'L2', 'L3'];
const PRIORS = { L0: 0.9, L1: 0.85, L2: 0.75, L3: 0.6 };
const FLOOR = 0.03;

function now() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function sampleStrategy(exploration, seed = Date.now()) {
  const value = Math.min(1, Math.max(0, exploration));
  const tau = 0.15 + 0.45 * value;
  const exps = {};
  let total = 0;
  for (const name of STRATEGIES) {
    exps[name] = Math.exp(PRIORS[name] / tau);
    total += exps[name];
  }
  // Deterministic per-mission randomness is enough for the first Host slice.
  let roll = (seed % 10000) / 10000;
  let chosen = STRATEGIES[STRATEGIES.length - 1];
  for (const name of STRATEGIES) {
    const probability = Math.max(FLOOR, exps[name] / total);
    roll -= probability;
    if (roll <= 0) {
      chosen = name;
      break;
    }
  }
  return chosen;
}

function baseBranch(campaign) {
  return campaign.sotaBranch || 'initialize';
}

function strategyPriority(strategy) {
  return { L3: 3, L2: 2, L1: 1, L0: 0 }[strategy] ?? 0;
}

function defaultVramMb(campaign) {
  const total = campaign.infra?.gpuMemoryTotalMb;
  if (typeof total !== 'number' || total <= 0) return null;
  return Math.max(1024, Math.floor((total * 0.8) / Math.max(1, campaign.maxParallel ?? 1)));
}

function countStatuses(missions) {
  const counts = { queued: 0, running: 0, done: 0, failed: 0 };
  for (const mission of missions) counts[mission.status] = (counts[mission.status] ?? 0) + 1;
  return counts;
}

function snapshot(campaign) {
  const branches = new Map();
  for (const mission of campaign.missions) {
    if (!mission.branch || !mission.commit) continue;
    branches.set(mission.branch, {
      name: mission.branch,
      score: mission.score,
      parent: mission.baseBranch,
      mission: mission.id,
      is_sota: false,
    });
  }
  if (campaign.sotaBranch) {
    branches.set(campaign.sotaBranch, {
      name: campaign.sotaBranch,
      score: campaign.sotaScore,
      parent: null,
      mission: null,
      is_sota: true,
    });
  }
  return {
    schema: 1,
    generated_at: now(),
    workspace: campaign.workspace,
    campaign: {
      id: campaign.id,
      title: campaign.title,
      status: campaign.status,
      exploration: campaign.exploration,
      sota_branch: campaign.sotaBranch,
      sota_score: campaign.sotaBranch ? campaign.sotaScore : null,
      budget: campaign.budget ?? null,
      spent: campaign.spent,
      max_parallel: campaign.maxParallel ?? 1,
      active_agents: campaign.missions.filter((mission) => mission.status === 'running').length,
      infra: campaign.infra ?? null,
      batches: campaign.batches ?? [],
      agents: (campaign.agents ?? []).map((agent) => ({ ...agent, branch: agent.branch ?? null })),
      runtime: campaign.runtime ?? null,
      cache: campaign.cache ?? { hits: 0, misses: 0, entries: {} },
      cost_profile: campaign.costProfile ?? { missions: 0, gpuSeconds: 0, evalSeconds: 0, diskBytes: 0 },
      budget_vector: campaign.budgetVector ?? { missions: null, gpuSeconds: null, diskBytes: null },
    },
    missions: campaign.missions.map((mission) => ({
      id: mission.id,
      status: mission.status,
      strategy: mission.strategy,
      branch: mission.branch,
      score: mission.score,
      description: mission.description,
      batch: mission.batch ?? null,
      promoted: mission.promoted === true,
      priority: mission.priority ?? 0,
      vram_mb: mission.vramMb ?? null,
      gpu_seconds: mission.gpuSeconds ?? null,
      eval_seconds: mission.evalSeconds ?? null,
      created_at: mission.createdAt,
      finished_at: mission.finishedAt,
    })),
    branches: [...branches.values()],
    counts: countStatuses(campaign.missions),
  };
}

function parseScore(stdout) {
  const lines = String(stdout ?? '').split(/\r?\n/).reverse();
  for (const line of lines) {
    const text = line.trim();
    if (!text.startsWith('{')) continue;
    try {
      const value = JSON.parse(text);
      if (value && typeof value.score === 'number') return value;
    } catch {
      // Keep scanning; evaluators may print other JSON lines.
    }
  }
  return null;
}

async function run(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    timeout: options.timeout ?? 600_000,
    maxBuffer: 32 * 1024 * 1024,
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
  });
  return result;
}

async function git(repo, args, timeout = 120_000) {
  return run('git', ['-C', repo, ...args], { timeout });
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function detectInfra(workspace) {
  const cpuCount = Math.max(1, cpus().length);
  const gpuNames = [];
  let gpuMemoryTotalMb = null;
  let gpuMemoryFreeMb = null;
  try {
    const result = await run('nvidia-smi', ['--query-gpu=name,memory.total,memory.free', '--format=csv,noheader,nounits'], { timeout: 5_000 });
    for (const line of result.stdout.split(/\r?\n/)) {
      const [name, total, free] = line.split(',').map((part) => part.trim());
      if (!name) continue;
      gpuNames.push(name);
      if (Number.isFinite(Number(total)) && gpuMemoryTotalMb === null) gpuMemoryTotalMb = Number(total);
      if (Number.isFinite(Number(free)) && gpuMemoryFreeMb === null) gpuMemoryFreeMb = Number(free);
    }
  } catch {
    // CPU-only hosts are the common case.
  }
  let diskFreeBytes = null;
  let diskTotalBytes = null;
  try {
    const info = await statfs(workspace);
    diskFreeBytes = info.bavail * info.bsize;
    diskTotalBytes = info.blocks * info.bsize;
  } catch {
    // Keep unknown disk capacity explicit.
  }
  const configured = Number(process.env.ALEPH_MAX_PARALLEL);
  const maxParallel = Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : Math.max(1, Math.min(4, Math.floor(cpuCount / 2), gpuNames.length > 0 ? gpuNames.length * 2 : 4));
  return {
    cpuCount,
    gpuCount: gpuNames.length,
    gpuNames,
    gpuMemoryTotalMb,
    gpuMemoryFreeMb,
    maxParallel,
    diskFreeBytes,
    diskTotalBytes,
    memoryTotalBytes: totalmem ? totalmem() : null,
    checkedAt: now(),
  };
}

/** Host-side service shared by tools and HTTP routes. */
class AlephService {
  constructor(ctx, domain, deps) {
    this.ctx = ctx;
    this.domain = domain;
    this.table = domain.table('campaigns');
    this.sessions = deps.sessions;
    this.subagents = deps.subagents;
    this.agentPresets = deps.agentPresets;
    this.writeChain = Promise.resolve();
    this.dispatchChain = Promise.resolve();
    this.evalChain = Promise.resolve();
    this.activations = new Set();
  }

  list() {
    return [...this.table.entries()].map(([, campaign]) => campaign);
  }

  get(id) {
    return this.table.get(id);
  }

  async mutate(campaignId, update) {
    const operation = async () => {
      const current = this.table.get(campaignId);
      if (!current) throw new Error(`campaign not found: ${campaignId}`);
      const next = { ...update(current), updatedAt: now() };
      await this.table.put(campaignId, next);
      return next;
    };
    const queued = this.writeChain.then(operation, operation);
    this.writeChain = queued.catch(() => undefined);
    return queued;
  }

  sessionFor(agent) {
    return this.sessions?.get(agent?.id);
  }

  assertWorkspace(agent, workspace) {
    const sessionRoot = this.sessionFor(agent)?.header?.cwd;
    if (typeof sessionRoot !== 'string' || sessionRoot === '') return;
    const root = resolve(sessionRoot);
    const target = resolve(workspace);
    if (target !== root && !target.startsWith(`${root}/`)) {
      throw new Error(
        `campaign workspace ${target} is outside the DSH session workspace ${root}; ` +
        'open the leader workspace as the DSH workspace before starting or dispatching a campaign',
      );
    }
  }

  workspaceFor(agent, explicit) {
    if (typeof explicit === 'string' && explicit.trim() !== '') return resolve(explicit.trim());
    const session = this.sessionFor(agent);
    const cwd = session?.header?.cwd;
    if (typeof cwd === 'string' && cwd !== '') return resolve(cwd);
    throw new Error('workspace is required when the calling session has no cwd');
  }

  async create({ workspace, title, evalCommand = 'python3 eval/run_eval.py', visibleData = null, testsetPath = null, submissionPython = null }) {
    const target = resolve(workspace);
    if (!(await pathExists(target))) throw new Error(`workspace does not exist: ${target}`);
    const campaignId = newId('c');
    const researchRoot = join(target, 'research');
    if (!(await pathExists(join(researchRoot, '.git')))) {
      await mkdir(researchRoot, { recursive: true });
      await git(researchRoot, ['init', '-b', 'initialize']);
      await writeFile(join(researchRoot, 'README.md'), '# Research repository\n', 'utf8');
      await git(researchRoot, ['add', '-A']);
      await git(researchRoot, ['-c', 'user.name=AlephResearch', '-c', 'user.email=aleph@localhost', 'commit', '-m', 'initialize contract']);
      await git(researchRoot, ['branch', 'sota/main', 'initialize']);
    }
    await mkdir(join(target, '.aleph'), { recursive: true });
    const infra = await detectInfra(target);
    const stamp = now();
    const campaign = {
      id: campaignId,
      title: typeof title === 'string' && title.trim() ? title.trim() : target.split('/').pop() || 'Aleph campaign',
      workspace: target,
      status: 'running',
      exploration: 0.7,
      budget: null,
      spent: 0,
      sotaBranch: null,
      sotaScore: -999999,
      evalCommand,
      researchRoot,
      visibleData: typeof visibleData === 'string' && visibleData ? resolve(visibleData) : null,
      testsetPath: typeof testsetPath === 'string' && testsetPath ? resolve(testsetPath) : null,
      submissionPython: typeof submissionPython === 'string' && submissionPython ? submissionPython : null,
      createdAt: stamp,
      updatedAt: stamp,
      missions: [],
      maxParallel: infra.maxParallel,
      batches: [],
      infra,
      agents: [],
      runtime: { ompThreads: 0, evalTimeoutMs: 180_000 },
      cache: { hits: 0, misses: 0, entries: {} },
      costProfile: { missions: 0, gpuSeconds: 0, evalSeconds: 0, diskBytes: 0 },
      budgetVector: { missions: null, gpuSeconds: null, diskBytes: null },
    };
    await this.table.put(campaignId, campaign);
    return campaign;
  }

  newMission(campaign, description, strategy, batch = null, options = {}) {
    const branch = baseBranch(campaign);
    return {
      id: newId('m'),
      description: description || 'researcher mission',
      status: 'queued',
      strategy,
      baseBranch: branch,
      branch,
      baseCommit: null,
      commit: null,
      score: null,
      error: null,
      childId: null,
      createdAt: now(),
      finishedAt: null,
      reclaimed: false,
      batch,
      priority: Number.isFinite(options.priority) ? options.priority : strategyPriority(strategy),
      vramMb: Number.isFinite(options.vramMb) ? options.vramMb : defaultVramMb(campaign),
      startedAt: null,
      gpuSeconds: null,
      evalSeconds: null,
      diskBytes: null,
    };
  }

  async enqueue({ campaignId, description = '', strategy = 'auto' }) {
    return this.mutate(campaignId, (campaign) => {
      const chosen = strategy !== 'auto' && STRATEGIES.includes(strategy)
        ? strategy
        : sampleStrategy(campaign.exploration, Date.now() + campaign.missions.length);
      return { ...campaign, missions: [...campaign.missions, this.newMission(campaign, description, chosen)] };
    });
  }

  async compose({ campaignId, brief, count = 2, strategies = null, priorities = null, vramMb = null }) {
    const requested = Math.max(1, Math.min(4, Number(count) || 1));
    return this.mutate(campaignId, (campaign) => {
      const pending = campaign.missions.filter((mission) => mission.status === 'queued').length;
      const missionLimit = campaign.budgetVector?.missions ?? campaign.budget;
      if (missionLimit != null && campaign.spent + pending + requested > missionLimit) {
        throw new Error(`campaign mission budget ${missionLimit} would be exceeded`);
      }
      const batchId = newId('b');
      const chosen = Array.isArray(strategies) && strategies.length > 0
        ? strategies.filter((name) => STRATEGIES.includes(name))
        : STRATEGIES;
      const missions = [];
      for (let index = 0; index < requested; index += 1) {
        const strategy = chosen[index % chosen.length] ?? sampleStrategy(campaign.exploration, Date.now() + index);
        const priority = Array.isArray(priorities) && Number.isFinite(Number(priorities[index]))
          ? Number(priorities[index])
          : strategyPriority(strategy);
        const vram = Array.isArray(vramMb) && Number.isFinite(Number(vramMb[index]))
          ? Number(vramMb[index])
          : defaultVramMb(campaign);
        missions.push(this.newMission(campaign, `${brief} [${batchId} #${index + 1}]`, strategy, batchId, { priority, vramMb: vram }));
      }
      const batch = { id: batchId, brief, count: requested, createdAt: now() };
      return {
        ...campaign,
        missions: [...campaign.missions, ...missions],
        batches: [...(campaign.batches ?? []), batch],
      };
    });
  }

  async setBudgetVector({ campaignId, missions = null, gpuSeconds = null, diskBytes = null }) {
    const value = (input) => (input === null || input === undefined ? null : Math.max(0, Number(input)));
    return this.mutate(campaignId, (campaign) => ({
      ...campaign,
      budgetVector: { missions: value(missions), gpuSeconds: value(gpuSeconds), diskBytes: value(diskBytes) },
    }));
  }

  async setRuntime({ campaignId, ompThreads = 0, evalTimeoutMs = 180_000 }) {
    const threads = Math.max(0, Math.floor(Number(ompThreads) || 0));
    const timeout = Math.max(10_000, Math.floor(Number(evalTimeoutMs) || 180_000));
    return this.mutate(campaignId, (campaign) => ({
      ...campaign,
      runtime: { ompThreads: threads, evalTimeoutMs: timeout },
    }));
  }

  async setParallel({ campaignId, maxParallel }) {
    const value = Math.max(1, Math.min(8, Math.floor(Number(maxParallel) || 1)));
    return this.mutate(campaignId, (campaign) => ({
      ...campaign,
      maxParallel: value,
      infra: campaign.infra ? { ...campaign.infra, maxParallel: value, checkedAt: now() } : campaign.infra,
    }));
  }

  async runAgent({ campaignId, role, agent }) {
    if (!agent) throw new Error('a calling Agent is required to start a role agent');
    if (!this.subagents) throw new Error('subagent service is unavailable');
    const campaign = this.table.get(campaignId);
    if (!campaign) throw new Error(`campaign not found: ${campaignId}`);
    this.assertWorkspace(agent, campaign.workspace);
    const active = (campaign.agents ?? []).find((item) => item.role === role && item.status === 'running');
    if (active) throw new Error(`${role} agent is already running: ${active.childId ?? 'starting'}`);

    const isInfra = role === 'infra';
    let worktree = campaign.workspace;
    let baseCommit = null;
    if (isInfra) {
      const worktreeRoot = join(campaign.workspace, '.aleph', 'worktrees', campaign.id);
      worktree = join(worktreeRoot, newId('infra'));
      await mkdir(worktreeRoot, { recursive: true });
      await git(campaign.researchRoot, ['worktree', 'add', '--detach', worktree, baseBranch(campaign)]);
      baseCommit = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
    }

    const prompt = isInfra
      ? [
          'You are InfraOptimizer, an AlephResearch machine-specific code optimization agent.',
          `Campaign: ${campaign.id} "${campaign.title}". Work only inside this worktree: ${worktree}.`,
          `Base commit: ${baseCommit}.`,
          'Optimize the code for the actual machine: inspect CPU/GPU/memory/IO, reduce unnecessary allocations, tune threading/batching/precision/caching/compile or runtime parameters, and remove redundant work.',
          'Run only short bounded profiling and benchmark commands. Do not start large training jobs, sweeps, background jobs, or extra agents. Do not change campaign budget, concurrency, explore policy or other constraints.',
          'Make the code changes in this worktree. Write ALEPH_HANDOFF.md with what changed, the before/after benchmark, expected speed/VRAM/disk impact, and a next step.',
          'The Host will commit one commit and return the branch; no hidden-test promotion is performed here.',
        ].join('\n')
      : [
          'You are Composer, an AlephResearch batch-orchestration agent. Own batch composition, VRAM profiling, queue-head priority and backfill.',
          `Campaign: ${campaign.id} "${campaign.title}" in ${campaign.workspace}.`,
          `Current SOTA: ${campaign.sotaBranch ?? 'none'} (${campaign.sotaScore}). Exploration: ${campaign.exploration}. Budget: ${campaign.budget ?? 'unset'}. Spent: ${campaign.spent}.`,
          'Inspect status and infrastructure, then compose the next batch of at most 4 missions with mixed L0 to L3 strategies.',
          'Use aleph_status, aleph_infra_status and aleph_compose_batch. Assign each mission a priority and a VRAM estimate; high-priority work runs first and lower-priority work backfills free GPU memory.',
          'Do not start researchers and do not edit research files. Return a short batch plan: mission count, strategy mix, priorities, VRAM estimates, rationale and the created batch id.',
        ].join('\n');

    const abort = new AbortController();
    this.activations.add(abort);
    let activation;
    try {
      activation = await this.subagents.startActivation({
        provider: 'spawn',
        label: `aleph ${role} ${campaign.id}`,
        delivery: 'caller',
        signal: abort.signal,
        request: {
          parent: agent,
          cwd: worktree,
          agentPreset: `aleph-${role}`,
          prompt: [{ type: 'text', text: prompt }],
        },
      });
    } catch (error) {
      if (isInfra) await cleanupWorktree(campaign, worktree).catch(() => undefined);
      await this.mutate(campaignId, (current) => ({
        ...current,
        agents: [...(current.agents ?? []), {
          role, childId: null, status: 'failed', summary: error instanceof Error ? error.message : String(error), branch: null, updatedAt: now(),
        }],
      }));
      this.activations.delete(abort);
      throw error;
    }

    await this.mutate(campaignId, (current) => ({
      ...current,
      agents: [...(current.agents ?? []), {
        role, childId: activation.childId ?? null, status: 'running', summary: null, branch: null, updatedAt: now(),
      }],
    }));

    try {
      const result = await activation.result;
      const resultText = (result?.output ?? [])
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n')
        .trim();
      let summary = resultText || '(no summary)';
      let branch = null;
      if (isInfra) {
        const handoff = await readFile(join(worktree, HANDOFF_FILE), 'utf8').catch(() => '');
        summary = (handoff || resultText || '(no summary)').trim();
        await git(worktree, ['add', '-A']);
        await git(worktree, ['reset', '--soft', baseCommit]);
        await git(worktree, ['-c', 'user.name=AlephResearch', '-c', 'user.email=aleph@localhost', 'commit', '--allow-empty', '-m',
          `infra optimization\n\nHandoff:\n${summary}\n\nAleph-Role: InfraOptimizer\nAleph-Campaign: ${campaign.id}\nAleph-Base-Commit: ${baseCommit}`]);
        const commit = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
        branch = `infra/${campaign.id}/${newId('i')}`;
        await git(campaign.researchRoot, ['branch', '-f', branch, commit]);
      }
      summary = summary.slice(0, 8000);
      await this.mutate(campaignId, (current) => ({
        ...current,
        agents: (current.agents ?? []).map((item) => (
          item.role === role && item.status === 'running'
            ? { ...item, status: 'done', summary, branch, updatedAt: now() }
            : item
        )),
      }));
      return { campaignId, role, childId: activation.childId ?? null, branch, summary };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.mutate(campaignId, (current) => ({
        ...current,
        agents: (current.agents ?? []).map((item) => (
          item.role === role && item.status === 'running'
            ? { ...item, status: 'failed', summary: message, branch: null, updatedAt: now() }
            : item
        )),
      }));
      throw error;
    } finally {
      if (isInfra) await cleanupWorktree(campaign, worktree).catch(() => undefined);
      this.activations.delete(abort);
    }
  }

  async setExploration({ campaignId, exploration }) {
    if (!(exploration >= 0 && exploration <= 1)) throw new Error('exploration must be between 0 and 1');
    return this.mutate(campaignId, (campaign) => ({ ...campaign, exploration }));
  }

  async setBudget({ campaignId, budget }) {
    if (!(budget === null || (typeof budget === 'number' && budget >= 0))) throw new Error('budget must be a non-negative number or null');
    return this.mutate(campaignId, (campaign) => ({ ...campaign, budget }));
  }

  async infraStatus({ campaignId }) {
    const campaign = this.table.get(campaignId);
    if (!campaign) throw new Error(`campaign not found: ${campaignId}`);
    const infra = await detectInfra(campaign.workspace);
    return this.mutate(campaignId, (current) => ({ ...current, infra, maxParallel: infra.maxParallel }));
  }

  missionUpdate(campaign, missionId, updater) {
    return {
      ...campaign,
      missions: campaign.missions.map((mission) => (mission.id === missionId ? updater(mission) : mission)),
    };
  }

  async runNext(args) {
    const operation = () => this._runNext(args);
    const queued = this.dispatchChain.then(operation, operation);
    this.dispatchChain = queued.catch(() => undefined);
    return queued;
  }

  async runAvailable({ campaignId, agent }) {
    const results = [];
    for (;;) {
      const campaign = this.table.get(campaignId);
      if (!campaign) throw new Error(`campaign not found: ${campaignId}`);
      const running = campaign.missions.filter((mission) => mission.status === 'running');
      const limit = campaign.maxParallel ?? 1;
      if (running.length >= limit) break;
      if (campaign.budgetVector?.gpuSeconds != null && (campaign.costProfile?.gpuSeconds ?? 0) >= campaign.budgetVector.gpuSeconds) break;
      if (campaign.budgetVector?.diskBytes != null && (campaign.costProfile?.diskBytes ?? 0) >= campaign.budgetVector.diskBytes) break;
      const gpuTotal = campaign.infra?.gpuMemoryTotalMb;
      const usedVram = running.reduce((sum, mission) => sum + (mission.vramMb ?? defaultVramMb(campaign) ?? 0), 0);
      const queued = campaign.missions
        .filter((mission) => mission.status === 'queued')
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.createdAt.localeCompare(b.createdAt));
      const mission = queued.find((item) => {
        if (typeof gpuTotal !== 'number' || gpuTotal <= 0) return true;
        const need = item.vramMb ?? defaultVramMb(campaign) ?? 0;
        return usedVram + need <= gpuTotal * 0.9;
      });
      if (!mission) break;
      results.push(await this.runNext({ campaignId, agent, missionId: mission.id }));
    }
    return results;
  }

  async _runNext({ campaignId, agent, missionId = null }) {
    if (!agent) throw new Error('a calling Agent is required to dispatch a researcher');
    if (!this.subagents) throw new Error('subagent service is unavailable');
    const campaign = this.table.get(campaignId);
    if (!campaign) throw new Error(`campaign not found: ${campaignId}`);
    this.assertWorkspace(agent, campaign.workspace);
    const mission = missionId
      ? campaign.missions.find((item) => item.id === missionId && item.status === 'queued')
      : campaign.missions.find((item) => item.status === 'queued');
    if (!mission) throw new Error('no queued mission');

    const worktreeRoot = join(campaign.workspace, '.aleph', 'worktrees', campaign.id);
    const worktree = join(worktreeRoot, mission.id);
    await mkdir(worktreeRoot, { recursive: true });
    const branch = mission.branch;
    const base = baseBranch(campaign);
    await git(campaign.researchRoot, ['worktree', 'add', '--detach', worktree, branch]);
    const baseCommit = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();

    await this.mutate(campaignId, (current) => this.missionUpdate(current, mission.id, (item) => ({
      ...item,
      status: 'running',
      baseBranch: base,
      baseCommit,
      startedAt: now(),
    })));

    const handoffPath = join(worktree, HANDOFF_FILE);
    const prompt = [
      'You are an AlephResearch researcher. Work only inside the current git worktree.',
      `Mission: ${mission.id}. Description: ${mission.description}.`,
      `The leader workspace is ${campaign.workspace}. Visible training data: ${campaign.visibleData ?? '(not configured)'}.`,
      'Edit code and run small bounded experiments. Do not run git commit, git push, checkout, rebase, or create branches.',
      'Do not launch compute-heavy work on your own: large training runs, multi-seed or multi-config sweeps, multi-GPU jobs, dataset-scale generation, benchmarking campaigns, long-running background jobs, or extra agents.',
      'Small work is allowed: reading files, focused edits, quick tests, one small fit/evaluation, and bounded commands that finish inside this mission.',
      'When a question needs heavy compute, stop and write a concrete proposal in the handoff instead of running it. The leader will start a separate mission and Composer will batch the work with its VRAM and priority profile.',
      `Write a handoff report to ${handoffPath}: approach, files changed, validation signal, whether heavy compute is needed, and next step.`,
      'Finish with a short summary. The leader commits, evaluates, and reclaims the worktree afterwards.',
    ].join('\n');

    const abort = new AbortController();
    this.activations.add(abort);
    let activation;
    try {
      activation = await this.subagents.startActivation({
        provider: 'spawn',
        label: `aleph ${campaign.id} ${mission.id}`,
        delivery: 'caller',
        signal: abort.signal,
        request: {
          parent: agent,
          cwd: worktree,
          agentPreset: 'aleph-researcher',
          prompt: [{ type: 'text', text: prompt }],
        },
      });
    } catch (error) {
      await this.failMission(campaignId, mission.id, worktree, error instanceof Error ? error.message : String(error));
      throw error;
    }

    await this.mutate(campaignId, (current) => this.missionUpdate(current, mission.id, (item) => ({
      ...item,
      childId: activation.childId ?? null,
    })));

    activation.result.then(
      (result) => this.completeMission(campaignId, mission.id, worktree, baseCommit, result),
      (error) => this.failMission(campaignId, mission.id, worktree, error instanceof Error ? error.message : String(error)),
    ).finally(() => this.activations.delete(abort));
    return { campaignId, missionId: mission.id, childId: activation.childId ?? null, worktree };
  }

  async completeMission(campaignId, missionId, worktree, baseCommit, result) {
    let campaign = this.table.get(campaignId);
    try {
      const handoff = await readFile(join(worktree, HANDOFF_FILE), 'utf8').catch(() => '');
      const fallback = (result?.output ?? [])
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n')
        .trim();
      const report = (handoff || fallback).trim();
      if (!report) throw new Error('researcher handoff report missing');
      const mission = campaign.missions.find((item) => item.id === missionId);
      if (!mission) throw new Error(`mission not found: ${missionId}`);

      await git(worktree, ['add', '-A']);
      await git(worktree, ['reset', '--soft', baseCommit]);
      const message = `${mission.description}\n\nHandoff:\n${report}\n\nAleph-Mission: ${mission.id}\nAleph-Campaign: ${campaign.id}\nAleph-Strategy: ${mission.strategy}\nAleph-Base-Commit: ${baseCommit}`;
      await git(worktree, ['-c', 'user.name=AlephResearch', '-c', 'user.email=aleph@localhost', 'commit', '--allow-empty', '-m', message]);
      const commit = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
      const cache = campaign.cache
        ? { hits: campaign.cache.hits, misses: campaign.cache.misses, entries: { ...campaign.cache.entries } }
        : { hits: 0, misses: 0, entries: {} };
      let score;
      let evalSeconds = 0;
      if (typeof cache.entries?.[commit] === 'number') {
        score = cache.entries[commit];
        cache.hits += 1;
      } else {
        const evalStarted = Date.now();
        const evaluation = await this.serializeEval(() => this.evaluate(campaign, worktree, commit));
        evalSeconds = (Date.now() - evalStarted) / 1000;
        score = Number(evaluation.score);
        if (!Number.isFinite(score)) throw new Error('evaluator did not return a numeric score');
        cache.misses += 1;
        cache.entries = { ...(cache.entries ?? {}), [commit]: score };
      }
      const finishedAt = now();
      const startedAt = mission.startedAt ? Date.parse(mission.startedAt) : Date.now();
      const gpuSeconds = Math.max(0, (Date.now() - startedAt) / 1000);
      let diskBytes = 0;
      try {
        const usage = await run('du', ['-sb', worktree], { timeout: 15_000 });
        diskBytes = Number(usage.stdout.trim().split(/\s+/)[0]) || 0;
      } catch {
        diskBytes = 0;
      }
      const branch = `exp/${campaign.id}/${mission.id}`;
      await git(campaign.researchRoot, ['branch', '-f', branch, commit]);
      let promoted = false;
      campaign = await this.mutate(campaignId, (current) => {
        promoted = score > current.sotaScore;
        let next = this.missionUpdate(current, missionId, (item) => ({
          ...item, status: 'done', score, commit, branch, finishedAt, error: null, reclaimed: true, promoted,
          gpuSeconds, evalSeconds, diskBytes,
        }));
        if (promoted) {
          next = { ...next, sotaBranch: 'sota/main', sotaScore: score };
        }
        const priorCost = next.costProfile ?? { missions: 0, gpuSeconds: 0, evalSeconds: 0, diskBytes: 0 };
        return {
          ...next,
          spent: next.spent + 1,
          cache,
          costProfile: {
            missions: priorCost.missions + 1,
            gpuSeconds: priorCost.gpuSeconds + gpuSeconds,
            evalSeconds: priorCost.evalSeconds + evalSeconds,
            diskBytes: priorCost.diskBytes + diskBytes,
          },
        };
      });
      if (promoted) {
        await git(campaign.researchRoot, ['branch', '-f', 'sota/main', commit]);
      }
    } catch (error) {
      await this.failMission(campaignId, missionId, worktree, error instanceof Error ? error.message : String(error));
      return;
    }
    await cleanupWorktree(campaign, worktree);
  }

  async serializeEval(operation) {
    const queued = this.evalChain.then(operation, operation);
    this.evalChain = queued.catch(() => undefined);
    return queued;
  }

  async evaluate(campaign, worktree, commit) {
    const env = {
      ALEPH_WORKSPACE: campaign.workspace,
      ALEPH_SOLUTION_DIR: worktree,
      ALEPH_SUBMISSION: commit,
      ...(campaign.visibleData ? { ALEPH_VISIBLE_DATA: campaign.visibleData } : {}),
      ...(campaign.testsetPath ? { ALEPH_TESTSET: campaign.testsetPath } : {}),
      ...(campaign.submissionPython ? { ALEPH_SUBMISSION_PYTHON: campaign.submissionPython } : {}),
      ...(campaign.runtime?.ompThreads ? { OMP_NUM_THREADS: String(campaign.runtime.ompThreads) } : {}),
    };
    const result = await run('bash', ['-lc', campaign.evalCommand], {
      cwd: campaign.workspace,
      env,
      timeout: campaign.runtime?.evalTimeoutMs ?? 180_000,
    });
    const parsed = parseScore(result.stdout);
    if (!parsed) throw new Error('evaluator did not emit a JSON score');
    return parsed;
  }

  async failMission(campaignId, missionId, worktree, message) {
    const campaign = this.table.get(campaignId);
    if (!campaign) return;
    await this.mutate(campaignId, (current) => this.missionUpdate(current, missionId, (item) => ({
      ...item, status: 'failed', error: message, finishedAt: now(), reclaimed: true,
    })));
    await cleanupWorktree(campaign, worktree).catch(() => undefined);
  }
}

async function cleanupWorktree(campaign, worktree) {
  try {
    await git(campaign.researchRoot, ['worktree', 'remove', '--force', worktree]);
  } catch {
    await rm(worktree, { recursive: true, force: true });
  }
  await rm(worktree, { recursive: true, force: true });
  await rm(join(campaign.workspace, '.aleph', 'researchers', worktree.split('/').pop()), { recursive: true, force: true }).catch(() => undefined);
}

function toolOutput(renderValue = (value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]) {
  return { schema: { type: 'json' }, render: (_args, value) => renderValue(value) };
}

function tool(name, description, parameters, execute) {
  return defineTool({ name, description, parameters, output: toolOutput(), execute });
}

export const inject = ['storageDomain', 'tools', 'webServer'];

export async function apply(ctx) {
  const domain = await ctx.storageDomain.open(campaignDomain);
  ctx.effect(() => () => { void domain.close(); });
  const sessions = ctx.get('sessions');
  const subagents = ctx.get('subagents');
  const agentPresets = ctx.get('agentPresets');
  const workspaceRegistry = ctx.get('workspaceRegistry');
  const service = new AlephService(ctx, domain, { sessions, subagents, agentPresets });

  const presetOf = (agent) => {
    if (!sessions || !agentPresets) return null;
    const session = sessions.get(agent?.id);
    return session ? agentPresets.presetForSession(session) : null;
  };
  const ALEPH_PRESETS = new Set(['aleph', 'aleph-composer', 'aleph-infra']);
  const isAleph = (agent) => ALEPH_PRESETS.has(presetOf(agent));
  const isLeader = (agent) => presetOf(agent) === 'aleph';

  const workspaceParameters = {
    workspace: { type: 'string', description: 'Absolute leader workspace path; defaults to the calling session cwd' },
    title: { type: 'string', description: 'Campaign title' },
    eval_command: { type: 'string', description: 'Leader-side evaluator command; prints JSON with a numeric score' },
    visible_data: { type: 'string', description: 'Optional absolute visible-data directory for researchers' },
    testset: { type: 'string', description: 'Optional absolute hidden-testset root for the evaluator' },
    submission_python: { type: 'string', description: 'Optional Python interpreter for the submission' },
  };

  const campaignParameter = { campaign_id: { type: 'string', required: true, description: 'Campaign id' } };

  const disposers = [
    ctx.tools.register(tool(
      'aleph_start_campaign',
      'Create an AlephResearch campaign inside a DSH workspace. State is stored in the DSH storage domain; no ~/.aleph files are written.',
      workspaceParameters,
      async (args, exec) => {
        const workspace = service.workspaceFor(exec.agent, args.workspace);
        service.assertWorkspace(exec.agent, workspace);
        return service.create({
          workspace,
          title: args.title,
          evalCommand: args.eval_command,
          visibleData: args.visible_data,
          testsetPath: args.testset,
          submissionPython: args.submission_python,
        });
      },
    ), { when: ({ agent }) => isLeader(agent) }),
    ctx.tools.register(tool(
      'aleph_status',
      'Return AlephResearch campaign and mission status from the DSH storage domain.',
      { campaign_id: { type: 'string', description: 'Optional campaign id; omitted lists every campaign' } },
      async (args) => {
        const campaigns = args.campaign_id
          ? [service.get(args.campaign_id)].filter(Boolean)
          : service.list();
        return campaigns.map(snapshot);
      },
    ), { when: ({ agent }) => isAleph(agent) }),
    ctx.tools.register(tool(
      'aleph_enqueue_mission',
      'Queue a researcher mission on the campaign SOTA branch.',
      {
        ...campaignParameter,
        description: { type: 'string' },
        strategy: { type: 'string', enum: ['auto', ...STRATEGIES], description: 'L0 to L3, or auto for Boltzmann sampling' },
      },
      async (args) => service.enqueue({
        campaignId: args.campaign_id,
        description: args.description,
        strategy: args.strategy ?? 'auto',
      }),
    ), { when: ({ agent }) => isAleph(agent) }),
    ctx.tools.register(tool(
      'aleph_run_next',
      'Start a queued researcher through the DSH subagent service and return its child session id.',
      campaignParameter,
      async (args, exec) => service.runNext({ campaignId: args.campaign_id, agent: exec.agent }),
    ), { when: ({ agent }) => isLeader(agent) }),
    ctx.tools.register(tool(
      'aleph_compose_batch',
      'Compose a batch of missions across L0 to L3 so several researchers can be dispatched concurrently.',
      {
        ...campaignParameter,
        brief: { type: 'string', required: true, description: 'Shared research brief for the batch' },
        count: { type: 'integer', description: 'Batch size, 1 to 4' },
        strategies: { type: 'array', items: { type: 'string' }, description: 'Optional strategy order, e.g. L0, L3, L2' },
        priorities: { type: 'array', items: { type: 'number' }, description: 'Optional per-mission priority; higher runs first' },
        vram_mb: { type: 'array', items: { type: 'number' }, description: 'Optional per-mission VRAM estimate' },
      },
      async (args) => service.compose({
        campaignId: args.campaign_id,
        brief: args.brief,
        count: args.count ?? 2,
        strategies: args.strategies,
        priorities: args.priorities,
        vramMb: args.vram_mb,
      }),
    ), { when: ({ agent }) => isAleph(agent) }),
    ctx.tools.register(tool(
      'aleph_run_available',
      'Dispatch queued missions until the campaign maxParallel limit is reached.',
      campaignParameter,
      async (args, exec) => service.runAvailable({ campaignId: args.campaign_id, agent: exec.agent }),
    ), { when: ({ agent }) => isLeader(agent) }),
    ctx.tools.register(tool(
      'aleph_infra_status',
      'Return host capacity and campaign cost/cache/runtime state for Leader and Composer.',
      campaignParameter,
      async (args) => service.infraStatus({ campaignId: args.campaign_id }),
    ), { when: ({ agent }) => isAleph(agent) }),
    ctx.tools.register(tool(
      'aleph_run_composer',
      'Start the Composer agent to inspect the campaign and compose the next strategy-mixed batch.',
      campaignParameter,
      async (args, exec) => service.runAgent({ campaignId: args.campaign_id, role: 'composer', agent: exec.agent }),
    ), { when: ({ agent }) => isLeader(agent) }),
    ctx.tools.register(tool(
      'aleph_run_infra',
      'Start InfraOptimizer to optimize a code worktree for the actual machine, run a short benchmark and return an infra branch.',
      campaignParameter,
      async (args, exec) => service.runAgent({ campaignId: args.campaign_id, role: 'infra', agent: exec.agent }),
    ), { when: ({ agent }) => isLeader(agent) }),
    ctx.tools.register(tool(
      'aleph_set_runtime',
      'Tune evaluation runtime parameters selected by InfraOptimizer.',
      {
        ...campaignParameter,
        omp_threads: { type: 'integer', description: 'OMP_NUM_THREADS for the evaluator; 0 uses the host default' },
        eval_timeout_ms: { type: 'integer', description: 'Evaluator timeout in milliseconds' },
      },
      async (args) => service.setRuntime({
        campaignId: args.campaign_id,
        ompThreads: args.omp_threads ?? 0,
        evalTimeoutMs: args.eval_timeout_ms ?? 180_000,
      }),
    ), { when: ({ agent }) => isLeader(agent) }),
    ctx.tools.register(tool(
      'aleph_set_budget_vector',
      'Set the cost budget vector (missions, GPU seconds, disk bytes) chosen by InfraOptimizer.',
      {
        ...campaignParameter,
        missions: { type: 'number', description: 'Mission count cap' },
        gpu_seconds: { type: 'number', description: 'Cumulative GPU seconds cap' },
        disk_bytes: { type: 'number', description: 'Cumulative artifact bytes cap' },
      },
      async (args) => service.setBudgetVector({
        campaignId: args.campaign_id,
        missions: args.missions ?? null,
        gpuSeconds: args.gpu_seconds ?? null,
        diskBytes: args.disk_bytes ?? null,
      }),
    ), { when: ({ agent }) => isLeader(agent) }),
    ctx.tools.register(tool(
      'aleph_set_parallel',
      'Set the campaign concurrency limit chosen by InfraOptimizer.',
      {
        ...campaignParameter,
        max_parallel: { type: 'integer', required: true, description: 'Concurrency limit from 1 to 8' },
      },
      async (args) => service.setParallel({ campaignId: args.campaign_id, maxParallel: args.max_parallel }),
    ), { when: ({ agent }) => isLeader(agent) }),
    ctx.tools.register(tool(
      'aleph_set_budget',
      'Set or clear the campaign mission budget.',
      {
        ...campaignParameter,
        budget: { type: 'number', description: 'Budget in missions, or null to clear' },
      },
      async (args) => service.setBudget({ campaignId: args.campaign_id, budget: args.budget ?? null }),
    ), { when: ({ agent }) => isLeader(agent) }),
    ctx.tools.register(tool(
      'aleph_set_exploration',
      'Set the campaign exploration level used by the next strategy sample.',
      {
        ...campaignParameter,
        exploration: { type: 'number', required: true, description: 'Value in [0, 1]' },
      },
      async (args) => service.setExploration({ campaignId: args.campaign_id, exploration: args.exploration }),
    ), { when: ({ agent }) => isLeader(agent) }),
  ];
  ctx.effect(() => () => { for (const dispose of disposers) dispose(); });

  const sendJson = (res, status, body) => {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(text),
      'cache-control': 'no-store',
    });
    res.end(text);
  };

  ctx.webServer.register({
    kind: 'exact',
    path: '/api/aleph/snapshot',
    handler(req, res) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { ok: false });
      const campaigns = service.list().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const campaign = campaigns[0];
      if (!campaign) return sendJson(res, 404, { ok: false, error: { code: 'aleph/no-campaign' } });
      return sendJson(res, 200, snapshot(campaign));
    },
  });

  ctx.webServer.register({
    kind: 'exact',
    path: '/api/aleph/campaigns',
    handler(req, res) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { ok: false });
      return sendJson(res, 200, { campaigns: service.list().map(snapshot) });
    },
  });

  ctx.webServer.register({
    kind: 'exact',
    path: '/api/aleph/start',
    async handler(req, res) {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false });
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const args = body ? JSON.parse(body) : {};
        const campaign = await service.create({
          workspace: args.workspace ?? process.cwd(),
          title: args.title,
          evalCommand: args.evalCommand ?? args.eval_command,
          visibleData: args.visibleData ?? args.visible_data,
          testsetPath: args.testset ?? args.testsetPath,
          submissionPython: args.submissionPython ?? args.submission_python,
        });
        return sendJson(res, 200, snapshot(campaign));
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: { code: 'aleph/start-failed', message: String(error?.message ?? error) } });
      }
    },
  });


  ctx.webServer.register({
    kind: 'exact',
    path: '/api/aleph/workspace',
    async handler(req, res) {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false });
      if (!workspaceRegistry) return sendJson(res, 503, { ok: false, error: { code: 'aleph/workspace-unavailable' } });
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const args = body ? JSON.parse(body) : {};
        const workspace = await workspaceRegistry.create(args.path);
        return sendJson(res, 200, { workspace: { id: workspace.workspaceId, path: workspace.path, title: workspace.title } });
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: { code: 'aleph/workspace-failed', message: String(error?.message ?? error) } });
      }
    },
  });

  ctx.webServer.register({
    kind: 'exact',
    path: '/api/aleph/enqueue',
    async handler(req, res) {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false });
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const args = body ? JSON.parse(body) : {};
        const campaign = await service.enqueue({
          campaignId: args.campaign_id ?? args.campaignId,
          description: args.description,
          strategy: args.strategy ?? 'auto',
        });
        return sendJson(res, 200, snapshot(campaign));
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: { code: 'aleph/enqueue-failed', message: String(error?.message ?? error) } });
      }
    },
  });

  ctx.webServer.register({
    kind: 'exact',
    path: '/api/aleph/health',
    async handler(req, res) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { ok: false });
      const presets = agentPresets ? await agentPresets.list() : [];
      return sendJson(res, 200, {
        ok: true,
        version: '0.2.0',
        storage: DOMAIN_NAME,
        presets: presets.map((preset) => ({ id: preset.id, name: preset.name, broken: preset.broken })),
      });
    },
  });

}
