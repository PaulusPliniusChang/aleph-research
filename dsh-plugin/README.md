# @local/dsh-aleph-research

DSH-native AlephResearch bundle.

The Host entry initializes a project with separate research and mission git
repositories, an approved MissionQueue, a machine registry and a batch queue.
MissionComposer and InfraOptimizer run as `aleph-composer` and `aleph-infra`
subagents. The client entry adds the `Aleph` project console.

## Presets

- `aleph`: Leader and approval tools.
- `aleph-researcher`: research work, mission proposal, evaluate and exit.
- `aleph-composer`: batch composition and conflict handling.
- `aleph-infra`: machine-specific batch code optimization.

## Install

```bash
npm install --prefix .
dsh plugin --profile web add "$PWD"
```

## Development

```bash
npm install
npm test
node --check index-v2.js
node --check client.js
```

## Project dispatch controls

Leader tools now expose `aleph_pause_project`, `aleph_resume_project`,
`aleph_finish_project`, `aleph_cancel_mission`, and `aleph_cancel_batch`.
All require `project_id`; cancellation also requires `mission_id` or `batch_id`.
An optional `reason` is retained with the operation. Control tools check the
calling session's Leader preset and workspace even when invoked directly.

Pause blocks new research, mission creation/proposal, composition, optimization,
and batch execution. An execution reservation acquired before pause counts as
existing work and may finish. Approval during pause only admits work to the
queue. Resume reopens dispatch and reports whether Composer notification was
actually delivered. Finish permanently closes new dispatch and drains existing
execution; ordinary resume cannot reopen a finished project. Existing evaluation
and saved research remain accessible.

Queued missions can be cancelled individually. Batched/running missions require
whole-batch cancellation. Cancellation preserves branches, already delivered
results, current worktrees, and diagnostics in `.aleph/diagnostics/`. It persists
intent before stopping the exact InfraOptimizer activation and Host command
process groups. Dependency preparation is included. Cancellation returns
`complete: false` and retains `cancelling`, machine ownership, and files if
cleanup cannot be confirmed. Repeating cancellation retries the same operation.
A partial batch keeps delivered missions `done`; undelivered missions become
`cancelled`.

Operator HTTP routes use the same controls:
`POST /api/aleph/project/{pause,resume,finish}`,
`POST /api/aleph/mission/cancel`, and `POST /api/aleph/batch/cancel`.
These routes rely on the DSH server's outer browser authentication. HTTP callers
are authenticated operators, not model Agents; a supplied `session_id` grants no
Leader authority. Pending cancellation returns HTTP 202. Console buttons are not
included in this change. Snapshots expose control state, cancelled counts,
execution ownership and cancellation diagnostics.

Batch commands require Linux and `/proc`. Each command has a detached session,
a durable identity receipt, and Host go/stop fences before user computation.
Recovery verifies boot identity and process start time before sending signals.
A missing receipt without a go fence proves no user command was admitted; a stop
fence also prevents a delayed launcher from admitting that command later.
A go fence without its receipt is uncertain and retains machine ownership.
Ordinary descendants must remain in their owned process group. Descendants that
escape with `setsid`, remote services, and arbitrary GPU jobs require a stronger
execution service; this implementation does not prove their termination.

The project lock coordinates one Host's writes; independent Hosts must not write
the same project concurrently. InfraOptimizer receipts cannot be reconstructed
after a Host restart, so an uncertain activation remains `cancelling` and busy
for operator investigation. Composer disposal is asynchronous to avoid waiting
on a Host tool called by that Composer. `control.composerCleanup` reports
`pending`, `complete`, or `failed` separately from dispatch state. Host restart
can leave that cleanup diagnostic pending; it does not manufacture completion.
