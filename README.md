# AlephResearch

AlephResearch is a DSH-native research project plugin. A researcher works in a
research repo; hardware-heavy work is packaged as an independent mission repo
branch, approved by the Leader, composed into a machine-bound batch by
MissionComposer, optimized and run by InfraOptimizer, and returned to the
researcher through the pre-batch mission branch.

## Repositories and state

A DSH workspace/project contains:

- `research/`: the researcher's own git repo and branches.
- `missions/`: a separate mission repo initialized from `template`.
- MissionQueue, BatchQueue, Machine registry, agents and results in the
  `aleph_project` DSH storage domain.

There is no campaign layer and no `~/.aleph` directory.

## Mission lifecycle

1. Researcher works in the research repo and commits research changes.
2. For a hardware-heavy task, researcher creates a mission branch from
   `template`, adds `missions/<mission-id>/mission.json`, code, uv project and
   entrypoint, then calls `aleph_propose_mission`.
3. Leader calls `aleph_approve_mission`; approved missions enter the queue.
4. MissionComposer (`aleph_run_composer`) merges approved mission branches into
   a machine-bound batch branch and resolves merge conflicts.
5. InfraOptimizer (`aleph_run_infra`) optimizes the merged batch code for the
   target machine, commits the optimization and runs the single batch
   entrypoint.
6. Each mission receives a result envelope and a result commit. The Host
   cherry-picks that commit onto the mission's pre-batch branch.
7. The researcher waits only for its own missions, calls `aleph_evaluate`, and
   the Host evaluates the research branch and writes the report into the
   research commit message.

## Tools

- `aleph_init_project`
- `aleph_status`
- `aleph_propose_mission`
- `aleph_approve_mission`
- `aleph_run_composer`
- `aleph_form_batch`
- `aleph_run_infra`
- `aleph_run_batch`
- `aleph_evaluate`
- `aleph_run_researcher`

## Install

```bash
npm install --prefix dsh-plugin
dsh plugin --profile web add "$PWD/dsh-plugin"
```

Reload the Web UI, open the project workspace, and choose `Aleph Research`.
The `Aleph` sidebar entry shows the project, machines, agents, batches and
mission queues.

For an isolated test profile:

```bash
./scripts/dsh-lab.sh
```

## Result envelope

Each mission result is a fixed envelope with free-form payload:

```json
{
  "schema": 1,
  "mission_id": "m-test",
  "batch_id": "b-...",
  "machine_id": "local",
  "status": "done",
  "metrics": {},
  "artifacts": [],
  "logs": [],
  "resource": {},
  "error": null
}
```

Results are committed to `results/<mission-id>/result.json` on the mission
branch and cherry-picked back to the pre-batch branch.

## Status

The project/mission/batch core, Composer agent, result cherry-pick and
researcher evaluate path have been exercised in an isolated DSH. See
`docs/STATUS.md` and `docs/architecture.md`.
