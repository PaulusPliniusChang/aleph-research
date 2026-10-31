# DSH-native project architecture

## Top-level state

One DSH workspace/project owns:

- `research/` git repository for researcher work.
- `missions/` git repository initialized from a fixed `template` commit.
- MissionQueue, BatchQueue, machine registry, agents and result records in the
  `aleph_project` storage domain.

No campaign layer, external daemon, SQLite sidecar or `~/.aleph` directory is
used.

## Mission packaging

A mission branch is created from `template` by the researcher. It contains:

- `missions/<mission-id>/mission.json` with id, entrypoint, output declaration
  and resource hints.
- mission code and an uv project.
- a single batch entrypoint contribution.

`aleph_propose_mission` validates the branch ancestry and manifest and records
the owner session. `aleph_approve_mission` moves it into the approved queue.

## Composer and machines

MissionComposer is an `aleph-composer` DSH subagent. It inspects the approved
queue and calls `aleph_form_batch`.

- One machine runs one batch at a time and the batch owns that machine.
- The batch branch is created from `template` and merges approved mission
  branches.
- Composer resolves merge conflicts and records each mission's pre-batch tip.
- A single merged entrypoint runs the missions and writes per-mission outputs.

## InfraOptimizer

InfraOptimizer is an `aleph-infra` DSH subagent. It receives the batch worktree,
profiles the target machine, optimizes the merged code for CPU/GPU/memory/IO,
commits the optimization to the batch branch, and runs the batch entrypoint.
It does not set project budget, queue or scheduling constraints.

## Result delivery

The batch runner writes each mission result to
`results/<mission-id>/result.json` and artifacts. Host creates a per-mission
result commit and cherry-picks it onto the pre-batch mission branch. The result
envelope has fixed routing fields and free-form metrics/artifacts.

## Researcher lifecycle

The project default researcher count is 4. `aleph_run_researchers` starts that
many researcher subagents; each receives a separate research branch and
worktree. A researcher may propose several missions over its lifetime.

Researcher prompts require inspecting the complete git history of both research
and mission repositories with `git log --all`, `git branch -a`, `git show` and
`git diff`. Before proposing a mission, the researcher must check mission
branches and result commits for an equivalent mission. Already-run missions must
not be rerun; their result commits and envelopes are read instead.

The researcher waits only for missions owned by its session. When those missions
are done, `aleph_evaluate` evaluates the research branch; the Host writes the
evaluation report into the research commit message and the researcher finishes.

## Host restart recovery

Startup reconciliation completes before product tools and routes are registered.
A machine reserved by its matching `forming` batch remains busy, so another
batch cannot take its capacity before the original batch runs. Stale agent
records are closed only from the startup snapshot.

Running batches captured at startup are watched by the existing five-second
Host monitor. A live process with a readable cwd under the batch worktree keeps
the batch and its reservation active. Once no such process is observed, the
captured batch and its waiting missions are marked interrupted (`failed`), and
only its matching machine reservation is released. Tracking checks the captured
batch identity, ignores work started after startup and retries failed durable
writes. It does not periodically repeat full startup reconciliation.

Interrupted output and Git worktrees remain available for inspection. Recovery
does not rerun compute or automatically deliver orphan results; explicitly
rerunning a failed batch is refused. Already delivered results remain stable.
If the `/proc` directory cannot be enumerated, recovery retains the reservation
for a later check. Observation otherwise retains the existing Linux readable-cwd
scope; processes with unreadable cwd or work outside that directory are not
covered by a complete process-ownership guarantee. This is single-Host recovery,
not an independent execution supervisor or a cross-Host coordination protocol.

## Current boundaries

- One local machine; multi-machine is an interface extension.
- Composer conflict handling is one merge attempt and fails to the operator.
- Batch optimization is agent-driven and bounded by prompt.
- The core project/mission/batch/result/evaluate path has an automated
  integration test in `dsh-plugin/test`; multi-machine and richer conflict
  handling remain future work.
