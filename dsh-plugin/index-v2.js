/**
 * AlephResearch Host plugin v2.
 *
 * Top-level state is a DSH project/workspace. Research work and mission
 * packaging live in separate git repositories; missions are proposed by
 * researchers, approved by the Leader, composed into machine-bound batches,
 * optimized and run by InfraOptimizer, and their results are cherry-picked
 * back to the pre-batch mission branch.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { z } from 'zod';

const execFileAsync = promisify(execFile);
const DOMAIN_NAME = 'aleph_project';
const HANDOFF_FILE = 'ALEPH_HANDOFF.md';

const missionSchema = z.object({
  id: z.string(),
  ownerSession: z.string().nullable(),
  branch: z.string(),
  manifestId: z.string().nullable().optional(),
  manifestPath: z.string().nullable().optional(),
  status: z.enum(['proposed', 'approved', 'batched', 'running', 'done', 'failed']),
  entrypoint: z.string().nullable().optional(),
  outputs: z.array(z.unknown()).optional(),
  resource: z.unknown().nullable().optional(),
  batchId: z.string().nullable(),
  preBatchTip: z.string().nullable().optional(),
  resultCommit: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  createdAt: z.string(),
  approvedAt: z.string().nullable().optional(),
  finishedAt: z.string().nullable().optional(),
});

const batchSchema = z.object({
  id: z.string(),
  machineId: z.string(),
  status: z.enum(['forming', 'running', 'done', 'failed']),
  missionIds: z.array(z.string()),
  branch: z.string(),
  baseTip: z.string().nullable().optional(),
  createdAt: z.string(),
  startedAt: z.string().nullable().optional(),
  finishedAt: z.string().nullable().optional(),
  summary: z.unknown().nullable().optional(),
});

const machineSchema = z.object({
  id: z.string(),
  kind: z.enum(['local']),
  status: z.enum(['idle', 'busy']),
  batchId: z.string().nullable(),
});

const projectSchema = z.object({
  id: z.string(),
  workspace: z.string(),
  researchRoot: z.string(),
  missionRoot: z.string(),
  templateBranch: z.string(),
  evalCommand: z.string(),
  researcherCount: z.number().int().optional(),
  visibleData: z.string().nullable().optional(),
  testsetPath: z.string().nullable().optional(),
  submissionPython: z.string().nullable().optional(),
  machines: z.array(machineSchema),
  agents: z.array(z.object({
    role: z.enum(['researcher', 'composer', 'infra']),
    childId: z.string().nullable(),
    status: z.enum(['running', 'done', 'failed']),
    summary: z.string().nullable(),
    branch: z.string().nullable().optional(),
    worktree: z.string().nullable().optional(),
    updatedAt: z.string(),
  })).optional(),
  missions: z.array(missionSchema),
  batches: z.array(batchSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const projectDomain = defineDomain({
  name: DOMAIN_NAME,
  version: 1,
  tables: { projects: domainTable(projectSchema) },
});

function now() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

async function run(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    timeout: options.timeout ?? 300_000,
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

async function ensureRepo(path, branch, files) {
  if (!(await pathExists(join(path, '.git')))) {
    await mkdir(path, { recursive: true });
    await git(path, ['init', '-b', branch]);
    for (const [name, content] of Object.entries(files)) {
      await mkdir(join(path, name, '..'), { recursive: true });
      await writeFile(join(path, name), content, 'utf8');
    }
    await git(path, ['add', '-A']);
    await git(path, ['-c', 'user.name=AlephResearch', '-c', 'user.email=aleph@localhost', 'commit', '-m', 'initialize']);
  }
  return path;
}

function toolOutput() {
  return { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function tool(name, description, parameters, execute) {
  return defineTool({ name, description, parameters, output: toolOutput(), execute });
}

const TEMPLATE_BATCH_RUNNER = `#!/usr/bin/env python3
import json, os, pathlib, subprocess, sys
root = pathlib.Path(__file__).resolve().parent
missions = root / "missions"
results = root / "results"
results.mkdir(exist_ok=True)
reports = []
for mission_dir in sorted(missions.glob("*/")):
    manifest_path = mission_dir / "mission.json"
    if not manifest_path.exists():
        continue
    manifest = json.loads(manifest_path.read_text())
    mission_id = manifest.get("id") or mission_dir.name
    entrypoint = manifest.get("entrypoint") or "run.sh"
    output_dir = results / mission_id
    output_dir.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env["ALEPH_MISSION_ID"] = mission_id
    env["ALEPH_OUTPUT_DIR"] = str(output_dir)
    proc = subprocess.run(["bash", str(mission_dir / entrypoint)], cwd=mission_dir, env=env)
    reports.append({"mission_id": mission_id, "exit_code": proc.returncode})
    (output_dir / "result.json").write_text(json.dumps({
        "schema": 1,
        "mission_id": mission_id,
        "status": "done" if proc.returncode == 0 else "failed",
        "exit_code": proc.returncode,
        "artifacts": [],
        "metrics": {},
        "logs": [],
    }, ensure_ascii=False))
