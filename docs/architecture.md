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
| `ctx.agentPresets` | Show tools only in the `aleph` preset. |
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

## Composer

`aleph_compose_batch` creates one batch record and several queued missions that
share a brief but rotate through L0 to L3. A batch is visible in the console and
on each mission as a `batch` id. Composer handles queue composition and budget
guarding; it does not call an LLM itself.

## InfraOptimizer

Campaign creation probes CPU cores, NVIDIA GPUs, memory, and free disk, then
sets a concurrency limit (`ALEPH_MAX_PARALLEL` can override it).
`aleph_infra_status` refreshes that snapshot. `aleph_run_available` starts
queued missions only while the number of running missions is below the limit,
so a Composer batch cannot oversubscribe the host.

This is capacity-aware scheduling, not a full cost model: budget is counted in
missions, and there is no GPU-time or token accounting in this version.

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
