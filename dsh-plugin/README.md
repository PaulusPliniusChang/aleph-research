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

## Committed evaluation input

Commit all tracked changes, staged changes, and untracked research files before
calling `aleph_evaluate`. Uncommitted input returns
`ALEPH_EVALUATION_UNCOMMITTED` with the worktree, Git statuses, and exact paths to
commit before retrying. The Host does not stage, commit, stash, clean, or remove
files from the original researcher worktree. Ordinary Git ignore rules apply;
ignored files are not copied into evaluation snapshots. Required ignored input
must be explicitly committed before evaluation.

Every evaluation, including a researcher's own branch, runs from a separate
detached worktree at the commit captured before computation. Later research
edits, commits, and branch switches cannot change that evaluation's submitted
input. The evaluator runs from `evalRoot` or the workspace and receives the
snapshot through `ALEPH_SOLUTION_DIR`. A selected branch's associated worktree
must have committed input; dirty worktrees on unrelated branches do not block
evaluating a clean selected branch or a commit without a checked-out worktree.

Report tree, evaluated commit, history, and best record identify the submitted
code. Independent evaluation refs preserve reports; branch compare-and-swap
keeps any later research commit intact. Evaluator-generated files are excluded
from report trees. The configured evaluator is responsible for executing the
submitted input rather than replacing it with other source files.

## Evaluation process lifetime

Managed evaluation requires Linux and readable `/proc` process metadata. Each
evaluation owns a separate process group and session. On timeout, output overflow,
entry failure, or normal entry exit, the Host stops remaining ordinary descendants
with `SIGTERM`, then escalates to `SIGKILL` after a bounded grace period. A
temporary solution worktree is removed only after the owned computation has
stopped. Researcher-owned worktrees remain available.

If process observation or termination cannot confirm a stop, evaluation returns a
diagnostic cleanup error and retains the solution worktree. Further evaluations
in that project first retry cleanup of the recorded group; a new evaluator cannot
start while that cleanup remains uncertain. This cleanup record lives in the
current Host process. It does not provide recovery across a Host restart.

Evaluators must keep descendants in the supplied process group. Processes that
deliberately detach with `setsid`, change process groups, or delegate computation
to another service are outside this lifetime guarantee. The Host does not kill
unrelated processes by matching their working directories. Other operating
systems return an unsupported-platform error before starting an evaluator.

The product tests use real Linux child and grandchild processes. A specifically
tagged integration-test module shortens only its evaluation deadline from ten
minutes to 500 milliseconds. The same tagged helper can inject a `/proc`
observation error to exercise retained-worktree and blocked-retry behavior;
process creation, signaling, and Git operations remain real. Untagged production
imports keep the ten-minute deadline and do not contain that injected failure.