(results / "batch.json").write_text(json.dumps({"missions": reports}, ensure_ascii=False))
print(json.dumps({"missions": reports}))
sys.exit(0 if all(item["exit_code"] == 0 for item in reports) else 1)
`;

function parseScore(stdout) {
  const lines = String(stdout ?? '').split(/\r?\n/).reverse();
  for (const line of lines) {
    const text = line.trim();
    if (!text.startsWith('{')) continue;
    try {
      const value = JSON.parse(text);
      if (value && typeof value.score === 'number') return value;
    } catch {
      // Keep scanning.
    }
  }
  return null;
}

class ProjectService {
  constructor(ctx, domain, deps) {
    this.ctx = ctx;
    this.table = domain.table('projects');
    this.sessions = deps.sessions;
    this.subagents = deps.subagents;
    this.agentPresets = deps.agentPresets;
    this.writeChain = Promise.resolve();
  }

  list() {
    return [...this.table.entries()].map(([, project]) => project);
  }

  get(id) {
    return this.table.get(id);
  }

  byWorkspace(workspace) {
    return this.list().find((project) => project.workspace === resolve(workspace));
  }

  async mutate(id, update) {
    const op = async () => {
      const current = this.table.get(id);
      if (!current) throw new Error(`project not found: ${id}`);
      const next = { ...update(current), updatedAt: now() };
      await this.table.put(id, next);
      return next;
    };
    const queued = this.writeChain.then(op, op);
    this.writeChain = queued.catch(() => undefined);
    return queued;
  }

  sessionFor(agent) {
    return this.sessions?.get(agent?.id);
  }

  workspaceFor(agent, explicit) {
    if (typeof explicit === 'string' && explicit.trim()) return resolve(explicit.trim());
    const cwd = this.sessionFor(agent)?.header?.cwd;
    if (typeof cwd === 'string' && cwd) return resolve(cwd);
    throw new Error('workspace is required when the calling session has no cwd');
  }

  assertWorkspace(agent, workspace) {
    const root = this.sessionFor(agent)?.header?.cwd;
    if (typeof root !== 'string' || root === '') return;
    const target = resolve(workspace);
    const base = resolve(root);
    if (target !== base && !target.startsWith(`${base}/`)) {
      throw new Error(`project workspace ${target} is outside the DSH session workspace ${base}; open the project as the DSH workspace`);
    }
  }

  async init({ workspace, evalCommand = 'python3 eval/run_eval.py', visibleData = null, testsetPath = null, submissionPython = null, researchers = 4, agent = null }) {
    const target = resolve(workspace);
    if (!(await pathExists(target))) throw new Error(`workspace does not exist: ${target}`);
    if (agent) this.assertWorkspace(agent, target);
    const existing = this.byWorkspace(target);
    if (existing) {
      return this.mutate(existing.id, (current) => ({ ...current, researcherCount: Number.isFinite(Number(researchers)) ? Number(researchers) : (current.researcherCount ?? 4) }));
    }
    const researchRoot = join(target, 'research');
    await ensureRepo(researchRoot, 'main', { 'README.md': '# Research repository\n' });
    const missionRoot = join(target, 'missions');
    await ensureRepo(missionRoot, 'template', {
      'README.md': '# Mission repository template\n',
      'batch_runner.py': TEMPLATE_BATCH_RUNNER,
      'pyproject.toml': '[project]\nname = "aleph-missions"\nversion = "0.1.0"\nrequires-python = ">=3.10"\n',
    });
    await mkdir(join(target, '.aleph'), { recursive: true });
    const stamp = now();
    const project = {
      id: newId('p'),
      workspace: target,
      researchRoot,
      missionRoot,
      templateBranch: 'template',
      evalCommand,
      researcherCount: Number.isFinite(Number(researchers)) ? Number(researchers) : 4,
      visibleData: visibleData ? resolve(visibleData) : null,
      testsetPath: testsetPath ? resolve(testsetPath) : null,
      submissionPython: submissionPython || null,
      machines: [{ id: 'local', kind: 'local', status: 'idle', batchId: null }],
      agents: [],
      missions: [],
      batches: [],
      createdAt: stamp,
      updatedAt: stamp,
    };
    await this.table.put(project.id, project);
    return project;
  }

  async propose({ projectId, branch, agent }) {
    const project = this.get(projectId);
    if (!project) throw new Error(`project not found: ${projectId}`);
    const branchExists = await git(project.missionRoot, ['rev-parse', '--verify', branch]).then(() => true).catch(() => false);
    if (!branchExists) throw new Error(`mission branch not found: ${branch}`);
    const ancestor = await git(project.missionRoot, ['merge-base', '--is-ancestor', project.templateBranch, branch]).then(() => true).catch(() => false);
    if (!ancestor) throw new Error(`mission branch ${branch} is not derived from ${project.templateBranch}`);
    let manifest = null;
    try {
      const files = (await git(project.missionRoot, ['ls-tree', '-r', '--name-only', branch])).stdout.split(/\r?\n/);
      const manifestPath = files.find((path) => /^missions\/[^/]+\/mission\.json$/.test(path));
      if (!manifestPath) throw new Error('no missions/<id>/mission.json');
      const raw = await git(project.missionRoot, ['show', `${branch}:${manifestPath}`]);
      manifest = JSON.parse(raw.stdout);
      manifest.__manifestPath = manifestPath;
    } catch (error) {
      throw new Error(`mission branch ${branch} has no valid missions/<id>/mission.json: ${error instanceof Error ? error.message : error}`);
    }
    const ownerSession = agent?.id ?? null;
    return this.mutate(projectId, (current) => ({
      ...current,
      missions: [...current.missions, {
        id: newId('m'),
        ownerSession,
        branch,
        manifestId: manifest.id ?? manifest.__manifestPath.split('/')[1],
        manifestPath: manifest.__manifestPath,
        status: 'proposed',
        entrypoint: manifest.entrypoint ?? null,
        outputs: Array.isArray(manifest.outputs) ? manifest.outputs : [],
        resource: manifest.resource ?? null,
        batchId: null,
        preBatchTip: null,
        resultCommit: null,
        error: null,
        createdAt: now(),
        approvedAt: null,
        finishedAt: null,
      }],
    }));
  }

  async approve({ projectId, missionId }) {
    return this.mutate(projectId, (project) => ({
      ...project,
      missions: project.missions.map((mission) => (
        mission.id === missionId && mission.status === 'proposed'
          ? { ...mission, status: 'approved', approvedAt: now() }
          : mission
      )),
    }));
  }

  async runBatch({ projectId, batchId }) {
    const project = this.get(projectId);
    if (!project) throw new Error(`project not found: ${projectId}`);
    const batch = project.batches.find((item) => item.id === batchId);
    if (!batch) throw new Error(`batch not found: ${batchId}`);
    if (batch.status !== 'forming') throw new Error(`batch ${batchId} is not runnable (status ${batch.status})`);
    const missionRecords = project.missions.filter((mission) => batch.missionIds.includes(mission.id));
    const worktreesRoot = join(project.workspace, '.aleph', 'batches');
    const batchWorktree = join(worktreesRoot, batchId);
    await mkdir(worktreesRoot, { recursive: true });
    await rm(batchWorktree, { recursive: true, force: true });
    await git(project.missionRoot, ['worktree', 'add', '--detach', batchWorktree, batch.branch]);
    const startedAt = now();
    let runnerError = null;
    try {
      await run('python3', ['batch_runner.py'], { cwd: batchWorktree, timeout: 900_000 });
      runnerError = null;
    } catch (error) {
      runnerError = error instanceof Error ? error.message : String(error);
    }

    const outcomes = [];
    for (const mission of missionRecords) {
      let manifestPath = mission.manifestPath;
      let manifestId = mission.manifestId;
      if (!manifestPath) {
        const files = (await git(project.missionRoot, ['ls-tree', '-r', '--name-only', mission.branch])).stdout.split(/\r?\n/);
        manifestPath = files.find((path) => /^missions\/[^/]+\/mission\.json$/.test(path));
        if (manifestPath && !manifestId) {
          try {
            const raw = await git(project.missionRoot, ['show', `${mission.branch}:${manifestPath}`]);
            const parsed = JSON.parse(raw.stdout);
            manifestId = parsed.id ?? manifestPath.split('/')[1];
          } catch {
            manifestId = manifestPath.split('/')[1];
          }
        }
      }
      const missionDir = manifestPath ? manifestPath.split('/')[1] : null;
      manifestId = manifestId ?? missionDir ?? mission.id;
      let envelope = {
        schema: 1,
        mission_id: manifestId,
        batch_id: batch.id,
        machine_id: batch.machineId,
        status: runnerError ? 'failed' : 'done',
        started_at: startedAt,
        finished_at: now(),
        metrics: {},
        artifacts: [],
        logs: [],
        resource: mission.resource ?? null,
        error: runnerError,
      };
      if (missionDir) {
        try {
          const raw = await readFile(join(batchWorktree, 'results', missionDir, 'result.json'), 'utf8');
          envelope = { ...envelope, ...JSON.parse(raw), batch_id: batch.id, machine_id: batch.machineId };
        } catch {
          envelope.status = 'failed';
          envelope.error = runnerError || 'mission result missing';
        }
      } else {
        envelope.status = 'failed';
        envelope.error = 'mission manifest not found';
      }

      let resultCommit = null;
      const resultWorktree = join(worktreesRoot, `${batch.id}-${mission.id}-result`);
      const missionWorktree = join(worktreesRoot, `${batch.id}-${mission.id}-mission`);
      try {
        await git(project.missionRoot, ['worktree', 'add', '--detach', resultWorktree, batch.branch]);
        const target = join(resultWorktree, 'results', manifestId);
        await mkdir(target, { recursive: true });
        await writeFile(join(target, 'result.json'), JSON.stringify(envelope, null, 2), 'utf8');
        await git(resultWorktree, ['add', '-A']);
        await git(resultWorktree, ['-c', 'user.name=AlephResearch', '-c', 'user.email=aleph@localhost', 'commit', '-m',
          `mission result ${mission.id}\n\nAleph-Mission: ${mission.id}\nAleph-Batch: ${batch.id}\nAleph-Machine: ${batch.machineId}`]);
        resultCommit = (await git(resultWorktree, ['rev-parse', 'HEAD'])).stdout.trim();
        await git(project.missionRoot, ['worktree', 'add', '--detach', missionWorktree, mission.preBatchTip ?? mission.branch]);
        await git(missionWorktree, ['-c', 'user.name=AlephResearch', '-c', 'user.email=aleph@localhost', 'cherry-pick', resultCommit]);
        const newTip = (await git(missionWorktree, ['rev-parse', 'HEAD'])).stdout.trim();
        resultCommit = newTip;
        await git(project.missionRoot, ['branch', '-f', mission.branch, newTip]);
      } catch (error) {
        envelope.status = 'failed';
        envelope.error = error instanceof Error ? error.message : String(error);
      } finally {
        await git(project.missionRoot, ['worktree', 'remove', '--force', resultWorktree]).catch(() => undefined);
        await git(project.missionRoot, ['worktree', 'remove', '--force', missionWorktree]).catch(() => undefined);
        await rm(resultWorktree, { recursive: true, force: true }).catch(() => undefined);
        await rm(missionWorktree, { recursive: true, force: true }).catch(() => undefined);
      }
      outcomes.push({ missionId: mission.id, manifestId, manifestPath, status: envelope.status, resultCommit, envelope });
    }

    await git(project.missionRoot, ['worktree', 'remove', '--force', batchWorktree]).catch(() => undefined);
    await rm(batchWorktree, { recursive: true, force: true }).catch(() => undefined);
    return this.mutate(projectId, (current) => ({
      ...current,
      machines: current.machines.map((item) => item.id === batch.machineId ? { ...item, status: 'idle', batchId: null } : item),
      missions: current.missions.map((mission) => {
        const outcome = outcomes.find((item) => item.missionId === mission.id);
        if (!outcome) return mission;
        return {
          ...mission,
          manifestId: outcome.manifestId,
          manifestPath: outcome.manifestPath,
          status: outcome.status === 'done' ? 'done' : 'failed',
          resultCommit: outcome.resultCommit,
          error: outcome.envelope.error ?? null,
          finishedAt: now(),
        };
      }),
      batches: current.batches.map((item) => item.id === batch.id ? {
        ...item,
        status: runnerError ? 'failed' : (outcomes.every((outcome) => outcome.status === 'done') ? 'done' : 'failed'),
        startedAt,
        finishedAt: now(),
        summary: { runnerError, missions: outcomes.map(({ envelope, ...rest }) => rest) },
      } : item),
    }));
  }

  async evaluate({ projectId, agent }) {
    const project = this.get(projectId);
    if (!project) throw new Error(`project not found: ${projectId}`);
    const owner = agent?.id ?? null;
    const pending = project.missions.filter((mission) => (
      mission.ownerSession === owner && ['proposed', 'approved', 'batched', 'running'].includes(mission.status)
    ));
    if (pending.length > 0) {
      return { status: 'waiting', projectId, pending: pending.map((mission) => ({ id: mission.id, branch: mission.branch, status: mission.status })) };
    }
    const agentRecord = (project.agents ?? []).find((item) => item.role === 'researcher' && item.childId === owner && item.worktree);
    let worktree;
    let temporary = false;
    if (agentRecord?.worktree && await pathExists(agentRecord.worktree)) {
      worktree = agentRecord.worktree;
    } else {
      const worktreeRoot = join(project.workspace, '.aleph', 'evaluations');
      worktree = join(worktreeRoot, newId('eval'));
      await mkdir(worktreeRoot, { recursive: true });
      await git(project.researchRoot, ['worktree', 'add', '--detach', worktree, 'HEAD']);
      temporary = true;
    }
    const env = {
      ALEPH_WORKSPACE: project.workspace,
      ALEPH_SOLUTION_DIR: worktree,
      ...(project.visibleData ? { ALEPH_VISIBLE_DATA: project.visibleData } : {}),
      ...(project.testsetPath ? { ALEPH_TESTSET: project.testsetPath } : {}),
      ...(project.submissionPython ? { ALEPH_SUBMISSION_PYTHON: project.submissionPython } : {}),
    };
    let score = null;
    let stdout = '';
    let stderr = '';
    try {
      const result = await run('bash', ['-lc', project.evalCommand], { cwd: worktree, env, timeout: 600_000 });
      stdout = result.stdout;
      stderr = result.stderr;
      const parsed = parseScore(stdout);
      score = parsed?.score ?? null;
    } finally {
      if (temporary) {
        await git(project.researchRoot, ['worktree', 'remove', '--force', worktree]).catch(() => undefined);
        await rm(worktree, { recursive: true, force: true }).catch(() => undefined);
      }
    }
    const message = `research evaluation: ${score ?? 'no score'}\n\nAleph-Project: ${project.id}\nAleph-Evaluation: ${score ?? 'none'}\n\n${stdout.trim().slice(0, 4000)}`;
    const commitRoot = agentRecord?.worktree && await pathExists(agentRecord.worktree) ? agentRecord.worktree : project.researchRoot;
    await git(commitRoot, ['-c', 'user.name=AlephResearch', '-c', 'user.email=aleph@localhost', 'commit', '--allow-empty', '-m', message]);
    const researchCommit = (await git(commitRoot, ['rev-parse', 'HEAD'])).stdout.trim();
    return { status: 'done', projectId, score, researchCommit, stdout: stdout.slice(0, 8000), stderr: stderr.slice(0, 4000) };
  }

  async startResearcher({ projectId, agent }) {
    if (!agent) throw new Error('a calling Agent is required to start a researcher');
    if (!this.subagents) throw new Error('subagent service is unavailable');
    const project = this.get(projectId);
    if (!project) throw new Error(`project not found: ${projectId}`);
    this.assertWorkspace(agent, project.workspace);
    const branch = `research/r-${randomUUID().slice(0, 8)}`;
    const worktree = join(project.workspace, '.aleph', 'researchers', newId('r'));
    await mkdir(join(project.workspace, '.aleph', 'researchers'), { recursive: true });
    await git(project.researchRoot, ['worktree', 'add', '-b', branch, worktree, 'HEAD']);
    const prompt = [
      'You are an AlephResearch researcher.',
      `Project: ${project.id}. Research worktree: ${worktree}. Research branch: ${branch}. Mission repo: ${project.missionRoot}. Template branch: ${project.templateBranch}.`,
      'Work only in the assigned research worktree and commit research changes to its branch when appropriate.',
      'You may inspect the complete git history of both repositories with git: use git log --all, git branch -a, git show and git diff in the research worktree and mission repo. Mission results are cherry-picked onto mission branches, so previous work is visible there.',
      'Before creating or proposing a mission, inspect the mission repo history and branches for an equivalent mission that already ran or is queued. Do not re-run a mission that already has a result; read its existing result commit or result envelope instead.',
      'Small work can be done directly. For work with significant hardware cost, create a mission branch from the mission template, add missions/<id>/mission.json plus code and an uv project, commit the branch, and call aleph_propose_mission.',
      'After proposing, wait only for missions owned by you: call aleph_evaluate; if it returns status waiting, wait briefly and retry. Do not wait for other researchers missions.',
      'When all your missions are done, call aleph_evaluate once more so the Host evaluates your research branch and writes the report into its commit, then finish. Do not modify project queue, batch or machine state.',
    ].join('\n');
    const abort = new AbortController();
    let activation;
    try {
      activation = await this.subagents.startActivation({
        provider: 'spawn', label: `aleph researcher ${project.id}`, delivery: 'caller', signal: abort.signal,
        request: { parent: agent, cwd: worktree, agentPreset: 'aleph-researcher', prompt: [{ type: 'text', text: prompt }] },
      });
    } catch (error) {
      await this.mutate(projectId, (current) => ({ ...current, agents: [...(current.agents ?? []), { role: 'researcher', childId: null, status: 'failed', summary: String(error), branch: null, updatedAt: now() }] }));
      throw error;
    }
    await this.mutate(projectId, (current) => ({ ...current, agents: [...(current.agents ?? []), { role: 'researcher', childId: activation.childId ?? null, status: 'running', summary: null, branch: null, updatedAt: now() }] }));
    activation.result.then(async (result) => {
      const summary = (result?.output ?? []).filter((block) => block?.type === 'text').map((block) => block.text).join('\n').trim().slice(0, 8000) || '(no summary)';
      await this.mutate(projectId, (current) => ({ ...current, agents: (current.agents ?? []).map((item) => item.role === 'researcher' && item.status === 'running' ? { ...item, status: 'done', summary, updatedAt: now() } : item) })).catch(() => undefined);
    }, async (error) => {
      await this.mutate(projectId, (current) => ({ ...current, agents: (current.agents ?? []).map((item) => item.role === 'researcher' && item.status === 'running' ? { ...item, status: 'failed', summary: String(error), updatedAt: now() } : item) })).catch(() => undefined);
    });
    return { projectId, role: 'researcher', childId: activation.childId ?? null, branch, worktree };
  }

  async startResearchers({ projectId, count = null, agent }) {
    const project = this.get(projectId);
    if (!project) throw new Error(`project not found: ${projectId}`);
    const requested = Math.max(1, Math.min(16, Number(count) || project.researcherCount || 4));
    const started = [];
    for (let index = 0; index < requested; index += 1) {
      started.push(await this.startResearcher({ projectId, agent }));
    }
    return { projectId, requested, started };
  }

  async runComposer({ projectId, agent }) {
    if (!agent) throw new Error('a calling Agent is required to start Composer');
    if (!this.subagents) throw new Error('subagent service is unavailable');
    const project = this.get(projectId);
    if (!project) throw new Error(`project not found: ${projectId}`);
    this.assertWorkspace(agent, project.workspace);
    const abort = new AbortController();
    const prompt = [
      'You are MissionComposer for AlephResearch.',
      `Project: ${project.id}. Research repo: ${project.researchRoot}. Mission repo: ${project.missionRoot}.`,
      'Inspect the approved MissionQueue with aleph_status, then merge approved missions into a machine-bound batch with aleph_form_batch.',
      'Resolve merge conflicts in the mission repo before batching. Do not run researchers or change research code.',
      'Return the batch id, machine, mission ids and any conflict decisions.',
    ].join('\n');
    let activation;
    try {
      activation = await this.subagents.startActivation({
        provider: 'spawn', label: `aleph composer ${project.id}`, delivery: 'caller', signal: abort.signal,
        request: { parent: agent, cwd: project.workspace, agentPreset: 'aleph-composer', prompt: [{ type: 'text', text: prompt }] },
      });
    } catch (error) {
      await this.mutate(projectId, (current) => ({ ...current, agents: [...(current.agents ?? []), { role: 'composer', childId: null, status: 'failed', summary: String(error), branch: null, updatedAt: now() }] }));
      throw error;
    }
    await this.mutate(projectId, (current) => ({ ...current, agents: [...(current.agents ?? []), { role: 'composer', childId: activation.childId ?? null, status: 'running', summary: null, branch: null, updatedAt: now() }] }));
    try {
      const result = await activation.result;
      const summary = (result?.output ?? []).filter((block) => block?.type === 'text').map((block) => block.text).join('\n').trim().slice(0, 8000) || '(no summary)';
      await this.mutate(projectId, (current) => ({ ...current, agents: (current.agents ?? []).map((item) => item.role === 'composer' && item.status === 'running' ? { ...item, status: 'done', summary, updatedAt: now() } : item) }));
      return { projectId, role: 'composer', childId: activation.childId, summary };
    } catch (error) {
      await this.mutate(projectId, (current) => ({ ...current, agents: (current.agents ?? []).map((item) => item.role === 'composer' && item.status === 'running' ? { ...item, status: 'failed', summary: String(error), updatedAt: now() } : item) }));
      throw error;
    } finally {
      this.activations?.delete?.(abort);
    }
  }

  async runInfra({ projectId, batchId, agent }) {
    if (!agent) throw new Error('a calling Agent is required to start InfraOptimizer');
    if (!this.subagents) throw new Error('subagent service is unavailable');
    const project = this.get(projectId);
    if (!project) throw new Error(`project not found: ${projectId}`);
    const batch = project.batches.find((item) => item.id === batchId);
    if (!batch) throw new Error(`batch not found: ${batchId}`);
    if (batch.status !== 'forming') throw new Error(`batch ${batchId} is not forming`);
    const worktreeRoot = join(project.workspace, '.aleph', 'infra');
    const worktree = join(worktreeRoot, batchId);
    await mkdir(worktreeRoot, { recursive: true });
    await rm(worktree, { recursive: true, force: true });
    const baseTip = (await git(project.missionRoot, ['rev-parse', batch.branch])).stdout.trim();
    await git(project.missionRoot, ['worktree', 'add', '--detach', worktree, batch.branch]);
    const prompt = [
      'You are InfraOptimizer for AlephResearch.',
      `Batch: ${batch.id}. Machine: ${batch.machineId}. Work only inside this worktree: ${worktree}.`,
      'Optimize only files under the current worktree. Do not inspect /home, /root, DSH profile/state, other projects, or search the filesystem. Do not start extra agents.',
      'First read the batch files and the manifest. Make at most one focused optimization to threading, batching, import cost, allocation, precision or caching. Run one small before/after benchmark if cheap; otherwise inspect statically.',
      'Use at most six shell commands total. If no safe improvement is justified, write ALEPH_HANDOFF.md and stop without changing code.',
      'Write ALEPH_HANDOFF.md with changes and before/after measurements. Do not change project budget, queue or scheduling constraints. The Host commits the batch branch and runs the single batch entrypoint.',
    ].join('\n');
    const abort = new AbortController();
    let activation;
    try {
      activation = await this.subagents.startActivation({
        provider: 'spawn', label: `aleph infra ${batch.id}`, delivery: 'caller', signal: abort.signal,
        request: { parent: agent, cwd: worktree, agentPreset: 'aleph-infra', prompt: [{ type: 'text', text: prompt }] },
      });
    } catch (error) {
      await git(project.missionRoot, ['worktree', 'remove', '--force', worktree]).catch(() => undefined);
      throw error;
    }
    await this.mutate(projectId, (current) => ({ ...current, agents: [...(current.agents ?? []), { role: 'infra', childId: activation.childId ?? null, status: 'running', summary: null, branch: batch.branch, updatedAt: now() }] }));
    try {
      const result = await activation.result;
      const handoff = await readFile(join(worktree, 'ALEPH_HANDOFF.md'), 'utf8').catch(() => '');
      const summary = (handoff || (result?.output ?? []).filter((block) => block?.type === 'text').map((block) => block.text).join('\n') || '(no summary)').trim().slice(0, 8000);
      const dirty = (await git(worktree, ['status', '--porcelain'])).stdout.trim();
      if (dirty) {
        await git(worktree, ['add', '-A']);
        await git(worktree, ['-c', 'user.name=AlephResearch', '-c', 'user.email=aleph@localhost', 'commit', '-m', `infra optimization for ${batch.id}\n\n${summary.slice(0, 4000)}`]);
        const tip = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
        await git(project.missionRoot, ['branch', '-f', batch.branch, tip]);
      }
      await this.mutate(projectId, (current) => ({ ...current, agents: (current.agents ?? []).map((item) => item.role === 'infra' && item.status === 'running' ? { ...item, status: 'done', summary, branch: batch.branch, updatedAt: now() } : item) }));
      return this.runBatch({ projectId, batchId });
    } catch (error) {
      await this.mutate(projectId, (current) => ({ ...current, agents: (current.agents ?? []).map((item) => item.role === 'infra' && item.status === 'running' ? { ...item, status: 'failed', summary: String(error), updatedAt: now() } : item) }));
      throw error;
    } finally {
      await git(project.missionRoot, ['worktree', 'remove', '--force', worktree]).catch(() => undefined);
      await rm(worktree, { recursive: true, force: true }).catch(() => undefined);
      this.activations?.delete?.(abort);
    }
  }

  async formBatch({ projectId, machineId = 'local' }) {
    const project = this.get(projectId);
    if (!project) throw new Error(`project not found: ${projectId}`);
    const machine = project.machines.find((item) => item.id === machineId);
    if (!machine) throw new Error(`machine not found: ${machineId}`);
    if (machine.status !== 'idle') throw new Error(`machine ${machineId} is busy`);
    const approved = project.missions.filter((mission) => mission.status === 'approved');
    if (approved.length === 0) throw new Error('no approved missions');
    const batchId = newId('b');
    const batchBranch = `batch/${batchId}`;
    const baseTip = (await git(project.missionRoot, ['rev-parse', project.templateBranch])).stdout.trim();
    await git(project.missionRoot, ['switch', '-c', batchBranch, project.templateBranch]);
    const preBatch = {};
    for (const mission of approved) {
      preBatch[mission.id] = (await git(project.missionRoot, ['rev-parse', mission.branch])).stdout.trim();
      try {
        await git(project.missionRoot, ['-c', 'user.name=AlephResearch', '-c', 'user.email=aleph@localhost', 'merge', '--no-ff', '-m', `merge mission ${mission.id}`, mission.branch]);
      } catch (error) {
        await git(project.missionRoot, ['merge', '--abort']).catch(() => undefined);
        await git(project.missionRoot, ['switch', project.templateBranch]);
        throw new Error(`merge conflict for mission ${mission.id}; Composer must resolve it before batching`);
      }
    }
    await git(project.missionRoot, ['switch', project.templateBranch]);
    return this.mutate(projectId, (current) => ({
      ...current,
      machines: current.machines.map((item) => item.id === machineId ? { ...item, status: 'busy', batchId } : item),
      missions: current.missions.map((mission) => (
        approved.some((item) => item.id === mission.id)
          ? { ...mission, status: 'batched', batchId, preBatchTip: preBatch[mission.id] }
          : mission
      )),
      batches: [...current.batches, {
        id: batchId,
        machineId,
        status: 'forming',
        missionIds: approved.map((mission) => mission.id),
        branch: batchBranch,
        baseTip,
        createdAt: now(),
      }],
    }));
  }
}

function snapshot(project) {
  return {
    schema: 2,
    generated_at: now(),
    project: {
      id: project.id,
      title: project.workspace.split('/').pop() || 'Aleph project',
      status: 'running',
      workspace: project.workspace,
      research_root: project.researchRoot,
      mission_root: project.missionRoot,
      template_branch: project.templateBranch,
      eval_command: project.evalCommand,
      researcher_count: project.researcherCount ?? 4,
    },
    missions: project.missions.map((mission) => ({
      id: mission.id,
      owner_session: mission.ownerSession,
      status: mission.status,
      branch: mission.branch,
      manifest_id: mission.manifestId ?? null,
      batch_id: mission.batchId,
      pre_batch_tip: mission.preBatchTip ?? null,
      result_commit: mission.resultCommit ?? null,
      error: mission.error ?? null,
      created_at: mission.createdAt,
      approved_at: mission.approvedAt ?? null,
      finished_at: mission.finishedAt ?? null,
    })),
    batches: project.batches.map((batch) => ({
      id: batch.id,
      machine_id: batch.machineId,
      status: batch.status,
      mission_ids: batch.missionIds,
      branch: batch.branch,
      base_tip: batch.baseTip ?? null,
      created_at: batch.createdAt,
      started_at: batch.startedAt ?? null,
      finished_at: batch.finishedAt ?? null,
      summary: batch.summary ?? null,
    })),
    machines: project.machines,
    agents: project.agents ?? [],
    counts: {
      queued: project.missions.filter((mission) => ['proposed', 'approved'].includes(mission.status)).length,
      running: project.missions.filter((mission) => ['batched', 'running'].includes(mission.status)).length,
      done: project.missions.filter((mission) => mission.status === 'done').length,
      failed: project.missions.filter((mission) => mission.status === 'failed').length,
    },
  };
}

export const inject = ['storageDomain', 'tools', 'webServer'];

export async function apply(ctx) {
  const domain = await ctx.storageDomain.open(projectDomain);
  ctx.effect(() => () => { void domain.close(); });
  const sessions = ctx.get('sessions');
  const subagents = ctx.get('subagents');
  const agentPresets = ctx.get('agentPresets');
  const workspaceRegistry = ctx.get('workspaceRegistry');
  const service = new ProjectService(ctx, domain, { sessions, subagents, agentPresets });

  const presetOf = (agent) => {
    if (!sessions || !agentPresets) return null;
    const session = sessions.get(agent?.id);
    return session ? agentPresets.presetForSession(session) : null;
  };
  const isAleph = (agent) => ['aleph', 'aleph-researcher', 'aleph-composer', 'aleph-infra'].includes(presetOf(agent));
  const isLeader = (agent) => presetOf(agent) === 'aleph';
  const projectIdParam = { project_id: { type: 'string', required: true, description: 'Project id' } };

  const disposers = [
    ctx.tools.register(tool(
      'aleph_init_project',
      'Initialize the DSH project: research repo, mission template repo, machine registry and queues.',
      {
        workspace: { type: 'string', description: 'Absolute workspace path; defaults to the session cwd' },
        eval_command: { type: 'string', description: 'Research evaluator command' },
        visible_data: { type: 'string' },
        testset: { type: 'string' },
        submission_python: { type: 'string' },
        researchers: { type: 'integer', description: 'Default researcher count (default 4)' },
      },
      async (args, exec) => service.init({
        workspace: service.workspaceFor(exec.agent, args.workspace),
        evalCommand: args.eval_command,
        visibleData: args.visible_data,
        testsetPath: args.testset,
        submissionPython: args.submission_python,
        researchers: args.researchers ?? 4,
        agent: exec.agent,
      }),
    ), { when: ({ agent }) => isLeader(agent) }),
    ctx.tools.register(tool(
      'aleph_status',
      'Return projects, missions, batches and machines.',
      { project_id: { type: 'string', description: 'Optional project id' } },
      async (args) => (args.project_id ? [service.get(args.project_id)].filter(Boolean) : service.list()).map(snapshot),
    ), { when: ({ agent }) => isAleph(agent) }),
    ctx.tools.register(tool(
      'aleph_propose_mission',
      'Register a mission branch created by the researcher; Leader approval is required before batching.',
      {
        ...projectIdParam,
        branch: { type: 'string', required: true, description: 'Mission branch in the mission repo' },
      },
      async (args, exec) => service.propose({ projectId: args.project_id, branch: args.branch, agent: exec.agent }),
    ), { when: ({ agent }) => isAleph(agent) }),
    ctx.tools.register(tool(
      'aleph_approve_mission',
      'Approve a proposed mission and move it to the approved queue.',
      { ...projectIdParam, mission_id: { type: 'string', required: true } },
      async (args) => service.approve({ projectId: args.project_id, missionId: args.mission_id }),
    ), { when: ({ agent }) => isLeader(agent) }),
    ctx.tools.register(tool(
      'aleph_form_batch',
      'MissionComposer entry: merge approved missions into a machine-bound batch branch.',
      { ...projectIdParam, machine_id: { type: 'string', description: 'Machine id, default local' } },
      async (args) => service.formBatch({ projectId: args.project_id, machineId: args.machine_id ?? 'local' }),
    ), { when: ({ agent }) => isAleph(agent) }),
    ctx.tools.register(tool(
      'aleph_evaluate',
      'Evaluate the research branch after all missions owned by this researcher are done; Host writes the report into the research commit message.',
      { ...projectIdParam },
      async (args, exec) => service.evaluate({ projectId: args.project_id, agent: exec.agent }),
    ), { when: ({ agent }) => isAleph(agent) }),
    ctx.tools.register(tool(
      'aleph_run_researcher',
      'Start a researcher subagent in the research repo; it proposes missions and waits only for its own missions.',
      { ...projectIdParam },
      async (args, exec) => service.startResearcher({ projectId: args.project_id, agent: exec.agent }),
    ), { when: ({ agent }) => isLeader(agent) }),
    ctx.tools.register(tool(
      'aleph_run_researchers',
      'Start the project default number of researcher subagents, each with its own research worktree and branch.',
      { ...projectIdParam, count: { type: 'integer', description: 'Optional count; defaults to the project researcher count' } },
      async (args, exec) => service.startResearchers({ projectId: args.project_id, count: args.count, agent: exec.agent }),
    ), { when: ({ agent }) => isLeader(agent) }),
    ctx.tools.register(tool(
      'aleph_run_composer',
      'Start MissionComposer to inspect the approved queue and form a machine-bound batch.',
      { ...projectIdParam },
      async (args, exec) => service.runComposer({ projectId: args.project_id, agent: exec.agent }),
    ), { when: ({ agent }) => isLeader(agent) }),
    ctx.tools.register(tool(
      'aleph_run_infra',
      'Start InfraOptimizer on a forming batch, then run the batch and deliver per-mission results.',
      { ...projectIdParam, batch_id: { type: 'string', required: true } },
      async (args, exec) => service.runInfra({ projectId: args.project_id, batchId: args.batch_id, agent: exec.agent }),
    ), { when: ({ agent }) => isLeader(agent) }),
    ctx.tools.register(tool(
      'aleph_run_batch',
      'Run a formed machine-bound batch, write per-mission result envelopes and cherry-pick results to pre-batch mission branches.',
      { ...projectIdParam, batch_id: { type: 'string', required: true } },
      async (args) => service.runBatch({ projectId: args.project_id, batchId: args.batch_id }),
    ), { when: ({ agent }) => isAleph(agent) }),
  ];
  ctx.effect(() => () => { for (const dispose of disposers) dispose(); });

  const sendJson = (res, status, body) => {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text), 'cache-control': 'no-store' });
    res.end(text);
  };
  ctx.webServer.register({
    kind: 'exact',
    path: '/api/aleph/snapshot',
    handler(req, res) {
      const project = service.list().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      if (!project) return sendJson(res, 404, { ok: false, error: { code: 'aleph/no-project' } });
      return sendJson(res, 200, snapshot(project));
    },
  });
  ctx.webServer.register({
    kind: 'exact',
    path: '/api/aleph/projects',
    handler(req, res) {
      return sendJson(res, 200, { projects: service.list().map(snapshot) });
    },
  });
  ctx.webServer.register({
    kind: 'exact',
    path: '/api/aleph/init',
    async handler(req, res) {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false });
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const args = body ? JSON.parse(body) : {};
        const project = await service.init({
          workspace: args.workspace,
          evalCommand: args.evalCommand ?? args.eval_command,
          visibleData: args.visibleData ?? args.visible_data,
          testsetPath: args.testset ?? args.testsetPath,
          submissionPython: args.submissionPython ?? args.submission_python,
          researchers: args.researchers ?? 4,
        });
        return sendJson(res, 200, snapshot(project));
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: { code: 'aleph/init-failed', message: String(error?.message ?? error) } });
      }
    },
  });
  ctx.webServer.register({
    kind: 'exact',
    path: '/api/aleph/workspace',
    async handler(req, res) {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false });
      const registry = workspaceRegistry ?? ctx.get('workspaceRegistry');
      if (!registry) return sendJson(res, 503, { ok: false, error: { code: 'aleph/workspace-unavailable' } });
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const args = body ? JSON.parse(body) : {};
        const workspace = await registry.create(args.path);
        return sendJson(res, 200, { workspace: { id: workspace.workspaceId, path: workspace.path, title: workspace.title } });
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: { code: 'aleph/workspace-failed', message: String(error?.message ?? error) } });
      }
    },
  });
  ctx.webServer.register({
    kind: 'exact',
    path: '/api/aleph/health',
    handler(req, res) {
      return sendJson(res, 200, { ok: true, version: '0.3.0', storage: DOMAIN_NAME });
    },
  });
}

export { ProjectService, snapshot };
