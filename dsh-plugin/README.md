# @local/dsh-aleph-research

DSH-native AlephResearch bundle.

The Host entry initializes a project with separate research and mission git
repositories, an approved MissionQueue, a machine registry and a batch queue.
MissionComposer and InfraOptimizer run as `aleph-composer` and `aleph-infra`
subagents. The client entry adds the `Aleph` project console.

On Host restart, an unexecuted forming batch keeps its matching machine
reservation. Running batches found during startup remain active while their
worktree still has an observable process, and the five-second Host monitor
marks them interrupted after exit without requiring another restart. Recovery
preserves orphan output and refuses rerunning failed batches; it does not
automatically deliver those results. Newly started work and agent records are
not included in this later recovery scan. See `docs/architecture.md` in the
repository for the Linux observation boundary.

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
