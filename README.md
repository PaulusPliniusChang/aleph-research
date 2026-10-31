# AlephResearch

An automated research loop for DeepSeek Harness: a Leader plans, ephemeral
researchers edit code in isolated git worktrees, and a leader-side evaluator
scores submissions. SQLite holds campaign state; git holds code and branches.

## What is in this repository

- `runtime/` — Python runtime and `aleph` CLI (first runnable version).
- `dsh-plugin/` — DSH plugin: `Aleph Research` mode, console panel and a
  read-only snapshot API.
- `docs/` — requirements, topology and strategy design notes.
- `aleph` — launcher for the runtime from this checkout.

## Quick start (toy campaign)

```bash
./aleph init /tmp/aleph-demo --json
./aleph status --workspace /tmp/aleph-demo
./aleph run --workspace /tmp/aleph-demo --max 3
./aleph status --workspace /tmp/aleph-demo
```

`init` creates a leader workspace with:

- `eval/run_eval.py` — toy evaluator.
- `testsets/hidden.json` — hidden target value (not exposed to researchers).
- `research/` — nested git repository with `initialize`, `sota/main` and demo
  branches `exp/a`, `exp/b`, `exp/c`.
- `.aleph/state.sqlite` — campaign state (gitignored).
- `.aleph/dashboard.json` — snapshot consumed by the DSH console.

`run` claims queued missions, creates a worktree for each candidate branch,
commits any researcher changes, evaluates the submission in the leader
workspace, and promotes the best score to `sota/main`.

## Commands

```bash
./aleph init PATH [--title T] [--no-demo] [--force]
./aleph mission add --branch exp/a [--strategy auto|L0|L1|L2|L3] [--description D]
./aleph mission list
./aleph tick
./aleph run --max N
./aleph status [--json]
```

Mission commands run inside the mission worktree; evaluators run in the
leader workspace with `ALEPH_SOLUTION_DIR`, `ALEPH_TESTSET` and
`ALEPH_SUBMISSION`.

## Tests

```bash
PYTHONPATH=runtime python3 -m unittest discover -s runtime/tests -v
```

## Researcher lifecycle

One researcher mission owns one worktree and one commit. The runtime passes
`ALEPH_HANDOFF_PATH` and `ALEPH_RESEARCHER_HOME`, requires a non-empty handoff
report for researcher missions, and only after the researcher command exits
successfully collapses every researcher commit into a single commit whose
parent is the mission base. The handoff is embedded in the commit message with `Aleph-Mission`, `Aleph-Campaign`, `Aleph-Strategy` and
`Aleph-Base-Commit` trailers. The worktree and per-mission researcher home are
removed afterwards; only the commit, handoff log and evaluation remain.

## Observability

The runtime exports OpenTelemetry traces and metrics over OTLP HTTP/protobuf,
with a no-op fallback when the SDK or endpoint is absent. Install
`runtime/requirements-otel.txt`, set `OTEL_EXPORTER_OTLP_ENDPOINT`, and use
`aleph telemetry` to inspect the configuration. Spans cover CLI invocations,
missions, worktrees, LFS CoW, researcher commands, commits, evaluation and SOTA
promotion; metrics cover mission counts and durations, eval scores, branch
scores, strategy samples, budget spend and disk usage. Trace context is passed
to researcher and evaluator subprocesses through `TRACEPARENT`.

See `docs/observability.md` for signal names, environment variables and the
future expansion points.

## Git LFS

Research repositories and the leader workspace default to Git LFS for large
binary artifacts (`.cbm`, `.pt`, `.safetensors`, `.npz`, `.parquet`, archives
and similar). `aleph init` and local case setups run `git lfs install --local`
and commit a `.gitattributes`; small text data and hidden testsets stay in
normal Git objects. If `git-lfs` is not installed, setup falls back to normal
Git objects.

Model artifacts are committed as LFS pointers and restored on checkout. Mission
and evaluation worktrees then replace the checked-out copy with a reflink to
the local LFS object (`cp --reflink=auto`), so the worktree shares the object's
extents instead of duplicating them. Filesystems without reflink fall back to a
normal copy.

## Isolated DSH experiment

`scripts/dsh-lab.sh` builds a private DSH home (`/tmp/aleph-dsh-lab` by default),
creates a web profile, installs the plugin bundle there, initializes a toy
campaign and prints the command that starts the Web Host. The current DSH
profile is untouched.

![Aleph Research console](docs/assets/aleph-console.png)

## DSH plugin

The plugin directory is installable with the DSH plugin manager
(`install_bundle` with the absolute `dsh-plugin` path). It registers the
`aleph` and `aleph-researcher` modes, a full-page console and
`/api/aleph/snapshot`; the console reads
`<workspace>/.aleph/dashboard.json` through `~/.aleph/current_workspace`.
Installation and live UI verification happen in DSH; see
`dsh-plugin/README.md`.

## Status and limits

This is a first vertical slice: the runtime is a CLI loop, the console is
read-only, and the toy evaluator is deliberately small. The design notes in
`docs/` describe the intended evolution (batch scheduling, strategy sampling
details, infrastructure optimization, researcher subagents).
