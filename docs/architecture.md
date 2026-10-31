# DSH-native architecture

AlephResearch is a Host plugin, not a separate runtime. Campaign state, control
and researcher dispatch use DSH services directly.

## Integration points

| DSH facility | AlephResearch use |
| --- | --- |
| `ctx.storageDomain` | Durable `aleph_research` domain with one `campaigns` table. |
| `ctx.tools` | Leader tools for campaign start, status, enqueue, batch composition, parallel dispatch, InfraOptimizer and exploration/budget controls. |
| `ctx.subagents.startActivation` | One `aleph-researcher` child per mission. |
| `ctx.sessions` | Resolve the Leader workspace from the session header `cwd`. |
| `ctx.agentPresets` | Host `aleph`, `aleph-researcher`, `aleph-composer` and `aleph-infra` presets. |
| `ctx.webServer` | Read-only state routes and workspace creation route. |
| Client panel | `Aleph` sidebar entry polling `/api/aleph/snapshot`. |

No `~/.aleph` pointer, external daemon, standalone SQLite queue or shell CLI
controls campaign state.

## State model

The storage domain is declared once:

```js
defineDomain({
  name: 'aleph_research',
  version: 1,
  tables: { campaigns: domainTable(campaignSchema) },
})
```

A campaign record contains the workspace path, status, exploration level,
budget, spent count, SOTA branch and score, evaluator command, research root,
visible-data path, timestamps and mission records. Each mission records its
strategy, base branch, branch, base commit, final commit, score, child session
id, error and reclamation flag.

## Mission lifecycle

1. `aleph_start_campaign` resolves the workspace from the tool argument or the
   calling session `cwd`, creates `research/` and `.aleph/` when absent, and
   writes the campaign record to DSH storage.
2. `aleph_enqueue_mission` samples L0 to L3 and appends a queued mission.
3. `aleph_run_next` creates a git worktree under
   `<workspace>/.aleph/worktrees/<campaign>/<mission>`, records the base commit,
   and starts a local `spawn` subagent with the `aleph-researcher` preset.
4. The researcher edits files and writes `ALEPH_HANDOFF.md`. It does not commit
   or touch campaign state.
5. On completion, the Host service reads the handoff, resets the worktree to the
   base commit, creates one commit, embeds the handoff and trailers, evaluates
   the commit, updates the mission and SOTA, and reclaims the worktree.
6. A failed command, missing handoff or evaluator error marks the mission
   failed; the worktree is still reclaimed.

## Workspace and data boundaries

- Campaign state is not stored in the workspace; it is in DSH storage.
- Worktrees and logs are workspace-local `.aleph/` data and can be gitignored.
- The campaign workspace must be the DSH session workspace or a directory inside
  it. The researcher inherits the session's workspace-write sandbox; a campaign
  outside that boundary is rejected before dispatch because its worktree would
  be read-only.
- The researcher never sees the leader workspace outside its worktree.
- Hidden test data and evaluator configuration remain Leader-side.
- The evaluator receives `ALEPH_TESTSET` when a testset path is configured and
  `ALEPH_SUBMISSION_PYTHON` when a submission interpreter is configured.

## Role agents

Composer and InfraOptimizer are DSH agents, not Host helper functions:

- `aleph_run_composer` starts an `aleph-composer` child. Composer owns batch
  orchestration, VRAM profiling, queue-head priority and backfill. It calls
  `aleph_compose_batch` with explicit per-mission priorities and VRAM
  estimates.
- `aleph_run_infra` creates a dedicated code worktree from the campaign base
  and starts an `aleph-infra` child. InfraOptimizer optimizes that code for the
  actual machine: it profiles CPU/GPU/memory/IO, removes redundant work, tunes
  threading, batching, precision, caching, compilation and runtime parameters,
  runs a short before/after benchmark, and writes `ALEPH_HANDOFF.md`. The Host
  commits one commit and returns an `infra/...` branch; hidden-test promotion
  is not part of this role.
- InfraOptimizer does not set campaign constraints. Budget, concurrency,
  exploration and evaluation runtime are Leader-side controls;
  `aleph_run_infra` gives the agent one worktree and no constraint tools.
- Both runs are recorded in `campaign.agents` with role, child session id,
  status and summary, and shown in the console.

## Composer batches

`aleph_compose_batch` creates one batch record and several queued missions that
share a brief but rotate through L0 to L3. A batch is visible in the console and
on each mission as a `batch` id. The Composer agent supplies the brief,
priorities and per-mission VRAM estimates. `aleph_run_available` sorts queued
missions by priority, then skips a mission that does not fit the remaining GPU
memory and attempts the next one, so lower-priority work backfills free slots.

## Host capacity and cost controls

Campaign creation probes CPU cores, NVIDIA GPUs, memory, and free disk, then
sets a concurrency limit (`ALEPH_MAX_PARALLEL` can override it).
`aleph_infra_status` refreshes that snapshot. `aleph_run_available` starts
queued missions only while the number of running missions is below the limit,
so a Composer batch cannot oversubscribe the host.

The Host maintains a cumulative cost profile (GPU seconds, evaluation seconds,
artifact bytes), a per-commit evaluation cache, and evaluator runtime settings
(`OMP_NUM_THREADS`, timeout). These are Leader-side controls for scheduling and
observability, not InfraOptimizer responsibilities. Evaluations run through a
serialized queue to avoid training/evaluation contention on the shared GPU. A
budget vector can cap missions, GPU seconds and artifact bytes; token accounting
is not yet available.

## Researcher compute boundary

A researcher mission is deliberately small. The Host prompt and the
`aleph-researcher` preset forbid:

- large training runs and long-running jobs;
- multi-seed or multi-configuration sweeps;
- multi-GPU work;
- dataset-scale generation;
- benchmarking campaigns and extra agents.

Reading files, focused edits, quick tests, one small fit/evaluation and bounded
commands that finish inside the mission are allowed. If a question needs heavy
compute, the researcher must stop and write a proposal in the handoff with
hypothesis, command, expected GPU time, VRAM, disk and priority. The Leader then
opens a separate mission and Composer batches it with an explicit resource
profile.

## Evaluation

The evaluator command runs in the campaign workspace with
`ALEPH_WORKSPACE`, `ALEPH_SOLUTION_DIR`, `ALEPH_SUBMISSION` and optional
`ALEPH_VISIBLE_DATA`. It must print a JSON line with a numeric `score`.

## Current boundaries

- The console is read-only and shows the most recently updated campaign.
- Only the implemented tools exist; there is no pause, budget enforcement or
  concurrent mission runner yet.
- The evaluator is supplied by the project; no default task protocol is bundled.
- Git LFS/CoW and OpenTelemetry from the prototype are not active in this
  Host plugin.
