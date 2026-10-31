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

## Current boundaries

- One local machine; multi-machine is an interface extension.
- Composer conflict handling is one merge attempt and fails to the operator.
- Batch optimization is agent-driven and bounded by prompt.
- The core project/mission/batch/result/evaluate path has an automated
  integration test in `dsh-plugin/test`; multi-machine and richer conflict
  handling remain future work.

## Persistent dispatch and cancellation

Projects carry optional persistent `control` state. Legacy records default to
`running`; pause, resume and finish increment the control revision and retain an
operation identifier. `finishing` drains existing batch/InfraOptimizer owners,
then becomes `finished`. Queued work remains available for inspection. An
existing evaluation is independent of dispatch admission.

`ProjectControls` serializes bounded admission, Git publication, cancellation
intent and final settlement per project. Long compute and activation disposal
run outside the lock. A batch reservation precedes worktree creation, including
the InfraOptimizer preparation window. The reservation prevents duplicate
requests from deleting or reusing the same directory. Result publication and the
mission's persisted terminal state share the lock: cancellation either preserves
an already delivered result or prevents the later branch update.

Host batch/dependency commands run through `execution-owner.mjs` and a small
launcher. The launcher atomically records Linux boot/session/group/start
identity, then waits for Host admission. Durable stop fences close explicit
cancellation's pre-spawn gap. Startup reconciliation finishes before tools and
routes are registered. Ordinary restart does not stop compute: read-only receipt
observation retains active or unverifiable groups, and the five-second monitor
follows only identities captured at startup until their processes exit. Legacy
commands use the readable Linux process-cwd scope, retaining ownership when
`/proc` enumeration is unavailable. Forming reservations remain busy. Settlement
preserves outputs and branches, records interrupted undelivered work without
rerunning it, and releases only matching machine/batch/execution ownership.
New or replaced executions and agents are excluded from follow-up reconciliation.
Persisted `cancelling` intent resumes the existing stop protocol instead. Exact
activation receipts own InfraOptimizer disposal; a resolved result does not
substitute for successful disposal. Ordinary restart preserves an unreconstructed
InfraOptimizer activation's reservation. Unknown explicit cancellation cleanup
retains `cancelling`, the machine assignment and the worktree.

Machine release checks batch and execution ownership. Late callbacks cannot
publish results for a cancelled or replaced execution. Composer cleanup is
scheduled independently of the finishing Host tool to avoid disposal waiting on
its own caller; cleanup status is reported separately. This is a single Host,
Linux process-group protocol, not a multi-Host transaction or a guarantee over
processes that create independent sessions. Operator routes rely on the DSH
browser authentication boundary; model tools additionally enforce Leader and
workspace authority. Frontend controls remain a separate change.
